#!/usr/bin/env bash
# =============================================================================
# sync_to_release.sh —— 把 #3000 开发树同步到发布树
#
# 设计原则
# --------
# 1. **白名单**：只同步明确列出的路径，不做通配全量拷贝。
#    公开审计要能逐项确认「这份代码 == 要部署的代码」。
# 2. **路径映射**：开发树的目录名与发布树不同（见 MAP_* 常量），显式处理。
# 3. **不清空**：绝不 rm -rf 发布树，只覆盖白名单内的文件。
# 4. **可预演**：默认 dry-run，必须显式 --apply 才动文件。
# 5. **同步后自检**：扫描私钥/临时文件泄漏。
#
# 用法
# ----
#   bash sync_to_release.sh            # 预演（默认）
#   bash sync_to_release.sh --apply    # 真正同步
#   bash sync_to_release.sh --verify   # 只比对差异
# =============================================================================
set -euo pipefail

SRC="${SRC:-/d/hacds_server-main}"
DST="${DST:-/d/hacds-v3000}"
MODE="${1:---dry-run}"

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
say()  { printf '%s\n' "$*"; }
ok()   { printf '%s✔ %s%s\n' "$GRN" "$*" "$RST"; }
warn() { printf '%s⚠ %s%s\n' "$YEL" "$*" "$RST"; }
die()  { printf '%s✘ %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

[ -d "$SRC" ] || die "源目录不存在：$SRC"
[ -d "$DST" ] || die "目标目录不存在：$DST"
[ -d "$DST/.git" ] || die "目标不是 git 仓库：$DST"

# ---------------------------------------------------------------------------
# 路径映射：开发树路径 → 发布树路径（无映射的直接同名）
# ---------------------------------------------------------------------------
declare -A MAP=(
  ["白皮书"]="Whitepaper"
  ["HacdsDeFi-README.md"]="README.md"
)

# ---------------------------------------------------------------------------
# 白名单（开发树侧路径）
# ---------------------------------------------------------------------------
WHITELIST=(
  # 顶层
  "LICENSE"
  "HacdsDeFi-README.md"
  "README.en.md"
  "SHA256SUMS.txt"

  # 白皮书（三语 + RPC/用户手册）
  "白皮书"

  # 合约与设计文档
  "hacds_exchange/HacdsDeFi3000.fitsh"
  "hacds_exchange/HacdsDeFi3000-经济设计-定稿.md"
  "hacds_exchange/HacdsDeFi3000-经济设计-3lite.md"
  "hacds_exchange/HacdsDeFi3000-开发说明.md"
  "hacds_exchange/发行参数-正式.md"
  "hacds_exchange/DeFi设计文档-v4.md"
  "hacds_exchange/AMM种子流动性设计-v1.md"
  "hacds_exchange/借贷模块设计-v1.md"
  "hacds_exchange/fuzz_vectors.txt"
  "hacds_exchange/assets"

  # 服务端
  "hacds_exchange/indexer/hacds_indexer.py"
  "hacds_exchange/indexer/hacds_keeper.py"
  "hacds_exchange/indexer/hacds_build_server.py"
  "hacds_exchange/indexer/hacds_indexer.service"
  "hacds_exchange/indexer/部署说明-索引器.md"
  "hacds_exchange/indexer/部署说明-构建服务.md"

  # 钱包 / Android / 官网 / 工具
  "wallet-app"
  "android-app"
  "hacds.com"
  "hacds.com/部署指南.md"
  "tools"

  # 审计报告与底稿（公开审计输入）
  "安全审计/上线前安全审计报告-2026-10-25.md"
  "安全审计/上线前安全审计报告-2026-10-27-终审.md"
  "安全审计/工作底稿"
)

# ---------------------------------------------------------------------------
# 排除规则（相对路径命中即跳过）
# ---------------------------------------------------------------------------
EXCLUDES=(
  # 依赖与构建产物
  "/node_modules/" "/.git/" "/__pycache__/" "/.gradle/" "/build/" "/dist/"
  "/.idea/" "/.vscode/" "/.cxx/" "/intermediates/"

  # 密钥与签名
  ".jks" ".keystore" ".key" ".pem"

  # 部署产物（与源码不同步会误导审计）
  ".deploy.json" ".contractmap.json"

  # 备份 / 临时 / 调试残留
  "/_archive_" "/tmp_" "/_trash_" "/_bench/" "/_dist_stale_"
  "/tmp/"                     # android-app/tmp、wallet-app/tmp
  "/local.properties"         # 本机 SDK 路径
  "/remain"                   # remain.txt / remain_all.txt（临时清单）
  "/verify.txt"
  "/_fix" "/_unify" "/_patch" # 一次性改名/补丁脚本
  "/md2html.py"               # 白皮书一次性转换脚本
  "/hacds_oracle.py"          # #3000 已删预言机，随包携带会误导

  ".DS_Store" ".pyc" ".log"
)

should_exclude() {
  local rel="/$1" pat
  for pat in "${EXCLUDES[@]}"; do
    case "$rel" in *"$pat"*) return 0 ;; esac
  done
  return 1
}

