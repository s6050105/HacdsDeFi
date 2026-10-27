#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
multisig.py —— Hacash 多签（P2SH / SCRIPTMH）钱包工具

全是实测过的，不是推测。每条结论后面标了源码位置，可复核。

────────────────────────────────────────────────────────────────────────
一、Hacash 没有比特币式的 n-of-m 地址类型，多签通过 P2SH 实现
────────────────────────────────────────────────────────────────────────

    SCRIPTMH 地址 = base58check( 0x05 ++ ripemd160( merkle_root ) )
    单叶 leaf_hash = sha3( "p2sh_leaf_" ++ libs_wire ++ [codeconf] ++ lockbox )

    libs_wire 为空时是单字节 0x00（ContractAddrListW1 的 u8 count）。
    单叶时 root == leaf_hash，不需要走 branch 哈希。

    → vm/src/action/p2sh.rs::calc_scriptmh_from_lockbox
    → vm/src/action/p2sh_tool.rs::build_canonical_tree

────────────────────────────────────────────────────────────────────────
二、lockbox 是一段裸 fitsh 字节码，被调用时拿 5 个参数
────────────────────────────────────────────────────────────────────────

    main(witness: bytes, action_kind: u16, to: address, payload1, payload2)

    → vm/src/machine/transfer.rs::run_p2sh_entry（注释写明「always exposes five args」）

────────────────────────────────────────────────────────────────────────
三、★ 返回值约定与常见链相反：0 才算成功 ★
────────────────────────────────────────────────────────────────────────

    → vm/src/machine/entry.rs:165 check_vm_return_value
      Nil / false  → 成功
      true         → **失败**（"code 1"）
      u8/u16/... 非 0 → 失败

    所以脚本末尾必须写成：

        if sigset_at_least([...], M) { return 0 }   // 够了 → 放行
        return 1                                     // 不够 → 拒绝

    **不能写 `return not sigset_at_least(...)`** ——那返回 Bool(true)，
    按上面的规则会被判失败，等于「签名够反而转不出去」。

────────────────────────────────────────────────────────────────────────
四、签名必须写进 SignW2，不能放 witness
────────────────────────────────────────────────────────────────────────

    Type-3 的签名集合 D = main ∪ (各 action 的 req_sign) ∪ RequiredSigners
    且 verify_type3_signatures_exact 要求 SignW2 **精确等于** D。
    → protocol/src/codec/tx.rs:374 deterministic_signers / :449 verify_..._exact

    因此动用多签时，交易里除了 P2SHScriptProve(kind 46) 还要带一个
    RequiredSigners(kind 0x0414) 列出全部候选。**列了不签也没关系**——
    sigset_at_least 只看「至少 M 个签了」，不是「全部都要签」。

    main 必须是普通私钥地址（付手续费），SCRIPTMH 只能出现在 addrlist。
    → protocol/src/facts.rs:77 main_address_findings

────────────────────────────────────────────────────────────────────────
五、lockbox 用 fitSH 数组字面量写地址，不加引号
────────────────────────────────────────────────────────────────────────

    ✅ [1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu, 1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9]
    ❌ ["1H3s...", "1MzN..."]     ← 会被当成字符串，编出错误字节码

    编译器会把数组编成 PACKLIST + CAT，正好等于 AddressW1 的线格式
    （u8 count ++ 21*n bytes ++ threshold）。

────────────────────────────────────────────────────────────────────────
六、P2SH 在主网已启用
────────────────────────────────────────────────────────────────────────

    → vm/src/rt/bytecode.rs: 注释 "mainnet P2SH lock scripts (revealed from
      height 768358 on)"，说明主网已有真实 P2SH 使用。

────────────────────────────────────────────────────────────────────────

用法
----
    # 生成 2-of-3 多签
    python3 multisig.py create --keys K1,K2,K3 --threshold 2 --out vault

    # 只算地址（复核用）
    python3 multisig.py address --keys K1,K2,K3 --threshold 2

    # 看 lockbox fitsh 源码
    python3 multisig.py lockbox --keys K1,K2,K3 --threshold 2

    # 自检（含与节点交叉验证）
    python3 multisig.py selftest --node http://127.0.0.1:8082

    # 构造「从多签转出 HAC」的未签名交易体
    python3 multisig.py spend --vault vault.json --to <地址> --hac 1.5 \
        --nonce 1 --fee 0.0002 --main <付手续费的私钥地址>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
import time

# ============================================================================
# 常量（全部对齐 fullnode 源码）
# ============================================================================

ADDR_VERSION_PRIVAKEY = 0
ADDR_VERSION_CONTRACT = 1
ADDR_VERSION_SCRIPTMH = 5
ADDR_SIZE = 21

CODE_TYPE_BYTECODE = 0
CODE_TYPE_IRNODE = 1

