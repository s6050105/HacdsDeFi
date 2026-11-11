#!/bin/sh
# 构建 #3000 合约（含 rv64im 评分内核 score_sum）。
#
# 用法：
#   sh build-v3000.sh                 # 产物写到 ./_build_v30
#   FITSHC=/path/to/fitshc sh build-v3000.sh
#   sh build-v3000.sh --periods 100   # 折扣部署（测试网用；主网建议全价）
#
# 输入（本目录）：
#   HacdsDeFi3000.fitsh    合约主体
#   score_sum_opt.hcf1     预编译的优化内核（2,026 B）—— **默认用这个**
#   score_sum.rs           内核源码（重新编译得 3,700 B，会超交易上限）
#
# ⚠ 为什么默认用预编译内核：
#   交易大小上限 max_tx_size = 16,384 字节（hacash-params/src/lib.rs:162，
#   编译期常量）。用 score_sum.rs 现编的内核 3,700 B 会让部署动作达到
#   17,872 B，直接超限。预编译的 score_sum_opt.hcf1 只有 2,026 B，
#   算法等价（已用 15+ 组测试向量验证），最终产物 16,198 B。
#
#   若要自己重编内核：sh build-v3000.sh --rebuild-kernel（可能超限）
#
# 输出（./_build_v30）：
#   score_sum.hcf1
#   score_sum.calc.manifest.json
#   HacdsDeFi3000.contractmap.json
#   HacdsDeFi3000.deploy.json
#
# ⚠ 必须用 v1.3.0+ 的 fitshc；v1.2.5 不认识 calc，也不认识 hacd_*_batch 视图。
set -e
cd "$(dirname "$0")"

FITSHC="${FITSHC:-/d/hacash_v130_build/fitshc.exe}"
[ -x "$FITSHC" ] || { echo "找不到 fitshc：$FITSHC（用 FITSHC=... 指定）" >&2; exit 1; }

mkdir -p _build_v30

if [ "${1:-}" = "--rebuild-kernel" ]; then
    shift
    echo "⚠ 从源码重编内核（3,700 B，部署动作可能超 16,384 上限）"
    "$FITSHC" build HacdsDeFi3000.fitsh \
        --calc score_sum="$PWD/score_sum.rs" \
        --out-dir "$PWD/_build_v30" "$@"
else
    KERNEL="$PWD/score_sum_opt.hcf1"
    [ -f "$KERNEL" ] || {
        echo "找不到预编译内核 $KERNEL" >&2
        echo "  用 sh build-v3000.sh --rebuild-kernel 从源码重编（可能超限）" >&2
        exit 1
    }
    "$FITSHC" build HacdsDeFi3000.fitsh \
        --calc score_sum="$KERNEL" \
        --out-dir "$PWD/_build_v30" --no-build "$@"
fi

# 自检：部署动作大小
python -X utf8 -I - "$PWD/_build_v30/HacdsDeFi3000.deploy.json" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
n = len(bytes.fromhex(d['action']))
LIMIT = 16 * 1024
print(f"部署动作 {n:,} B / 上限 {LIMIT:,} B")
if n > LIMIT:
    print(f"✗ 超限 {n - LIMIT:,} 字节 —— 不能上链", file=sys.stderr)
    sys.exit(1)
print(f"✓ 余 {LIMIT - n:,} 字节")
PY
