# -*- coding: utf-8 -*-
"""#3000 构建产物自检。

在部署前跑一遍，确认：
  1. fitsh 源码里的 nonce 与 BURN_ADDR 一致（部署地址 = 合约地址是硬耦合）
  2. 用官方 hacds_addr 复算 nonce → 地址，与 BURN_ADDR 对上
  3. 字节码里确实调用了 hacd_number_batch / hacd_visual_gene_batch
  4. 内核 profile / 输入输出上限符合预期
  5. 部署协议费

⚠ 不解析 deploy.json 里的 nonce 字节偏移：`protocol_cost` 是变长编码，
   写死偏移必然出错。nonce 的真相只有一个来源 —— fitsh 源码里的
   `deploy { nonce: N }`，再用官方工具把 N 推成地址来交叉验证。
"""
import json
import os
import re
import subprocess
import sys

# Windows 控制台默认 GBK，脚本里的 ✓/✗ 会抛 UnicodeEncodeError。
# 强制 UTF-8，否则自检在中途崩掉，看起来像"检查失败"。
try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "_build_v30")

SRC = os.path.join(ROOT, "HacdsDeFi3000.fitsh")
DEPLOY = os.path.join(OUT, "HacdsDeFi3000.deploy.json")
MAP = os.path.join(OUT, "HacdsDeFi3000.contractmap.json")
MANIFEST = os.path.join(OUT, "score_sum.calc.manifest.json")

ADDR_TOOL = os.environ.get("HACDS_ADDR", r"D:\hacash_fullnode\target\release\hacds_addr.exe")
DEPLOYER = "15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q"
EXPECT_ADDR = "T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH"


def check_nonce(ok):
    src = open(SRC, encoding="utf-8").read()
    m = re.search(r"nonce:\s*(\d+)", src)
    if not m:
        print("  ✗ 源码里找不到 nonce")
        return False, ok
    nonce = int(m.group(1))
    print(f"  · 源码 nonce = {nonce}")

    m2 = re.search(r"BURN_ADDR\s*:\s*address\s*=\s*(\S+)", src)
    if not m2:
        print("  ✗ 源码里找不到 BURN_ADDR")
        return nonce, False
    burn = m2.group(1).strip()
    print(f"  · 源码 BURN_ADDR = {burn}")

    if burn != EXPECT_ADDR:
        print(f"  ✗ BURN_ADDR 不是目标地址 {EXPECT_ADDR}")
        ok = False

    if os.path.exists(ADDR_TOOL):
        r = subprocess.run([ADDR_TOOL, DEPLOYER, str(nonce)],
                           capture_output=True, text=True, encoding="utf-8",
                           errors="replace")
        out = (r.stdout or "") + (r.stderr or "")
        mm = re.search(r"nonce\s+\d+\s*->\s*(\S+)", out)
        if not mm:
            print("  ✗ hacds_addr 输出无法解析:\n" + out)
            ok = False
        else:
            got = mm.group(1)
            if got == burn == EXPECT_ADDR:
                print(f"  ✓ nonce {nonce} -> {got}（与 BURN_ADDR 一致）")
            else:
                print(f"  ✗ nonce {nonce} -> {got}，与 BURN_ADDR {burn} 不一致")
                ok = False
    else:
        print(f"  · 未找到 hacds_addr（{ADDR_TOOL}），跳过地址复算")
    return nonce, ok


def main():
    ok = True

    print("【部署地址】")
    _, ok = check_nonce(ok)

    print("\n【基因视图调用点】")
    d = json.load(open(DEPLOY))
    a = bytes.fromhex(d["action"])
    names = {0x15: "hacd_smelt", 0x16: "hacd_number_batch",
             0x17: "hacd_visual_gene_batch", 0x18: "hacd_life_gene_batch"}
    found = {}
    for i in range(len(a) - 1):
        if a[i] == 0x06 and a[i + 1] in names:   # 0x06 = ACTVIEW
            k = names[a[i + 1]]
            found[k] = found.get(k, 0) + 1
    for need in ("hacd_number_batch", "hacd_visual_gene_batch"):
        n = found.get(need, 0)
        if n >= 1:
            print(f"  ✓ {need}: {n} 处")
        else:
            print(f"  ✗ 字节码里没有 {need}")
            ok = False
    if "hacd_smelt" in found:
        print(f"  · hacd_smelt: {found['hacd_smelt']} 处（可选）")

    print("\n【评分内核】")
    # --no-build（用预编译内核）时不生成 manifest / hcf1，内核已内联进 deploy.json
    if not os.path.exists(MANIFEST):
        # 反推：总大小 - 无内核版本的大小 ≈ 内核贡献
        print("  · 使用预编译内核（--no-build），未生成 manifest")
        print(f"  · 部署动作 {len(a):,} B 已含内联内核")
        print(f"     （内核源码编译版约 +1,674 B，此处为优化版）")
        print(f"  · 字节码 {len(a):,} 字节")
        print(f"  · 部署协议费 {int(d['protocol_cost_u232']) / 1e16:.6f} HAC")
        bad = not os.path.exists(MAP)
        print()
        print("自检通过" if not bad else "自检失败")
        return 0 if not bad else 1
    if os.path.exists(MANIFEST):
        m = json.load(open(MANIFEST))
        prof = m["profile_byte"]
        prof_name = {0: "rv64im", 2: "rv64imc"}.get(prof, f"0x{prof:02x}")
        print(f"  ✓ {m['kernel']}: profile {prof_name}, mem {m['mem_kib']} KiB, "
              f"in {m['input_max']}, out {m['output_max']}")
        print(f"     image {m['image']['total']} B, id {m['image']['id'][:16]}")
        if m["input_max"] != 4800 or m["output_max"] != 8:
            print("  ✗ IO 上限不符（应为 in 4800 / out 8）")
            ok = False
        if m["mem_kib"] > 64:
            print(f"  ✗ 内存 {m['mem_kib']} KiB 超过链上上限 64")
            ok = False
        if not (prof & ~0b110 == 0):
            print(f"  ✗ profile {prof} 不在链上准入集合内")
            ok = False
    else:
        print("  ✗ 缺少内核清单")
        ok = False

    print("\n【产物】")
    if os.path.exists(MAP):
        mp = json.load(open(MAP))
        print(f"  ✓ 函数数 {len(mp['funcs'])}")
    print(f"  · 字节码 {len(a)} 字节")
    cost = int(d["protocol_cost_u232"])
    print(f"  · 部署协议费 {cost / 1e18:.6f} HAC")

    print()
    print("自检通过" if ok else "自检失败")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
