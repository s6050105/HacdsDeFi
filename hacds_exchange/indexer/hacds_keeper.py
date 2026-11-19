#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hacds keeper —— 无许可的账本键续租（H-2 / A 方案）

设计前提：合约的 rent_keys() 是**无许可**的——任何人调用都能续租，
并领取每键 0.07 HAC 的报酬（从 tre:hac 支出）。

所以这个脚本任何人都可以跑，不依赖项目方。谁跑谁赚钱。

两种模式
--------
  run    ——  常规续租，**领报酬**。只在 `live < period/3` 时才真正续。
  topup  ——  首注后立即补满，**不领报酬**。不看阈值，直接补到 period。

为什么需要 topup
----------------
`run` 的续租条件是 `live < period/3`，而 `live` 的单位是**区块**。
首注新建的键只租 100 期 = 10,000 块，远高于阈值 100，
所以**首注后立刻跑 run 不会续、也不付酬**——要等约 34 天。

这 34 天里如果键到期，账本失效（用户余额归零）。
`topup` 让发行方在首注后立刻把键补到 300 期，窗口从 34 天延到 104 天。

用法
----
    # 1. 看现状（不广播）
    python3 hacds_keeper.py check --indexer https://indexer.hacds.com

    # 2. 首注后立刻补满（不领报酬，约 0.001 HAC）
    #    自动包含 4 个首注地址键（u:/ck:<首注人> + u:/ck:<BURN>）+ 固定键
    HACDS_KEEPER_KEY=/path/to/key.hex \
    python3 hacds_keeper.py topup --node http://... --main <首注人地址>

    # 3. 常规续租（领报酬）
    HACDS_KEEPER_KEY=/path/to/key.hex \
    python3 hacds_keeper.py run --indexer http://... --node http://... --main <地址>

    # 4. 只看收益估算
    python3 hacds_keeper.py quote --indexer http://...

环境变量
--------
    HACDS_KEEPER_KEY   私钥文件路径（64 hex）。**不要**用命令行参数传，避免进 shell history。

依赖：仅标准库 + 本仓库的 txbuild 可执行文件（用于构造 Type-3 交易）。
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
import urllib.request

# ============================================================================
# Windows 编码说明（2026-11-20 第二次修正）
#
# 日志里的 `UnicodeEncodeError: 'gbk' codec can't encode` 根因是**输出内容**
# 含 GBK 不支持的符号（✓ ✗ ⚠ →），不是编码设置本身。
#
# 第一次的修法（reconfigure stdout 为 UTF-8）是错的：
#   写出去的字节是 UTF-8，但 `Get-Content` 按系统默认 GBK 解码，
#   于是日志全变成「鍚堢害=」「寰呯画绉燂細」这种乱码。
#
# 正确修法（现状）：
#   ① **所有 print 输出只用 ASCII 符号**（[OK] / [FAIL] / [WARN] / ->），
#      中文本身在 GBK 下是正常的，不需要特殊处理；
#   ② stdout 保持系统默认编码，与 Get-Content 一致，中文不乱码；
#   ③ subprocess 仍显式指定 encoding="utf-8" —— txbuild 的输出含
#      非 ASCII 字节（中文/符号），按 GBK 解码会在后台线程抛
#      UnicodeDecodeError（日志里的 Traceback in Thread-2 _readerthread）。
# ============================================================================

# 默认走 HTTPS 域名，不硬编码运维 IP（2026-11-12 审计 M-5）。
# keeper 会在命令行/日志里出现地址，写死明文 IP 等于把攻击面随仓库一起发出去。
DEFAULT_INDEXER = "https://indexer.hacds.com"
DEFAULT_NODE = "https://api.hacds.com"
def _default_txbuild():
    """定位 hacds_txbuild.exe。

    WARN 2026-11-20：原来写死成 indexer/../../wallet-app/bin/hacds_txbuild.exe
      -- 那是**开发机的仓库布局**。生产服务器上脚本放在 oracle 根目录，
      这个相对路径会解析成 C:/Users/<user>/wallet-app/bin/...，根本不存在，
      keeper 一跑就报「找不到 txbuild」。

      现在的查找顺序（哪个先命中用哪个）：
        1. 脚本同目录（生产部署：oracle 目录下的 hacds_txbuild.exe）
        2. ../wallet-app/bin（开发机仓库布局，保持兼容）
        3. PATH 里的 hacds_txbuild
      都找不到时返回第 1 项的路径，让报错信息至少指向正确的地方。
    """
    here = os.path.dirname(os.path.abspath(__file__))
    exe = "hacds_txbuild.exe" if os.name == "nt" else "hacds_txbuild"
    candidates = [
        os.path.join(here, exe),
        os.path.join(here, "..", "..", "wallet-app", "bin", exe),
    ]
    for c in candidates:
        if os.path.exists(c):
            return os.path.normpath(c)
    import shutil
    found = shutil.which("hacds_txbuild")
    if found:
        return found
    return os.path.normpath(candidates[0])


DEFAULT_TXBUID = _default_txbuild()

# 合约常量（与 HacdsDeFi3000.fitsh 对齐）
RENT_PERIOD = 300          # 续租期（≈104 天）
RENT_MAX_KEYS = 10         # 合约硬上限（topup_keys/rent_keys 的 n > 10 → return 60）
RENT_REWARD_HAC = 0.07     # 每键报酬

# keeper 健康状态文件（2026-11-15 审计 H-2）。
# 链上查不到单键剩余租期，运维只能靠"上一轮什么时候跑的"间接判断。
DEFAULT_HEALTH = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "keeper_health.json")

# 单键 storage 成本 = (值字节 + 20) × period（vm/src/state/state.rs:504，全额计费）
STORAGE_BUDGET = 111911    # storage 桶上限（storage_limit_byte=99）
VALUE_BASE = 20

# H-4 / H-2：按**值字节**分级定批次，而不是统一 10。
# 打包键让 u:/ln:/ck: 的值从 16B 变成 48/64B，单键成本翻 2~4 倍。
#
# ⚠ 键长必须按**前缀实际字节数**算，不能用 2 字节硬判：
#     u:   2B 前缀 + 21B 地址 = 23B   值 48B（3 字段 × 16）
#     ln:  3B 前缀 + 21B 地址 = 24B   值 48B（3 字段 × 16）
#     ck:  3B 前缀 + 21B 地址 = 24B   值 64B（4 字段 × 16）
#     bad: 4B 前缀 + 21B 地址 = 25B   值 16B（单 u128）
#   旧实现只判 klen == 23，ln:/ck: 全部落到 `return 16`（低估 3~4 倍）
#   → keeper 以为「10 键不用切」→ 整笔 OutOfGas 回滚。
#
# 实测成本（period=300，单桶 111,911）：
#   u:/ln: ×5 = 102,000 ✅ ／ ×6 = 122,400 ❌
#   ck:    ×4 = 100,800 ✅ ／ ×5 = 126,000 ❌
#   bad:  ×10 = 108,000 ✅ ／ 固定聚合键 ×10 = 108,000 ✅


def _one_value_len(key: bytes) -> int:
    """单个地址类键的值字节数。"""
    if key[:3] == b"ck:":
        return 64                       # [chk:hac|chk:ds|lch:hac|lch:ds] = 4×16
    if key[:3] == b"ln:":
        return 48                       # [debt|coll|last] = 3×16
    if key[:2] == b"u:":
        return 48                       # [bal:hac|due|lpt] = 3×16
    if key[:4] == b"bad:":
        return 16                       # 单 u128（稀疏）
    return 48                           # 未知前缀：保守估


