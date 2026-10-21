#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
redeem.py —— HACD 兑换 hacds 的一键封装（用户侧）

它把整条链路串起来：
  1. 从全节点 RPC 读取每颗 HACD 的 name / number / life_gene（顺便校验归属）；
  2. 向预言机 HTTP 服务 /cert 取回该钻石的基因证书（29B 消息 + 97B 签名）；
  3. 把 N 份证书（每份 126B）拼成证书流，写成临时 hex 文件；
  4. 调用 hacds_txbuild 的 `hacd` 模式构造并签名交易

这样用户拿 HACD 换 hacds 只需一条命令。

前置：
  - 全节点 RPC（默认 http://127.0.0.1:8082）
  - 预言机服务（默认 http://127.0.0.1:8123）
  - hacds_txbuild.exe（含 `hacd` 模式）
  - 用户的私钥文件（64 hex）

用法：
  python redeem.py \
    --names MVUUBA,HYXYHY \
    --key D:\\keys\\user.key \
    --contract VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1 \
    --node http://127.0.0.1:8082 \
    --oracle http://127.0.0.1:8123 \
    --txbuild D:\\hacash_fullnode\\target\\release\\hacds_txbuild.exe \
    --out redeem_signed.txt

  只取证书、不构造交易（离线检查用）：加 --cert-only
