#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hacds_indexer — HacdsDeFi 链上索引器（服务端常驻）

为什么需要它：合约**无法枚举借款人** —— 借款账目按 `loan:debt:<addr>` 拼键存储，
合约不写日志，节点也没有按前缀枚举合约 KV 的接口。所以只能**遍历区块**，
从历史交易中收集「调用过借贷函数的地址」，形成观察台账；再逐个查
loan_status 得到实时健康度。

钱包端（PC / Android）只需 GET 一次本服务的 API，**不需要自己扫链**。

--------------------------------------------------------------------------
已验证的链上原语（2026-10-21，真机主网）
--------------------------------------------------------------------------
  1) /query/block/intro?height=N&tx_hash_list=true   → 块内交易哈希列表
  2) /query/transaction?hash=H&action=true           → 结构化动作 [{kind,...}]
  3) 合约调用 kind=44，codes 内含 selector = sha3_256(函数名)[0:4]
     （字节码形态 09 14 01 <sig4> ee；已用 txbuild 实际生成的交易 3/3 验证）

--------------------------------------------------------------------------
用法
--------------------------------------------------------------------------
  python3 hacds_indexer.py selftest                      # 离线自检（含 sha3 向量）
  python3 hacds_indexer.py scan   --node URL             # 一次性扫描
  python3 hacds_indexer.py serve  --port 8124            # 常驻 HTTP 服务

