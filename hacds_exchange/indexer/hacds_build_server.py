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
# transfer 模式允许的子形式。
#
# ⚠ 这是**无鉴权**的公开端点，必须严格白名单，不能接受任意 action。
#   尤其是 from-to 类：from 必须是本合约地址，否则等于提供
#   「构造把任意地址的钱转走」的交易体，会被钓鱼利用。
TRANSFER_FORMS = {
    # 子形式            : (需要 from 参数, 额外字段)
    "hac-to":        (False, ["to", "hac"]),
    "hac-from-to":   (True,  ["from", "to", "hac"]),
    "asset-to":      (False, ["to", "serial", "atoms"]),
    "asset-from-to": (True,  ["from", "to", "serial", "atoms"]),
    "hacd-to":       (False, ["to", "names"]),
    "hacd-from-to":  (True,  ["from", "to", "names"]),
}

# 允许的资产 serial。
#
# 为什么不限制成只有 hacds：
#   `asset-to` / `asset-from-to` 的第一个约束是「发送方 = 交易主地址（或本合约）」，
#   用户本来就只能转自己持有的资产，放开 serial 不构成安全问题。
#   而且「其它资产转账」是 PC 钱包已有的功能，官网不放开就对不齐。
#
# ⚠ 真正的安全边界是 `from`（见 _validate_transfer）：
#   from-to 类的 from 必须等于本合约地址，这条不能放开 ——
#   否则等于提供「构造把合约资产转给任意地址」的交易体，会被钓鱼利用。
#
# 注意：用户「我 → 他人」的资产转账走 **asset-to**（发送方隐含为交易主地址），
# 不依赖 from 参数，所以上述 from 限制不影响任何转账功能。
ALLOWED_SERIALS = {"hacds", "3000"}   # 保留这两个别名，另允许任意数字 serial

# 数字 serial 的合法范围
SERIAL_RE = re.compile(r"^\d{1,20}$")

# HAC 金额：整数或小数（如 "1"、"0.5"、"1:248"）
HAC_AMT_RE = re.compile(r"^\d{1,18}(\.\d{1,18})?(:\d{1,3})?$")

# 钻石名列表：6 位大写字母，逗号分隔，最多 200 颗
HACD_NAMES_RE = re.compile(r"^[WTYUIAHXVMEKBSZN]{6}(,[WTYUIAHXVMEKBSZN]{6}){0,199}$")

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