def _value_len(klen: int, blob_hex: str) -> int:
    """一批键里**最大的**值字节数（保守估计）。

    ⚠ 2026-11-12：原实现只看**第一个键**的前缀。但索引器按 `len(key)` 分组，
    `ln:`（24B/值48）与 `ck:`（24B/值64）会落进同一个 `klen=24` 批次 ——
    只看首键会把整批按 48 算，实际有 ck: 时是 64，导致批次超桶 OutOfGas、
    整笔回滚（实测 5 键混排：估 102,000，实 116,400 > 111,911）。

    改为扫描批内每个键取最大值。批内键数上限是 RENT_MAX_KEYS(10)，
    开销可忽略。
    """
    raw = bytes.fromhex(blob_hex)
    if klen < 23:
        return 16                       # 固定聚合键（amm:hac 等）均为 u128
    if klen == 0:
        return 48
    n = len(raw) // klen
    if n <= 0:
        return 48
    return max(_one_value_len(raw[i * klen:(i + 1) * klen]) for i in range(n))


def max_keys_per_batch(klen: int, blob_hex: str, period: int = RENT_PERIOD) -> int:
    """该键型单笔最多能续几个（storage 桶不超限）。"""
    unit = _value_len(klen, blob_hex) + VALUE_BASE
    per_key = unit * period
    if per_key <= 0:
        return RENT_MAX_KEYS
    n = STORAGE_BUDGET // per_key
    return max(1, min(n, RENT_MAX_KEYS))


# ⚠ 2026-11-20：显式带 User-Agent。
#
#   原因：urllib 默认的 User-Agent 是 "Python-urllib/3.x"，Cloudflare
#   会直接返回 403 Forbidden（实测访问 indexer.hacds.com 时）：
#     [WARN] 地址键跳过（索引器不可用）：HTTP Error 403: Forbidden
#   计划任务用的是 --indexer http://127.0.0.1:8124（本机，不过 CDN），
#   所以生产路径不受影响；但手动跑、或将来把 keeper 放到别的机器上时
#   就会踩到。带上正常 UA 即可。
_UA = "hacds-keeper/1.0 (+https://hacds.com)"


def _req(url, data=None, timeout=15):
    r = urllib.request.Request(url, data=data, headers={"User-Agent": _UA})
    if data is not None:
        r.add_header("Content-Type", "application/json")
    return urllib.request.urlopen(r, timeout=timeout)