# ---------------------------------------------------------------------------
# 收集文件并映射目标路径
# ---------------------------------------------------------------------------
declare -a SRC_FILES=() DST_FILES=()

for w in "${WHITELIST[@]}"; do
  [ -e "$SRC/$w" ] || { warn "白名单项不存在，跳过：$w"; continue; }
  if [ -d "$SRC/$w" ]; then
    while IFS= read -r f; do
      SRC_FILES+=("$w/$f")
    done < <(cd "$SRC/$w" && find . -type f | sed 's|^\./||')
  else
    SRC_FILES+=("$w")
  fi
done

map_path() {
  local p="$1" first rest
  first="${p%%/*}"
  if [ -n "${MAP[$first]:-}" ]; then
    rest="${p#*/}"
    if [ "$rest" = "$p" ]; then echo "${MAP[$first]}"; else echo "${MAP[$first]}/$rest"; fi
  else
    echo "$p"
  fi
}

NEW=(); CHANGED=(); SAME=(); SKIPPED=()

for rel in "${SRC_FILES[@]}"; do
  if should_exclude "$rel"; then SKIPPED+=("$rel"); continue; fi
  dstrel="$(map_path "$rel")"
  DST_FILES+=("$dstrel")
  if [ ! -f "$DST/$dstrel" ]; then
    NEW+=("$rel -> $dstrel")
  elif ! cmp -s "$SRC/$rel" "$DST/$dstrel"; then
    CHANGED+=("$rel -> $dstrel")
  else
    SAME+=("$rel")
  fi
done

say "候选 ${#SRC_FILES[@]} 个文件"
say "  新增 : ${#NEW[@]}"
say "  修改 : ${#CHANGED[@]}"
say "  相同 : ${#SAME[@]}"
say "  排除 : ${#SKIPPED[@]}"
say ""

[ ${#NEW[@]} -gt 0 ] && { say "--- 新增（前 40）---"; printf '  + %s\n' "${NEW[@]:0:40}"; }
[ ${#CHANGED[@]} -gt 0 ] && { say "--- 修改（前 40）---"; printf '  ~ %s\n' "${CHANGED[@]:0:40}"; }
[ ${#SKIPPED[@]} -gt 0 ] && { say "--- 排除（前 20）---"; printf '  - %s\n' "${SKIPPED[@]:0:20}"; }

case "$MODE" in
  --verify) say ""; ok "仅比对，未改动"; exit 0 ;;
  --dry-run) say ""; warn "预演模式。确认无误后加 --apply"; exit 0 ;;
  --apply) ;;
  *) die "未知参数：$MODE" ;;
esac

# ---------------------------------------------------------------------------
# 同步
# ---------------------------------------------------------------------------
say ""
say "开始同步…"
n=0
for rel in "${SRC_FILES[@]}"; do
  should_exclude "$rel" && continue
  dstrel="$(map_path "$rel")"
  mkdir -p "$DST/$(dirname "$dstrel")"
  cp -p "$SRC/$rel" "$DST/$dstrel"
  n=$((n+1))
done
ok "已拷贝 $n 个文件"

# ---------------------------------------------------------------------------
# 自检：不应入库的文件
# ---------------------------------------------------------------------------
say ""
say "=== 同步后自检 ==="
cd "$DST"
LEAK=0
while IFS= read -r f; do
  [ -z "$f" ] && continue
  warn "疑似不应入库：$f"
  LEAK=$((LEAK+1))
done < <(git status --porcelain --untracked-files=all 2>/dev/null | awk '{print $NF}' \
         | grep -Ei '\.(jks|keystore|key|pem)$|/(node_modules|_archive[^/]*|tmp_[^/]*|_trash[^/]*|_dist_stale[^/]*)/' || true)

if [ "$LEAK" -eq 0 ]; then ok "未发现私钥/临时文件泄漏"; else die "发现 $LEAK 个可疑文件"; fi

say ""
say "下一步："
say "  cd $DST && git status    # 人工核对"
say "  git add -A && git commit"