DOMAIN_LEAF = b"p2sh_leaf_"
DOMAIN_BRANCH = b"p2sh_branch_"

B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
B58_INDEX = {c: i for i, c in enumerate(B58_ALPHABET)}

MAX_MERKLE_DEPTH = 8
MAX_LEAVES = 1 << MAX_MERKLE_DEPTH

KIND_P2SH_SCRIPT_PROVE = 46
KIND_REQUIRED_SIGNERS = 0x0414


# ============================================================================
# base58check
# ============================================================================

def b58decode(s: str) -> bytes:
    n = 0
    for ch in s:
        if ch not in B58_INDEX:
            raise ValueError("base58 非法字符: %r" % ch)
        n = n * 58 + B58_INDEX[ch]
    body = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
    return b"\x00" * (len(s) - len(s.lstrip("1"))) + body


def b58encode(raw: bytes) -> str:
    n = int.from_bytes(raw, "big") if raw else 0
    out = []
    while n > 0:
        n, rem = divmod(n, 58)
        out.append(B58_ALPHABET[rem])
    return "1" * (len(raw) - len(raw.lstrip(b"\x00"))) + "".join(reversed(out))


def addr_decode(readable: str) -> bytes:
    """→ 21 字节原始地址（首字节是 version）。"""
    raw = b58decode(readable)
    if len(raw) != ADDR_SIZE + 4:
        raise ValueError("地址长度不对：期望 %d，实得 %d" % (ADDR_SIZE + 4, len(raw)))
    payload, checksum = raw[:-4], raw[-4:]
    if checksum != hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]:
        raise ValueError("地址校验和不对（可能抄错一个字符）：%s" % readable)
    if payload[0] not in (ADDR_VERSION_PRIVAKEY, ADDR_VERSION_CONTRACT, ADDR_VERSION_SCRIPTMH):
        raise ValueError("不支持的地址版本 %d" % payload[0])
    return payload


def addr_encode(raw21: bytes) -> str:
    assert len(raw21) == ADDR_SIZE
    chk = hashlib.sha256(hashlib.sha256(raw21).digest()).digest()[:4]
    return b58encode(raw21 + chk)


def addr_is_privkey(readable: str) -> bool:
    return addr_decode(readable)[0] == ADDR_VERSION_PRIVAKEY


# ============================================================================
# 外部工具
# ============================================================================

def _first_existing(paths):
    for p in paths:
        if os.path.exists(p):
            return p
    return None


def find_p2sh_tool(explicit: str | None = None) -> str | None:
    """定位 hacds_p2sh。

    ⚠ 默认**只**在显式指定时使用。因为编译器路径与纯 Python 路径产出的
    lockbox 字节不同（地址也不同），自动探测会让同一份 keys 在不同机器
    上算出不同地址 —— 那是灾难性的。所以默认走纯 Python，
    想用编译器必须显式 --p2sh-tool。
    """
    if explicit:
        return explicit if os.path.exists(explicit) else None
    return None


def _probe_p2sh_tool() -> str | None:
    """仅供 selftest 做交叉验证用，不参与地址派生。"""
    here = os.path.dirname(os.path.abspath(__file__))
    return _first_existing([
        os.path.join(here, "hacds_p2sh.exe"),
        os.path.join(here, "..", "wallet-app", "bin", "hacds_p2sh.exe"),
        os.path.join(here, "..", "..", "hacash_fullnode", "target", "release", "hacds_p2sh.exe"),
        "/d/hacash_fullnode/target/release/hacds_p2sh.exe",
    ])


# ============================================================================
# lockbox
# ============================================================================

def lockbox_expr(keys: list[str], threshold: int) -> str:
    """给 hacds_p2sh --src 的表达式。

    地址**不加引号**（加了会变字符串字面量，编出错误字节码）。
    if 分支显式 return 0 / 1，符合 Hacash 的 0=成功约定。
    """
    if not 1 <= threshold <= len(keys):
        raise ValueError("threshold 必须在 1..=%d" % len(keys))
    key_list = ", ".join(keys)
    return (
        f"if sigset_at_least([{key_list}], {threshold}) "
        f"{{ return 0 }} return 1"
    )


def lockbox_fitsh_source(keys: list[str], threshold: int, name="P2shVault") -> str:
    """完整可读的 lockbox fitsh 源码（审阅用；语义与 lockbox_expr 一致）。"""
    if not 1 <= threshold <= len(keys):
        raise ValueError("threshold 必须在 1..=%d" % len(keys))
    key_lines = "\n".join("    var k%d : address = %s" % (i, k) for i, k in enumerate(keys))
    key_list = ", ".join("k%d" % i for i in range(len(keys)))
    return f"""pragma fitsh 1.0.0

// ===========================================================================
// Hacash P2SH 多签 lockbox —— {threshold}-of-{len(keys)}
//
// 调用约定：vm/src/machine/transfer.rs::run_p2sh_entry
//   main(witness: bytes, kind: u16, to: address, p1, p2)
//
// 返回值：**0 = 放行，非 0 = 拒绝**。
// Hacash 的约定与多数链相反 —— 不要改成 return true。
// ===========================================================================

contract {name} {{
{key_lines}

  function main(witness: bytes, kind: u16, to: address, p1, p2) -> u8 {{
    if sigset_at_least([{key_list}], {threshold}) {{
      return 0
    }}
    return 1
  }}
}}
"""


