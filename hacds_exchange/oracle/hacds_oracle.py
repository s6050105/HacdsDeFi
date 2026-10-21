#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
HACDS 基因证书预言机（单文件，零第三方依赖，无数据库）

职责（对应 DeFi设计文档-v2.md 第 3.2 节，决定点 #1=A / #2=独立账户 / #3=不加过期块）：
  1. 从全节点 RPC 实时读取钻石的 name / number / life_gene；
  2. 用 Diamond_Analyzer v0.1.1（当初交易所使用的版本）的 5 维评分算法逐条复现，
     实时算分（总分下限 1：api.txt Notes "All diamond scores less than 1 will
     be set to 1"）；
  3. 打包 29 字节证书消息 → sha3_256 → 预言机账户 secp256k1 签名（RFC6979 确定性）；
  4. 输出合约可直接消费的证书（Message 动作 data）。

证书消息布局（29 字节，与合约 FitSH 端逐字节对齐）：
  name(6B, ASCII) + visual_gene(10B) + number_u64(8B, big-endian) + score_u32(4B, BE) + version(1B)

签名 wire 格式（与 field::Sign 完全一致，合约 verify_signature 可验）：
  pubkey_compressed(33B) || signature_r||s(64B)   共 97 字节

安全要点：
  - 评分永远链上重算：证书只引入基因字节与编号，预言机无法谎报分数；
  - visual_gene 由 life_gene + name 确定性派生（mint-core/src/exec/diamond.rs:19），
    预言机本地派生后与 RPC 返回的 visual_gene 字段交叉校验，不一致即拒绝出证；
  - 私钥仅支持环境变量 / 密钥文件（0600）两种注入方式，不落参数、不进日志。

用法：
  python hacds_oracle.py genkey --out oracle_secret.hex
  python hacds_oracle.py cert --name MVUUBA --node http://127.0.0.1:3338
  python hacds_oracle.py selftest
  python hacds_oracle.py serve --port 8123 --node http://127.0.0.1:3338