def http_get(url, timeout=15):
    with _req(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def post_json(url, obj, timeout=20):
    data = json.dumps(obj).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json",
                                          "User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


# --------------------------------------------------------------------------
# 1) 取批次
# --------------------------------------------------------------------------
#: 允许的地址键前缀（M-8：防止远端返回任意键名让 keeper 去续）
ALLOWED_KEY_PREFIXES = (b"u:", b"ln:", b"ck:", b"bad:")
ALLOWED_KEYLEN = {23, 24, 25}


def _validate_batch(b):
    """校验索引器返回的批次（M-8：blob 走明文 HTTP，不可盲信）。

    blob 是 hex，`bytes.fromhex` 已挡住非法字符，拼进 params 无法注入 `:`/`,`，
    所以不能改写函数名或金额；但**租哪些键**完全由远端决定。这里加白名单：
      · klen 必须是 23/24/25（地址键）
      · 长度必须是 klen 的整数倍
      · 每个键的前缀必须命中白名单
    """
    klen = int(b.get("klen") or 0)
    if klen not in ALLOWED_KEYLEN:
        raise SystemExit("索引器返回非法 klen=%r（只允许 %s）" % (klen, sorted(ALLOWED_KEYLEN)))
    try:
        raw = bytes.fromhex(b.get("blob") or "")
    except ValueError:
        raise SystemExit("索引器返回的 blob 不是合法 hex")
    if not raw or len(raw) % klen != 0:
        raise SystemExit("索引器返回的 blob 长度 %d 不是 klen=%d 的整数倍" % (len(raw), klen))
    for off in range(0, len(raw), klen):
        k = raw[off:off + klen]
        if not any(k.startswith(p) for p in ALLOWED_KEY_PREFIXES):
            raise SystemExit("索引器返回了白名单外的键前缀：%r" % k[:4])
    return {"klen": klen, "blob": raw.hex()}


def fetch_batches(indexer, max_keys=10):
    """从索引器拉取按地址键的续租批次（带 M-8 校验）。"""
    url = indexer.rstrip("/") + "/rent_batches?max=%d" % max_keys
    try:
        r = http_get(url)
    except Exception as e:                                        # noqa: BLE001
        raise SystemExit("索引器不可用：%s\n"
                         "  → H-2 依赖索引器维护活跃地址台账，请先启动它。" % e)
    if r.get("ret") != 0:
        raise SystemExit("索引器返回错误：%s" % r.get("err"))
    if r.get("truncated"):
        # H-1 修复后索引器不再截断；若仍报 truncated 说明版本过旧，必须停
        raise SystemExit("索引器返回 truncated=true（旧版本会静默丢键），请升级索引器")
    return [_validate_batch(b) for b in (r.get("batches") or [])]


def _to_hex(raw, klen):
    """把 sandboxcall 的 bytes 返回值规范成 hex 字符串。

    sandboxcall 对 `bytes` 类型的返回值给的是**原始字符串**（"amm:ds"），
    而不是 hex。但索引器的 /rent_batches 给的是 hex。keeper 两条来源都要
    兼容，所以在这里统一。

    判定顺序：
      ① 已经是合法 hex（偶数长度且全是 0-9a-fA-F）且长度是 klen 的整数倍
         → 原样返回（这是索引器路径的格式）
      ② 否则按 UTF-8 编码成字节再取 hex（这是 sandboxcall 路径的格式）
    """
    if not isinstance(raw, str) or not raw:
        return None
    s = raw.strip()
    if s and len(s) % 2 == 0 and all(c in "0123456789abcdefABCDEF" for c in s):
        # 既是合法 hex，又要能整除 klen 才认为它真是 hex 键串
        if klen <= 0 or (len(s) // 2) % klen == 0:
            return s.lower()
    b = s.encode("utf-8")
    if klen > 0 and len(b) % klen != 0:
        print("  [WARN] 固定键长度 %d 不是 klen=%d 的整数倍，跳过" % (len(b), klen))
        return None
    return b.hex()


# --------------------------------------------------------------------------
# 合约未收录的固定键 —— keeper 侧补续
#
# ⚠ 2026-11-19：`amm:lastout` 是合约**每次 swap 都会写**的临时通道键，
#   但它**不在 `rent_keys_group()` 的 24 键清单里**（长度 11，没有任何
#   键组覆盖它）。合约侧的 `rent_key_len_at()` 只报 6/7/8/9/10/13/14 七组，
#   keeper 按组遍历时永远扫不到它。
#
#   后果：该键按 PERIOD_NEW=100 期（主网 34.7 天）到期后
#      ① `ld_u128("amm:lastout")` 返回 0
#      ② `swap_hac_to_ds` 会把 0 记进用户配额 → **兑换拿不到 hacds**
#      ③ `auto_topup_ds` 见 `got < shortfall` → return 32 整笔回滚
#   直到下一次 swap 用 `storage_new` 把它重建为止。
#   这期间所有兑换都异常，且**不会报错**，用户只看到数量不对。
#
#   测试链没暴露：1 秒/块 → 键 2.8 小时就过期，而测试流程恰好没跨那么久。
#   主网 34.7 天的窗口才让它显形。
#
#   修法选择：**不改合约**（那要重部署、换地址、A 的 TREASURY 也得跟着换），
#   改为 keeper 每轮顺带续这些键。`topup_keys` 接受任意键清单，
#   不依赖 `rent_keys_group()`，所以这条路成立。
#
#   键清单：（键名, 键长）。新增时把长度写对，keeper 按长度分组批量提交。
EXTRA_FIXED_KEYS = [
    ("amm:lastout", 11),
]


def extra_fixed_groups():
    """把 EXTRA_FIXED_KEYS 按 klen 分组成 keeper 的 job 格式。"""
    by_len = {}
    for name, klen in EXTRA_FIXED_KEYS:
        enc = name.encode("ascii")
        if len(enc) != klen:
            print("  [WARN] EXTRA_FIXED_KEYS 里 %r 声明长度 %d 与实际 %d 不符，跳过"
                  % (name, klen, len(enc)))
            continue
        by_len.setdefault(klen, []).append(enc)
    return [{"klen": k, "blob": b"".join(v).hex()} for k, v in sorted(by_len.items())]


def fetch_fixed_groups(node, contract):
    """从合约拿固定键分组（rent_keys_group / rent_key_len_at）。

    固定键（amm:* / tot:* / res:* 等）由合约自己提供；按地址键由索引器提供。
    """
    groups = []
    try:
        n = int(_call_view(node, contract, "rent_key_group_count"))
        for i in range(n):
            klen = int(_call_view(node, contract, "rent_key_len_at", "%d:u128" % i))
            if klen <= 0:
                continue
            raw = _call_view_raw(node, contract, "rent_keys_group", "%d:u128" % klen)
            if raw:
                # ⚠ 2026-11-16 修复：sandboxcall 对 `bytes` 返回值的 `ret_val`
                #   是**原始字符串**（如 "amm:ds"），不是 hex。
                #   原实现直接把它当 hex 传给 _split_job → bytes.fromhex() 抛
                #   ValueError: non-hexadecimal number，keeper 每轮都崩。
                #
                #   这里统一转成 hex：如果返回值本身就是合法 hex（偶数长度、
                #   全 hex 字符）就原样用，否则按 UTF-8 编码后再取 hex。
                blob_hex = _to_hex(raw, klen)
                if blob_hex:
                    groups.append({"klen": klen, "blob": blob_hex})
    except Exception as e:                                        # noqa: BLE001
        print("  [WARN] 固定键读取失败（可忽略）：%s" % e)

    # 追加合约清单里遗漏的键（见 EXTRA_FIXED_KEYS 的说明）。
    # 放在 try 外面：即便合约视图读取失败，这些键仍然要续。
    groups += extra_fixed_groups()
    return groups


def _call_view(node, contract, fn, params=None, caller=None):
    v = _call_view_raw(node, contract, fn, params, caller)
    return v if v is not None else 0


def _call_view_raw(node, contract, fn, params=None, caller=None):
    """sandboxcall 只读调用。返回 ret_val 或 None。"""
    q = {"contract": contract, "function": fn}
    if params:
        q["params"] = params
    if caller:
        q["caller"] = caller
    url = node.rstrip("/") + "/query/contract/sandboxcall?" + urllib.parse.urlencode(q)
    try:
        r = http_get(url)
        if r.get("ret") != 0:
            return None
        return r.get("ret_val")
    except Exception:                                             # noqa: BLE001
        return None


# --------------------------------------------------------------------------
# 2) 检查键的剩余租期（决定值不值得续）
# --------------------------------------------------------------------------
def key_live_hint(indexer, klen, blob_hex):
    """粗略判断：索引器无法直接给 live 值，这里只返回键数供估算。

    精确的 live 值只有合约 storage_stat 能读，但合约也不能批量返回。
    实际做法：keeper 定期全量续租即可，不必精确判断——
    rent_keys 内部 already 有 `live < period/3` 阈值判断，不会重复充电。
    """
    n = len(bytes.fromhex(blob_hex)) // klen if klen else 0
    return n


# --------------------------------------------------------------------------
# 3) 构造并广播 rent_keys 交易
# --------------------------------------------------------------------------
def build_rent_tx(txbuild, node, main_addr, contract, klen, blob_hex,
                  period=RENT_PERIOD, ts=None, keyfile=None, func="rent_keys"):
    """构造 rent_keys / topup_keys 调用交易体；给了 keyfile 就直接签名。

    txbuild 签名机制（testkit/src/txbuild.rs:14）：
      设 HACDS_SIGN_KEY=<keyfile> 后，构建模式会**同时**输出 signed_tx_hex。

    返回 (hex, 是否已签名)。
    """
    ts = ts or int(time.time())
    # ✅ 实测确认的格式：**<value>:<type>**（与 sandboxcall 相同）
    #   依据：txbuild.rs:372 的 parse_args_csv 直接调用 vm::parse_sandbox_params，
    #   即 `值:类型`。源码文档注释里写的 `<type>:<value>` 是**错的**，以代码为准。
    params = f"0x{blob_hex}:bytes,{klen}:u128,{period}:u128"
    cmd = [txbuild, "call", main_addr, str(ts), contract, func, params]

    env = os.environ.copy()
    # keyfile 现在可能是 {"hex": "..."}（见 _load_keyfile）。优先走 HEX 通道，
    # 绕开子进程打开文件（SYSTEM 账户下实测读不到用户目录）。
    if isinstance(keyfile, dict):
        env["HACDS_SIGN_KEY_HEX"] = keyfile["hex"]
        env["HACDS_SIGN_KEY_LABEL"] = main_addr
    elif keyfile:
        env["HACDS_SIGN_KEY"] = keyfile

    try:
        out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", timeout=120, env=env)
    except FileNotFoundError:
        raise SystemExit("找不到 txbuild：%s ; 用 --txbuild 指定路径" % txbuild)
    if out.returncode != 0:
        err = (out.stderr or out.stdout or "txbuild 失败").strip()
        # 2026-11-20：原来截断 300 字节，Windows panic 路径恰好被切在文件名中间，
        # 看不出到底读了哪个文件。改成保留全文（panic 行通常 < 500 字节），
        # 并把换行压成 " | " 单行，方便在日志里看。
        raise RuntimeError(err.replace(chr(13), "").replace(chr(10), " | ")[:600])

    signed = unsigned = None
    for line in out.stdout.splitlines():
        # M-1：原实现用子串判断 `if "signed_tx_hex" in line`，
        # 而 `"signed_tx_hex" in "unsigned_tx_hex=AAAA"` 为 True ——
        # txbuild 只输出 unsigned 时（签名失败但仍退出 0），signed 会被赋成
        # **未签名交易体**，后续 `if not signed: raise` 不触发 → 广播未签名交易。
        # 改为精确匹配键名。
        k = line.split("=", 1)[0].strip()
        if k == "signed_tx_hex":
            signed = line.split("=", 1)[1].strip()
        elif k == "unsigned_tx_hex":
            unsigned = line.split("=", 1)[1].strip()

    if signed:
        return signed, True
    if unsigned:
        return unsigned, False
    raise RuntimeError("txbuild 未返回任何 tx hex")



def submit(node, tx_hex):
    """广播未签名交易体（由调用方先签名）。"""
    url = node.rstrip("/") + "/submit/transaction?hexbody=true"
    req = urllib.request.Request(url, data=tx_hex.encode("ascii"),
                                 headers={"Content-Type": "text/plain",
                                          "User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


# --------------------------------------------------------------------------
# 子命令
# --------------------------------------------------------------------------
def cmd_check(args):
    print("=== 索引器 ===")
    try:
        h = http_get(args.indexer.rstrip("/") + "/health")
        print("  状态: %s" % ("运行中" if h.get("ok") else "异常"))
        print("  已扫高度: %s" % h.get("head"))
        print("  台账地址数: %s" % h.get("watched"))
    except Exception as e:                                        # noqa: BLE001
        print("  [FAIL] 不可用: %s" % e)
        return 1

    print("\n=== 按地址键（索引器提供）===")
    try:
        batches = fetch_batches(args.indexer, args.max_keys)
        total = sum(b["count"] for b in batches)
        print("  总键数: %d，批次数: %d（每批 ≤%d）" % (total, len(batches), args.max_keys))
        for b in batches[:5]:
            print("    klen=%2d  %d 键" % (b["klen"], b["count"]))
        if len(batches) > 5:
            print("    ... 还有 %d 批" % (len(batches) - 5))
        print("\n  预计报酬: %.2f HAC" % (total * RENT_REWARD_HAC))
    except SystemExit as e:
        print("  %s" % e)
        return 1

    print("\n=== 固定键（合约提供）===")
    groups = fetch_fixed_groups(args.node, args.contract)
    n_fixed = sum(len(bytes.fromhex(g["blob"])) // g["klen"] for g in groups)
    print("  分组数: %d，键数: %d" % (len(groups), n_fixed))
    print("  预计报酬: %.2f HAC" % (n_fixed * RENT_REWARD_HAC))

    print("\n=== 合计 ===")
    print("  一次全量续租约 %.2f HAC 报酬" % ((total + n_fixed) * RENT_REWARD_HAC))
    print("  [WARN] 实际报酬受 tre:hac 余额限制，可能低于此值")
    return 0


def cmd_quote(args):
    batches = fetch_batches(args.indexer, args.max_keys)
    total = sum(b["count"] for b in batches)
    print("按地址键 %d 个 -> 报酬 %.2f HAC" % (total, total * RENT_REWARD_HAC))
    print("（未计固定键；用 check 看全量）")
    return 0


_B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def _addr_to_21(addr: str) -> bytes:
    """Hacash 可读地址 → 21 字节二进制（base58check 解码，含 version 字节）。

    与索引器 `hacds_indexer.py::_addr_to_21` 同一实现，供构造地址键用。
    """
    import hashlib

    n = 0
    for ch in addr:
        n = n * 58 + _B58.index(ch)
    raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    raw = bytes(len(addr) - len(addr.lstrip("1"))) + raw
    if len(raw) != 25:
        raise ValueError("地址长度异常：%d" % len(raw))
    body, chk = raw[:21], raw[21:]
    want = hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4]
    if chk != want:
        raise ValueError("地址校验和不对")
    return body


def _load_keyfile():
    """读取 keeper 私钥。

    \u26a0 2026-11-20：优先用 HACDS_KEEPER_KEY_HEX（私钥内容本身放进环境变量），
      其次才是 HACDS_KEEPER_KEY（文件路径）。

      为什么加这条：计划任务以 SYSTEM 账户运行时，子进程 txbuild 读不到用户
      目录下的文件（实测 panic "read key file"），而同一命令在
      Administrator 会话里手动跑却完全正常 —— 典型的跨账户文件访问问题。

      传 hex 就绕开了"打开文件"这一步：Python 读一次文件（它能读），
      把 64 位十六进制塞进环境变量，txbuild 直接用 HACDS_SIGN_KEY_HEX。

      注意：环境变量在任何进程的 env 里都可见，所以这是"降低兼容风险"，
      不提升安全性。真正的安全边界仍是 NTFS 权限。
    """
    hexkey = os.environ.get("HACDS_KEEPER_KEY_HEX")
    if hexkey and hexkey.strip():
        h = hexkey.strip().lower()
        if h.startswith("0x"):
            h = h[2:]
        if len(h) != 64:
            raise SystemExit("HACDS_KEEPER_KEY_HEX 长度应为 64 个十六进制字符，实际 %d" % len(h))
        return {"hex": h}

    keyfile = os.environ.get("HACDS_KEEPER_KEY")
    if not keyfile:
        raise SystemExit("未设置 HACDS_KEEPER_KEY（私钥文件路径）或 HACDS_KEEPER_KEY_HEX（私钥内容）")
    if not os.path.exists(keyfile):
        raise SystemExit("私钥文件不存在：%s" % keyfile)
    # 顺便读一次，验证可读且格式正确 —— 让错误在 Python 侧暴露，
    # 而不是等到 txbuild 里 panic 成一行看不懂的错误
    try:
        raw = open(keyfile, "r", encoding="utf-8").read().strip().lower()
    except Exception as e:
        raise SystemExit("私钥文件读不出：%s（%s）" % (keyfile, e))
    if raw.startswith("0x"):
        raw = raw[2:]
    if len(raw) != 64 or any(c not in "0123456789abcdef" for c in raw):
        raise SystemExit("私钥文件内容不是 64 位十六进制：%s（长度 %d）" % (keyfile, len(raw)))
    return {"hex": raw}


def _collect_jobs(args, include_addr_keys=True):
    """收集本轮要续的键。

    ⚠ 2026-11-20 修复：索引器不可用时**不能整轮失败**。

      原实现把 `fetch_batches()` 放在最前面且不捕获异常，而它内部是
      `raise SystemExit(...)`。于是：
        · 索引器还没起来（keeper 与索引器同时开机启动时很常见）
        · 或索引器临时 5xx
        → keeper 直接退出 → 计划任务拉起 → 又撞同一个问题 → 无限重启。
      而 health 文件只在 `_execute()` 里写，所以退出时**连一份记录都没有**，
      索引器的 /keeper_health 一直停在很久以前的时间戳，看起来像"keeper 没跑"，
      实际是"跑了但立刻死了"。

      固定键（24+1 个）不依赖索引器，必须照常续 —— 它们才是池子和账本的根本。
      地址键取不到就跳过，下一轮再试。
    """
    jobs = []
    if include_addr_keys:
        try:
            batches = fetch_batches(args.indexer, args.max_keys)
            jobs += [{"klen": b["klen"], "blob": b["blob"]} for b in batches]
        except SystemExit as e:
            # fetch_batches 用 SystemExit 表达"索引器不可用"，这里降级为本轮跳过
            print("  [WARN] 地址键跳过（索引器不可用）：%s" % str(e).split(chr(10))[0][:120])
        except Exception as e:                                    # noqa: BLE001
            print("  [WARN] 地址键跳过（异常）：%s" % str(e)[:400])
    jobs += fetch_fixed_groups(args.node, args.contract)
    return jobs


# --------------------------------------------------------------------------
# 合约 B（金库分红）的续租 —— 2026-11-18
#
# 为什么 B 需要单独一套：
#   B 没有 rent_keys / topup_keys / rent_keys_group 这套"接受键清单"的接口。
#   它只有三个续租入口，且都不接受键清单：
#     claim()          → 只续 tx_main_addr() 自己（keeper 代签无效）
#     pay_rent()       → 只续 B 自己的 3 个全局键
#     pay_rent_ahac()  → 续的是 A 的键，不是 B 股东的
#   所以 B 的补丁是新增 pay_rent_shares(addrs, period)，
#   收连排 21 字节地址，内部自己拼 chk:/due:/sh: 三个键并续租。
#
# ⚠ 单笔地址数必须随 period 变（storage_rent 成本 = 36 × period × 键数）：
#     period= 30 → 34 个地址   period=100 → 10 个地址   period=300 → 3 个地址
#   这里按同样公式现算，超了就切批，避免 OutOfGas 整笔回滚。
# --------------------------------------------------------------------------

VAULT_KEY_UNIT = 36          # 单键 unit = val(16) + base(20)
VAULT_STORAGE_BUDGET = 111000
VAULT_KEYS_PER_ADDR = 3      # chk: / due: / sh:


def _vault_max_addrs(period):
    """单笔 pay_rent_shares 能装下几个地址。与合约侧公式保持一致。"""
    per = VAULT_KEY_UNIT * period * VAULT_KEYS_PER_ADDR
    if per <= 0:
        return 0
    return max(0, VAULT_STORAGE_BUDGET // per)


def fetch_vault_addr_batches(indexer):
    """从索引器取 B 的股东地址（连排 21 字节 hex），先按 50 个一批粗切。"""
    url = indexer.rstrip("/") + "/vault_addr_batches?max=50"
    try:
        r = http_get(url)
    except Exception as e:                                        # noqa: BLE001
        print("  [WARN] 金库地址台账不可用（跳过 B）：%s" % str(e)[:100])
        return []
    if r.get("ret") != 0:
        print("  [WARN] 金库地址台账返回错误（跳过 B）：%s" % r.get("err"))
        return []
    return [b for b in (r.get("batches") or []) if b.get("blob")]


def build_vault_rent_tx(txbuild, main_addr, vault, addrs_hex, period,
                        ts=None, keyfile=None):
    """构造 pay_rent_shares(addrs, period) 调用交易体。"""
    ts = ts or int(time.time())
    # 参数格式 <值>:<类型>，与 sandboxcall 一致
    params = "0x%s:bytes,%d:u128" % (addrs_hex, period)
    cmd = [txbuild, "call", main_addr, str(ts), vault, "pay_rent_shares", params]

    env = os.environ.copy()
    # keyfile 现在可能是 {"hex": "..."}（见 _load_keyfile）。优先走 HEX 通道，
    # 绕开子进程打开文件（SYSTEM 账户下实测读不到用户目录）。
    if isinstance(keyfile, dict):
        env["HACDS_SIGN_KEY_HEX"] = keyfile["hex"]
        env["HACDS_SIGN_KEY_LABEL"] = main_addr
    elif keyfile:
        env["HACDS_SIGN_KEY"] = keyfile

    try:
        out = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", errors="replace",
                             timeout=120, env=env)
    except FileNotFoundError:
        raise SystemExit("找不到 txbuild：%s" % txbuild)
    if out.returncode != 0:
        err = (out.stderr or out.stdout or "txbuild 失败").strip()
        # 2026-11-20：原来截断 300 字节，Windows panic 路径恰好被切在文件名中间，
        # 看不出到底读了哪个文件。改成保留全文（panic 行通常 < 500 字节），
        # 并把换行压成 " | " 单行，方便在日志里看。
        raise RuntimeError(err.replace(chr(13), "").replace(chr(10), " | ")[:600])

    signed = unsigned = None
    for line in out.stdout.splitlines():
        k = line.split("=", 1)[0].strip()
        if k == "signed_tx_hex":
            signed = line.split("=", 1)[1].strip()
        elif k == "unsigned_tx_hex":
            unsigned = line.split("=", 1)[1].strip()
    if signed:
        return signed, True
    if unsigned:
        return unsigned, False
    raise RuntimeError("txbuild 未返回任何 tx hex")


def rent_vault(args, period=None):
    """续租合约 B 的股东地址键。返回 (ok, fail)。

    ⚠ 这一步在旧版 keeper 里**完全不存在** —— B 的股东键只能靠本人 claim。
      股东 34.7 天（主网）不来领，chk:/due:/sh: 就会被物理删除，
      sh: 丢失意味着质押份数归零、链上的 3001 永远转不出来。
      测试链上 9,690 份 3001 正是这样锁死的。
    """
    vault = getattr(args, "vault", None)
    if not vault:
        return 0, 0

    period = period or getattr(args, "vault_period", None) or 100
    cap = _vault_max_addrs(period)
    if cap < 1:
        # ⚠ 2026-11-18：不能直接跳过 —— 那会让 B 的股东键**静默无人续租**，
        #   34.7 天后到期删除、份额永久归零，而日志里只有一行警告很容易被忽略。
        #   正确做法：自动降级到"单笔能装 1 个地址"的最大 period。
        #
        #   单地址成本 = VAULT_KEY_UNIT(36) × period × 3 键 ≤ STORAGE_BUDGET(111000)
        #   → period ≤ 111000 / 108 = 1027
        safe = VAULT_STORAGE_BUDGET // (VAULT_KEY_UNIT * VAULT_KEYS_PER_ADDR)
        print("  [WARN] period=%d 太大（单笔装不下 1 个地址），自动降级到 %d" % (period, safe))
        period = safe
        if period < 1:
            print("  [FAIL] 降级后仍无效，跳过 B（这不该发生，请检查 VAULT_* 常量）")
            return 0, 0
        cap = _vault_max_addrs(period)
        if cap < 1:
            print("  [FAIL] 降级失败，跳过 B")
            return 0, 0

    raw_batches = fetch_vault_addr_batches(args.indexer)
    if not raw_batches:
        print("  金库 B：地址台账为空（可能还没有股东，或索引器未收录 B）")
        return 0, 0

    # 按实际容量重新切片
    batches = []
    for b in raw_batches:
        blob = b["blob"]
        step = cap * 21 * 2          # 每个地址 21 字节 → 42 个 hex 字符
        for i in range(0, len(blob), step):
            part = blob[i:i + step]
            if part:
                batches.append(part)

    naddr = sum(len(b) // 42 for b in batches)
    print("  金库 B：待续 %d 个地址 / %d 批（period=%d，每批 ≤%d 地址）"
          % (naddr, len(batches), period, cap))

    if args.dry_run:
        for b in batches:
            print("    [dry] %d 个地址" % (len(b) // 42))
        return 0, 0

    keyfile = _load_keyfile()
    ok = fail = 0
    for i, blob in enumerate(batches, 1):
        n = len(blob) // 42
        # ⚠ 2026-11-20：去掉 end=" "。
        #   原来结果接在同一行，而 PowerShell 的 Tee-Object 按**行**写文件，
        #   不换行就落不了盘 —— 日志里只剩"待续 N 个地址"，
        #   看不到究竟成功还是失败，事后没法复盘。
        print("  B[%d/%d] %d 个地址 ..." % (i, len(batches), n), flush=True)
        try:
            tx, signed = build_vault_rent_tx(args.txbuild, args.main, vault,
                                             blob, period, keyfile=keyfile)
            if not signed:
                raise RuntimeError("未签名（HACDS_SIGN_KEY 未生效）——拒绝广播")
            r = submit(args.node, tx)
            if r.get("ret") == 0:
                print("[OK] %s" % r.get("hash", "")[:16])
                ok += 1
            else:
                print("[FAIL] %s" % r.get("err", r))
                fail += 1
        except Exception as e:                                    # noqa: BLE001
            print("[FAIL] %s" % str(e)[:400])
            fail += 1
        time.sleep(args.delay)
    return ok, fail


def _split_job(job, period):
    """把一个 job 按 storage 容量切成多笔（H-4 按 klen 分级）。

    单笔键数上限来自两个约束的交集：
      · 合约硬上限 RENT_MAX_KEYS = 10（超过 → return 60）
      · storage 桶 111,911（超过 → OutOfGas，整笔回滚）
    后者随键值字节变化：u: 5 键、ck: 4 键、固定聚合键 10 键。
    """
    klen = job["klen"]
    blob = bytes.fromhex(job["blob"])
    n = len(blob) // klen
    cap = max_keys_per_batch(klen, job["blob"], period)
    if n <= cap:
        return [job]
    out = []
    # off/cap 是**键下标**，切片要按字节：乘 klen
    for i in range(0, n, cap):
        out.append({"klen": klen, "blob": blob[i * klen:(i + cap) * klen].hex()})
    return out


def _execute(args, jobs, func, reward_per_key):
    """逐批构造并广播。func = rent_keys（有报酬）或 topup_keys（无报酬）。"""
    # H-4：先按 klen 分级切分，避免单笔撞 storage 桶整笔回滚
    split_jobs = []
    for j in jobs:
        split_jobs.extend(_split_job(j, args.period))
    jobs = split_jobs

    total = sum(len(bytes.fromhex(j["blob"])) // j["klen"] for j in jobs)
    label = "续租" if func == "rent_keys" else "补期（无报酬）"
    print("待%s：%d 批 / %d 键%s"
          % (label, len(jobs), total,
             (" → 预计报酬 %.2f HAC" % (total * reward_per_key)) if reward_per_key else ""))

    if args.dry_run:
        for j in jobs:
            n = len(bytes.fromhex(j["blob"])) // j["klen"]
            vl = _value_len(j["klen"], j["blob"])
            est = (vl + VALUE_BASE) * args.period * n
            print("  [dry] klen=%2d %2d 键  预计 storage=%6d / %d%s"
                  % (j["klen"], n, est, STORAGE_BUDGET,
                     "" if est <= STORAGE_BUDGET else "  ⚠ 超限"))
        print("dry-run 结束，未广播")
        return 0

    keyfile = _load_keyfile()

    ok = fail = 0
    for i, j in enumerate(jobs, 1):
        n = len(bytes.fromhex(j["blob"])) // j["klen"]
        # 同上：不换行会丢日志（Tee-Object 按行写）。
        print("[%d/%d] klen=%d %d 键 ..." % (i, len(jobs), j["klen"], n), flush=True)
        try:
            tx, signed = build_rent_tx(args.txbuild, args.node, args.main,
                                       args.contract, j["klen"], j["blob"],
                                       args.period, keyfile=keyfile, func=func)
            if not signed:
                raise RuntimeError("未签名（HACDS_SIGN_KEY 未生效）——拒绝广播")
            r = submit(args.node, tx)
            if r.get("ret") == 0:
                print("[OK] %s" % r.get("hash", "")[:16])
                ok += 1
            else:
                print("[FAIL] %s" % r.get("err", r))
                fail += 1
        except Exception as e:                                    # noqa: BLE001
            print("[FAIL] %s" % str(e)[:400])
            fail += 1
        time.sleep(args.delay)

    print("\n完成：成功 %d / 失败 %d" % (ok, fail))

    # ⚠ 2026-11-15 审计 H-2：写一份健康状态文件，让索引器/监控能判断
    #   "keeper 到底有没有在跑、上一轮续了什么"。
    #
    #   背景：链上**查不到**单个存储键的剩余租期（storage_stat 是 VM 内置，
    #   合约没有暴露成视图；节点 API 只有全局存储费参数）。所以运维侧
    #   只能用间接信号判断续租是否正常：
    #
    #     · 每轮都成功       → 正常
    #     · 连续多轮 job=0    → 键都很新，正常（刚续过）
    #     · 连续多轮 fail>0   → 异常，告警
    #     · 文件时间戳很旧    → keeper 没在跑，**这是最危险的**
    #
    #   索引器的 /keeper_health 读这个文件，超过阈值时长就返回 stale。
    try:
        _write_health(args, func, ok, fail, total)
    except Exception as e:                                       # noqa: BLE001
        print("（健康状态写入失败，不影响续租：%s）" % str(e)[:80])

    return 0 if fail == 0 else 1


def _write_health(args, func, ok, fail, total_keys):
    """写 keeper 健康状态（JSON），供索引器读取。"""
    health_path = getattr(args, "health", None) or DEFAULT_HEALTH
    now = int(time.time())
    rec = {
        "ts": now,
        "ts_human": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now)),
        "func": func,
        "batches_ok": ok,
        "batches_fail": fail,
        "keys_total": total_keys,
        "period": args.period,
        "contract": args.contract,
        "main": args.main,
    }
    # 保留上一轮的时间戳，便于监控算"上一轮到现在隔了多久"
    prev = None
    try:
        if os.path.exists(health_path):
            prev = json.load(open(health_path, encoding="utf-8"))
    except Exception:                                            # noqa: BLE001
        prev = None
    if prev:
        rec["prev_ts"] = prev.get("ts")
        rec["prev_ts_human"] = prev.get("prev_ts_human")
        # 连续失败轮数：成功后清零，失败累加
        streak = int(prev.get("consecutive_fail", 0))
        rec["consecutive_fail"] = (streak + 1) if fail > 0 else 0
    else:
        rec["consecutive_fail"] = 1 if fail > 0 else 0

    tmp = health_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(rec, f, ensure_ascii=False, indent=2)
    os.replace(tmp, health_path)
    print("健康状态已写：%s" % health_path)


def cmd_run(args):
    """常规续租：领报酬。只在 live < period/3 时才真正续。"""
    jobs = _collect_jobs(args, include_addr_keys=True)
    return _execute(args, jobs, "rent_keys", RENT_REWARD_HAC)


def cmd_daemon(args):
    """常驻循环：每隔 --interval 秒跑一轮 run。

    为什么需要它（2026-11-17）：
      原来 run 是「跑一轮就退出」，靠外部调度器（Windows 计划任务 / cron）
      驱动。但测试环境没装计划任务，只手动跑过一次 —— 结果 2.8 小时后
      账本键过期，池子和钻石全部丢失（真实发生过两次）。

      合约侧无法加长新键的初始租期（PERIOD_NEW=100 是编译期常量，
      100 期 × 100 块/期 = 10,000 块，1 块/秒时只有 2.8 小时），
      所以「定期续租」是唯一的保命手段。把循环放进进程本身，
      不依赖任何外部调度器，重启进程即恢复守护。

    ⚠ 与计划任务的区别：
      计划任务的好处是进程崩溃后系统会重拉；daemon 模式没有这层保护，
      但胜在零配置、跨平台、测试环境可用。生产环境两者可以并用。

    退出条件：
      · 连续 --max-consecutive-fail 轮失败（默认 5）→ 退出，避免刷屏
      · 收到 Ctrl+C → 正常退出
    """
    interval = max(60, int(getattr(args, "interval", 1800) or 1800))
    print("=== keeper daemon 启动：每 %d 秒一轮，period=%s ===" % (interval, args.period))
    print("    合约=%s   keeper=%s" % (args.contract, args.main))

    consecutive_fail = 0
    round_no = 0
    while True:
        round_no += 1
        print("\n----- 第 %d 轮  %s -----" % (
            round_no, time.strftime("%Y-%m-%d %H:%M:%S")))
        try:
            jobs = _collect_jobs(args, include_addr_keys=True)
            if not jobs:
                print("  没有可续租的键（可能索引器还没扫到）")
                rc = 0
                # ⚠ 2026-11-20：空轮次也要写 health。
                #   否则索引器的 /keeper_health 永远停在最后一次真正续租的时刻，
                #   看起来像"keeper 挂了"，实际它活得好好的、只是这轮没活干。
                try:
                    _write_health(args, "rent_keys", 0, 0, 0)
                except Exception as e:                            # noqa: BLE001
                    print("  （health 写入失败：%s）" % str(e)[:80])
            else:
                rc = _execute(args, jobs, "rent_keys", RENT_REWARD_HAC)

            # 合约 B 的股东键：独立的一段，失败不影响 A 的续租结论
            if getattr(args, "vault", ""):
                try:
                    vok, vfail = rent_vault(args)
                    # 2026-11-20：B 的结果单独记进 health 文件。
                    #   原来只 print 到控制台，而 PowerShell 的 Tee-Object
                    #   有缓冲，日志里常常只留下 "B[1/1] 1 个地址 ..." 半行，
                    #   事后无法判断到底续没续成。写进 JSON 才可靠。
                    try:
                        hp = getattr(args, "health", None) or DEFAULT_HEALTH
                        if os.path.exists(hp):
                            h = json.load(open(hp, encoding="utf-8"))
                            h["vault_ok"] = vok
                            h["vault_fail"] = vfail
                            h["vault_period"] = getattr(args, "vault_period", None)
                            h["vault_addr"] = getattr(args, "vault", None)
                            tmp = hp + ".tmp"
                            json.dump(h, open(tmp, "w", encoding="utf-8"),
                                      ensure_ascii=False, indent=2)
                            os.replace(tmp, hp)
                    except Exception as e:                        # noqa: BLE001
                        print("  [WARN] B 结果写入 health 失败：%s" % str(e)[:100])
                    if vfail > 0:
                        rc = 1
                    elif vok > 0:
                        print("  金库 B：成功 %d 批" % vok)
                except Exception as e:                            # noqa: BLE001
                    print("  [WARN] 金库 B 续租异常（不影响 A）：%s" % str(e)[:150])
        except Exception as e:                                    # noqa: BLE001
            print("  本轮异常：%s" % str(e)[:200])
            rc = 1

        if rc == 0:
            consecutive_fail = 0
        else:
            consecutive_fail += 1
            print("  [WARN] 连续失败 %d 轮" % consecutive_fail)
            if consecutive_fail >= 5:
                print("  [STOP] 连续 5 轮失败，daemon 退出。请检查节点/索引器/私钥。")
                return 1

        print("  下一轮在 %d 秒后（%s）" % (
            interval, time.strftime("%H:%M:%S", time.localtime(time.time() + interval))))
        time.sleep(interval)


def cmd_topup(args):
    """首注后立即补满：把已存在的键从 PERIOD_NEW(100) 直接补到 period(300)。

    为什么需要单独一条命令
    ----------------------
    `rent_keys` 的续租条件是 `live < period/3`，而 `live` 的单位是**区块**。
    首注新建的键租 100 期 = 10,000 块，远高于阈值 100，所以**首注后立刻调
    rent_keys 不会续、也不付酬**——要等 live 掉到 100 以下，约 34 天。

    这 34 天里如果 keeper 没跑起来，键会到期失效（账本键消失 = 用户余额归零）。

    `topup_keys` 不看阈值、直接补期，且**不付报酬**（否则任何人可每块调用领赏，
    复现 C-2 的抽干 tre:hac 攻击）。所以本命令是纯支出，成本几乎为零：
    3 笔交易 ≈ 0.0006 HAC，再加 storage gas（由交易 fee 承担）。

    覆盖哪些键
    ----------
    · **固定键** —— 合约 rent_keys_group 提供（amm:*/tot:*/res:* 等）
    · **首注地址键** —— 脚本自己构造（合约无法枚举地址）：
        u:<首注人>、ck:<首注人>、u:<BURN>、ck:<BURN>
      其中 BURN 就是合约地址本身（HacdsDeFi3000.fitsh:182），首注铸
      MINIMUM_LIQUIDITY 死份额时创建。
    · 加 --include-addr-keys 时再并上索引器提供的全部活跃地址键。

    典型用法：首注完成后立刻跑一次，把窗口从 34 天延到 104 天。
    """
    if args.period < RENT_PERIOD:
        raise SystemExit("--period 必须 ≥ %d（topup 只用于补长，不能缩短）" % RENT_PERIOD)
    # L-8：合约侧 `rent_keys`/`topup_keys` 要求 period ≤ RENT_PERIOD*10；
    # 脚本侧也要拦，否则 --period 1e9 会让单笔 storage 远超预算（OutOfGas，白烧手续费）。
    if args.period > RENT_PERIOD * 10:
        raise SystemExit("--period 必须 ≤ %d（合约硬上限）" % (RENT_PERIOD * 10))

    fixed_jobs = _collect_jobs(args, include_addr_keys=False)
    jobs = list(fixed_jobs)

    # H-5：首注还会创建**地址键**，而 rent_keys_group 只返回固定键
    # （合约无法枚举地址）。所以脚本自己构造首注涉及的那几个键：
    #   u:<首注人>   ← settle_and_write(main,0/1) 创建
    #   ck:<首注人>  ← 同上，检查点
    #   u:<BURN>     ← wr_u_field(BURN_ADDR, 2, ...) 铸死份额时创建
    # 名长 2 前缀 + 21 字节地址 = 23，故 klen=23。
    burn = args.contract            # BURN_ADDR 常量 == 合约地址（:182）
    seeds = []
    for a in (args.main, burn):
        if a and a not in seeds:
            seeds.append(a)

    for a in seeds:
        try:
            a21 = _addr_to_21(a)
        except Exception as e:                                    # noqa: BLE001
            print("  [WARN] 跳过地址键 %s：%s" % (a, e))
            continue
        # ⚠ 2026-11-12：klen 必须逐个前缀算 —— `u:` 是 2+21=23 字节，
        #   而 `ck:` 是 3+21=**24** 字节。原实现统一写 23，ck: 那笔
        #   `size % klen == 1` 被合约 rent_keys/topup_keys 以 `return 3`
        #   （长度不符）整笔拒绝 → topup 的保护完全没生效。
        for prefix in (b"u:", b"ck:"):
            key = prefix + a21
            jobs.append({"klen": len(key), "blob": key.hex()})

    addr_key_n = len(jobs) - len(fixed_jobs)
    if addr_key_n:
        print("（另含 %d 个首注地址键：u:/ck:<首注人>%s）"
              % (addr_key_n,
                 " + u:/ck:<BURN>" if len(seeds) > 1 else ""))

    if args.include_addr_keys:
        extra = _collect_jobs(args, include_addr_keys=True)
        jobs += extra
        if extra:
            print("（另含索引器提供的 %d 批活跃地址键）" % len(extra))

    return _execute(args, jobs, "topup_keys", 0)


def selftest() -> int:
    """离线自检：键长与批次容量。不联网、不需要私钥。

    这两个缺陷都在 2026-11-12 审计中被发现，且都属于「不联网、不跑链
    就看不出来」的类型，所以固化成回归测试。
    """
    ok = True
    checks = []

    def chk(label, got, exp):
        nonlocal ok
        good = (got == exp)
        ok = ok and good
        checks.append(("PASS" if good else "FAIL", label, got, exp))

    a21 = b"\x00" * 21
    # 1) 地址类键长必须按前缀分别计算（ck: 是 24，不是 23）
    chk("len(u: + 21) = 23", len(b"u:" + a21), 23)
    chk("len(ck: + 21) = 24", len(b"ck:" + a21), 24)
    chk("len(ln: + 21) = 24", len(b"ln:" + a21), 24)
    chk("len(bad: + 21) = 25", len(b"bad:" + a21), 25)

    # 2) 值长取批内最大值（混合 ln:/ck: 必须按 ck: 的 64 算）
    chk("u: 值长 = 48", _one_value_len(b"u:" + a21), 48)
    chk("ln: 值长 = 48", _one_value_len(b"ln:" + a21), 48)
    chk("ck: 值长 = 64", _one_value_len(b"ck:" + a21), 64)
    chk("bad: 值长 = 16", _one_value_len(b"bad:" + a21), 16)

    mixed = (b"ck:" + a21) * 3 + (b"ln:" + a21) * 2
    chk("混合批取最大 64", _value_len(24, mixed.hex()), 64)

    # 3) 满批容量不得超 storage 桶（用真实前缀 + 21 字节地址构造 10 个键）
    for prefix in (b"u:", b"ln:", b"ck:", b"bad:"):
        one = prefix + a21
        klen = len(one)
        blob = (one * 10).hex()
        cap = max_keys_per_batch(klen, blob, RENT_PERIOD)
        vlen = _value_len(klen, blob)
        cost = cap * (vlen + VALUE_BASE) * RENT_PERIOD
        chk("%s 满批 %d 键不超桶" % (prefix.decode(), cap),
            cost <= STORAGE_BUDGET, True)

    # 4) 金库 B 的批量续租容量（2026-11-18 新增 pay_rent_shares）
    #
    # 为什么必须测：这个上限随 period 变化，写死会在 period=300 时
    # 让 10 个地址 = 324,000 gas 撞 storage 桶 111,911 → OutOfGas 整笔回滚
    # （不但没续上，gas 也白烧）。合约侧用同样的公式现算，两边必须一致。
    chk("B period=30  可装 34 地址", _vault_max_addrs(30), 34)
    chk("B period=100 可装 10 地址", _vault_max_addrs(100), 10)
    chk("B period=300 可装 3 地址", _vault_max_addrs(300), 3)
    # 装下的量必须真的不超桶
    for p in (30, 100, 300):
        cap = _vault_max_addrs(p)
        cost = cap * VAULT_KEY_UNIT * p * VAULT_KEYS_PER_ADDR
        chk("B period=%d 容量不超桶" % p, cost <= VAULT_STORAGE_BUDGET, True)
        # 再多装一个就必须超桶（否则上限过于保守，白白多跑批）
        over = (cap + 1) * VAULT_KEY_UNIT * p * VAULT_KEYS_PER_ADDR
        chk("B period=%d 多装1个即超桶" % p, over > VAULT_STORAGE_BUDGET, True)

    # 5) period 过大时的自动降级（2026-11-18 修复）
    #
    # 为什么必须测：原实现在 `_vault_max_addrs(period) == 0` 时只打一行警告
    # 就 `return 0, 0` 跳过 B —— B 的股东键从此静默无人续租，34.7 天后
    # 到期删除、份额永久归零，而运维很难注意到那一行日志。
    # 现在改成自动降到"单笔能装 1 个地址"的最大 period。
    safe = VAULT_STORAGE_BUDGET // (VAULT_KEY_UNIT * VAULT_KEYS_PER_ADDR)
    chk("降级阈值 = 1027 期", safe, 1027)
    chk("阈值处仍能装 1 个地址", _vault_max_addrs(safe), 1)
    chk("阈值+1 就装不下", _vault_max_addrs(safe + 1), 0)
    # 边界：常用 period 都必须在阈值内，否则会触发降级
    for p in (30, 100, 300):
        chk("period=%d 无需降级" % p, _vault_max_addrs(p) >= 1, True)

    # 6) 合约清单外的补充键（2026-11-19）
    #
    # 为什么必须测：`amm:lastout` 不在合约的 rent_keys_group() 里，
    # 全靠 keeper 侧这份清单续租。清单写错（键名拼错、长度写错）会让这个键
    # 静默到期 —— 兑换数量归零，而且链上不会报任何错。
    eg = extra_fixed_groups()
    allkeys = [n for n, _ in EXTRA_FIXED_KEYS]
    chk("补充键包含 amm:lastout", "amm:lastout" in allkeys, True)
    chk("补充键分组非空", len(eg) > 0, True)
    # 每个声明的长度必须与实际字节长度一致，否则批次会错位
    for name, klen in EXTRA_FIXED_KEYS:
        chk("键长正确 %s" % name, len(name.encode("ascii")), klen)
    # 分组后的 blob 长度必须是 klen 的整数倍（_split_job 的前提）
    for g in eg:
        chk("blob 长度整除 klen=%d" % g["klen"],
            len(bytes.fromhex(g["blob"])) % g["klen"], 0)

    for st, label, got, exp in checks:
        print("  [%s] %s = %s%s" % (st, label, got, "" if st == "PASS" else "  (expect %s)" % exp))
    print("KEEPER SELFTEST " + ("PASSED" if ok else "FAILED"))
    return 0 if ok else 1


def main():
    ap = argparse.ArgumentParser(description="hacds keeper —— 无许可账本键续租")
    ap.add_argument("cmd",
                    choices=["check", "quote", "run", "topup", "selftest", "daemon"])
    ap.add_argument("--interval", type=int, default=1800,
                    help="daemon 模式下两轮之间的秒数（默认 1800 = 30 分钟）")
    ap.add_argument("--indexer", default=DEFAULT_INDEXER)
    ap.add_argument("--node", default=DEFAULT_NODE)
    ap.add_argument("--contract", default="bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h")
    ap.add_argument("--txbuild", default=DEFAULT_TXBUID)
    ap.add_argument("--main", help="keeper 地址（tx.main）")
    ap.add_argument("--max-keys", type=int, default=RENT_MAX_KEYS)
    ap.add_argument("--period", type=int, default=RENT_PERIOD)
    ap.add_argument("--delay", type=float, default=1.0, help="每批间隔秒数")
    ap.add_argument("--health", default=None,
                    help="健康状态文件路径（默认 hacds_exchange/indexer/keeper_health.json）")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-addr-keys", action="store_true",
                    help="topup 时连地址键一起补（默认只补固定键）")
    ap.add_argument("--vault", default="",
                    help="金库分红合约 B 的地址；给了才续租 B 的股东键")
    ap.add_argument("--vault-period", type=int, default=100,
                    help="续租 B 的股东键时用的目标租期（默认 100；"
                         "越大单笔能装的地址越少，见 _vault_max_addrs）")
    args = ap.parse_args()

    if args.cmd == "selftest":
        sys.exit(selftest())
    if args.cmd == "check":
        sys.exit(cmd_check(args))
    if args.cmd == "quote":
        sys.exit(cmd_quote(args))
    if not args.main:
        raise SystemExit("%s 需要 --main <keeper 地址>" % args.cmd)
    if args.cmd == "topup":
        sys.exit(cmd_topup(args))
    if args.cmd == "daemon":
        return cmd_daemon(args)
    sys.exit(cmd_run(args))


if __name__ == "__main__":
    main()