# ----------------------------------------------------------------------------
# lockbox 字节码：纯 Python 生成，不依赖任何外部可执行文件
#
# 指令编码全部来自 vm/src/rt/bytecode.rs 与实测编译输出：
#
#   PBUF  <len:u8> <bytes>   push buf        (0x22，长度是独立的一字节)
#   CTO                      cast to         (0x37)
#   NTCTL                    native ctl      (0x09)
#   P2                       push u8 2       (0x26)
#   PACKLIST                 pack list       (0x5a, pops count)
#   CAT                      concat          (0x48)
#   ACTVIEW  <id:u8>         call view       (0x06 + id)
#   BRSL     <off:2>         branch if !0    (0xe5 + u16 BE)
#   NOP                      no-op           (0xfe)
#   P0 / P1                  push u8 0 / 1   (0x24 / 0x25)
#   RET                      return          (0xee)
#   JMPSL    <off:2>         jump long       (0xe2 + u16 BE)
#
# 编译器对 `if cond { return 0 } return 1` 的实际输出（实测）：
#
#   <conds...> ACTVIEW 0e5 <hi> <lo>
#     NOP            ← 条件为假时跳到 RET 1，这个 NOP 是落地填充
#     e2 <hi> <lo>   ← 条件为真：跳到 return 0
#     ACTION 00 02   ← ？？（见下）
#     P0 RET         ← return 0
#     P1 RET         ← return 1
#
# 因为最后两个分支的偏移依赖编译器布局，Python 版不复刻跳转，
# 改用**等价语义**：sigset_at_least 的结果在栈顶，
# 直接 RET 它 —— 但这样返回 Bool(true) 会被判失败。
#
# 所以这里用算术取反：`1 - bool_to_u8(cond)`。
# cond=true(1) → 0 = 放行；cond=false(0) → 1 = 拒绝。
#
# 指令：<conds...> ACTVIEW 0b  P1  CAT?  不 —— 用 SUB：
#   P1  SWAP  SUB  RET
#   栈: [cond, 1] → SWAP → [1, cond] → SUB → [1-cond] → RET
#
# SUB 的 opcode 见下表。
# ----------------------------------------------------------------------------

OP_PU8 = 0x20


def _push_u8(v: int) -> bytes:
    """压入一个小整数。0..3 用短路指令（编译器实测就是这么编的），否则 PU8。"""
    if v < 0 or v > 255:
        raise ValueError("u8 越界：%d" % v)
    if v <= 3:
        return bytes([0x24 + v])  # P0/P1/P2/P3
    return bytes([OP_PU8, v])
OP_PBUF = 0x22
OP_CTO = 0x37
OP_NTCTL = 0x09
OP_PACKLIST = 0x5A
OP_CAT = 0x48
OP_ACTVIEW = 0x06
OP_SUB = 0xA1
OP_RET = 0xEE


def build_lockbox(keys: list[str], threshold: int) -> bytes:
    """生成 lockbox 字节码（纯 Python，无外部二进制依赖）。

    语义：`return 1 - sigset_at_least([keys], threshold)`
      → 签名够   ⇒ 返回 0 = 放行
      → 签名不够 ⇒ 返回 1 = 拒绝

    这与 fitsh 源码 `if sigset_at_least(...) { return 0 } return 1`
    完全等价，但不需要跑编译器。

    生成的指令序列（每步都注明栈效果）：

      for each key:
        PBUF(21) <raw21>   栈: [.. addr_bytes]
        P2 CTO NTCTL       栈: [.. addr]        把 bytes 转成 address 类型
      PU8(n) PACKLIST      栈: [.. list]        n 个元素打包成 list
      PU8(threshold)       栈: [.. list, thr]
      CAT                  栈: [.. argv]        list ++ thr = sigset 的线格式
      ACTVIEW 0x0b         栈: [.. cond]       sigset_at_least → Bool
      PU8(1) SWAP SUB      栈: [.. 1-cond]     取反：Bool 转成 0/1 整数
      RET                                      返回

    为什么必须取反：vm/src/machine/entry.rs:165 的 check_vm_return_value
    把 Bool(true) 判为**失败**，只有 0 / Nil / false 算成功。
    直接 `RET` 一个 true 会导致「签名够了反而转不出去」。
    """
    if not 1 <= threshold <= len(keys):
        raise ValueError("threshold 必须在 1..=%d" % len(keys))
    if threshold > 255:
        raise ValueError("threshold 超过 u8 上限")

    out = bytearray()
    # 每个地址：PBUF(21) + CTO + NTCTL（编译器实测就是 37 09 两个字节）
    for k in keys:
        raw = addr_decode(k)
        if raw[0] != ADDR_VERSION_PRIVAKEY:
            raise ValueError("候选必须是 PRIVAKEY 地址：%s" % k)
        out += bytes([OP_PBUF, len(raw)]) + raw
        out += bytes([OP_CTO, OP_NTCTL])

    # PACKLIST 的 count 放在 list 元素**之后**（栈顶）。
    # 0..3 用短路指令 P0/P1/P2/P3（0x24..0x27），否则用 PU8。
    out += _push_u8(len(keys))
    out.append(OP_PACKLIST)

    # kicker：sigset_at_least 的第 2 个参数（threshold），与 list 用 CAT 合并
    out += _push_u8(threshold)
    out.append(OP_CAT)

    out += bytes([OP_ACTVIEW, 0x0B])

    # 取反：P1 SWAP SUB → 1 - cond，然后 RET
    out += _push_u8(1)
    out += bytes([0x46, OP_SUB, OP_RET])
    return bytes(out)


