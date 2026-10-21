#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
score_census.py — 统计当前流通 HACD 的评分总量与均值（用于 hacds 发行总量测算）。

数据源：浏览器后端 GET /api/diamond/views?page=N&limit=200
  rows = [name, number, life_gene(32B hex), protocol_cost]
评分：直接复用本目录 hacds_oracle.py 的 analyse（DA v0.1.1 语义，与链上重算一致）。

用法：
  python score_census.py --out /tmp/diamond_pages.json
"""
import argparse
import json
import os
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import hacds_oracle as H  # noqa: E402

API = "https://explorer.hacash.org/api/diamond/views"
UA = {"User-Agent": "hacds-score-census/1.0"}


def fetch_page(page: int, limit: int = 200, timeout: int = 20, retries: int = 4):
    url = "%s?page=%d&limit=%d" % (API, page, limit)
    last = None
    for _ in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001
            last = e
            time.sleep(1.0)
    raise RuntimeError("fetch page %d failed: %s" % (page, last))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/tmp/diamond_pages.json")
    ap.add_argument("--limit", type=int, default=200)
    args = ap.parse_args()

    # 断点续抓：已存在的分页缓存直接复用
    cache = {}
    if os.path.exists(args.out):
        with open(args.out) as f:
            cache = json.load(f)

    page = 1
    while True:
        key = str(page)
        if key in cache:
            rows = cache[key]
        else:
            data = fetch_page(page, args.limit)
            rows = data.get("rows", [])
            cache[key] = rows
            if page % 50 == 0 or len(rows) < args.limit:
                with open(args.out, "w") as f:
                    json.dump(cache, f)
                print("  fetched page %d (total rows so far %d)" % (page, sum(len(v) for v in cache.values())),
                      flush=True)
            time.sleep(0.05)
        if len(rows) < args.limit:
            break
        page += 1

    with open(args.out, "w") as f:
        json.dump(cache, f)

    # 逐颗算分
    total = 0
    n = 0
    seen_num = set()
    for p in sorted(cache, key=int):
        for row in cache[p]:
            name, number, life_gene = row[0], int(row[1]), row[2]
            if number in seen_num:
                continue
            seen_num.add(number)
            lgb = bytes.fromhex(life_gene)
            vg = H.visual_gene_hex(name, lgb)
            sc = H.analyse(name, number, vg)["score"]
            total += sc
            n += 1

    avg_num = total / n
    avg = total // n          # 取整均值（下取整）
    print("\n=== 流通 HACD 评分普查 ===")
    print("颗数 n            = %d" % n)
    print("总评分 Σ          = %d" % total)
    print("平均评分 (精确)   = %.6f" % avg_num)
    print("平均评分 (下取整) = %d" % avg)
    print("最小/最大 number  = %d / %d" % (min(seen_num), max(seen_num)))

    # 发行总量候选
    HACD_MAX = 16_777_216
    def show(label, atoms):
        print("  %-42s %d atoms  (= %.4f 万 hacds 单位)" % (label, atoms, atoms / 1e8 / 1e4))
    print("\n=== hacds 发行总量候选（decimal=8，1 单位 = 10^8 atoms = 1 原始分）===")
    show("A) 取整均值 %d × 流通量 %d" % (avg, n), avg * n * 10**8)
    show("A') 精确均值 × 流通量（= Σscore）", total * 10**8)
    show("B) 取整均值 %d × HACD 总量 %d" % (avg, HACD_MAX), avg * HACD_MAX * 10**8)
    show("B') 精确均值 × HACD 总量", int(avg_num * HACD_MAX) * 10**8)


if __name__ == "__main__":
    main()