"""

import argparse
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.request
import urllib.error

# 默认指向本机（工具与节点/预言机同机时用这个；跨机时用 --node/--oracle 指定公网地址）
DEFAULT_NODE = "http://127.0.0.1:8082"
DEFAULT_ORACLE = "http://127.0.0.1:8123"


def check_endpoints(node, oracle, timeout):
    """连通性自检：节点高度 + 预言机 /health + 一份样例证书。"""
    ok = True
    print("== 连通性自检 ==")
    try:
        h = http_get(node.rstrip("/") + "/query/block/height/latest", timeout)
        print("  [OK]  节点 %s  高度=%s" % (node, h.get("height")))
    except Exception as e:
        ok = False
        print("  [FAIL] 节点 %s -> %s" % (node, e))
    try:
        h = http_get(oracle.rstrip("/") + "/health", timeout)
        print("  [OK]  预言机 %s health=%s" % (oracle, h))
    except Exception as e:
        ok = False
        print("  [FAIL] 预言机 %s /health -> %s" % (oracle, e))
    try:
        c = http_get(oracle.rstrip("/") + "/cert?name=MVUUBA", timeout)
        if c.get("error"):
            ok = False
            print("  [FAIL] 预言机 /cert?name=MVUUBA -> %s" % c["error"])
        else:
            print("  [OK]  预言机 /cert?name=MVUUBA score=%s oracle=%s"
                  % (c.get("score"), c.get("oracle_address")))
    except Exception as e:
        ok = False
        print("  [FAIL] 预言机 /cert?name=MVUUBA -> %s" % e)
    print("== 结论: %s ==" % ("全部可达" if ok else "存在不可达端点，见上"))
    return ok


def http_get(url, timeout):
    req = urllib.request.Request(url, headers={"User-Agent": "hacds-redeem/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def node_diamond(node, name, timeout):
    """读钻石数据（校验存在性与归属）。"""
    return http_get(node.rstrip("/") + "/query/diamond?name=" + name, timeout)


def oracle_cert(oracle, name, timeout):
    """向预言机取一份证书；返回 dict（含 cert_message_hex / sign_hex / score）。"""
    url = oracle.rstrip("/") + "/cert?name=" + name
    data = http_get(url, timeout)
    if "error" in data:
        raise RuntimeError("oracle error for %s: %s" % (name, data["error"]))
    for k in ("cert_message_hex", "sign_hex", "score"):
        if k not in data:
            raise RuntimeError("oracle response missing %s: %s" % (k, data))
    return data


def build_cert_stream(oracle, names, timeout):
    """把 N 颗钻石的证书拼成合约要的流：每份 29B 消息 ++ 97B 签名 = 126B。"""
    stream = ""
    total_score = 0
    for nm in names:
        c = oracle_cert(oracle, nm, timeout)
        msg = c["cert_message_hex"]
        sig = c["sign_hex"]
        if len(msg) != 58:      # 29B = 58 hex
            raise RuntimeError("%s: cert message must be 29B, got %d hex" % (nm, len(msg)))
        if len(sig) != 194:     # 97B = 194 hex
            raise RuntimeError("%s: sign must be 97B, got %d hex" % (nm, len(sig)))
        stream += msg + sig
        total_score += int(c["score"])
        print("  %s: score=%s vg=%s" % (nm, c["score"], c.get("visual_gene", "")))
    return stream, total_score


def main():
    ap = argparse.ArgumentParser(description="HACD -> hacds 一键兑换封装")
    ap.add_argument("--names", help="钻石名，逗号或空格分隔，如 MVUUBA,HYXYHY")
    ap.add_argument("--key", help="用户私钥文件（64 hex）")
    ap.add_argument("--contract", help="HacdsDeFi 合约地址")
    ap.add_argument("--node", default=DEFAULT_NODE, help="全节点 RPC（默认：本机 %s）" % DEFAULT_NODE)
    ap.add_argument("--oracle", default=DEFAULT_ORACLE, help="预言机服务（默认：本机 %s）" % DEFAULT_ORACLE)
    ap.add_argument("--txbuild", default="hacds_txbuild", help="hacds_txbuild 可执行文件路径")
    ap.add_argument("--fee", default=None, help="交易手续费（默认 hacds_txbuild 的 0.0002）")
    ap.add_argument("--gas-max", default=None, help="gas_max 字节（默认 99）")
    ap.add_argument("--out", default=None, help="已签名交易输出文件（默认打印到屏幕）")
    ap.add_argument("--timeout", type=int, default=15)
    ap.add_argument("--cert-only", action="store_true", help="只取证书、不构造交易")
    ap.add_argument("--check", action="store_true",
                    help="只做连通性自检（节点 + 预言机），不校验钻石、不构造交易")
    args = ap.parse_args()

    # 连通性自检模式：不需要 names / key / contract
    if args.check:
        sys.exit(0 if check_endpoints(args.node, args.oracle, args.timeout) else 1)

    for req in ("names", "key", "contract"):
        if not getattr(args, req):
            raise SystemExit("--%s is required (unless --check)" % req)

    names = [n.strip().upper() for n in args.names.replace(",", " ").split() if n.strip()]
    if not names:
        raise SystemExit("no diamond names given")
    for n in names:
        if len(n) != 6:
            raise SystemExit("diamond name must be 6 chars: %r" % n)

    # 用户地址（由私钥派生，用于归属校验）—— 交给 hacds_txbuild 不打印私钥，
    # 这里只读文件算地址：复用预言机脚本的派生函数，避免重复实现。
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                    "..", "hacds_exchange", "oracle"))
    try:
        import hacds_oracle as oc
    except Exception as e:
        raise SystemExit("cannot import hacds_oracle for address derivation: %s" % e)
    key_hex = open(args.key).read().strip().replace("0x", "").replace("0X", "")
    if len(key_hex) != 64:
        raise SystemExit("key file must hold 64 hex chars")
    user_addr = oc.resolve_oracle_address(int(key_hex, 16))
    print("user address = %s" % user_addr)

    # 1) 校验钻石存在与归属
    print("checking %d diamond(s) on node %s ..." % (len(names), args.node))
    for nm in names:
        d = node_diamond(args.node, nm, args.timeout)
        if not d.get("name"):
            raise SystemExit("diamond %s not found on node" % nm)
        if d.get("belong") and d["belong"] != user_addr:
            raise SystemExit(
                "diamond %s belongs to %s, not your %s" % (nm, d["belong"], user_addr))
        print("  %s: number=%s owner ok" % (nm, d.get("number")))

    # 2) 取证书
    print("fetching certificates from oracle %s ..." % args.oracle)
    stream, total_score = build_cert_stream(args.oracle, names, args.timeout)
    print("cert stream = %d bytes (%d diamonds), total score = %d (%s hacds)"
          % (len(stream) // 2, len(names), total_score, total_score))

    if args.cert_only:
        print("\ncert_stream_hex = %s" % stream)
        return

    # 3) 写证书流到临时文件
    fd, cert_path = tempfile.mkstemp(suffix=".cert.hex", text=True)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(stream)
        # 4) 调 hacds_txbuild（tx 时间戳用当前 unix 秒）
        tx_ts = str(int(time.time()))
        cmd = [args.txbuild, "hacd", user_addr, tx_ts, args.contract,
               ",".join(names), cert_path]
        env = dict(os.environ)
        env["HACDS_SIGN_KEY"] = args.key
        if args.fee:
            env["HACDS_FEE"] = args.fee
        if args.gas_max:
            env["HACDS_GAS_MAX"] = args.gas_max
        print("\nrunning: %s hacd %s %s %s <%d diamonds> <certfile>" % (
            args.txbuild, user_addr, tx_ts, args.contract, len(names)))
        proc = subprocess.run(cmd, env=env, capture_output=True, text=True)
        sys.stdout.write(proc.stdout)
        if proc.returncode != 0:
            sys.stderr.write(proc.stderr)
            raise SystemExit("hacds_txbuild failed (exit %d)" % proc.returncode)

        # 5) 提取并保存已签名交易
        signed = None
        for line in proc.stdout.splitlines():
            if line.strip().startswith("signed_tx_hex"):
                signed = line.split("=", 1)[1].strip()
        if not signed:
            raise SystemExit("no signed_tx_hex in txbuild output")
        if args.out:
            with open(args.out, "w") as f:
                f.write("0x" + signed + "\n")
            print("\nsigned tx written to %s" % args.out)
        else:
            print("\nSIGNED_TX = 0x%s" % signed)
    finally:
        try:
            os.remove(cert_path)
        except OSError:
            pass


if __name__ == "__main__":
    main()
