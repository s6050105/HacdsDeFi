# -*- coding: utf-8 -*-
"""差分测试：rv64im 内核 score_sum vs FitSH 参考实现。

生成大量随机 + 边界用例，逐条比较。
"""
import io
import json
import os
import random
import subprocess
import sys

try:
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')
except Exception:
    pass

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import fitsh_score_ref as ref  # noqa: E402

FITSHC = os.environ.get("FITSHC", r"D:\hacash_v130_build\fitshc.exe")
KERNEL = os.path.join(os.path.dirname(HERE), "score_sum.rs")

LETTERS = "WTYUIAHXVMEKBSZN"


def build_wire(records):
    """records = [(name: bytes6, num: int, vg: bytes10)] → calc 输入字节。"""
    names = b"".join(r[0] for r in records)
    nums = b"".join(r[1].to_bytes(8, "big") for r in records)
    vgs = b"".join(r[2] for r in records)
    return names + nums + vgs


def run_kernel(inp):
    """调 fitshc run 执行内核，返回输出整数。"""
    out = subprocess.run(
        [FITSHC, "run", KERNEL, "--input", "0x" + inp.hex()],
        capture_output=True, text=True, encoding="utf-8", errors="replace")
    if out.returncode != 0:
        raise RuntimeError(out.stdout + out.stderr)
    for line in (out.stdout + out.stderr).splitlines():
        if line.startswith("output:"):
            return int(line.split("0x")[1].strip(), 16)
    raise RuntimeError("no output line:\n" + out.stdout + out.stderr)


def rand_name(rng):
    return "".join(rng.choice(LETTERS) for _ in range(6)).encode()


def rand_vg(rng):
    return bytes(rng.randrange(256) for _ in range(10))


def gen_cases(rng):
    cases = []

    # 1) 纯随机
    for _ in range(60):
        n = rng.randint(1, 8)
        cases.append([(rand_name(rng), rng.randrange(10**9), rand_vg(rng))
                      for _ in range(n)])

    # 2) 边界形状：形状 nibble 00..08，验证 shape_score 全分支
    for shapeb in range(0, 10):
        vg = bytes([0x00, shapeb]) + rand_vg(rng)[2:]
        cases.append([(rand_name(rng), rng.randrange(1000), vg)])

    # 3) style 分支：构造 c13..c16 各种关系
    pats = [
        (5, 5, 5, 5), (5, 5, 5, 7), (5, 7, 5, 5), (5, 5, 7, 5),
        (7, 5, 5, 5), (5, 5, 7, 7), (5, 7, 5, 7), (3, 4, 5, 6),
        (5, 5, 7, 8), (5, 7, 8, 8),
    ]
    for p in pats:
        raw = bytearray(rand_vg(rng))
        # vg_hex 索引 14..17 → 字节 7,7(b%16),8,8(b%16)
        nib = list(raw.hex())
        nib[14:18] = [f"{v:x}" for v in p]
        vg = bytes.fromhex("".join(nib))
        # 强制形状 00（Common）才能走 style
        vg = bytes([0x00]) + vg[1:]
        cases.append([(rand_name(rng), rng.randrange(1000), vg)])

    # 4) 名字边界：6 连、5 连、ABCABC、回文、两字母、三字母
    names = [b"WWWWWW", b"WWWWWX", b"WTYWTY", b"WTYYTW", b"WTWTWT",
             b"WWTYYW", b"WTYW TY".replace(b" ", b""), b"XXXYYY"]
    for nm in names:
        if len(nm) == 6:
            cases.append([(nm, rng.randrange(10**6), rand_vg(rng))])

    # 5) 编号边界：个位数、全同、顺子、回文、长连
    nums = [0, 1, 9, 10, 111111, 123456, 654321, 12321,
            1111, 11111, 1111111, 99999999, 12345678901234567]
    for nu in nums:
        cases.append([(rand_name(rng), nu, rand_vg(rng))])

    # 6) 颜色分支：名字首字母遍历（配合非 Common 形状）
    for c in LETTERS:
        vg = bytes([0x00, rng.randint(1, 8)]) + rand_vg(rng)[2:]
        cases.append([(c.encode() + b"WAAAA"[:5], rng.randrange(1000), vg)])

    # 7) 199 / 200 颗的最大批量
    for n in (199, 200):
        seen = set()
        recs = []
        while len(recs) < n:
            nm = rand_name(rng)
            if nm in seen:
                continue
            seen.add(nm)
            recs.append((nm, rng.randrange(10**9), rand_vg(rng)))
        cases.append(recs)

    return cases


def main():
    rng = random.Random(20261111)
    cases = gen_cases(rng)
    print(f"用例数: {len(cases)}")

    bad = 0
    for ci, recs in enumerate(cases):
        # 合约要求名字不重复；我们的生成已保证，这里再校验一次
        names = [r[0] for r in recs]
        if len(set(names)) != len(names):
            print(f"  [跳过 #{ci}] 名字重复")
            continue

        inp = build_wire(recs)
        if len(inp) % 24 != 0 or len(inp) > 4800:
            print(f"  [跳过 #{ci}] 长度非法 {len(inp)}")
            continue

        expect = sum(ref.diamond_score(nm, vg, nu) for nm, nu, vg in recs)
        got = run_kernel(inp)

        if got != expect:
            bad += 1
            print(f"  ✗ #{ci} n={len(recs)} 期望 {expect} 得到 {got}")
            for nm, nu, vg in recs[:3]:
                print(f"      {nm} num={nu} vg={vg.hex()} "
                      f"-> ref={ref.diamond_score(nm, vg, nu)}")
            if bad >= 5:
                print("失败过多，中止")
                break
        else:
            if ci % 20 == 0:
                print(f"  ✓ #{ci} n={len(recs)} sum={got}")

    if bad == 0:
        print("\n全部通过：内核与 FitSH 参考实现逐条一致")
        return 0
    print(f"\n失败 {bad} 条")
    return 1


if __name__ == "__main__":
    sys.exit(main())