零第三方依赖（仅标准库）。
"""

import argparse
import concurrent.futures
import hashlib
import json
import os
import sys
import tempfile
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

# --------------------------------------------------------------------------
# 常量（与合约/钱包一致）
# --------------------------------------------------------------------------
DEFAULT_NODE = "http://127.0.0.1:8082"
DEFAULT_CONTRACT = "T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH"

#: 借贷相关函数 —— 这些在合约上被调用时，tx.main 即借款人
#: 借贷相关函数 —— 这些在合约上被调用时，tx.main 即借款人。
#
# ⚠ H-7（2026-10-27）：原表里还有 loan_status / loan_debt_of / loan_coll_of
#   三个**只读视图**。它们不产生任何借款行为，却会把调用者写进观察名单 ——
#   任何人调一次 `loan_status(自己)` 就能把自己塞进清算台。
#   只保留真正改变借贷状态的四个写函数。
LOAN_FNS = [
    "loan_borrow", "loan_repay", "loan_liquidate",
    "loan_add_collateral",
]

#: 清算判定（与合约 loan_liquidate 的门槛一致）
#:   合约要求 debt > coll / COLL_RATIO(2) 才放行 ⟺ coll_hac/debt < 2 ⟺ health < 200
LIQ_HEALTH_MAX = 200

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "watch.json")

#: CORS 来源白名单（M-4）。空集合 = 不发送任何 CORS 头 = 浏览器端一律拒绝跨站读取。
#: 需要让某个前端跨站访问时，把其 origin 加进来（如 "https://hacds.com"）。
#: 默认留空是安全的；本机调试可临时加 "http://localhost:3000" 等。
CORS_ALLOWED_ORIGINS = set(filter(None, os.environ.get(
    "HACDS_CORS_ORIGINS", "").split(",")))


def sha3_256(b: bytes) -> bytes:
    """标准库 sha3_256（Python 3.6+ 内置，与链上一致）。"""
    return hashlib.sha3_256(b).digest()


#: 单位锚点：`value:unit` = value × 10^(unit−248) HAC
#: （field/src/types/amount.rs:14-31）
#:   UNIT_MEI  = 248 → 1:248 = 1 HAC        ← 锚点
#:   UNIT_ZHU  = 240 → 1:240 = 10^-8 HAC    ← 「zhu」，账本内部统一用它
UNIT_MEI = 248
UNIT_ZHU = 240


def _hac_str_to_zhu(s: str) -> int:
    """节点返回的 `hacash` 金额串 → **zhu**（1 HAC = 1e8 zhu）。

    节点 `/query/balance` 的字段形如 `"1220469079183:239"` 或 `"1:248"`，
    含义是 `value × 10^(unit−248) HAC`（见 field::UNIT_*）。

    换算到 zhu（unit=240）：
      1 HAC = 10^(248−240) = 1e8 zhu
      所以  zhu = value × 10^(unit−248) × 1e8 = value × 10^(unit−240)

    例：
      "1:248"     → 1 × 10^8        = 100,000,000 zhu (= 1 HAC)
      "549:244"   → 549 × 10^4      = 5,490,000 zhu  (= 0.0549 HAC)
      "2000:240"  → 2000 × 10^0     = 2,000 zhu      (= 0.00002 HAC) ⚠ 只 2000 zhu
    """
    if not s:
        return 0
    try:
        if ":" in s:
            val, unit = s.split(":", 1)
            v, u = int(val), int(unit)
        else:
            return 0                       # 无单位的不猜
    except (ValueError, TypeError):
        return 0
    exp = u - UNIT_ZHU
    if exp >= 0:
        if exp > 40:
            return 0                       # 离谱值，拒绝而不是溢出
        return v * (10 ** exp)
    # 比 zhu 更细的单位（如 239 = 10^-9 HAC）→ 向下取整到 zhu。
    # 节点余额确实会出现 239（实测 "1220469079183:239"），不能直接丢成 0。
    div = 10 ** (-exp)
    return v // div


_HEX = set("0123456789abcdef")


def _is_hex(c: str) -> bool:
    """单个字符是否为十六进制数字（match_contract_fn 的边界判断用）。"""
    return bool(c) and c in _HEX


def fn_selector(name: str) -> str:
    """合约函数 selector = sha3_256(函数名)[0:4] 的 hex。"""
    return sha3_256(name.encode()).hex()[:8]


LOAN_SELECTORS = {fn_selector(f): f for f in LOAN_FNS}


# --------------------------------------------------------------------------
# HTTP 小工具
# --------------------------------------------------------------------------
def http_get_json(url: str, timeout: float = 15.0, tries: int = 3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "hacds-indexer/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:                                    # noqa: BLE001
            last = e
            time.sleep(0.3 * (i + 1))
    raise RuntimeError(f"GET failed {url}: {last}")


def match_contract_fn(codes_hex: str):
    """解析 kind=44 的 ContractMainCall codes，命中借贷函数则返回函数名。

    H-7（2026-10-27）：原实现用 `if sig in hx` —— **任意位置子串命中**即可。
    任何 DApp 的 calldata 里只要恰好包含这 4 个字节，其 tx.main 就会被当成
    借款人写进台账。

    MainCall 的线格式是：`09 14 01 <sig4> ee`（CALL / 长度 / 参数区 /
    selector / 结束），所以这里定位 `091401` 之后紧跟的 4 字节作为 selector，
    并且要求 selector 之后是 `ee`（参数区结束）—— 即**无参数的裸调用**。
    带参数的调用（如 loan_borrow(x)）参数区在 selector 之前，形态不同，
    这里退化为「精确匹配 8 位十六进制 selector 作为完整 token」。

    匹配不到时返回 None，宁缺勿滥。
    """
    hx = str(codes_hex or "").strip().lower()
    if hx.startswith("0x"):
        hx = hx[2:]
    if not hx or any(c not in "0123456789abcdef" for c in hx):
        return None

    # 主形态：09 14 01 <sig4> ee
    i = 0
    while True:
        j = hx.find("091401", i)
        if j < 0:
            break
        sig = hx[j + 6: j + 14]
        if len(sig) == 8 and hx[j + 14: j + 16] == "ee" and sig in LOAN_SELECTORS:
            return LOAN_SELECTORS[sig]
        i = j + 6

    # 兜底：带参数形态 —— selector 作为独立的 8 位片段出现，前后不得紧邻
    # 其它十六进制数字（避免 32 位地址/金额里恰好包含该子串）。
    for sig, name in LOAN_SELECTORS.items():
        for k in range(0, len(hx) - 8 + 1):
            if hx[k:k + 8] != sig:
                continue
            before_ok = (k == 0) or not _is_hex(hx[k - 1])
            after_ok = (k + 8 >= len(hx)) or not _is_hex(hx[k + 8])
            if before_ok and after_ok:
                return name
    return None


# --------------------------------------------------------------------------
# 索引器
# --------------------------------------------------------------------------
class Indexer:
    def __init__(self, node=DEFAULT_NODE, contract=DEFAULT_CONTRACT,
                 state_file=STATE_FILE, window=500, workers=4):
        self.node = node.rstrip("/")
        self.contract = contract
        self.state_file = state_file
        self.window = window
        self.workers = max(1, int(workers))
        self.watch = {}          # addr -> {first,last,calls,fns,manual,note}
        self.last_scanned = 0
        self.chain = []          # [(height, block_hash, {addr: calls})] 最近 N 块，用于重组检测（C-4）
        self.lock = threading.Lock()
        # H-3：sync 专用的非阻塞锁。poller 线程（每 interval 秒）与 HTTP /sync
        # 可并发进入 sync()，两者都会改 self.chain / last_scanned。用独立锁，
        # 拿不到直接返回 busy（而不是排队堆积）。
        self.sync_lock = threading.Lock()
        self.load()

    #: 重组检测保留的最近块数（够覆盖常见重组深度）
    REORG_DEPTH = 64

    # ---- 持久化 ----
    def load(self):
        """载入台账。

        H-3 修复：原实现用 `except Exception: pass` 吞掉**所有**错误——
        文件被截断、JSON 损坏、手工编辑出错，都会静默变成空台账
        （watch={}、last_scanned=0）→ 历史借款人集体消失，日志一句不提。

        现在区分三种情况：
          · 文件不存在      → 全新部署，正常从空开始
          · JSON 解析失败   → **拒绝启动**（宁可起不来，也不要带着空台账跑）
          · 结构不合法      → 拒绝启动
        """
        if not os.path.exists(self.state_file):
            return                                    # 首次运行，正常
        try:
            with open(self.state_file, "r", encoding="utf-8") as f:
                j = json.load(f)
        except Exception as e:                         # noqa: BLE001
            raise SystemExit(
                "状态文件解析失败，拒绝启动（避免带着空台账运行，历史借款人会全部丢失）\n"
                "  文件: %s\n  错误: %s\n"
                "  处理: 修复该文件，或确认可丢弃后手动移走再启动。" % (self.state_file, e))
        if not isinstance(j, dict) or not isinstance(j.get("watch", {}), dict):
            raise SystemExit("状态文件结构不合法（watch 不是对象）：%s" % self.state_file)
        self.watch = j.get("watch", {}) or {}
        self.last_scanned = int(j.get("lastScanned", 0) or 0)
        self.chain = j.get("chain", []) or []

    def save(self):
        """原子写台账。

        H-3 修复：
          · 原来用固定名 `state_file + ".tmp"`——poller 线程与 HTTP `/sync`
            同时调用会互相截断，发布半截文件；那份半截文件下次启动又被静默清空。
            改用 `mkstemp` 生成唯一临时名。
          · `last_scanned` 原来是相对路径时 `makedirs(dirname(""))` 抛错被吞
            → 状态永不落盘（L-7），这里显式处理空目录。
          · 快照在锁内取，避免遍历 `self.watch` 时被其他线程修改。
        """
        try:
            d = os.path.dirname(os.path.abspath(self.state_file))
            if d:
                os.makedirs(d, exist_ok=True)
            with self.lock:
                snap = {"watch": dict(self.watch),
                        "lastScanned": self.last_scanned,
                        "chain": list(self.chain[-self.REORG_DEPTH:]),
                        "updatedAt": int(time.time())}
            fd, tmp = tempfile.mkstemp(dir=d or ".", prefix=".watch-", suffix=".tmp")
            try:
                with os.fdopen(fd, "w", encoding="utf-8") as f:
                    json.dump(snap, f, ensure_ascii=False, indent=1)
                os.replace(tmp, self.state_file)
                return True
            except Exception:                                      # noqa: BLE001
                try:
                    os.unlink(tmp)
                except OSError:
                    pass
                return False
        except Exception:                                          # noqa: BLE001
            return False

    # ---- 台账 ----
    def add(self, addr, note=None):
        # H-7：原实现只判空 —— 任意字符串都能进台账，进而被拼进节点查询串、
        # 被钱包渲染层原样插值。这里强制 base58check 校验（复用 _addr_to_21，
        # 它同时校验长度 25B 与双 sha256 校验和），非法地址直接拒绝。
        if not addr:
            return False
        try:
            Indexer._addr_to_21(addr)
        except Exception:                                          # noqa: BLE001
            return False
        if note is not None:
            note = str(note)[:64]          # 限长：note 会原样出现在 /watchlist 里
            if not note:
                note = None
        with self.lock:
            w = self.watch.setdefault(addr, {"first": 0, "last": 0, "calls": 0, "fns": {}})
            w["manual"] = True
            if note:
                w["note"] = note
        self.save()
        return True

    def remove(self, addr):
        with self.lock:
            hit = self.watch.pop(addr, None) is not None
        self.save()
        return hit

    def addresses(self):
        with self.lock:
            return list(self.watch.keys())

    # ---- 扫块 ----
    def _record(self, main, fn, height, delta=1):
        """把 height 处命中的 fn 计入台账。delta=+1 记入（扫描），-1 撤销（重组回退）。"""
        with self.lock:
            w = self.watch.get(main)
            if delta < 0:
                # 撤销：仅当该地址仍存在且由扫链记入（manual 地址不撤销）
                if not w or w.get("manual"):
                    return
                w["calls"] = max(0, w.get("calls", 0) - 1)
                if w["calls"] == 0 and not w.get("manual"):
                    # 该地址已无任何命中来源，从台账移除
                    self.watch.pop(main, None)
                return
            w = self.watch.setdefault(main, {"first": height, "last": height,
                                             "calls": 0, "fns": {}})
            w["first"] = min(w["first"] or height, height)
            w["last"] = max(w.get("last") or 0, height)
            w["calls"] = w.get("calls", 0) + 1
            w.setdefault("fns", {})[fn] = w["fns"].get(fn, 0) + 1

    def _current_hash(self, height):
        try:
            return http_get_json(f"{self.node}/query/block/intro?height={height}").get("hash")
        except Exception:                                          # noqa: BLE001
            return None

    #: 找到的块中，命中该地址的每个 fn 各 1 次（用于回退时精确撤销）
    def _unrecord_old(self, per_fn):
        for addr, fns in per_fn.items():
            for fn, cnt in fns.items():
                for _ in range(cnt):
                    self._record(addr, fn, 0, delta=-1)

    def scan(self, height, progress=None):
        """扫描单个高度，返回 (height, block_hash, {addr: {fn: 次数}})。命中仍写入台账。"""
        intro = http_get_json(f"{self.node}/query/block/intro?height={height}&tx_hash_list=true")
        bh = intro.get("hash")
        per_fn = {}
        for th in (intro.get("tx_hash_list") or []):
            try:
                d = http_get_json(f"{self.node}/query/transaction?hash={th}&action=true")
            except Exception:                                      # noqa: BLE001
                continue
            main = d.get("main_address")
            for a in (d.get("actions") or []):
                if a.get("kind") != 44:
                    continue
                fn = match_contract_fn(a.get("codes"))
                if not fn or not main:
                    continue
                self._record(main, fn, height)
                per_fn.setdefault(main, {})
                per_fn[main][fn] = per_fn[main].get(fn, 0) + 1
        if progress:
            progress(height)
        return (height, bh, per_fn)

    def scan_many(self, heights, workers=4):
        """并发扫描多个高度，返回 (found_total, [scan结果...]) 按高度有序。
        串行约 2.6 块/秒；并发可加速首次回溯；节点侧都是只读 GET。"""
        results = []
        if workers <= 1:
            for h in heights:
                results.append(self.scan(h))
        else:
            with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
                results = list(ex.map(self.scan, heights))
        found = sum(sum(per.values()) for (_h, _bh, per) in results)
        return found, results

    def _append_chain(self, results):
        """把扫描结果并入 chain（按高度去重、排序、只保留最近 REORG_DEPTH 块）。"""
        for (h, bh, pf) in results:
            self.chain = [c for c in self.chain if c[0] != h]
            self.chain.append((h, bh, pf))
        self.chain.sort(key=lambda c: c[0])
        if len(self.chain) > self.REORG_DEPTH:
            self.chain = self.chain[-self.REORG_DEPTH:]

    def _revert_above(self, fork):
        """回退高度 > fork 的块：撤销其台账命中并移出 chain。返回回退块数。"""
        n = 0
        keep = []
        for (h, bh, pf) in sorted(self.chain, key=lambda c: c[0], reverse=True):
            if h > fork:
                self._unrecord_old(pf)
                n += 1
            else:
                keep.append((h, bh, pf))
        keep.sort(key=lambda c: c[0])
        self.chain = keep
        return n

    def find_fork(self, head):
        """从已记录的最高块往下比对节点当前块哈希，返回最高共同祖先高度。
        chain 为空 → None。找不到任何匹配 → 返回已知最老块高（保守整体回退）。"""
        if not self.chain:
            return None
        chain = sorted(self.chain, key=lambda c: c[0])
        for (h, bh, _pf) in reversed(chain):
            if h > head:
                continue
            cur = self._current_hash(h)
            if cur is not None and bh is not None and cur == bh:
                return h
        return chain[0][0]

    def sync(self):
        """带互斥的 sync 包装：同一时刻只允许一个扫描在跑。

        H-3：poller 线程与 HTTP `/sync` 原先可并发进入，二者都会重写
        `self.chain`（`_append_chain` 里的 `self.chain = [...]` + `sort`）
        和 `self.last_scanned`，互相覆盖 → 台账错乱。
        拿不到锁时**直接返回 busy**，不排队堆积。
        """
        if not self.sync_lock.acquire(blocking=False):
            return {"ok": False, "err": "busy", "msg": "another sync is running"}
        try:
            return self._sync_locked()
        finally:
            self.sync_lock.release()

    def _sync_locked(self):
        head = int(http_get_json(f"{self.node}/query/block/height/latest")["height"])
        reorg = 0
        if not self.last_scanned:
            # 首次：回溯 window 块
            start, end = max(1, head - self.window), head
            heights = list(range(start, end + 1))
            found, results = self.scan_many(heights, self.workers)
            self._append_chain(results)
            self.last_scanned = head
        else:
            fork = self.find_fork(head)
            if fork is None:
                start, end = max(1, head - self.window), head
                heights = list(range(start, end + 1))
                found, results = self.scan_many(heights, self.workers)
                self._append_chain(results)
                self.last_scanned = head
            else:
                # C-4：检测到重组 → 回退 fork 以上的块（撤销台账），再从 fork+1 重扫
                if fork < self.last_scanned:
                    reorg = self._revert_above(fork)
                    print(f"[indexer] reorg detected: revert {reorg} blocks above {fork}", flush=True)
                    self.last_scanned = fork
                start, end = self.last_scanned + 1, head
                if start > end:
                    found, heights = 0, []
                else:
                    heights = list(range(start, end + 1))
                    found, results = self.scan_many(heights, self.workers)
                    self._append_chain(results)
                self.last_scanned = head
        self.save()
        return {"ok": True, "head": head, "from": (heights[0] if heights else 0),
                "to": (heights[-1] if heights else 0), "scanned": len(heights),
                "found": found, "reverted": reorg, "watched": len(self.addresses())}

    # ---- 快照（查实时健康度）----
    def _call(self, fn, params=None, caller=None):
        # H-7：caller 来自台账里的地址字符串，而台账可经 /watch/add 注入任意内容。
        # 原实现只给 params 做了 quote，caller 直接拼进 URL → 攻击者构造
        #   caller = "1Q9…&function=balance_hac&params=evil"
        # 就能让索引器替自己向本地节点发出**被篡改的查询串**（SSRF-lite）。
        # 三个参数一律编码。
        c = caller or self.contract
        u = (f"{self.node}/query/contract/sandboxcall"
             f"?contract={urllib.parse.quote(str(self.contract), safe='')}"
             f"&function={urllib.parse.quote(str(fn), safe='')}"
             f"&caller={urllib.parse.quote(str(c), safe='')}")
        if params:
            u += "&params=" + urllib.parse.quote(params)
        try:
            d = http_get_json(u)
            return d.get("ret_val") if d.get("ret") == 0 else None
        except Exception:                                          # noqa: BLE001
            return None

    def hac_backing(self):
        """积分覆盖率：tot_hac_eff（合约内部积分）vs 合约真实链上 HAC 余额。

        为什么需要：`loan_borrow` 是「积分先行、转出在后」——先给借款人记
        bal:hac 积分，再由同笔 TransferHacFromTo 经 PermitHAC 扣减。借款人若
        **不转出**，积分暂留合约（= 对合约 HAC 的索取权），这会让
        `providers() = tot_hac_eff + lendable_amm_hac` 虚高 → 利用率偏低 →
        利率被低估。

        经济上可接受（钱确实在合约里），但要能看见。合约侧算不了：
        `balance_coin(BURN_ADDR)` 返回的是 `diamond4B + satoshi8B + Amount`
        的可变长编码，链上拆 Amount 既费 gas 又易错。索引器直接查节点
        `/query/balance` 更简单可靠。

        返回：
          tot_hac_eff  合约内部有效积分（zhu）
          real_hac     合约真实链上 HAC 余额（zhu）
          ratio_bps    tot_hac_eff / real_hac，万分比（≤10000 正常）
          ok           ratio_bps ≤ 10000
        """
        # 1) 合约内部积分
        eff = 0
        v = self._call("tot_hac")
        if v is not None:
            try:
                eff = int(v)
            except (TypeError, ValueError):
                eff = 0

        # 2) 合约真实链上 HAC 余额（节点 /query/balance 返回 "zhu:unit" 形式）
        real = 0
        try:
            d = http_get_json("%s/query/balance?address=%s" % (self.node, self.contract))
            if d.get("ret") == 0 and d.get("list"):
                real = _hac_str_to_zhu(d["list"][0].get("hacash") or "0")
        except Exception:                                          # noqa: BLE001
            pass

        ratio = (eff * 10000 // real) if real > 0 else 0
        return {
            "tot_hac_eff": eff,
            "real_hac": real,
            "ratio_bps": ratio,
            "ok": (real > 0 and ratio <= 10000),
            "note": "" if real > 0 else "合约余额查询失败或为 0",
        }

    def snapshot(self):
        out = []
        for addr in self.addresses():
            health = self._call("loan_status", f"{addr}:address", addr)
            debt = self._call("loan_debt_of", f"{addr}:address", addr)
            coll = self._call("loan_coll_of", f"{addr}:address", addr)
            # loan_status 语义（HacdsDeFi.fitsh:1382）：
            #   0   = 无借贷且无抵押
            #   999 = 有抵押但无债务（安全）
            #   其它 = coll_hac × 100 / debt（抵押率 ×100）
            h = None if health is None else int(health)
            d_ = int(debt or 0)
            has_debt = d_ > 0
            liquidatable = (h is not None) and has_debt and 0 < h < LIQ_HEALTH_MAX
            with self.lock:
                w = dict(self.watch.get(addr, {}))
            out.append({
                "address": addr,
                "health": h,
                "healthPct": (None if (h is None or h in (0, 999)) else round(h / 100.0, 2)),
                "debt": d_,
                "coll": int(coll or 0),
                "liquidatable": bool(liquidatable),
                "noLoan": not has_debt,
                "first": w.get("first", 0),
                "last": w.get("last", 0),
                "calls": w.get("calls", 0),
                "fns": w.get("fns", {}),
                "manual": bool(w.get("manual")),
                "note": w.get("note"),
            })
        # 可清算优先，其次健康度升序
        out.sort(key=lambda x: (not x["liquidatable"],
                                x["health"] if x["health"] is not None else 10 ** 9))
        return out

    # ---- 概况 ----
    # ---- H-2：按地址账本键的续租清单 ----
    #
    # 背景：合约 rent_keys_group() 只覆盖 23 个固定键，按地址键
    # （bal:hac:<addr> / due:<addr> / loan:debt:<addr> 等）无法枚举。
    # 键一旦过期，storage_load 会 abort StorageNotActive(108)，
    # 该用户所有操作整笔回滚（存款/取款/swap/赎回/还款全部受影响）。
    #
    # 合约没有管理员，也没有人"有义务"救他；普通用户更不会拼键名。
    # 所以必须由索引器扫链维护活跃地址清单，输出原始键字节喂给 rent_keys。

    # 按地址键（H-2 合并后：11 种 → 4 种）
    #
    # 合约把 bal:hac / due / lpt 打包进 u:<addr>，
    # loan:debt / loan:coll / loan:last 打包进 ln:<addr>，
    # chk:* / lch:* 打包进 ck:<addr>。
    # bad:<addr> 保持独立（稀疏键）。
    ADDR_KEYS = [
        ("u:", "naked"),      # 64B  [bal:hac | due | lpt]
        ("ln:", "naked"),     # 48B  [debt | coll | last]
        ("ck:", "naked"),     # 64B  [chk:hac | chk:ds | lch:hac | lch:ds]
        ("bad:", "naked"),    # 16B  稀疏
    ]

    @staticmethod
    def _addr_to_21(addr: str) -> bytes:
        """Hacash 可读地址 → 21 字节二进制（base58check 解码）。"""
        import hashlib
        ALPH = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
        n = 0
        for ch in addr:
            n = n * 58 + ALPH.index(ch)
        raw = n.to_bytes((n.bit_length() + 7) // 8, "big") if n else b""
        # 前导 '1' 补 0x00
        pad = len(addr) - len(addr.lstrip("1"))
        raw = bytes(pad) + raw
        if len(raw) != 25:
            raise ValueError("bad address length: %d" % len(raw))
        body, chk = raw[:21], raw[21:]
        want = hashlib.sha256(hashlib.sha256(body).digest()).digest()[:4]
        if chk != want:
            raise ValueError("bad address checksum")
        return body

    def rent_keys(self, klen: int = None) -> dict:
        """生成按地址账本键的续租清单，按长度分组（rent_keys 要求同批等长）。

        返回：
          { "groups": [ {"klen": N, "blob": "<hex>", "count": M, "keys": [...]}, ... ],
            "total": T }
        blob 是**连排的原始键字节**，可直接作为 rent_keys(blob, klen, period) 的 keys 参数。
        """
        groups = {}
        addrs = self.addresses()

        for addr in addrs:
            try:
                a21 = self._addr_to_21(addr)
            except Exception:
                continue
            for prefix, _ in self.ADDR_KEYS:
                key = prefix.encode("ascii") + a21
                groups.setdefault(len(key), []).append(key)

        out = []
        for ln in sorted(groups):
            keys = groups[ln]
            blob = b"".join(keys)
            out.append({
                "klen": ln,
                # 键名含二进制地址，用 hex 传；客户端转回字节即可
                "blob": blob.hex(),
                "count": len(keys),
                "keys": [prefix_label(k) if False else k.hex() for k in keys],
            })

        return {"groups": out, "total": sum(g["count"] for g in out)}

    def rent_batches(self, max_keys: int = 10) -> dict:
        """把 rent_keys 分组进一步切成 ≤max_keys 的批次（单笔 storage 上限）。"""
        r = self.rent_keys()
        # H-1 修复：原实现在这里把**总数**截成 50（`if n > 50: n = 50`），
        # 导致第 51 个起的地址账本键永远不进续租清单 → 键过期后
        # storage_load 报 StorageNotActive(108) → 该用户所有操作整笔回滚。
        # 现在**不截断**，全部按键数切片返回；活跃地址过多时由
        # `truncated` / `total_all` 显式告知调用方（而不是静默丢键）。
        batches = []
        dropped = 0
        for g in r["groups"]:
            klen = g["klen"]
            raw = bytes.fromhex(g["blob"])
            n = len(raw) // klen
            for i in range(0, n, max_keys):
                part = raw[i * klen: min(i + max_keys, n) * klen]
                if not part:
                    continue
                batches.append({
                    "klen": klen,
                    "blob": part.hex(),
                    "count": len(part) // klen,
                })
        total = sum(b["count"] for b in batches)
        return {
            "batches": batches,
            "total": total,
            "total_all": total,          # 与 total 相同：不再丢键
            "truncated": False,          # 恒 False；保留字段方便调用方断言
            "dropped": dropped,
        }

    def summary(self):
        snap = self.snapshot()
        return {
            "head": self.last_scanned,
            "node": self.node,
            "contract": self.contract,
            "watched": len(snap),
            "withDebt": sum(1 for x in snap if not x["noLoan"]),
            "liquidatable": sum(1 for x in snap if x["liquidatable"]),
            "snapshot": snap,
        }


IDX: Indexer = None                                          # 由 main 初始化
READ_ONLY = False                                            # --read-only 时置 True


# --------------------------------------------------------------------------
# 后台轮询线程
# --------------------------------------------------------------------------
def poller(idx: Indexer, interval: int, stop: threading.Event):
    while not stop.is_set():
        try:
            r = idx.sync()
            print(f"[indexer] sync head={r['head']} scanned={r['scanned']} "
                  f"found={r['found']} watched={r['watched']}", flush=True)
        except Exception as e:                                    # noqa: BLE001
            print(f"[indexer] sync error: {e}", flush=True)
        stop.wait(interval)


# --------------------------------------------------------------------------
# HTTP API
# --------------------------------------------------------------------------
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):                            # noqa: A003
        pass                                                      # 静默，避免刷屏

    def _send(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        # M-4：不再用 `*`。写接口是 GET（CORS 简单请求，免预检），配 `*` 时
        # 任意网页都能跨站触发 /watch/remove 把借款人从清算台移除。
        # 改为来源白名单（对齐 hacds.com/worker/index.js 的 corsHeaders 写法）。
        origin = self.headers.get("Origin", "")
        if origin in CORS_ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):                                             # noqa: N802
        parsed = urllib.parse.urlparse(self.path)
        qs = urllib.parse.parse_qs(parsed.query)
        path = parsed.path.rstrip("/") or "/"
        try:
            if path == "/health":
                return self._send({"ok": True, "service": "hacds-indexer",
                                   "head": IDX.last_scanned,
                                   "watched": len(IDX.addresses())})
            # ---- 运维监控：驻留积分 vs 真实储备 ----
            #
            # loan_borrow 是「积分先行、转出在后」。借款人若不转出，积分暂留
            # 合约（对合约 HAC 的索取权）→ providers() 虚高 → 利用率/利率被低估。
            # 合约侧无法算这个比值（balance_coin 返回的是编码后的 Bytes，
            # 拆 Amount 既费 gas 又易错），所以由索引器查节点 /query/balance 算。
            if path == "/backing":
                return self._send({"ret": 0, **IDX.hac_backing()})
            # ★ 钱包唯一需要的接口
            if path == "/watchlist":
                return self._send({"ret": 0, **IDX.summary()})
            if path == "/snapshot":
                return self._send({"ret": 0, "list": IDX.snapshot()})
            # ---- H-2：按地址账本键的续租清单 ----
            # 返回按长度分组的原始键字节（hex），可直接喂给合约 rent_keys
            if path == "/rent_keys":
                return self._send({"ret": 0, **IDX.rent_keys()})
            if path == "/rent_batches":
                try:
                    mx = int((qs.get("max") or ["10"])[0])
                except ValueError:
                    mx = 10
                mx = max(1, min(10, mx))      # 合约单笔上限 10 键
                return self._send({"ret": 0, **IDX.rent_batches(mx)})
            # ---- 只读模式：拦截所有写操作 ----
            WRITE_PATHS = {"/sync", "/watch/add", "/watch/remove"}
            if READ_ONLY and path in WRITE_PATHS:
                return self._send({"ret": 1, "err": "read-only mode"}, 403)
            if path == "/sync":
                return self._send({"ret": 0, **IDX.sync()})
            if path == "/watch/add":
                a = (qs.get("address") or [""])[0].strip()
                if not a:
                    return self._send({"ret": 1, "err": "address required"}, 400)
                if not IDX.add(a, (qs.get("note") or [None])[0]):
                    return self._send({"ret": 1, "err": "invalid address"}, 400)
                return self._send({"ret": 0, "list": IDX.addresses()})
            if path == "/watch/remove":
                a = (qs.get("address") or [""])[0].strip()
                return self._send({"ret": 0, "removed": IDX.remove(a)})
            return self._send({"ret": 1, "err": "not found"}, 404)
        except Exception as e:                                    # noqa: BLE001
            return self._send({"ret": 1, "err": str(e)}, 500)


# --------------------------------------------------------------------------
# 自检
# --------------------------------------------------------------------------
def selftest():
    ok = True
    checks = []

    def chk(label, got, exp):
        nonlocal ok
        good = (got == exp)
        ok = ok and good
        checks.append(("PASS" if good else "FAIL", label, got, exp))

    # 1) 官方向量
    chk("SHA3-256('abc')", sha3_256(b"abc").hex(),
        "3a985da74fe225b2045c172d6bd390bd855f086e3e9d525b46bfe24511431532")
    # 2) selector 与链上一致
    chk("selector(loan_borrow)", fn_selector("loan_borrow"), "a4fea537")
    chk("selector(loan_liquidate)", fn_selector("loan_liquidate"), "3e403fb8")
    chk("selector(loan_status)", fn_selector("loan_status"), "dfd17a76")
    # 3) 交易字节匹配（txbuild 真实产物）
    tx = ("0300000000001600333ca1f19b602275f871a308675dfece685ae8e701369d52e912c2f26d25b3b8f7289f"
          "10086a54d46ef401020001002c000000000020221500333ca1f19b602275f871a308675dfece685ae8e73"
          "70914013e403fb8ee00006300")
    chk("match kind44 -> loan_liquidate", match_contract_fn(tx), "loan_liquidate")
    chk("match 别的DApp -> None",
        match_contract_fn("7f0322e64843415348444558327c65794a6a61474670626b6c6b496a6f694d"),
        None)
    # 4) 清算判定
    def liq(health, debt):
        d_ = int(debt or 0)
        return bool(health is not None and d_ > 0 and 0 < health < LIQ_HEALTH_MAX)
    chk("无借贷(0,0) 不可清算", liq(0, 0), False)
    chk("有抵押无债务(999,0) 不可清算", liq(999, 0), False)
    chk("健康 150 可清算", liq(150, 100), True)
    chk("健康 250 不可清算", liq(250, 100), False)
    chk("健康 200 边界不可清算", liq(200, 100), False)

    # 5) H-2：地址键续租清单
    import tempfile
    tmpf = os.path.join(tempfile.gettempdir(), "hacds_idx_selftest.json")
    try:
        if os.path.exists(tmpf):
            os.remove(tmpf)
        ix = Indexer(state_file=tmpf)
        chk("地址解码 21 字节", len(Indexer._addr_to_21(
            "15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q")), 21)
        chk("地址首字节 = 0x00（普通地址）",
            Indexer._addr_to_21("15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q")[0], 0)
        chk("合约地址首字节 = 0x01",
            Indexer._addr_to_21("T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH")[0], 1)

        ix.add("15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q")
        rk = ix.rent_keys()
        chk("1 地址 × 4 种打包键 = 4", rk["total"], 4)
        # blob 长度必须等于 klen × count
        chk("blob 长度自洽",
            all(len(bytes.fromhex(g["blob"])) == g["klen"] * g["count"]
                for g in rk["groups"]), True)

        rb = ix.rent_batches(10)
        chk("批次切分 ≤10 键",
            all(x["count"] <= 10 for x in rb["batches"]), True)
        chk("批次覆盖全部键", rb["total"], rk["total"])
        os.remove(tmpf)
    except Exception as e:                                        # noqa: BLE001
        chk("rent_keys 自检", "exception: %s" % e, "ok")

    for st, label, got, exp in checks:
        print(f"  [{st}] {label} = {got}" + ("" if st == "PASS" else f"  (expect {exp})"))
    print("SELFTEST " + ("PASSED" if ok else "FAILED"))
    return 0 if ok else 1


# --------------------------------------------------------------------------
def main():
    global IDX
    ap = argparse.ArgumentParser(description="HacdsDeFi 链上索引器")
    ap.add_argument("cmd", choices=["selftest", "scan", "serve"], help="子命令")
    ap.add_argument("--node", default=DEFAULT_NODE)
    ap.add_argument("--contract", default=DEFAULT_CONTRACT)
    ap.add_argument("--state", default=STATE_FILE)
    ap.add_argument("--window", type=int, default=500,
                    help="首次回溯块数（默认 500；越大越慢，2000 块约 4000 次 HTTP）")
    ap.add_argument("--port", type=int, default=8124)
    # C-1：写接口默认关闭、默认只监听本机 —— 2026-10-22 的加固在本轮被回归，
    # 现恢复并加强：
    #   · --host 默认 127.0.0.1（要对外必须显式指定，且建议同时开 read-only）
    #   · --read-only 默认 True（写端点 /watch/add、/watch/remove、/sync 需显式 --allow-write）
    # 这样「按默认配置部署」是安全的，危险配置必须显式选。
    ap.add_argument("--host", default="127.0.0.1",
                    help="监听地址（默认 127.0.0.1 仅本机；要对外访问须显式传 0.0.0.0）")
    ap.add_argument("--read-only", dest="read_only", action="store_true", default=True,
                    help="只读模式（默认开启）：禁用 /watch/add、/watch/remove、/sync")
    ap.add_argument("--allow-write", dest="read_only", action="store_false",
                    help="显式关闭只读模式，启用写入端点（谨慎：无鉴权）")
    ap.add_argument("--interval", type=int, default=60, help="serve 模式轮询秒数")
    ap.add_argument("--workers", type=int, default=4,
                    help="并发扫块线程数（串行约 2.6 块/秒；节点侧均为只读 GET）")
    args = ap.parse_args()

    if args.cmd == "selftest":
        sys.exit(selftest())

    global READ_ONLY
    READ_ONLY = bool(args.read_only)
    IDX = Indexer(args.node, args.contract, args.state, args.window, args.workers)
    if READ_ONLY:
        print("[indexer] 只读模式：/sync、/watch/add、/watch/remove 已禁用", flush=True)

    if args.cmd == "scan":
        print("sync:", json.dumps(IDX.sync(), ensure_ascii=False))
        snap = IDX.snapshot()
        print(f"台账 {len(snap)} 个地址：")
        for it in snap:
            print("  ", json.dumps(it, ensure_ascii=False))
        return

    if args.cmd == "serve":
        stop = threading.Event()
        t = threading.Thread(target=poller, args=(IDX, args.interval, stop), daemon=True)
        t.start()
        print(f"[indexer] serving on {args.host}:{args.port}  node={args.node}")
        print(f"[indexer] wallet API:  GET /watchlist   (single call)")
        HTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
