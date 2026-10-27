#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
hacds_build_server —— 官网 `/api/build` 交易体构建服务

为什么需要它
------------
官网 hacds.com 是**纯静态站**，浏览器里不重新实现合约调用编码（那样等于给
链上行为造第二份实现，一旦与合约不一致，用户签的就是错交易且现场无法调试）。
所以官网把所有写操作交给 `POST /api/build`：

    { fn, params: "v:t,v:t", main, fee?, gasMax? }
    → { txbody, fee, description? }

`txbody` 是**未签名**的 Type-3 交易体，交给 MoneyNex 钱包签名后广播。
**本服务从不接触私钥，也无法动用资金**——它只拼字节。

实现方式
--------
不重写编码逻辑，而是**调用已验证的 `hacds_txbuild` 二进制**（与 PC 钱包、
Android 共用同一份 Rust 引擎）。这样编码正确性由同一份代码保证。

    本服务 → subprocess → hacds_txbuild call <main> <ts> <contract> <fn> <params>

用法
----
    # 1) 服务器上编译引擎（只需一次）
    cd /opt/hacash_fullnode
    cargo build --release -p testkit --bin hacds_txbuild

    # 2) 启动本服务
    python3 hacds_build_server.py --port 8125 \
        --node http://127.0.0.1:8082 \
        --contract T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH \
        --txbuild /opt/hacash_fullnode/target/release/hacds_txbuild

    # 3) 在 Cloudflare Worker 里把 /api/build 转发到这里
    #    wrangler secret put BUILD_ORIGIN   →  http://<server>:8125

安全边界
--------
· **不签名、不广播、不持私钥**：只产出未签名交易体。
· **白名单函数**：只允许合约里真实存在的 external 函数（见 ALLOWED_FNS），
  避免被当作任意调用代理。
· **参数校验**：单个参数长度、总参数长度、函数名格式都做上界检查。
· **限流**：单 IP 每分钟请求数上限（简单内存计数）。
· **CORS**：只允许官网域名（可用 --cors-origin 覆盖）。
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import threading
import time
import urllib.parse
import urllib.request
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

# ---------------------------------------------------------------------------
# 允许的函数白名单
#
# 只放**有写副作用、且官网控制台会用到**的函数。只读视图（balance_*、
# pool_price 等）官网走 GET 查询，不需要经过构建接口。
#
# 核对方式：`grep -oP "function external \K\w+" HacdsDeFi3000.fitsh`
# 下面每个名字都必须在那个列表里，否则是拼写错误（会 100% 构建失败）。
# ---------------------------------------------------------------------------
ALLOWED_FNS = {
    # AMM
    "swap_hac_to_ds", "swap_ds_to_hac",
    "add_liquidity", "remove_liquidity", "lp_harvest",
    # 借贷
    "loan_add_collateral", "loan_borrow", "loan_repay", "loan_liquidate",
    # 键续租（无许可，任何人可调；官网可不提供，但保留以便运维页使用）
    "rent_keys", "topup_keys",
}

#: 金库清扫不是独立函数——它由「普通转账到金库地址」触发合约的
#: PermitHAC / PermitAsset 钩子。官网若要提供清扫，需走 transfer 而非 call，
#: 不在本服务的 call 白名单范围内。

#: 参数串上界（防止超长 body 撑爆子进程 argv）
MAX_PARAMS_LEN = 1024
MAX_PARAM_ITEMS = 16

#: 单 IP 每分钟请求上限
RATE_LIMIT_PER_MIN = 30

DEFAULT_CONTRACT = "T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH"
DEFAULT_NODE = "http://127.0.0.1:8082"
DEFAULT_TXBUILD = "/opt/hacash_fullnode/target/release/hacds_txbuild"

ADDR_RE = re.compile(r"^[1-9A-HJ-NP-Za-km-z]{26,36}$")
FN_RE = re.compile(r"^[a-z][a-z0-9_]{0,63}$")

_rates = defaultdict(deque)
_rates_lock = threading.Lock()


def rate_ok(ip):
    now = time.time()
    with _rates_lock:
        q = _rates[ip]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= RATE_LIMIT_PER_MIN:
            return False
        q.append(now)
        return True