"""

import argparse
import hashlib
import hmac
import json
import os
import struct
import sys
import urllib.request
import urllib.error

# ============================================================
# 常量（评分表逐条拷贝自 Diamond_Analyzer v0.1.1 源码；密码学参数同 secp256k1 标准）
# ============================================================

# x16rs/src/lib.rs:10 —— 钻石名字母表（索引即 hex 字符值）
DIAMOND_NAME_VALID_CHARS = b"WTYUIAHXVMEKBSZN"

# Diamond_Analyzer v0.1.1 分值表（lib/DiamondAnalyser.py 内置 dict 逐条拷贝）。
# 与官方 rule.txt 的差异（已逐条核实，390 颗主网样本归因）：
#   - styles 键无尾随空格（"Right mix pure"），"Symmetry" 改名 "Color Symmetry"，
#     "Half repeat" 改名 "ABCABC"（条件与分值不变）；
#   - "Number Symmetry"（回文编号 10 分）启用（官方源码中已注释）。
RULE_SCORES = {
    # shapes（形状，shape_map，键 "Square|01" 形式仅为兼容本文件内部表示）
    "Square|01": 30, "Ellipse|02": 30, "Heart|03": 50, "Triangle|04": 20,
    "Teardrop|05": 30, "Circle|06": 30, "Rhombus|07": 20, "Hexagon|08": 20,
    # styles（样式，仅形状为 Common 时计，style_map）
    "Pure": 250, "Sum four color": 200, "All 16 color": 200,
    "Sum five color": 100, "All 15 color": 100,
    "Sum six color": 50, "All 14 color": 30,
    "Left three pure": 20, "Left mix pure": 20, "Right three pure": 20,
    "Right mix pure": 20, "Color Symmetry": 20, "Half divide": 20, "Double mix": 20,
    "Sum seven color": 20, "darkColor": 20, "lightColor": 20,
    "Center color": 3, "Edge color": 3,
    # nameliteral（名字字母，name_map）
    "six repeat": 200, "Penta repeat": 50, "ABCABC": 20,
    "Two letters": 10, "Quadro repeat": 10, "AABCCD": 10, "ABBCDD": 10,
    "Symmetric letter": 10, "Three letters": 3, "Triple repeat": 2,
    # numberliteral（编号，number_map）
    "Tail seven": 200, "Tail six": 100, "Tail five": 50, "Repetition": 50,
    "Single num": 30, "Serial num": 25, "Tail four": 20, "Number Symmetry": 10,
    # color（颜色，仅形状非 Common 时计；名字首字符查 color_map）
    "Red cyan|A": 7, "Cyan|B": 6, "Secret|E": 1, "Pink|H": 8, "Red|I": 8,
    "Pink cyan|K": 8, "Yellow secret|M": 2, "Yellow Cyan|N": 6, "Green|S": 6,
    "Blue|T": 8, "Blue purple|U": 3, "Light pink|V": 8, "Dark blue|W": 3,
    "Grey|X": 5, "Red purple|Y": 3, "Gold|Z": 10,
    "darkColor|color": 20, "lightColor|color": 20,
}

# cleanMap 镜像（兼容旧结构）：DA 各维度函数直接返回内置 dict 的键，无需 split，
# 保留此表仅为 _clean_score 查分路径统一。
CLEAN_SCORES = {}
for _k, _v in RULE_SCORES.items():
    CLEAN_SCORES[_k.split("|")[0]] = _v

# 形状前缀 -> metric_en（getDiamondshapes 用 visual_gene 前 2 个 hex 字符查表，
# 命中后返回 metric_en.split("|")[0]，即短名 "Square" 等 —— 与 cleanMap 键一致）
SHAPES_BY_HEX = {
    "01": "Square", "02": "Ellipse", "03": "Heart", "04": "Triangle",
    "05": "Teardrop", "06": "Circle", "07": "Rhombus", "08": "Hexagon",
}

# 颜色表（名字首字符 -> metric_en），getDiamondColor 用；
# getDiamondColor 返回 getMaxScoreFeature(...).split("|")[0] 短名（如 "Yellow secret"）
COLOR_BY_LETTER = {
    "A": "Red cyan", "B": "Cyan", "E": "Secret", "H": "Pink",
    "I": "Red", "K": "Pink cyan", "M": "Yellow secret", "N": "Yellow Cyan",
    "S": "Green", "T": "Blue", "U": "Blue purple", "V": "Light pink",
    "W": "Dark blue", "X": "Grey", "Y": "Red purple", "Z": "Gold",
}

CERT_VERSION = 1          # 证书版本字节
COMMON = "Common diamond" # DA 无命中时的哨兵值（查表不到 → 0 分）

# 预言机地址（由所载入私钥派生；cmd_cert / cmd_serve 载入密钥时刷新）
ORACLE_ADDRESS = ""

# secp256k1 曲线参数
P  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F
N  = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
GX = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798
GY = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8
HALF_ORDER = N // 2       # sys::Account::verify_signature 用 parse_standard（low-S 强制）


# ============================================================
# 5 维评分（Diamond_Analyzer v0.1.1 逐条复现，交易所版基准）
# ============================================================

def visual_gene_hex(name: str, life_gene: bytes) -> str:
    """mint-core/src/exec/diamond.rs:19 calculate_diamond_visual_gene 的精确复现。

    genehexstr[0..2]   = life_gene[31] 的两位 hex（形状字节）
    genehexstr[2..8]   = 名字 6 字符在字母表中的索引 hex
    genehexstr[8..20]  = life_gene[20..31] 各字节 % 16 的 hex
    返回 20 个小写 hex 字符（与 RPC visual_gene 字段一致）。
    """
    if len(name) != 6 or len(life_gene) != 32:
        raise ValueError("name must be 6 chars, life_gene 32 bytes")
    gene = [ord("0")] * 20
    for i, ch in enumerate(name.encode("ascii")):
        idx = DIAMOND_NAME_VALID_CHARS.find(bytes([ch]))
        if idx < 0:
            raise ValueError("invalid diamond name char: %r" % ch)
        gene[i + 2] = ord("%x" % idx)
    idx = 8
    for i in range(20, 31):
        gene[idx] = ord("%x" % (life_gene[i] % 16))
        idx += 1
    gene[0:2] = list(("%02x" % life_gene[31]).encode("ascii"))
    return "".join(chr(c) for c in gene)


def _distinct_chars(s: str) -> int:
    return len(set(s))


def _max_run(s: str) -> int:
    """DA get_max_repeat_count：最长连击（无连击返回 1，与官方 repeat 返回 0 不同；
    DA 的连击块条件是 repeat_count >= 3 / >= 4，1 与 0 都不进块，观察等价）。"""
    best = 1
    cur = 1
    for i in range(1, len(s)):
        if s[i] == s[i - 1]:
            cur += 1
            best = max(best, cur)
        else:
            cur = 1
    return best


def _symmetry(s: str) -> bool:
    """DA is_symmetric：前半 == 后半反转（与官方 symmetry 等价：前半 == 反转前半）。"""
    mid = len(s) // 2
    return s[:mid] == s[-mid:][::-1] if mid else False


def _shunzi(number: str, cha: int) -> bool:
    """DA is_sequential：全串严格递增(1)/递减(-1)；单字符循环体不执行返回 True。

    单字符时 Serial num(25) 必与 Repetition(50) 并存，永不夺魁，故该差异无观察效应，
    此处仍按 DA 原样对齐。
    """
    for i in range(len(number) - 1):
        if int(number[i + 1]) - int(number[i]) != cha:
            return False
    return True


def _dark_or_light(style: str) -> str:
    """DA analyse_color_type（Set 双标志）与官方 darkOrLight 等价：
    全深 → '1'（dark）/ 全浅 → '0'（light）/ 混合 → '2'。"""
    dark = "01234"
    light = "56789abcdef"
    has_dark = has_light = False
    for ch in style.lower():
        if ch in dark:
            has_dark = True
        if ch in light:
            has_light = True
        if has_dark and has_light:
            return "2"
    if has_dark:
        return "1"
    if has_light:
        return "0"
    return "2"


def _max_score_feature(features):
    """DA 各 analyse_* 的取最高分循环：`if score > max_score` 严格大于
    → 等分并列时先 append 者胜。max() 配合 -index 键即此语义。"""
    if not features:
        return COMMON
    return max(features, key=lambda f: (RULE_SCORES.get(f, 0), -features.index(f)))


def get_shapes(visual_gene: str) -> str:
    """DA analyse_shape：前 2 hex 查形状表，无命中 = Common。"""
    return SHAPES_BY_HEX.get(visual_gene[0:2], COMMON)


def get_styles(visual_gene: str) -> str:
    """DA analyse_styles：仅形状 Common 时调用；style = visual_gene[2:18]（16 个 hex 位）。

    与官方 Java 的两处关键差异（DA v0.1.1 原样）：
    1. 位置规则是 elif 互斥链（官方是独立 if，可叠加命中）；
    2. Right mix pure 条件为 14==15==16 且 14!=13（后三条相同），
       官方是 13==14 && 15==16 && 15!=13（前两条同 + 后两条同）。
    """
    style = visual_gene[2:18]
    t13, t14, t15, t16 = style[12], style[13], style[14], style[15]
    feats = []
    if t13 == t14 == t15 == t16:
        feats.append("Pure")
    elif t14 == t15 == t13 and t14 != t16:
        feats.append("Left three pure")
    elif t13 == t15 == t16 and t14 != t13:
        feats.append("Left mix pure")
    elif t13 == t14 == t16 and t15 != t13:
        feats.append("Right three pure")
    elif t14 == t16 == t15 and t14 != t13:
        feats.append("Right mix pure")
    elif t16 == t15 and t13 == t14:
        feats.append("Color Symmetry")
    elif t16 == t14 and t13 == t15:
        feats.append("Half divide")
    elif (t15 + t13) == (t14 + t16):
        feats.append("Double mix")
    elif t13 == t14 and t15 != t16:
        feats.append("Center color")
    elif t15 == t16 and t14 != t13:
        feats.append("Edge color")
    dc = _distinct_chars(style)
    if dc == 4:
        feats.append("Sum four color")
    elif dc == 5:
        feats.append("Sum five color")
    elif dc == 6:
        feats.append("Sum six color")
    elif dc == 7:
        feats.append("Sum seven color")
    elif dc == 14:
        feats.append("All 14 color")
    elif dc == 15:
        feats.append("All 15 color")
    elif dc == 16:
        feats.append("All 16 color")
    dl = _dark_or_light(style)
    if dl == "1":
        feats.append("darkColor")
    elif dl == "0":
        feats.append("lightColor")
    return _max_score_feature(feats)


def get_color(visual_gene: str, name: str) -> str:
    """DA analyse_color：仅形状非 Common 时调用；style = visual_gene[2:19]（17 位，含形状后 1 位）。

    darkOrLight 遍历全部 17 位；颜色表只按名字首字符命中。
    darkColor|color / lightColor|color 是本文件内部完整键（分值 20），
    返回后再 split("|")[0] 取短名。
    """
    style = visual_gene[2:19]
    feats = []
    key = COLOR_BY_LETTER.get(name[0])
    if key:
        feats.append(key)
    dl = _dark_or_light(style)
    if dl == "1":
        feats.append("darkColor|color")
    if dl == "0":
        feats.append("lightColor|color")
    best = _max_score_feature(feats)
    if best == COMMON:
        return COMMON
    return best.split("|")[0]


def get_nameliteral(name: str) -> str:
    """DA analyse_name_literal：名字 6 字母规则，取最高分（严格大于 → 先 append 者胜）。

    append 顺序 = DA 源码顺序：连击块（repeat>=3 才进块：six/Penta/Quadro/Triple）
    → Two letters / Three letters（elif 互斥）→ ABCABC → Symmetric letter
    → AABCCD → ABBCDD。
    等分并列取先 append 者（例：HMMMMH 的 Quadro repeat 与 Two letters 同 10 分，
    DA 取 Quadro repeat）。
    """
    feats = []
    run = _max_run(name)
    if run >= 3:
        if run == 6:
            feats.append("six repeat")
        elif run == 5:
            feats.append("Penta repeat")
        elif run == 4:
            feats.append("Quadro repeat")
        elif run == 3:
            feats.append("Triple repeat")
    dc = _distinct_chars(name)
    if dc == 2:
        feats.append("Two letters")
    elif dc == 3:
        feats.append("Three letters")
    if name[0:3] == name[3:6]:
        feats.append("ABCABC")
    if _symmetry(name):
        feats.append("Symmetric letter")
    if name[0] == name[1] and name[3] == name[4]:
        feats.append("AABCCD")
    if name[1] == name[2] and name[4] == name[5]:
        feats.append("ABBCDD")
    return _max_score_feature(feats)


def get_numberliteral(number_str: str) -> str:
    """DA analyse_number_literal：编号规则，取最高分（严格大于 → 先 append 者胜）。

    append 顺序 = DA 源码顺序：Single num → Repetition → Serial num
    → Number Symmetry（DA 启用，官方已注释）→ Tail 连击块（repeat>=4 才进块）。
    等分并列取先 append 者（例：77777 的 Repetition 与 Tail five 同 50 分，
    DA 取 Repetition）。
    """
    feats = []
    n = int(number_str)
    if n < 10:
        feats.append("Single num")
    if _distinct_chars(number_str) == 1:
        feats.append("Repetition")
    if _shunzi(number_str, 1) or _shunzi(number_str, -1):
        feats.append("Serial num")
    if _symmetry(number_str):
        feats.append("Number Symmetry")
    run = _max_run(number_str)
    if run >= 4:
        if run == 7:
            feats.append("Tail seven")
        elif run == 6:
            feats.append("Tail six")
        elif run == 5:
            feats.append("Tail five")
        elif run == 4:
            feats.append("Tail four")
    return _max_score_feature(feats)


def _clean_score(metric_en: str) -> int:
    """DA 各维度返回键查内置 dict，查不到 = 0。

    各维度函数返回的已是 dict 键（shapes/color 短名、styles/nameliteral/
    numberliteral 完整键），直接查 CLEAN_SCORES。
    """
    return CLEAN_SCORES.get(metric_en, 0)


def analyse(name: str, number: int, visual_gene: str) -> dict:
    """DA analyse 主入口：5 维判定 + 总分。

    DA DiamondManager.analyse_address_diamonds 的 score = max(1, score)：
    0 分钻石抬为 1 分（api.txt Notes: "All diamond scores less than 1 will
    be set to 1"）。证书里的 score 即此下限后数值。
    """
    number_str = str(number)
    shapes = get_shapes(visual_gene)
    if shapes == COMMON:
        styles_or_color = get_styles(visual_gene)
    else:
        styles_or_color = get_color(visual_gene, name)
    nameliteral = get_nameliteral(name)
    numberliteral = get_numberliteral(number_str)
    score = (
        _clean_score(shapes)
        + _clean_score(styles_or_color)
        + _clean_score(nameliteral)
        + _clean_score(numberliteral)
    )
    score = max(1, score)  # DA 下限：0 分抬 1
    return {
        "shapes": shapes,
        "styles_or_color": styles_or_color,
        "nameliteral": nameliteral,
        "numberliteral": numberliteral,
        "score": score,
    }


# ============================================================
# secp256k1 纯 Python 实现（与 sys::Account 完全同构）
# ============================================================

def _inv(a: int, m: int) -> int:
    return pow(a, m - 2, m)


def _point_add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2 and (y1 + y2) % P == 0:
        return None
    if p1 == p2:
        lam = (3 * x1 * x1) * _inv(2 * y1, P) % P
    else:
        lam = (y2 - y1) * _inv(x2 - x1, P) % P
    x3 = (lam * lam - x1 - x2) % P
    y3 = (lam * (x1 - x3) - y1) % P
    return (x3, y3)


def _point_mul(k: int, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = _point_add(result, addend)
        addend = _point_add(addend, addend)
        k >>= 1
    return result


def _privkey_to_pubkey(privkey: int):
    point = _point_mul(privkey, (GX, GY))
    x, y = point
    prefix = b"\x03" if y & 1 else b"\x02"
    return prefix + x.to_bytes(32, "big")


def pubkey_to_address(pubkey33: bytes) -> str:
    """sys::Account::get_address_by_public_key + to_readable：base58check(version=0)。

    addr = [0] || ripemd160(sha256(pubkey))，base58check 版本字节取 addr[0]=0。
    """
    sha = hashlib.sha256(pubkey33).digest()
    h160 = hashlib.new("ripemd160", sha).digest()
    addr = b"\x00" + h160
    return base58check_encode(addr)


def base58check_encode(payload: bytes) -> str:
    """base58check：payload[0] 作版本字节，校验 sha256(sha256(version||data)) 前 4 字节。

    对应 sys::Account::to_base58check：s.first() 为版本，s[1..] 为数据体。
    """
    version = payload[0:1]
    body = payload[1:]
    checksum = hashlib.sha256(hashlib.sha256(version + body).digest()).digest()[:4]
    full = version + body + checksum
    alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
    n = int.from_bytes(full, "big")
    out = ""
    while n > 0:
        n, rem = divmod(n, 58)
        out = alphabet[rem] + out
    # 前导 0 字节 -> '1'
    pad = 0
    for b in full:
        if b == 0:
            pad += 1
        else:
            break
    return "1" * pad + out


def rfc6979_nonce(privkey: int, digest32: bytes) -> int:
    """RFC6979 确定性 nonce（HMAC-SHA256），与 libsecp256k1 sign 语义一致。

    Hacash 的 do_sign 用 libsecp256k1::sign（RFC6979），同私钥同消息必得同签名，
    预言机出证可复现、可审计。
    """
    def bits2int(b):
        n = int.from_bytes(b, "big")
        excess = len(b) * 8 - 256
        return n >> excess if excess > 0 else n

    def int2octets(x):
        return x.to_bytes(32, "big")

    def bits2octets(b):
        z1 = bits2int(b)
        z2 = z1 % N
        return int2octets(z2)

    h1 = digest32
    x = privkey
    v = b"\x01" * 32
    k = b"\x00" * 32
    k = hmac.new(k, v + b"\x00" + int2octets(x) + bits2octets(h1), hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    k = hmac.new(k, v + b"\x01" + int2octets(x) + bits2octets(h1), hashlib.sha256).digest()
    v = hmac.new(k, v, hashlib.sha256).digest()
    while True:
        v = hmac.new(k, v, hashlib.sha256).digest()
        t = bits2int(v)
        if 1 <= t < N:
            return t
        k = hmac.new(k, v + b"\x00", hashlib.sha256).digest()
        v = hmac.new(k, v, hashlib.sha256).digest()


def sign_digest(privkey: int, digest32: bytes) -> bytes:
    """sys::Account::do_sign 同构：RFC6979 + low-S 规范化，返回 r||s（64B）。

    verify_signature 走 Signature::parse_standard，要求 s <= HALF_ORDER，
    所以这里必须做 low-S 翻转（libsecp256k1::sign 内建此行为）。
    """
    z = int.from_bytes(digest32, "big")
    while True:
        k = rfc6979_nonce(privkey, digest32)
        point = _point_mul(k, (GX, GY))
        r = point[0] % N
        if r == 0:
            digest32 = hashlib.sha256(digest32).digest()
            continue
        kinv = _inv(k, N)
        s = (kinv * (z + r * privkey)) % N
        if s == 0:
            digest32 = hashlib.sha256(digest32).digest()
            continue
        if s > HALF_ORDER:
            s = N - s
        return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def verify_signature_local(digest32: bytes, pubkey33: bytes, sig64: bytes) -> bool:
    """本地验签（与合约 verify_signature 同逻辑），用于出证前自检。"""
    if len(digest32) != 32 or len(pubkey33) != 33 or len(sig64) != 64:
        return False
    prefix = pubkey33[0]
    if prefix not in (2, 3):
        return False
    x = int.from_bytes(pubkey33[1:], "big")
    if x >= P:
        return False
    y_sq = (pow(x, 3, P) + 7) % P
    y = pow(y_sq, (P + 1) // 4, P)
    if pow(y, 2, P) != y_sq:
        return False
    if (y & 1) != (prefix & 1):
        y = P - y
    r = int.from_bytes(sig64[:32], "big")
    s = int.from_bytes(sig64[32:], "big")
    if r == 0 or s == 0 or s > HALF_ORDER or r >= N or s >= N:
        return False
    z = int.from_bytes(digest32, "big")
    w = _inv(s, N)
    u1 = (z * w) % N
    u2 = (r * w) % N
    point = _point_add(_point_mul(u1, (GX, GY)), _point_mul(u2, (x, y)))
    if point is None:
        return False
    return point[0] % N == r


# ============================================================
# 证书打包与 RPC
# ============================================================

def build_cert_message(name: str, visual_gene: bytes, number: int, score: int) -> bytes:
    """29 字节证书消息（与合约 FitSH 端逐字节对齐）：
    name(6B) + visual_gene(10B) + number_u64(8B BE) + score_u32(4B BE) + version(1B)
    """
    if len(name) != 6:
        raise ValueError("diamond name must be 6 chars")
    if len(visual_gene) != 10:
        raise ValueError("visual_gene must be 10 bytes")
    if not (0 <= score <= 0xFFFFFFFF):
        raise ValueError("score out of u32 range")
    return (
        name.encode("ascii")
        + visual_gene
        + struct.pack(">Q", number)
        + struct.pack(">I", score)
        + bytes([CERT_VERSION])
    )


def parse_cert_message(msg: bytes) -> dict:
    """合约端解包的镜像实现（供测试与前端对照）。"""
    if len(msg) != 29:
        raise ValueError("cert message must be 29 bytes")
    return {
        "name": msg[0:6].decode("ascii"),
        "visual_gene_hex": msg[6:16].hex(),
        "number": int.from_bytes(msg[16:24], "big"),
        "score": int.from_bytes(msg[24:28], "big"),
        "version": msg[28],
    }


def fetch_diamond(node: str, name: str, timeout: int = 10) -> dict:
    """从全节点实时读取钻石数据。兼容两种路由风格：
    - 新版 REST：GET /query/diamond?name=XXX
    - 旧版：     GET /query?action=diamond&name=XXX
    """
    base = node.rstrip("/")
    urls = [
        base + "/query/diamond?name=" + urllib.request.quote(name),
        base + "/query?action=diamond&name=" + urllib.request.quote(name),
    ]
    last_err = None
    for url in urls:
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hacds-oracle/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            if isinstance(data, dict) and data.get("name"):
                return data
            last_err = "unexpected response shape: %s" % str(data)[:200]
        except (urllib.error.URLError, urllib.error.HTTPError, OSError) as e:
            last_err = str(e)
        except ValueError as e:
            last_err = "json decode: %s" % e
    raise RuntimeError("RPC query failed for %s: %s" % (name, last_err))


def issue_certificate(name: str, node: str, privkey: int, timeout: int = 10) -> dict:
    """出证主流程：RPC 读基因 → 本地派生 visual_gene 交叉校验 → 评分 → 签名。"""
    info = fetch_diamond(node, name, timeout)
    life_gene = bytes.fromhex(info["life_gene"])
    if len(life_gene) != 32:
        raise RuntimeError("life_gene must be 32 bytes")
    number = int(info["number"])
    # 本地派生并与节点返回值交叉校验（防节点或传输层数据损坏）
    vg_hex_local = visual_gene_hex(name, life_gene)
    vg_hex_node = info.get("visual_gene", "").lower()
    if vg_hex_node and vg_hex_local != vg_hex_node:
        raise RuntimeError(
            "visual_gene mismatch: local %s vs node %s" % (vg_hex_local, vg_hex_node)
        )
    visual_gene = bytes.fromhex(vg_hex_local)
    result = analyse(name, number, vg_hex_local)
    score = result["score"]
    msg = build_cert_message(name, visual_gene, number, score)
    digest = hashlib.sha3_256(msg).digest()
    sig = sign_digest(privkey, digest)
    pubkey = _privkey_to_pubkey(privkey)
    # 出证前本地自检（与合约 verify_signature 同逻辑）
    if not verify_signature_local(digest, pubkey, sig):
        raise RuntimeError("internal error: self-verification failed")
    if pubkey_to_address(pubkey) != ORACLE_ADDRESS:
        raise RuntimeError("internal error: address mismatch")
    return {
        "name": name,
        "number": number,
        "visual_gene": vg_hex_local,
        "life_gene": info["life_gene"].lower(),
        "score": score,
        "hacds_amount": score * 10**8,
        "details": result,
        "cert_message_hex": msg.hex(),
        "cert_sha3_256": digest.hex(),
        "sign_hex": (pubkey + sig).hex(),
        "oracle_address": ORACLE_ADDRESS,
        "version": CERT_VERSION,
    }


# -*- coding: utf-8 -*-
# 密钥管理 + 子命令 + 自检（合并进主文件）

def load_privkey(args) -> int:
    """私钥注入：环境变量 HACDS_ORACLE_KEY 优先，其次 --key-file 文件（hex，0600）。
    不接受命令行明文私钥（避免进 shell history / 进程列表）。"""
    hexkey = os.environ.get("HACDS_ORACLE_KEY")
    if not hexkey:
        if getattr(args, "key_file", None):
            with open(args.key_file, "r") as f:
                hexkey = f.read().strip()
        else:
            raise RuntimeError(
                "no private key: set HACDS_ORACLE_KEY env or pass --key-file"
            )
    hexkey = hexkey.strip()
    if len(hexkey) != 64:
        raise RuntimeError("private key must be 64 hex chars (32 bytes)")
    key = int(hexkey, 16)
    if key == 0 or key >= N:
        raise RuntimeError("private key out of range")
    if key.to_bytes(32, "big")[0:4] == b"\xff\xff\xff\xff":
        raise RuntimeError("secret_key not supported; try a different one")
    return key


def resolve_oracle_address(privkey: int) -> str:
    return pubkey_to_address(_privkey_to_pubkey(privkey))


def cmd_genkey(args):
    import secrets as _secrets
    while True:
        raw = _secrets.token_bytes(32)
        if raw[0:4] != b"\xff\xff\xff\xff":
            break
    key = int.from_bytes(raw, "big")
    addr = resolve_oracle_address(key)
    out = args.out or "oracle_secret.hex"
    flags = os.O_WRONLY | os.O_CREAT | os.O_TRUNC
    fd = os.open(out, flags, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(raw.hex() + "\n")
    try:
        os.chmod(out, 0o600)
    except OSError:
        pass
    print(json.dumps({
        "oracle_address": addr,
        "secret_key_file": os.path.abspath(out),
        "note": "私钥已写入 0600 权限文件，请离线备份；该地址即合约 set_oracle 需设置的预言机账户",
    }, ensure_ascii=False, indent=2))


def cmd_cert(args):
    privkey = load_privkey(args)
    global ORACLE_ADDRESS
    ORACLE_ADDRESS = resolve_oracle_address(privkey)
    _check_expected_address(args)
    cert = issue_certificate(args.name, args.node, privkey, args.timeout)
    print(json.dumps(cert, ensure_ascii=False, indent=2))


def _check_expected_address(args):
    """--expect-address 提供时校验所载密钥与预期预言机账户一致，防止装错密钥文件。"""
    expect = getattr(args, "expect_address", None)
    if expect and ORACLE_ADDRESS != expect:
        raise RuntimeError(
            "oracle address mismatch: key resolves to %s, expected %s"
            % (ORACLE_ADDRESS, expect)
        )


def cmd_serve(args):
    privkey = load_privkey(args)
    global ORACLE_ADDRESS
    ORACLE_ADDRESS = resolve_oracle_address(privkey)
    _check_expected_address(args)
    from http.server import BaseHTTPRequestHandler, HTTPServer
    from urllib.parse import urlparse, parse_qs

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            parsed = urlparse(self.path)
            if parsed.path == "/cert":
                name = (parse_qs(parsed.query).get("name") or [""])[0].strip().upper()
                if not name or len(name) != 6:
                    self._reply(400, {"error": "query name must be 6 chars"})
                    return
                try:
                    cert = issue_certificate(name, args.node, privkey, args.timeout)
                    self._reply(200, cert)
                except Exception as e:
                    self._reply(502, {"error": str(e)})
            elif parsed.path == "/health":
                self._reply(200, {"ok": True, "oracle": ORACLE_ADDRESS})
            else:
                self._reply(404, {"error": "not found"})

        def _reply(self, code, obj):
            body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, fmt, *a):
            sys.stderr.write("[oracle] %s\n" % (fmt % a))

    print("HACDS oracle serving on 0.0.0.0:%d, node=%s, address=%s" % (
        args.port, args.node, ORACLE_ADDRESS), file=sys.stderr)
    HTTPServer(("0.0.0.0", args.port), Handler).serve_forever()

def cmd_selftest(args):
    """离线全链路自检（不连节点）：
    1. ripemd160 / sha3_256 已知向量；
    2. secp256k1 签名/验签/地址派生往返；
    3. visual_gene 派生用主网真实钻石 MVUUBA 验证；
    4. 5 维评分对 MVUUBA 出分；
    5. 证书打包 → 签名 → 本地验签（合约同逻辑）往返。
    """
    failures = []

    def check(label, ok, detail=""):
        status = "PASS" if ok else "FAIL"
        print("[%s] %s %s" % (status, label, detail))
        if not ok:
            failures.append(label)

    # 1. 哈希向量
    check("ripemd160(abc)",
          hashlib.new("ripemd160", b"abc").hexdigest()
          == "8eb208f7e05d987a9b044a8e98c6b087f15a0bfc")
    check("sha3_256(abc)",
          hashlib.sha3_256(b"abc").hexdigest()
          == "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532")

    # 2. secp256k1 往返（私钥 7x32，与 vm crypto_tests 同款）
    privkey = int.from_bytes(b"\x07" * 32, "big")
    pubkey = _privkey_to_pubkey(privkey)
    digest = b"\x42" * 32
    sig = sign_digest(privkey, digest)
    check("secp256k1 sign/verify roundtrip", verify_signature_local(digest, pubkey, sig))
    check("secp256k1 low-S", int.from_bytes(sig[32:], "big") <= HALF_ORDER)
    check("secp256k1 deterministic (RFC6979)", sig == sign_digest(privkey, digest))
    bad = bytearray(sig)
    bad[0] ^= 1
    check("secp256k1 tamper rejected",
          not verify_signature_local(digest, pubkey, bytes(bad)))
    addr = pubkey_to_address(pubkey)
    check("address format", addr.startswith("1") and 26 <= len(addr) <= 34, addr)

    # 3. visual_gene 派生（MVUUBA 主网向量）
    life_gene = bytes.fromhex(
        "aa205b1f612fd81192c1d4b70bec9d0c00d2d8d90b1315fb75a1f75130955a01")
    vg = visual_gene_hex("MVUUBA", life_gene)
    check("visual_gene(MVUUBA)", vg == "019833c5b35b517105a0", "got %s" % vg)

    # 4. 评分（MVUUBA：Square 30 + Yellow secret 2 + 名字 Common 0 + 编号 Common 0 = 32）
    result = analyse("MVUUBA", 138455, vg)
    print("    MVUUBA details:", json.dumps(result, ensure_ascii=False))
    check("MVUUBA shapes=Square", result["shapes"] == "Square")
    check("MVUUBA color=Yellow secret",
          result["styles_or_color"] == "Yellow secret",
          "got %s" % result["styles_or_color"])
    check("MVUUBA nameliteral=Common diamond",
          result["nameliteral"] == COMMON, "got %s" % result["nameliteral"])
    check("MVUUBA numberliteral=Common diamond",
          result["numberliteral"] == COMMON, "got %s" % result["numberliteral"])
    check("MVUUBA score=32", result["score"] == 32, "got %s" % result["score"])

    # 4b. Diamond_Analyzer v0.1.1 对齐用例（与提取的 DiamondAnalyser.py 逐条比对，
    #     390 颗主网真实钻石 0 分差；此处固化关键语义）
    check("tie-break 77777 -> Repetition (DA append 顺序)",
          get_numberliteral("77777") == "Repetition",
          "got %s" % get_numberliteral("77777"))
    check("tie-break HMMMMH -> Quadro repeat (DA append 顺序)",
          get_nameliteral("HMMMMH") == "Quadro repeat",
          "got %s" % get_nameliteral("HMMMMH"))
    check("Pure 250 (styles 全同)",
          analyse("WTYUIA", 11111, "99aaaaaaaaaaaaaaaaaaaa")["score"] == 300)
    check("回文编号计分 Number Symmetry=10 (DA 启用)",
          get_numberliteral("12321") == "Number Symmetry",
          "got %s" % get_numberliteral("12321"))
    check("0 分抬 1 (DA max(1, score))",
          analyse("WTYUIA", 138455, "99123456789012345678")["score"] == 1,
          "got %s" % analyse("WTYUIA", 138455, "99123456789012345678")["score"])
    check("NITVSB styles -> Right mix pure (DA 条件: 后三条相同)",
          get_styles("d9f418dc195372199970") == "Right mix pure",
          "got %s" % get_styles("d9f418dc195372199970"))

    # 5. 证书往返
    msg = build_cert_message("MVUUBA", bytes.fromhex(vg), 138455, result["score"])
    check("cert message 29 bytes", len(msg) == 29)
    parsed = parse_cert_message(msg)
    check("cert roundtrip", parsed["name"] == "MVUUBA"
          and parsed["number"] == 138455 and parsed["score"] == result["score"])
    digest = hashlib.sha3_256(msg).digest()
    sig = sign_digest(privkey, digest)
    check("cert sign/verify", verify_signature_local(digest, pubkey, sig))

    print()
    if failures:
        print("SELFTEST FAILED: %d failure(s): %s" % (len(failures), ", ".join(failures)))
        sys.exit(1)
    print("SELFTEST PASSED")


def main():
    ap = argparse.ArgumentParser(description="HACDS 基因证书预言机")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("genkey", help="生成预言机账户密钥")
    p.add_argument("--out", default=None)
    p.set_defaults(func=cmd_genkey)

    p = sub.add_parser("cert", help="为钻石签发证书")
    p.add_argument("--name", required=True)
    p.add_argument("--node", default="http://127.0.0.1:3338")
    p.add_argument("--timeout", type=int, default=10)
    p.add_argument("--key-file", default=None)
    p.add_argument("--expect-address", default=None,
                   help="预期预言机地址（如 1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu），"
                        "所载密钥派生地址不符时报错退出")
    p.set_defaults(func=cmd_cert)

    p = sub.add_parser("serve", help="HTTP API 模式")
    p.add_argument("--port", type=int, default=8123)
    p.add_argument("--node", default="http://127.0.0.1:3338")
    p.add_argument("--timeout", type=int, default=10)
    p.add_argument("--key-file", default=None)
    p.add_argument("--expect-address", default=None,
                   help="预期预言机地址（如 1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu），"
                        "所载密钥派生地址不符时报错退出")
    p.set_defaults(func=cmd_serve)

    p = sub.add_parser("selftest", help="离线自检")
    p.set_defaults(func=cmd_selftest)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
