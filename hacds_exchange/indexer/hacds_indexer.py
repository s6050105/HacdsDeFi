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
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

# --------------------------------------------------------------------------
# 常量（与合约/钱包一致）
# --------------------------------------------------------------------------
DEFAULT_NODE = "http://127.0.0.1:8082"
DEFAULT_CONTRACT = "VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1"

#: 借贷相关函数 —— 这些在合约上被调用时，tx.main 即借款人
LOAN_FNS = [
    "loan_borrow", "loan_repay", "loan_liquidate",
    "loan_add_collateral", "loan_status", "loan_debt_of", "loan_coll_of",
]

#: 清算判定（与合约 loan_liquidate 的门槛一致）
#:   合约要求 debt > coll / COLL_RATIO(2) 才放行 ⟺ coll_hac/debt < 2 ⟺ health < 200
LIQ_HEALTH_MAX = 200

STATE_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "watch.json")


def sha3_256(b: bytes) -> bytes:
    """标准库 sha3_256（Python 3.6+ 内置，与链上一致）。"""
    return hashlib.sha3_256(b).digest()


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
    """解析 kind=44 的 codes，命中借贷函数则返回函数名，否则 None。"""
    hx = str(codes_hex or "").strip().lower()
    if hx.startswith("0x"):
        hx = hx[2:]
    if not hx:
        return None
    for sig, name in LOAN_SELECTORS.items():
        if sig in hx:
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
        self.lock = threading.Lock()
        self.load()

    # ---- 持久化 ----
    def load(self):
        try:
            with open(self.state_file, "r", encoding="utf-8") as f:
                j = json.load(f)
            self.watch = j.get("watch", {}) or {}
            self.last_scanned = int(j.get("lastScanned", 0) or 0)
        except Exception:                                          # noqa: BLE001
            pass

    def save(self):
        tmp = self.state_file + ".tmp"
        try:
            os.makedirs(os.path.dirname(self.state_file), exist_ok=True)
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump({"watch": self.watch, "lastScanned": self.last_scanned,
                           "updatedAt": int(time.time())}, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.state_file)
            return True
        except Exception:                                          # noqa: BLE001
            return False

    # ---- 台账 ----
    def add(self, addr, note=None):
        if not addr:
            return False
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
    def _record(self, main, fn, height):
        with self.lock:
            w = self.watch.setdefault(main, {"first": height, "last": height,
                                             "calls": 0, "fns": {}})
            w["first"] = min(w["first"] or height, height)
            w["last"] = max(w.get("last") or 0, height)
            w["calls"] = w.get("calls", 0) + 1
            w.setdefault("fns", {})[fn] = w["fns"].get(fn, 0) + 1

    def scan(self, height, progress=None):
        """扫描单个高度，返回命中的 (addr, fn) 列表。"""
        intro = http_get_json(f"{self.node}/query/block/intro?height={height}&tx_hash_list=true")
        hits = []
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
                hits.append((main, fn))
        if progress:
            progress(height)
        return hits

    def scan_many(self, heights, workers=4):
        """并发扫描多个高度。串行时约 2.6 块/秒（每块 1 次 intro + N 次 tx 查询），
        并发可显著加速首次回溯；节点侧都是只读 GET，无 sandbox 并发限制。"""
        found = 0
        if workers <= 1:
            for h in heights:
                found += len(self.scan(h))
            return found
        with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as ex:
            for hits in ex.map(self.scan, heights):
                found += len(hits)
        return found

    def sync(self):
        head = int(http_get_json(f"{self.node}/query/block/height/latest")["height"])
        if self.last_scanned:
            start, end = self.last_scanned + 1, head
        else:
            start, end = max(1, head - self.window), head
        if start > end:
            return {"ok": True, "head": head, "from": 0, "to": 0, "scanned": 0,
                    "found": 0, "watched": len(self.addresses())}
        heights = list(range(start, end + 1))
        found = self.scan_many(heights, self.workers)
        scanned = len(heights)
        self.last_scanned = head
        self.save()
        return {"ok": True, "head": head, "from": start, "to": end,
                "scanned": scanned, "found": found, "watched": len(self.addresses())}

    # ---- 快照（查实时健康度）----
    def _call(self, fn, params=None, caller=None):
        c = caller or self.contract
        u = f"{self.node}/query/contract/sandboxcall?contract={self.contract}&function={fn}&caller={c}"
        if params:
            u += "&params=" + urllib.parse.quote(params)
        try:
            d = http_get_json(u)
            return d.get("ret_val") if d.get("ret") == 0 else None
        except Exception:                                          # noqa: BLE001
            return None

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
        self.send_header("Access-Control-Allow-Origin", "*")
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
            # ★ 钱包唯一需要的接口
            if path == "/watchlist":
                return self._send({"ret": 0, **IDX.summary()})
            if path == "/snapshot":
                return self._send({"ret": 0, "list": IDX.snapshot()})
            if path == "/sync":
                return self._send({"ret": 0, **IDX.sync()})
            if path == "/watch/add":
                a = (qs.get("address") or [""])[0].strip()
                if not a:
                    return self._send({"ret": 1, "err": "address required"}, 400)
                IDX.add(a, (qs.get("note") or [None])[0])
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
    ap.add_argument("--interval", type=int, default=60, help="serve 模式轮询秒数")
    ap.add_argument("--workers", type=int, default=4,
                    help="并发扫块线程数（串行约 2.6 块/秒；节点侧均为只读 GET）")
    args = ap.parse_args()

    if args.cmd == "selftest":
        sys.exit(selftest())

    IDX = Indexer(args.node, args.contract, args.state, args.window, args.workers)

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
        print(f"[indexer] serving on 0.0.0.0:{args.port}  node={args.node}")
        print(f"[indexer] wallet API:  GET /watchlist   (single call)")
        HTTPServer(("0.0.0.0", args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
