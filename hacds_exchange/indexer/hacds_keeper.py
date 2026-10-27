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
    python3 hacds_keeper.py check --indexer http://43.251.101.101:8124

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

DEFAULT_INDEXER = "http://43.251.101.101:8124"
DEFAULT_NODE = "http://43.251.101.101:8082"
DEFAULT_TXBUID = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                              "..", "..", "wallet-app", "bin", "hacds_txbuild.exe")

# 合约常量（与 HacdsDeFi3000.fitsh 对齐）
RENT_PERIOD = 300          # 续租期（≈104 天）
RENT_MAX_KEYS = 10         # 合约硬上限（topup_keys/rent_keys 的 n > 10 → return 60）
RENT_REWARD_HAC = 0.07     # 每键报酬

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


def _value_len(klen: int, blob_hex: str) -> int:
    """估计该键的值字节数。用于算单键 storage 成本。

    blob_hex 是**一批键**的拼接，取前几个字节判断前缀即可（同批同类型）。
    """
    raw = bytes.fromhex(blob_hex)
    if klen >= 23:                      # 地址类键：u: / ln: / ck: / bad:
        head = raw[:4]
        if head[:3] == b"ck:":
            return 64                   # [chk:hac|chk:ds|lch:hac|lch:ds] = 4×16
        if head[:3] == b"ln:":
            return 48                   # [debt|coll|last] = 3×16
        if head[:2] == b"u:":
            return 48                   # [bal:hac|due|lpt] = 3×16
        if head[:4] == b"bad:":
            return 16                   # 单 u128（稀疏）
        return 48                       # 未知前缀：按较大的 48 保守估
    return 16                           # 固定聚合键（amm:hac 等）均为 u128


def max_keys_per_batch(klen: int, blob_hex: str, period: int = RENT_PERIOD) -> int:
    """该键型单笔最多能续几个（storage 桶不超限）。"""
    unit = _value_len(klen, blob_hex) + VALUE_BASE
    per_key = unit * period
    if per_key <= 0:
        return RENT_MAX_KEYS
    n = STORAGE_BUDGET // per_key
    return max(1, min(n, RENT_MAX_KEYS))
RENT_THRESHOLD = 100       # 剩余租期低于此值才值得续


def http_get(url, timeout=15):
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def post_json(url, obj, timeout=20):
    data = json.dumps(obj).encode("utf-8")
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"})
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
            blob_hex = _call_view_raw(node, contract, "rent_keys_group", "%d:u128" % klen)
            if blob_hex:
                groups.append({"klen": klen, "blob": blob_hex})
    except Exception as e:                                        # noqa: BLE001
        print("  ⚠ 固定键读取失败（可忽略）：%s" % e)
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
    if keyfile:
        env["HACDS_SIGN_KEY"] = keyfile

    try:
        out = subprocess.run(cmd, capture_output=True, text=True, timeout=120, env=env)
    except FileNotFoundError:
        raise SystemExit("找不到 txbuild：%s ; 用 --txbuild 指定路径" % txbuild)
    if out.returncode != 0:
        raise RuntimeError((out.stderr or out.stdout or "txbuild 失败").strip()[:300])

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
                                 headers={"Content-Type": "text/plain"})
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
        print("  ✗ 不可用: %s" % e)
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
    print("  ⚠ 实际报酬受 tre:hac 余额限制，可能低于此值")
    return 0


def cmd_quote(args):
    batches = fetch_batches(args.indexer, args.max_keys)
    total = sum(b["count"] for b in batches)
    print("按地址键 %d 个 → 报酬 %.2f HAC" % (total, total * RENT_REWARD_HAC))
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
    keyfile = os.environ.get("HACDS_KEEPER_KEY")
    if not keyfile:
        raise SystemExit("未设置 HACDS_KEEPER_KEY 环境变量（私钥文件路径）")
    if not os.path.exists(keyfile):
        raise SystemExit("私钥文件不存在：%s" % keyfile)
    return keyfile


def _collect_jobs(args, include_addr_keys=True):
    jobs = []
    if include_addr_keys:
        batches = fetch_batches(args.indexer, args.max_keys)
        jobs += [{"klen": b["klen"], "blob": b["blob"]} for b in batches]
    jobs += fetch_fixed_groups(args.node, args.contract)
    return jobs


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
        print("[%d/%d] klen=%d %d 键 ..." % (i, len(jobs), j["klen"], n), end=" ", flush=True)
        try:
            tx, signed = build_rent_tx(args.txbuild, args.node, args.main,
                                       args.contract, j["klen"], j["blob"],
                                       args.period, keyfile=keyfile, func=func)
            if not signed:
                raise RuntimeError("未签名（HACDS_SIGN_KEY 未生效）——拒绝广播")
            r = submit(args.node, tx)
            if r.get("ret") == 0:
                print("✓ %s" % r.get("hash", "")[:16])
                ok += 1
            else:
                print("✗ %s" % r.get("err", r))
                fail += 1
        except Exception as e:                                    # noqa: BLE001
            print("✗ %s" % str(e)[:120])
            fail += 1
        time.sleep(args.delay)

    print("\n完成：成功 %d / 失败 %d" % (ok, fail))
    return 0 if fail == 0 else 1


def cmd_run(args):
    """常规续租：领报酬。只在 live < period/3 时才真正续。"""
    jobs = _collect_jobs(args, include_addr_keys=True)
    return _execute(args, jobs, "rent_keys", RENT_REWARD_HAC)


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
            print("  ⚠ 跳过地址键 %s：%s" % (a, e))
            continue
        for prefix in (b"u:", b"ck:"):
            jobs.append({"klen": 23, "blob": (prefix + a21).hex()})

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


def main():
    ap = argparse.ArgumentParser(description="hacds keeper —— 无许可账本键续租")
    ap.add_argument("cmd", choices=["check", "quote", "run", "topup"])
    ap.add_argument("--indexer", default=DEFAULT_INDEXER)
    ap.add_argument("--node", default=DEFAULT_NODE)
    ap.add_argument("--contract", default="T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH")
    ap.add_argument("--txbuild", default=DEFAULT_TXBUID)
    ap.add_argument("--main", help="keeper 地址（tx.main）")
    ap.add_argument("--max-keys", type=int, default=RENT_MAX_KEYS)
    ap.add_argument("--period", type=int, default=RENT_PERIOD)
    ap.add_argument("--delay", type=float, default=1.0, help="每批间隔秒数")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--include-addr-keys", action="store_true",
                    help="topup 时连地址键一起补（默认只补固定键）")
    args = ap.parse_args()

    if args.cmd == "check":
        sys.exit(cmd_check(args))
    if args.cmd == "quote":
        sys.exit(cmd_quote(args))
    if not args.main:
        raise SystemExit("%s 需要 --main <keeper 地址>" % args.cmd)
    if args.cmd == "topup":
        sys.exit(cmd_topup(args))
    sys.exit(cmd_run(args))


if __name__ == "__main__":
    main()
