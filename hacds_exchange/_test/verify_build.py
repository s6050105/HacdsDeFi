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

# 交易大小硬上限（hacash-params/src/lib.rs:162，编译期常量）。
# ⚠ 2026-11-15 审计 B-1：原脚本只打印长度、从不判断，超限也照样"自检通过"。
MAX_TX_BYTES = 16384

# 部署协议费的价格单位。u232 = 10⁻¹⁶ HAC（见 hacash-params 里
# initial_fee_purity_floor 的注释：5×10¹⁰ u232 ≡ 50,000 u238/byte）。
# ⚠ 2026-11-15 审计 B-1：原脚本 :117 用 1e16、:181 用 1e18，同一份数据
#   算出两个相差 100 倍的值。统一走这个常量。
COST_UNIT_DIVISOR = 1e16


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


ARTIFACT_MANIFEST = os.path.join(OUT, "manifest.json")


def check_artifact_manifest(ok):
    """A-1/A-2：比对 _build_v30/manifest.json 与磁盘实际产物。

    ⚠ 2026-11-15 审计 B-1：此前没有这份清单，`action` 字节数在文档里有
      16,201 / 16,300 / 16,198 三种说法，谁也没法判定哪个是真的。
      现在以 manifest.json 为唯一权威，任何不一致都判失败。
    """
    import hashlib
    if not os.path.exists(ARTIFACT_MANIFEST):
        print("  ✗ 缺少 %s" % ARTIFACT_MANIFEST)
        print("    请先运行: python _test/gen_manifest.py")
        return False

    m = json.load(open(ARTIFACT_MANIFEST, encoding="utf-8"))

    def cmp(label, declared, actual):
        if declared == actual:
            print(f"  ✓ {label} 与 manifest 一致")
            return True
        print(f"  ✗ {label} 与 manifest 不符")
        print(f"     manifest: {declared}")
        print(f"     实际    : {actual}")
        return False

    good = True
    a = bytes.fromhex(json.load(open(DEPLOY, encoding="utf-8"))["action"])
    good &= cmp("action_bytes", m.get("action_bytes"), len(a))
    good &= cmp("source_fitsh_sha256", m.get("source_fitsh_sha256"),
                hashlib.sha256(open(SRC, "rb").read()).hexdigest())

    if os.path.exists(MAP):
        good &= cmp("contractmap_sha256", m.get("contractmap_sha256"),
                    hashlib.sha256(open(MAP, "rb").read()).hexdigest())

    kpath = os.path.join(ROOT, "score_sum_opt.hcf1")
    if os.path.exists(kpath) and m.get("kernel_hcf1_sha256"):
        good &= cmp("kernel_hcf1_sha256", m.get("kernel_hcf1_sha256"),
                    hashlib.sha256(open(kpath, "rb").read()).hexdigest())

    return ok and good