class Handler(BaseHTTPRequestHandler):
    server_version = "hacds-build/1.0"
    protocol_version = "HTTP/1.1"

    # ---- 输出 ----
    def _send(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        origin = self.headers.get("Origin", "")
        if origin and origin in self.server.cors_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):                                          # noqa: N802
        origin = self.headers.get("Origin", "")
        self.send_response(204)
        if origin and origin in self.server.cors_origins:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "86400")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):                                              # noqa: N802
        if self.path.rstrip("/") in ("", "/health"):
            return self._send({"ok": True, "service": "hacds-build"})
        return self._send({"error": "not_found"}, 404)

    def do_POST(self):                                             # noqa: N802
        if self.path.rstrip("/") != "/api/build":
            return self._send({"error": "not_found"}, 404)

        ip = self.client_address[0]
        if not rate_ok(ip):
            return self._send({"error": "rate_limited", "detail": "每分钟请求过多，请稍后再试"}, 429)

        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            return self._send({"error": "bad_length"}, 400)
        if n <= 0 or n > 8192:
            return self._send({"error": "bad_length", "detail": "请求体过大或为空"}, 400)

        try:
            req = json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:                                          # noqa: BLE001
            return self._send({"error": "bad_json"}, 400)

        err = self._validate(req)
        if err:
            return self._send({"error": err}, 400)

        fn = req["fn"]
        params = req.get("params") or "-"
        main = req["main"]
        fee = req.get("fee")

        # M-18：gasMax 原先直接 int() 且不在 try 内 —— 传 "abc" 会抛未捕获
        # ValueError（500），传 -1/0/999 会被原样塞进 env，引擎侧 panic。
        # 合约/引擎的合法范围是 1..99（0 引擎显式拒绝，>99 超出 u8 预算档）。
        try:
            gas_max = int(req.get("gasMax") or 99)
        except (TypeError, ValueError):
            return self._send({"error": "bad_gasMax", "detail": "gasMax 必须是整数"}, 400)
        if not (1 <= gas_max <= 99):
            return self._send({"error": "bad_gasMax", "detail": "gasMax 取值 1–99"}, 400)

        # M-19：fee 原先完全未校验，任意字符串直接进 HACDS_FEE，引擎
        # Amount::from() panic。只接受 "单位:尾数" 形式（如 0:248）。
        if fee is not None:
            if not isinstance(fee, str) or not re.match(r"^\d{1,3}:\d{1,3}$", fee):
                return self._send({"error": "bad_fee", "detail": "fee 形如 0:248"}, 400)

        ts = str(int(time.time()))
        argv = [self.server.txbuild, "call", main, ts, self.server.contract, fn, params]

        env = os.environ.copy()
        if fee:
            env["HACDS_FEE"] = str(fee)
        if gas_max:
            env["HACDS_GAS_MAX"] = str(gas_max)

        try:
            out = subprocess.run(argv, capture_output=True, text=True, timeout=30, env=env)
        except subprocess.TimeoutExpired:
            return self._send({"error": "build_timeout"}, 504)
        except FileNotFoundError:
            return self._send({"error": "engine_missing",
                               "detail": "服务器未找到 hacds_txbuild，请检查 --txbuild"}, 500)

        text = (out.stdout or "") + "\n" + (out.stderr or "")
        if out.returncode != 0 or "[ERROR]" in text:
            # 不回显完整 stderr（可能含服务器路径），只给首行
            msg = ""
            for line in text.splitlines():
                if "[ERROR]" in line:
                    msg = line.split("[ERROR]", 1)[1].strip()
                    break
            return self._send({"error": "build_failed", "detail": msg[:200] or "构建失败"}, 400)

        # 解析 txbody / fee
        tx_hex, fee_used = None, None
        for line in text.splitlines():
            k, _, v = line.partition("=")
            k, v = k.strip(), v.strip()
            if k in ("unsigned_tx_hex", "tx_hex"):
                tx_hex = v
            elif k == "fee":
                fee_used = v
        if not tx_hex:
            return self._send({"error": "empty_txbody"}, 500)

        # 兜底：绝不返回已签名交易体（本服务不签名，但双保险）
        for line in text.splitlines():
            if line.strip().startswith("signed_tx_hex"):
                return self._send({"error": "unexpected_signed_output"}, 500)

        return self._send({
            "txbody": tx_hex,
            "fee": fee_used,
            "fn": fn,
            "contract": self.server.contract,
        })

    def _validate(self, req):
        if not isinstance(req, dict):
            return "bad_request"
        fn = req.get("fn")
        if not isinstance(fn, str) or not FN_RE.match(fn):
            return "bad_fn"
        if fn not in ALLOWED_FNS:
            return "fn_not_allowed"
        main = req.get("main")
        if not isinstance(main, str) or not ADDR_RE.match(main):
            return "bad_main"
        params = req.get("params")
        if params in (None, "", "-"):
            return None
        if not isinstance(params, str):
            return "bad_params"
        if len(params) > MAX_PARAMS_LEN:
            return "params_too_long"
        if params.count(",") + 1 > MAX_PARAM_ITEMS:
            return "too_many_params"
        # 只允许 [0-9a-zA-Z:,._-]（地址、数字、类型名、十六进制）
        if not re.match(r"^[0-9A-Za-z:,._\-]+$", params):
            return "params_charset"
        return None

    def log_message(self, fmt, *args):                             # noqa: A003
        sys.stderr.write("[%s] %s\n" % (time.strftime("%H:%M:%S"), fmt % args))


def main():
    ap = argparse.ArgumentParser(description="hacds 官网交易构建服务（/api/build）")
    ap.add_argument("--host", default="127.0.0.1", help="监听地址（默认仅本机；由 Worker 反代）")
    ap.add_argument("--port", type=int, default=8125)
    ap.add_argument("--node", default=DEFAULT_NODE, help="Hacash 节点（当前未使用，保留）")
    ap.add_argument("--contract", default=DEFAULT_CONTRACT)
    ap.add_argument("--txbuild", default=DEFAULT_TXBUILD)
    ap.add_argument("--cors-origin", action="append", default=None,
                    help="允许的 Origin（可多次传）。默认 https://hacds.com 与 http://localhost")
    args = ap.parse_args()

    if not os.path.exists(args.txbuild):
        sys.exit("找不到 txbuild：%s\n"
                 "  请在服务器上编译：cd /opt/hacash_fullnode && "
                 "cargo build --release -p testkit --bin hacds_txbuild" % args.txbuild)
    if not os.access(args.txbuild, os.X_OK):
        sys.exit("txbuild 不可执行：%s" % args.txbuild)

    origins = args.cors_origin or ["https://hacds.com", "https://www.hacds.com",
                                   "http://localhost:8080", "http://127.0.0.1:8080"]

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.txbuild = args.txbuild
    srv.contract = args.contract
    srv.cors_origins = set(origins)
    print("hacds build server on http://%s:%d" % (args.host, args.port), flush=True)
    print("  contract : %s" % args.contract, flush=True)
    print("  txbuild  : %s" % args.txbuild, flush=True)
    print("  origins  : %s" % ", ".join(sorted(origins)), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