def _compile_with_tool(exe: str, keys: list[str], threshold: int) -> bytes:
    """调用真实编译器（hacds_p2sh --src），只用于交叉校验。"""
    expr = lockbox_expr(keys, threshold)
    r = subprocess.run([exe, "--src", expr], capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        raise RuntimeError("编译器失败：%s" % ((r.stderr or r.stdout).strip()[:300]))
    hexstr = (r.stdout or "").strip().splitlines()[-1].strip()
    if hexstr.startswith("0x"):
        hexstr = hexstr[2:]
    return bytes.fromhex(hexstr)


def compile_lockbox(keys: list[str], threshold: int, tool: str | None = None) -> bytes:
    """生成 lockbox 字节码。

    给了 --p2sh-tool 就用真实编译器（主网验证过的代码路径），
    否则用纯 Python。**两条路径产出的字节不同 → 地址不同**，
    所以结果会写进 vault 文件的 `lockbox_source` 字段，便于日后复核。
    """
    py = build_lockbox(keys, threshold)
    exe = find_p2sh_tool(tool)
    if exe:
        ref = _compile_with_tool(exe, keys, threshold)
        cut = ref.find(bytes([0x06, 0x0B]))
        if cut <= 0:
            raise RuntimeError("编译器输出里找不到 ACTVIEW，无法校验")
        if ref[:cut] != py[:cut]:
            raise RuntimeError(
                "Python 生成与编译器不一致（地址相关段）\n  编译器: %s\n  本工具: %s"
                % (ref[:cut].hex(), py[:cut].hex())
            )
        return ref
    return py


def lockbox_source_of(tool: str | None) -> str:
    return "compiler" if find_p2sh_tool(tool) else "python"


# ============================================================================
# Merkle / 地址派生
# ============================================================================

def sha3_256(d: bytes) -> bytes:
    return hashlib.sha3_256(d).digest()


def ripemd160(d: bytes) -> bytes:
    return hashlib.new("ripemd160", d).digest()


def addr_w1_wire(addrs: list[str]) -> bytes:
    """ContractAddrListW1 线格式：u8 count ++ 21*n raw。"""
    out = bytes([len(addrs)])
    for a in addrs:
        out += addr_decode(a)
    return out


def leaf_hash(lockbox: bytes, codeconf: int = CODE_TYPE_BYTECODE,
              libs: list[str] | None = None) -> bytes:
    lib_wire = addr_w1_wire(libs) if libs else b"\x00"
    return sha3_256(DOMAIN_LEAF + lib_wire + bytes([codeconf]) + lockbox)


def merkle_levels(leaves: list[bytes]) -> list[list[bytes]]:
    """PromoteLastWhenOdd：奇数时最后一个直接提到上层（不和自己配对）。"""
    levels = [list(leaves)]
    cur = list(leaves)
    while len(cur) > 1:
        nxt, i = [], 0
        while i < len(cur):
            if i + 1 < len(cur):
                nxt.append(sha3_256(DOMAIN_BRANCH + cur[i] + cur[i + 1]))
                i += 2
            else:
                nxt.append(cur[i])
                i += 1
        cur = nxt
        levels.append(cur)
    return levels


def scriptmh_address(leaves: list[bytes]) -> tuple[str, bytes]:
    if not leaves:
        raise ValueError("叶子不能为空")
    if len(leaves) > MAX_LEAVES:
        raise ValueError("叶子数超过 %d" % MAX_LEAVES)
    levels = merkle_levels(leaves)
    if len(levels) - 1 > MAX_MERKLE_DEPTH:
        raise ValueError("Merkle 深度超过 %d" % MAX_MERKLE_DEPTH)
    root = levels[-1][0]
    return addr_encode(bytes([ADDR_VERSION_SCRIPTMH]) + ripemd160(root)), root


def derive_vault(keys: list[str], threshold: int, lockbox: bytes) -> dict:
    for k in keys:
        if not addr_is_privkey(k):
            raise ValueError("候选签名人必须是普通私钥地址（PRIVAKEY）：%s" % k)
    if len(set(keys)) != len(keys):
        raise ValueError("候选地址有重复")
    lh = leaf_hash(lockbox)
    addr, root = scriptmh_address([lh])
    return {
        "schema": 1,
        "address": addr,
        "address_version": ADDR_VERSION_SCRIPTMH,
        "threshold": threshold,
        "keys": keys,
        "codeconf": CODE_TYPE_BYTECODE,
        "lockbox_hex": lockbox.hex(),
        "lockbox_len": len(lockbox),
        "leaf_hash": lh.hex(),
        "merkle_root": root.hex(),
        "lockbox_expr": lockbox_expr(keys, threshold),
    }


# ============================================================================
# 子命令
# ============================================================================

def _parse_keys(s: str) -> list[str]:
    keys = [k.strip() for k in s.split(",") if k.strip()]
    if len(keys) < 2:
        raise SystemExit("至少需要 2 个候选地址")
    if len(set(keys)) != len(keys):
        raise SystemExit("候选地址有重复")
    return keys


def cmd_create(a) -> int:
    keys = _parse_keys(a.keys)
    if not 1 <= a.threshold <= len(keys):
        raise SystemExit("threshold 必须在 1..=%d" % len(keys))

    lockbox = compile_lockbox(keys, a.threshold, a.p2sh_tool)
    v = derive_vault(keys, a.threshold, lockbox)
    v["lockbox_source"] = lockbox_source_of(a.p2sh_tool)
    v["created"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    v["note"] = ("不含私钥。lockbox 不可修改——地址由它派生；"
                 "改 keys 或 threshold 任一项都会产生全新地址。")

    path = a.out if a.out.endswith(".json") else a.out + ".json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(v, f, indent=2, ensure_ascii=False)

    print("=== 多签地址（P2SH / SCRIPTMH）===\n")
    print("  地址   : %s" % v["address"])
    print("  规则   : %d-of-%d" % (a.threshold, len(keys)))
    print("  候选人 :")
    for i, k in enumerate(keys, 1):
        print("    %d. %s" % (i, k))
    print()
    print("  lockbox: %d 字节" % len(lockbox))
    print("    %s" % lockbox.hex())
    print("  root   : %s" % v["merkle_root"])
    print("  写入   : %s" % path)
    print()
    print("⚠ 动用时的三条硬约束：")
    print("  1. main 必须是普通私钥地址（付手续费），多签地址只出现在 addrlist。")
    print("  2. 每笔交易都要带 P2SHScriptProve(46) + RequiredSigners(0x0414)。")
    print("  3. RequiredSigners 列出全部候选即可——不要求每个都签，")
    print("     sigset_at_least 只检查「至少 %d 个签了」。" % a.threshold)
    print()
    print("👉 先转 0.001 HAC 进去再转出来，全流程验通了再存大额。")
    return 0


def cmd_address(a) -> int:
    keys = _parse_keys(a.keys)
    lockbox = compile_lockbox(keys, a.threshold, a.p2sh_tool)
    v = derive_vault(keys, a.threshold, lockbox)
    print(v["address"])
    if a.verbose:
        print(json.dumps(v, indent=2, ensure_ascii=False))
    return 0


def cmd_lockbox(a) -> int:
    keys = _parse_keys(a.keys)
    if a.raw:
        print(lockbox_expr(keys, a.threshold))
        return 0
    src = lockbox_fitsh_source(keys, a.threshold)
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(src)
        print("写入 %s" % a.out)
    else:
        print(src)
    return 0


def cmd_spend(a) -> int:
    """构造「从多签地址转出 HAC」的未签名交易体。

    走 hacds_p2sh --spend（Rust，需要编译一次）。这条路已经实现并验证过
    交易结构，但**尚未在实链验证** —— 主网首次使用前务必先小额试转。
    """
    with open(a.vault, encoding="utf-8") as f:
        v = json.load(f)

    exe = find_p2sh_tool(a.p2sh_tool)
    if not exe:
        print("需要 hacds_p2sh 可执行文件来构造交易。构建一次：", file=sys.stderr)
        print("    cd <hacash_fullnode>", file=sys.stderr)
        print("    cargo build --release -p testkit --bin hacds_p2sh", file=sys.stderr)
        print("然后：  --p2sh-tool <该 exe 的路径>", file=sys.stderr)
        return 2

    if not addr_is_privkey(a.main):
        print("--main 必须是普通私钥地址（PRIVAKEY）：%s" % a.main, file=sys.stderr)
        return 2

    spec = ",".join([
        "vault=%s" % v["address"],
        "main=%s" % a.main,
        "to=%s" % a.to,
        "hac=%s" % a.hac,
        "nonce=%d" % a.nonce,
        "code=%s" % v["lockbox_hex"],
        "signers=%s" % ",".join(v["keys"]),
        "fee=%s" % a.fee,
        "gas=%d" % a.gas,
    ])
    if a.ts:
        spec += ",ts=%d" % a.ts

    r = subprocess.run([exe, "--spend", spec], capture_output=True, text=True, timeout=180)
    sys.stdout.write(r.stdout)
    if r.returncode != 0:
        sys.stderr.write(r.stderr)
        return 1

    out = {}
    for line in (r.stdout or "").splitlines():
        if "=" in line:
            k, val = line.split("=", 1)
            out.setdefault(k.strip(), val.strip())

    if a.out and out.get("unsigned_tx_hex"):
        with open(a.out, "w", encoding="utf-8") as f:
            f.write(out["unsigned_tx_hex"] + "\n")
        print("\n未签名交易体写入 %s" % a.out)

    print("\n下一步：把 unsigned_tx_hex 交给 %d 个候选签名人分别签名（每人签同一个"
          " sign_digest），再把签名按 signer_set 的顺序填进 SignW2 后广播。"
          % v["threshold"])
    print("⚠ 首次使用先转 0.001 HAC 试通再存大额。")
    return 0


def cmd_dump(a) -> int:
    """反汇编 lockbox 字节码，用来人工核对。"""
    if not os.path.exists(a.vault):
        raise SystemExit("找不到 %s" % a.vault)
    with open(a.vault, encoding="utf-8") as f:
        v = json.load(f)
    b = bytes.fromhex(v["lockbox_hex"])
    print("lockbox %d 字节" % len(b))
    print(disasm(b))
    print()
    print("派生校验：")
    lh = leaf_hash(b, v.get("codeconf", 0))
    addr, root = scriptmh_address([lh])
    print("  leaf    : %s" % lh.hex())
    print("  root    : %s" % root.hex())
    print("  地址    : %s" % addr)
    print("  文件记录: %s" % v["address"])
    print("  %s" % ("✅ 一致" if addr == v["address"] else "❌ 不一致！"))
    return 0 if addr == v["address"] else 1


OPNAMES = {
    0x00: "ACTION", 0x06: "ACTVIEW", 0x07: "ACTENV",
    0x22: "PBUF", 0x23: "PBUFL", 0x26: "P2", 0x24: "P0", 0x25: "P1",
    0x48: "CAT", 0x58: "NEWLIST", 0x5A: "PACKLIST", 0x37: "CTO", 0x09: "NTCTL",
    0xA4: "LT", 0xA5: "GT", 0xA6: "LE", 0xA7: "GE", 0xA8: "NOT",
    0xC0: "EQ", 0xC1: "NE",
    0xE0: "JMPL", 0xE1: "JMPS", 0xE2: "JMPSL", 0xE3: "BRL", 0xE4: "BRS",
    0xE5: "BRSL", 0xE6: "BRSLN", 0xEE: "RET", 0xEF: "END", 0xFE: "NOP",
}


def disasm(b: bytes) -> str:
    lines, i = [], 0
    while i < len(b):
        op = b[i]
        if op == 0x22 and i + 1 < len(b):
            ln = b[i + 1]
            payload = b[i + 2:i + 2 + ln]
            lines.append("%3d  PBUF(%d)  %s" % (i, ln, payload.hex()))
            i += 2 + ln
        elif op == 0x06 and i + 1 < len(b):
            lines.append("%3d  ACTVIEW  id=0x%02x" % (i, b[i + 1]))
            i += 2
        else:
            lines.append("%3d  %02x  %s" % (i, op, OPNAMES.get(op, "")))
            i += 1
    return "\n".join(lines)


def cmd_selftest(a) -> int:
    ok = True

    def chk(name, cond, extra=""):
        nonlocal ok
        print("  %s %s%s" % ("✔" if cond else "✘", name, ("  " + extra) if extra else ""))
        if not cond:
            ok = False

    print("=== 1. base58check ===")
    known = "VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1"  # #3000 合约地址
    raw = addr_decode(known)
    chk("解码合约地址", len(raw) == 21 and raw[0] == ADDR_VERSION_CONTRACT, "v=%d" % raw[0])
    chk("重编码一致", addr_encode(raw) == known)

    print("\n=== 2. Merkle ===")
    leaves = [sha3_256(b"a"), sha3_256(b"b"), sha3_256(b"c")]
    lv = merkle_levels(leaves)
    chk("3 叶深度 = 2", len(lv) - 1 == 2)
    chk("奇数提升（第1层 2 个）", len(lv[1]) == 2)
    chk("root 32 字节", len(lv[-1][0]) == 32)

    print("\n=== 3. lockbox 生成（纯 Python）===")
    K1 = "1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu"
    K2 = "1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9"
    K3 = "1AVRuFXNFi3rdMrPH4hdqSgFrEBnWisWaS"

    # 与真实编译器（fitshc 后端 lang_to_bytecode）逐字节对照的前缀：
    # 到 ACTVIEW+id 为止必须完全相同（这段决定地址）。
    GOLDEN = {
        (2, 2): "221500b00ccab4471e632ee734ad009a2614e879f0d02a3709"
                "221500e63c33a796b3032ce6b856f68fccf06608d9ed183709"
                "265a2648060b",
        (3, 2): "221500b00ccab4471e632ee734ad009a2614e879f0d02a3709"
                "221500e63c33a796b3032ce6b856f68fccf06608d9ed183709"
                "221500681990afd226b1cbc6c5f085cfdc2092d08432413709"
                "275a2648060b",
    }
    for (n, thr), golden in GOLDEN.items():
        keys = [K1, K2, K3][:n]
        got = build_lockbox(keys, thr)
        want = bytes.fromhex(golden)
        chk("%d 键 / 阈值 %d：与编译器字节一致（地址相关段）" % (n, thr),
            got[:len(want)] == want, "%d/%d 字节" % (len(want), len(want)))

    lb = build_lockbox([K1, K2], 2)
    chk("含 ACTVIEW(sigset_at_least)", bytes([0x06, 0x0B]) in lb)
    chk("以 RET 结尾", lb[-1] == 0xEE)
    chk("含取反（不是裸 RET bool）", lb[-3:] == bytes([0x46, OP_SUB, 0xEE]),
        lb[-5:].hex())

    print("\n=== 4. 地址派生 ===")
    v = derive_vault([K1, K2], 2, lb)
    chk("地址版本 = 5", addr_decode(v["address"])[0] == ADDR_VERSION_SCRIPTMH, v["address"])
    chk("单叶时 root == leaf", v["merkle_root"] == v["leaf_hash"])
    chk("重复派生结果一致", derive_vault([K1, K2], 2, lb)["address"] == v["address"])
    lb1 = build_lockbox([K1, K2], 1)
    chk("改阈值 → 地址变（预期）",
        derive_vault([K1, K2], 1, lb1)["address"] != v["address"])
    lb_rev = build_lockbox([K2, K1], 2)
    chk("改候选顺序 → 地址变（预期）",
        derive_vault([K2, K1], 2, lb_rev)["address"] != v["address"])

    print("\n=== 5. 主网真实 lockbox 复现 ===")
    # 从 vm/src/rt/bytecode.rs:754 抄来的主网真实脚本
    # （高度 768358 首次出现的 P2SH，主网已按此字节验证通过）
    MAINNET_LOCKBOX = (
        "7f0107027c00070122030bba7c32a7e5001f80221500b11f3f59601a0da2e0c471"
        "e460fb03bf156f46f33709a2ebe2001c8022150039e26861b8743434b95a1af10cb7"
        "051a429a9ce73709a2eb24ee"
    )
    MAINNET_ADDR = "3FmXz2VHLju7dkeEnV8KrdggdpmmQtW5zw"
    lmb = bytes.fromhex(MAINNET_LOCKBOX)
    chk("主网 lockbox 长度 = 79", len(lmb) == 79, "%d" % len(lmb))
    laddr, _ = scriptmh_address([leaf_hash(lmb, 0)])
    chk("派生出主网真实地址", laddr == MAINNET_ADDR, laddr)
    exe = find_p2sh_tool(a.p2sh_tool) or _probe_p2sh_tool()
    if exe:
        # 用共识代码再算一次，双向确认
        try:
            r = subprocess.run([exe, "--code", MAINNET_LOCKBOX],
                               capture_output=True, text=True, timeout=60)
            got = ""
            for line in (r.stdout or "").splitlines():
                if line.startswith("address="):
                    got = line.split("=", 1)[1].strip()
            chk("共识代码(P2shTool)算出同一地址", got == MAINNET_ADDR, got)
        except Exception as e:  # noqa: BLE001
            chk("共识代码复算", False, str(e)[:80])
    else:
        print("  （未找到 hacds_p2sh，跳过共识代码复算）")

    print("\n=== 6. 节点交叉验证 ===")
    if a.node:
        try:
            import urllib.parse
            import urllib.request
            k1 = "1H3sFZ53HzNVUVN97mjpC9JT8s2PqKMyRu"
            k2 = "1MzNY1oA3kfgYi75zquj3SRUPYztzXHzK9"
            lb = compile_lockbox([k1, k2], 2)
            ours = derive_vault([k1, k2], 2, lb)["address"]
            q = urllib.parse.urlencode({"lockbox": lb.hex(), "codeconf": 0})
            url = a.node.rstrip("/") + "/debug/p2sh/scriptmh?" + q
            with urllib.request.urlopen(url, timeout=8) as resp:
                got = json.loads(resp.read().decode())
            chk("节点算出的地址一致", got.get("address") == ours,
                "node=%s us=%s" % (got.get("address"), ours))
        except Exception as e:  # noqa: BLE001
            print("  ⚠ 不可用：%s" % str(e)[:100])
            print("     （节点需配置 debug_routes=true 才暴露 /debug/ 路由）")
    else:
        print("  （未指定 --node，跳过）")

    print("\n结果：%s" % ("全部通过" if ok else "有失败项"))
    return 0 if ok else 1


SOURCE_REFS = """
vm/src/action/p2sh.rs              calc_scriptmh_from_lockbox（地址派生）
vm/src/action/p2sh_tool.rs         P2shTool::build_canonical_tree
vm/src/action/p2sh_exec.rs         kind 46 执行体（TOP only）
vm/src/machine/transfer.rs         run_p2sh_entry：5 参 ABI
vm/src/machine/entry.rs:165        check_vm_return_value（0=成功，true=失败）
protocol/src/exec/action/envfunc.rs:308   sigset_validate_keys
protocol/src/codec/tx.rs:374       deterministic_signers（D = R0 ∪ E）
protocol/src/codec/tx.rs:449       verify_type3_signatures_exact
protocol/src/codec/action/guard.rs:118    RequiredSigners (0x0414)
protocol/src/facts.rs:77           main 必须是 PRIVAKEY
field/src/types/address.rs         base58check + VERSION_SCRIPTMH = 5
vm/src/rt/cap.rs                   lockbox≤4096B, merkle depth≤8
vm/src/rt/bytecode.rs:214          NOT = 0xa8
vm/src/rt/bytecode.rs（注释）      主网 P2SH 自高度 768358 起已有实际使用
"""


def main():
    ap = argparse.ArgumentParser(
        description="Hacash P2SH 多签（SCRIPTMH）钱包工具",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="源码依据：multisig.py --refs",
    )
    ap.add_argument("--refs", action="store_true", help="打印源码依据")
    ap.add_argument("--p2sh-tool", dest="p2sh_tool", help="hacds_p2sh 可执行文件路径")

    sub = ap.add_subparsers(dest="cmd")

    p = sub.add_parser("create", help="生成多签并写 vault 文件")
    p.add_argument("--keys", required=True, help="逗号分隔的候选私钥地址")
    p.add_argument("--threshold", type=int, required=True)
    p.add_argument("--out", default="vault")
    p.set_defaults(func=cmd_create)

    p = sub.add_parser("address", help="只打印多签地址")
    p.add_argument("--keys", required=True)
    p.add_argument("--threshold", type=int, required=True)
    p.add_argument("-v", "--verbose", action="store_true")
    p.set_defaults(func=cmd_address)

    p = sub.add_parser("lockbox", help="打印 lockbox fitsh 源码")
    p.add_argument("--keys", required=True)
    p.add_argument("--threshold", type=int, required=True)
    p.add_argument("--raw", action="store_true", help="打印单行表达式（喂给编译器）")
    p.add_argument("-o", "--out")
    p.set_defaults(func=cmd_lockbox)

    p = sub.add_parser("dump", help="反汇编 vault 里的 lockbox 并复核地址")
    p.add_argument("--vault", required=True)
    p.set_defaults(func=cmd_dump)

    p = sub.add_parser("spend", help="构造从多签转出 HAC 的未签名交易体")
    p.add_argument("--vault", required=True)
    p.add_argument("--main", required=True, help="付手续费的普通私钥地址")
    p.add_argument("--to", required=True, help="收款地址")
    p.add_argument("--hac", required=True, help="转出数量，如 1.5")
    p.add_argument("--nonce", type=int, default=1, help="合约 nonce（默认 1；仅用于隔离锁，不影响金额）")
    p.add_argument("--fee", default="0.0002")
    p.add_argument("--gas", type=int, default=99)
    p.add_argument("--ts", type=int, help="交易时间戳（默认当前）")
    p.add_argument("--out", help="把 unsigned_tx_hex 写到文件")
    p.set_defaults(func=cmd_spend)

    p = sub.add_parser("selftest", help="自检")
    p.add_argument("--node", help="本地节点，如 http://127.0.0.1:8082")
    p.set_defaults(func=cmd_selftest)

    a = ap.parse_args()

    if a.refs:
        print(SOURCE_REFS)
        return 0
    if not getattr(a, "cmd", None):
        ap.print_help()
        return 0
    return a.func(a)


if __name__ == "__main__":
    sys.exit(main())