def check_artifacts(ok):
    """A-5：把「要部署的东西」本身纳入 SHA256SUMS 校验。

    ⚠ 2026-11-15 审计 B-1：原 SHA256SUMS.txt 只登记随包二进制与内核，
      **不含** deploy.json / contractmap / fitsh —— 也就是说部署字节码
      可以被整份替换，而所有既有自检照过。这里补齐。
    """
    import hashlib
    sums = os.path.join(ROOT, "..", "SHA256SUMS.txt")
    sums = os.path.abspath(sums)
    if not os.path.exists(sums):
        print(f"  ✗ 找不到 SHA256SUMS.txt：{sums}")
        return ok

    tbl = {}
    for ln in open(sums, encoding="utf-8"):
        ln = ln.strip()
        if not ln or ln.startswith("#"):
            continue
        parts = ln.split()
        if len(parts) >= 2:
            tbl[parts[-1].lstrip("*")] = parts[0]

    targets = [
        ("hacds_exchange/HacdsDeFi3000.fitsh", SRC),
        ("hacds_exchange/_build_v30/HacdsDeFi3000.deploy.json", DEPLOY),
        ("hacds_exchange/_build_v30/HacdsDeFi3000.contractmap.json", MAP),
    ]
    for rel, path in targets:
        base = os.path.basename(rel)
        exp = tbl.get(rel) or tbl.get(base)
        if exp is None:
            print(f"  ✗ {rel} 未登记在 SHA256SUMS.txt")
            ok = False
            continue
        if not os.path.exists(path):
            print(f"  ✗ 找不到 {path}")
            ok = False
            continue
        got = hashlib.sha256(open(path, "rb").read()).hexdigest()
        if got != exp:
            print(f"  ✗ {base} 哈希不符")
            print(f"     登记 {exp}")
            print(f"     实际 {got}")
            ok = False
        else:
            print(f"  ✓ {base} 哈希与 SHA256SUMS 一致 ({exp[:16]}…)")
    return ok


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
        print("  · 使用预编译内核（--no-build），未生成 manifest")
        print(f"  · 部署动作 {len(a):,} B 已含内联内核")
        print(f"     （内核源码编译版约 +1,674 B，此处为优化版）")
        print(f"  · 字节码 {len(a):,} 字节")
        print(f"  · 部署协议费 {int(d['protocol_cost_u232']) / COST_UNIT_DIVISOR:.6f} HAC")

        # ⚠ 2026-11-15 审计 B-1：这里原本是 `bad = ...; return`，把函数开头累积的
        #   `ok`（nonce / BURN_ADDR / 地址复算 / ACTVIEW 调用点）全部丢弃了 ——
        #   实测把字节码末尾改成 deadbeef 后仍然打印"自检通过"。
        #   现在改用同一个 `ok` 累加，不再另起 `bad`。
        #
        # H-6（2026-11-12）：预编译内核**必须**与 SHA256SUMS 里登记的哈希一致，
        # 否则任何人都能在构建机上把 hcf1 换掉，让「存入按 A 算分、赎回按 B 扣分」，
        # 而所有既有自检照样通过 —— 这是部署后无法修复的账本 bug。
        kpath = os.path.join(HERE, "..", "score_sum_opt.hcf1")
        kpath = os.path.abspath(kpath)
        exp = None
        sums = os.path.join(HERE, "..", "..", "SHA256SUMS.txt")
        if os.path.exists(sums):
            for ln in open(sums, encoding="utf-8"):
                ln = ln.strip()
                if ln.endswith("score_sum_opt.hcf1"):
                    exp = ln.split()[0]
                    break
        if exp is None:
            print("  ✗ 内核哈希未登记在 SHA256SUMS.txt —— 拒绝判通过")
            print("    请执行: sha256sum hacds_exchange/score_sum_opt.hcf1 并写入")
            ok = False
        elif not os.path.exists(kpath):
            print("  ✗ 找不到 %s" % kpath)
            ok = False
        else:
            import hashlib
            got = hashlib.sha256(open(kpath, "rb").read()).hexdigest()
            if got != exp:
                print("  ✗ 内核哈希不符！")
                print("    期望 %s" % exp)
                print("    实际 %s" % got)
                ok = False
            else:
                print("  ✓ 内核哈希与 SHA256SUMS 一致 (%s…)" % exp[:16])
                print("  ⚠ 仍需人工确认已跑过 _test/diff_test.py（内核 vs 参考实现）")

        # A-3：交易大小硬上限。合约无管理员、不可升级，超限部署会直接失败。
        if len(a) > MAX_TX_BYTES:
            print(f"  ✗ 部署动作 {len(a):,} B 超过交易上限 {MAX_TX_BYTES:,} B"
                  f"（超 {len(a) - MAX_TX_BYTES:,} B）")
            ok = False
        else:
            print(f"  ✓ 部署动作 {len(a):,} B ≤ 上限 {MAX_TX_BYTES:,} B"
                  f"（余量 {MAX_TX_BYTES - len(a):,} B）")

        if not os.path.exists(MAP):
            print(f"  ✗ 缺少 contractmap：{MAP}")
            ok = False

        # A-1/A-2/A-5：产物与源码的完整性——不能再只靠内核哈希。
        ok = check_artifact_manifest(ok)
        ok = check_artifacts(ok)

        print()
        print("自检通过" if ok else "自检失败")
        return 0 if ok else 1
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

    # A-3：非 manifest 分支同样要有上限断言
    if len(a) > MAX_TX_BYTES:
        print(f"  ✗ 部署动作 {len(a):,} B 超过交易上限 {MAX_TX_BYTES:,} B")
        ok = False
    else:
        print(f"  ✓ 部署动作 {len(a):,} B ≤ 上限 {MAX_TX_BYTES:,} B"
              f"（余量 {MAX_TX_BYTES - len(a):,} B）")

    # A-4：统一除数（原 :181 用 1e18，与 :117 的 1e16 差 100 倍）
    cost = int(d["protocol_cost_u232"])
    print(f"  · 部署协议费 {cost / COST_UNIT_DIVISOR:.6f} HAC")

    # A-5：产物完整性
    ok = check_artifact_manifest(ok)
    ok = check_artifacts(ok)

    print()
    print("自检通过" if ok else "自检失败")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