#: /health 会返回这个值，用于远程确认服务器跑的是哪一版脚本。
#: Python 不热加载，改了脚本必须重启进程；改脚本时顺手改这里。
SERVER_VERSION = "2026-11-11.2"
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

    def _client_ip(self):
        """限流用的客户端 IP。

        为什么不能只用 self.client_address[0]（2026-11-12 审计 C-M5）：
        生产环境前面是 Cloudflare Worker 反向代理，TCP 源地址永远是 Worker
        的出口 IP —— 全站共享一个 30 次/分的桶，任何人几十个请求就能把
        服务对其他所有用户打死。

        取值顺序（默认**不信** X-Forwarded-For）：
          1. --trust-proxy 打开时，取 XFF 的**最右一跳**。
             最右一跳是紧邻我们的那一层代理写的，客户端伪造不了它；
             取最左（客户端可任意填）才是危险的经典错误。
          2. 否则用 TCP 源地址。
        """
        if getattr(self.server, 'trust_proxy', False):
            xff = self.headers.get('X-Forwarded-For') or ''
            if xff:
                last = xff.split(',')[-1].strip()
                if last:
                    return last
        return self.client_address[0]

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
            # 带上版本与自检结果，方便远程确认服务器跑的是哪个版本。
            #
            # 为什么需要：Python 不会热加载，改了脚本必须重启进程才生效。
            # 曾出现「文件已更新但进程还是旧的」——从外部看不出来，
            # 只能靠人工比对文件大小。有了这个字段，一条 curl 就能确认。
            return self._send({
                "ok": True,
                "service": "hacds-build",
                "version": SERVER_VERSION,
                "txbuild_ok": self.server.txbuild_ok,
                "contract": self.server.contract,
            })
        return self._send({"error": "not_found"}, 404)

    def do_POST(self):                                             # noqa: N802
        if self.path.rstrip("/") != "/api/build":
            return self._send({"error": "not_found"}, 404)

        ip = self._client_ip()
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

        # 按 mode 分流：默认 call（合约调用），transfer 走纯转账动作
        mode = req.get("mode") or "call"

        if mode == "transfer":
            err, extra = self._validate_transfer(req)
            if err:
                return self._send({"error": err}, 400)
            main = req.get("main")
            if not isinstance(main, str) or not ADDR_RE.match(main):
                return self._send({"error": "bad_main"}, 400)
            fee = req.get("fee")
            if fee is not None:
                if not isinstance(fee, str) or not re.match(r"^\d{1,3}:\d{1,3}$", fee):
                    return self._send({"error": "bad_fee", "detail": "fee 形如 0:248"}, 400)
            ts = str(int(time.time()))
            # ⚠ 参数顺序实测确认（2026-11-11）：
            #   a[0]=程序  a[1]="transfer"  a[2]=main  a[3]=ts
            #   a[4]=sub   a[5..]=子形式参数
            # 写成 "transfer <sub> <main> <ts>" 会把 sub 当成 main，
            # 报 InvalidBase58Character('-', 3)。
            argv = [self.server.txbuild, "transfer", main, ts, req["sub"]] + extra
            env = os.environ.copy()
            if fee:
                env["HACDS_FEE"] = str(fee)
            return self._run_and_reply(argv, env, {"sub": req["sub"]})

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

        return self._run_and_reply(argv, env, {"fn": fn})

    def _run_and_reply(self, argv, env, extra):
        """执行 txbuild 并解析输出。call / transfer 两条路径共用。"""
        try:
            out = subprocess.run(argv, capture_output=True, text=True, timeout=30, env=env)
        except subprocess.TimeoutExpired:
            return self._send({"error": "build_timeout"}, 504)
        except FileNotFoundError:
            return self._send({"error": "engine_missing",
                               "detail": "服务器未找到 hacds_txbuild，请检查 --txbuild"}, 500)

        text = (out.stdout or "") + "\n" + (out.stderr or "")
        if out.returncode != 0 or "[ERROR]" in text:
            # 提取可读错误。txbuild 有两种失败形态：
            #   ① 业务错误：输出含 "[ERROR] xxx"
            #   ② Rust panic："thread 'main' panicked at <file>:<line>:\n<原因>"
            # 原实现只认 ①，panic 时 detail 永远是空的「构建失败」，
            # 而真正的错误（如 unknown transfer sub-form hacd-to）被丢掉。
            #
            # 注意：不回显完整 stderr（可能含服务器路径），只取单行并截断。
            msg = ""
            lines = text.splitlines()
            for i, line in enumerate(lines):
                if "[ERROR]" in line:
                    msg = line.split("[ERROR]", 1)[1].strip()
                    break
            if not msg:
                # panic 形态：原因在 "panicked at ...:" 的下一行
                for i, line in enumerate(lines):
                    if "panicked at" in line:
                        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
                        msg = (nxt or line.strip()).strip()
                        break
            if not msg:
                # 兜底：取最后一条非空行（通常是错误原因）
                for line in reversed(lines):
                    if line.strip():
                        msg = line.strip()
                        break
            return self._send({"error": "build_failed", "detail": msg[:200] or "构建失败"}, 400)

        # 兜底：绝不返回已签名交易体（本服务不签名，但双保险）
        for line in text.splitlines():
            if line.strip().startswith("signed_tx_hex"):
                return self._send({"error": "unexpected_signed_output"}, 500)

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

        resp = {"txbody": tx_hex, "fee": fee_used, "contract": self.server.contract}
        resp.update(extra or {})
        return self._send(resp)

    def _validate_transfer(self, req):
        """校验 transfer 请求。返回 (err, argv_extra)。

        argv_extra 是拼在 `transfer <sub>` 之后的位置参数列表。
        """
        sub = req.get("sub")
        if not isinstance(sub, str) or sub not in TRANSFER_FORMS:
            return "bad_sub", None
        need_from, fields = TRANSFER_FORMS[sub]

        argv = []
        if need_from:
            frm = req.get("from")
            if not isinstance(frm, str) or not ADDR_RE.match(frm):
                return "bad_from", None
            # ⚠ 关键安全约束：from 必须是本合约地址。
            #   否则任何人都能拿到「把任意地址资产转走」的交易体。
            if frm != self.server.contract:
                return "from_must_be_contract", None
            argv.append(frm)

        to = req.get("to")
        if not isinstance(to, str) or not ADDR_RE.match(to):
            return "bad_to", None
        argv.append(to)

        if "hac" in fields:
            v = req.get("hac")
            if not isinstance(v, str) or not HAC_AMT_RE.match(v) or len(v) > 32:
                return "bad_hac_amount", None
            argv.append(v)

        if "serial" in fields:
            sr = req.get("serial")
            if not isinstance(sr, str):
                return "bad_serial", None
            # hacds / 3000 是别名；其它必须是纯数字 serial（如 2000、1028）
            if sr not in ALLOWED_SERIALS and not SERIAL_RE.match(sr):
                return "bad_serial", None
            atoms = req.get("atoms")
            if not isinstance(atoms, str) or not re.match(r"^\d{1,32}$", atoms):
                return "bad_atoms", None
            argv.append(sr)
            argv.append(atoms)

        if "names" in fields:
            nm = req.get("names")
            if not isinstance(nm, str) or not HACD_NAMES_RE.match(nm):
                return "bad_hacd_names", None
            argv.append(nm)

        return None, argv

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
    ap.add_argument("--trust-proxy", action="store_true",
                    help="信任前面有一层反向代理（Cloudflare Worker / Nginx），"
                         "按 X-Forwarded-For 的最右一跳做限流。"
                         "⚠ 只在**确实**有代理时打开：直连暴露时打开，客户端可伪造）
    args = ap.parse_args()

    if not os.path.exists(args.txbuild):
        sys.exit("找不到 txbuild：%s\n"
                 "  请在服务器上编译：cd /opt/hacash_fullnode && "
                 "cargo build --release -p testkit --bin hacds_txbuild" % args.txbuild)
    if not os.access(args.txbuild, os.X_OK):
        sys.exit("txbuild 不可执行：%s" % args.txbuild)

    # 启动自检：确认 txbuild 认识我们要用的 transfer 子形式。
    #
    # 为什么必须查：曾遇到服务器上的 txbuild 是旧版实现（605 行的老结构），
    # 只认 hac-to / asset-to，不认 hacd-to —— 服务能正常启动、call 模式也能用，
    # 只有 HACD 存入/赎回静默失败，而错误又被错误处理吃掉，只剩「构建失败」。
    # 在这里一次性查出来，比等用户点按钮踩坑强。
    probe = [args.txbuild, "transfer", "15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q",
             "1", "hacd-to", "T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH", "UWVXXI"]
    try:
        r = subprocess.run(probe, capture_output=True, text=True, timeout=20)
        probe_text = (r.stdout or "") + (r.stderr or "")
        if "unknown transfer sub-form" in probe_text:
            sys.exit("txbuild 版本过旧：不支持 hacd-to 子形式。\n"
                     "  该文件不是当前仓库编译的产物（老实现只有 605 行的单文件结构）。\n"
                     "  请用官方源码重新编译并覆盖：\n"
                     "    cargo build --release -p testkit --bin hacds_txbuild")
    except subprocess.TimeoutExpired:
        sys.exit("txbuild 自检超时（20s）：%s" % args.txbuild)
    except OSError as e:
        sys.exit("txbuild 自检失败：%s" % e)

    origins = args.cors_origin or ["https://hacds.com", "https://www.hacds.com",
                                   "http://localhost:8080", "http://127.0.0.1:8080"]

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    srv.txbuild = args.txbuild
    srv.contract = args.contract
    srv.cors_origins = set(origins)
    srv.txbuild_ok = True     # 上面自检没退出，就说明支持 hacd-to
    # 生产环境前面是 Cloudflare Worker 反代，必须开这个，
    # 否则全站共享一个限流桶（审计 C-M5）。
    srv.trust_proxy = bool(args.trust_proxy)
    print("hacds build server on http://%s:%d  [%s]"
          % (args.host, args.port, SERVER_VERSION), flush=True)
    print("  contract : %s" % args.contract, flush=True)
    print("  txbuild  : %s" % args.txbuild, flush=True)
    print("  origins  : %s" % ", ".join(sorted(origins)), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
