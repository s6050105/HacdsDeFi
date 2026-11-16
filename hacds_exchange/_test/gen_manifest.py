# -*- coding: utf-8 -*-
"""生成部署产物的唯一权威清单 _build_v30/manifest.json。

（2026-11-15 审计 B-1 第 1 条：此前 `action` 字节数在文档里有 16,201 /
 16,300 / 16,198 三种说法，没有单一权威来源。本脚本产出唯一值。）

用法（在 hacds_exchange/ 下）：
    python _test/gen_manifest.py

生成后 verify_build.py 会比对 manifest 与磁盘上的实际产物，不一致即判失败。
改 fitsh 或替换内核后必须重跑本脚本。
"""
import hashlib
import json
import os
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "_build_v30")

SRC = os.path.join(ROOT, "HacdsDeFi3000.fitsh")
DEPLOY = os.path.join(OUT, "HacdsDeFi3000.deploy.json")
MAP = os.path.join(OUT, "HacdsDeFi3000.contractmap.json")
KERNEL = os.path.join(ROOT, "score_sum_opt.hcf1")
KMANIFEST = os.path.join(OUT, "score_sum.calc.manifest.json")
MANIFEST = os.path.join(OUT, "manifest.json")

MAX_TX_BYTES = 16384
DEFAULT_FITSHC = "/d/hacash_v130_build/fitshc.exe"


def sha256(p):
    return hashlib.sha256(open(p, "rb").read()).hexdigest()


def fitshc_version():
    """尽力取编译器版本；取不到就记路径 + 自身哈希（仍可复现）。"""
    exe = os.environ.get("FITSHC", DEFAULT_FITSHC)
    ver = None
    if os.path.exists(exe):
        try:
            r = subprocess.run([exe, "version"], capture_output=True,
                               text=True, timeout=10, errors="replace")
            out = ((r.stdout or "") + (r.stderr or "")).strip()
            if out and "unknown" not in out.lower():
                ver = out.splitlines()[0]
        except Exception:
            ver = None
        return {
            "path": exe.replace("\\", "/"),
            "sha256": sha256(exe),
            "reported_version": ver,
        }
    return {"path": exe.replace("\\", "/"), "sha256": None,
            "reported_version": None, "note": "编译器不在预期路径"}


def main():
    for p in (SRC, DEPLOY, MAP):
        if not os.path.exists(p):
            print("缺少 %s" % p)
            return 2

    d = json.load(open(DEPLOY, encoding="utf-8"))
    action_hex = d["action"]
    action_bytes = bytes.fromhex(action_hex)

    entry = {
        "_comment": (
            "部署产物的唯一权威清单（2026-11-15 审计 B-1）。"
            "由 _test/gen_manifest.py 生成，verify_build.py 强制比对。"
            "改 fitsh 或替换内核后必须重跑本脚本，不要手改。"
        ),
        "contract": "HacdsDeFi3000",
        "expect_address": "T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH",
        "max_tx_bytes": MAX_TX_BYTES,

        # ⚠ 两个口径必须分开写，历史上正是这两个数字被混用：
        #   action_bytes     = 部署动作本身的字节数（受 16,384 上限约束的就是它）
        #   deploy_json_bytes = deploy.json 文件整体大小（含 JSON 结构与其它字段）
        "action_bytes": len(action_bytes),
        "action_sha256_hex_of_ascii": hashlib.sha256(
            action_hex.encode()).hexdigest(),
        "action_head16": action_bytes[:16].hex(),
        "action_tail16": action_bytes[-16:].hex(),
        "deploy_json_bytes": os.path.getsize(DEPLOY),
        "deploy_json_sha256": sha256(DEPLOY),
        "contractmap_sha256": sha256(MAP),
        "source_fitsh_sha256": sha256(SRC),
        "source_fitsh_bytes": os.path.getsize(SRC),

        "nonce": d.get("nonce"),
        "storage_periods": d.get("storage_periods"),
        "protocol_cost_basis": d.get("protocol_cost_basis"),
        "protocol_cost_u232": d.get("protocol_cost_u232"),

        "compiler": fitshc_version(),
        "kernel_hcf1_sha256": sha256(KERNEL) if os.path.exists(KERNEL) else None,
        "kernel_image_bytes": None,
        "kernel_id": None,
    }

    if os.path.exists(KMANIFEST):
        km = json.load(open(KMANIFEST, encoding="utf-8"))
        entry["kernel_image_bytes"] = km.get("image", {}).get("total")
        entry["kernel_id"] = km.get("image", {}).get("id")
        entry["kernel_profile_byte"] = km.get("profile_byte")
        entry["kernel_mem_kib"] = km.get("mem_kib")

    if entry["action_bytes"] > MAX_TX_BYTES:
        entry["_WARNING"] = (
            "action_bytes %d 超过上限 %d —— 不得部署"
            % (entry["action_bytes"], MAX_TX_BYTES))

    json.dump(entry, open(MANIFEST, "w", encoding="utf-8"),
              ensure_ascii=False, indent=2)

    print("已生成 %s" % MANIFEST)
    print()
    print("  action           %s B" % format(entry["action_bytes"], ","))
    print("  上限余量         %s B" % format(
        MAX_TX_BYTES - entry["action_bytes"], ","))
    print("  action sha256    %s" % entry["action_sha256_hex_of_ascii"])
    print("  deploy.json      %s B" % format(entry["deploy_json_bytes"], ","))
    print("  源码 sha256      %s" % entry["source_fitsh_sha256"])
    print("  编译器           %s" % (entry["compiler"].get("reported_version")
                                     or entry["compiler"]["path"]))
    if "_WARNING" in entry:
        print()
        print("  ⚠ " + entry["_WARNING"])
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
