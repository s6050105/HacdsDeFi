#!/usr/bin/env bash
# =============================================================================
# sync_to_release.sh —— 把 #4000 开发树同步到发布树
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
DST="${DST:-/d/hacds-v4000}"
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
# 值可以是**多个**目标，空格分隔 —— 同一份源文件落到发布树多个位置。
#
# 为什么 hacds.com/whitepaper 需要两个目标：
#   · hacds.com/whitepaper/ —— 官网自己就用这个路径（assets/js/config.js、
#     docview.js 直接引用），文档不能从官网源码树里消失，否则站内下载链接全 404。
#   · Whitepaper/           —— 发布树的顶层文档目录，README 与 Release 页面指向它。
#   只映射到其中一个，另一个就会一直是旧版。两份必须同源同版本。
#
# .py / index.html 不跟到 Whitepaper/（见 ALIAS_SKIP）：前者是渲染临时脚本，
# 后者是官网页面而非文档本体，发布树 Whitepaper/ 是给阅读者下载的纯文档目录。
declare -A MAP=(
  ["hacds.com/whitepaper"]="hacds.com/whitepaper Whitepaper"
  ["HacdsDeFi-README.md"]="README.md"
)

# 映射到下列目标目录时，跳过这些文件名（正则，匹配 basename）
ALIAS_SKIP="Whitepaper:(^index\.html$|\.py$)"

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
  #
  # ⚠ 2026-11-20：文档的唯一权威来源是 **hacds.com/whitepaper/**，不是 `白皮书/`。
  #   两个目录曾长期并存 —— `白皮书/` 是旧的副本（2026-10-24 那批），
  #   `hacds.com/whitepaper/` 是官网实际渲染的、随版本更新的那份。
  #   这次同步前核对发现：`白皮书/HacdsDeFi-白皮书.md` 是 23,837 B 的旧版
  #   （没有第五章、serial 还停在 3000），而官网那份已是 34,396 B 的新版。
  #   如果继续同步 `白皮书/`，推上去的就是过期文档。
  #
  #   现在改成从 hacds.com/whitepaper/ 取，映射到发布树的 Whitepaper/。
  "hacds.com/whitepaper"

  # 合约与设计文档
  # 合约 A（主协议）
  "hacds_exchange/HacdsDeFi3000.fitsh"
  # 合约 B（金库分红）—— 2026-11-20 补入。
  #   它是主网在运行的核心合约之一，源码与部署产物必须在公开仓库里，
  #   否则审计方无法验证「这份源码 == 链上那个字节码」，与合约 A 的待遇不一致。
  "hacds_exchange/vault.fitsh"
  "hacds_exchange/_build_vault/vault.deploy.json"
  "hacds_exchange/_build_vault/vault.contractmap.json"
  "hacds_exchange/编译说明-v3000.md"
  "hacds_exchange/HacdsDeFi3000-经济设计-定稿.md"
  "hacds_exchange/HacdsDeFi3000-经济设计-3lite.md"
  "hacds_exchange/HacdsDeFi3000-开发说明.md"
  "hacds_exchange/发行参数-正式.md"
  "hacds_exchange/DeFi设计文档-v4.md"
  "hacds_exchange/AMM种子流动性设计-v1.md"
  "hacds_exchange/借贷模块设计-v1.md"
  "hacds_exchange/fuzz_vectors.txt"
  "hacds_exchange/测试报告-v2.md"
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
  #
  # ⚠ 2026-11-20 补齐：此前只列了 10-25 / 10-27 / 11-12 三份，漏掉了
  #   11-15 第 5 轮独立审计及其修复闭环共 6 份。那批报告写在本项目树之外的
  #   D:\hacds_audit_reports\，编制完成后没有回流入库 —— 结果是发布树里
  #   审计链断在 11-12，看不到「11-15 判 No-Go → 逐条修复 → 重编译验证」
  #   这条最关键的闭环。审计方只能看到结论，看不到结论怎么来的。
  #   现已全部回流入 安全审计/，并按**时间顺序**列出：
  "安全审计/上线前安全审计报告-2026-10-25.md"        # 第 1 轮
  "安全审计/上线前安全审计报告-2026-10-27-终审.md"   # 第 2 轮（终审）
  "安全审计/上线前安全审计报告-2026-11-12.md"        # 第 4 轮
  "安全审计/上线前安全审计报告-2026-11-15.md"        # 第 5 轮（No-Go，3 Blocker）
  "安全审计/修复清单-2026-11-15.md"                  # 修复依据（15 条硬门禁）
  "安全审计/重编译验证-2026-11-15.md"                # B-1 重编译验证
  "安全审计/修复进度-2026-11-15.md"                  # 逐条修复闭环
  "安全审计/主网部署清单-2026-11-18.md"              # 主网部署执行清单
  "安全审计/发布前准备-2026-11-18.md"                # 发布前最终核对
  "安全审计/工作底稿"
  # 编译产物：审计方要能核对"这份源码编译出这个字节码"
  "hacds_exchange/_build_v30/HacdsDeFi3000.deploy.json"
  "hacds_exchange/_build_v30/HacdsDeFi3000.contractmap.json"
  # 部署产物的唯一权威清单（2026-11-15 审计 B-1）。
  # 记录 action 字节数 / 各文件 SHA256 / 编译器版本 —— 审计方靠它确认
  # 「这份源码编译出这个字节码」，缺了就无法复现验证。
  "hacds_exchange/_build_v30/manifest.json"
  "hacds_exchange/_build_v30/score_sum.calc.manifest.json"
  "hacds_exchange/_test/gen_manifest.py"
  "hacds_exchange/_test/verify_build.py"
  "hacds_exchange/score_sum_opt.hcf1"
  # 内核源码。⚠ 2026-11-20 补入：SHA256SUMS.txt 一直在校验它，但白名单漏了它，
  #   于是发布树里根本没有这个文件 —— 校验失败，审计方也无法从源码复现 hcf1。
  #   build-v3000.sh 用它编译内核，_test/diff_test.py 用它做对照测试，缺一不可。
  "hacds_exchange/score_sum.rs"
  "hacds_exchange/build-v3000.sh"
  "hacds_exchange/_test"
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

  # 部署产物：**只排除根目录那份**（历史遗留、17,259 B 超限、与源码不同源）。
  # _build_v30/ 下的产物是白名单里明确要同步的 —— 审计方需要能核对
  # 「这份源码编译出的就是这个字节码」，产物缺失反而无法验证。
  # ⚠ 用路径前缀而不是后缀匹配，否则白名单里的 _build_v30/*.deploy.json 会被吃掉。
  "/hacds_exchange/HacdsDeFi3000.deploy.json"
  "/hacds_exchange/HacdsDeFi3000.contractmap.json"

  # 合约源码的本地备份（*.bak / *.before_*）—— 不进公开仓库
  ".fitsh.bak" ".fitsh.before_"

  # 调试/一次性脚本（2026-11-20）：这些是开发期间用的临时工具，
  # 不进公开仓库 —— 它们依赖本机路径、没有文档价值，反而增加审计噪音。
  "/_probe_layout.js" "/_probe_web.js" "/_patch_hacd.js"
  "/preview_rename.py" "/preview2.py" "/apply_rename.py"

  # 备份 / 临时 / 调试残留
  "/_archive_" "/tmp_" "/_trash_" "/_bench/" "/_dist_stale_"
  "/tmp/"                     # android-app/tmp、wallet-app/tmp
  "/_pdf/"                    # 白皮书/_pdf：PDF 渲染中间产物（html + 副本），
                              # 正式 PDF 已在 白皮书/ 根下，不必重复公开
  "/.build/"                  # hacds.com/deploy-site/.build（构建产物）
  "/.wrangler/"               # wrangler 本地缓存/临时 worker
  "/local.properties"         # 本机 SDK 路径
  "/remain"                   # remain.txt / remain_all.txt（临时清单）
  "/verify.txt"
  "/_fix" "/_unify" "/_patch" # 一次性改名/补丁脚本
  "/md2html.py"               # 白皮书一次性转换脚本
  "/hacds_oracle.py"          # #4000 已删预言机，随包携带会误导

  # 2026-11-12 审计：运维脚本含基础设施细节（隧道令牌已移除，但仍不应公开）
  "/install-services.ps1"

  # 2026-11-12 审计：安装包不进源码树（Release 另行发布）。
  # ⚠ 不能全局排除 ".exe" —— wallet-app/bin/hacds_txbuild.exe 是**必须随包**
  #   的交易引擎。安装包都在 */dist/ 下（已在上面按目录排除），这里只补漏。
  ".apk" ".aab" ".blockmap" "/builder-debug.yml"

  ".DS_Store" ".pyc" ".log"
)

should_exclude() {
  # ⚠ 2026-11-15 审计 M-10：原实现 `case "$rel" in *"$pat"*` 是无差别子串匹配，
  #   语义含混：排除项里有目录名、有路径前缀、有扩展名，全靠"碰巧不撞车"。
  #
  #   现在按 EXCLUDES 的**写法**分三类，各用各的匹配方式：
  #
  #     /xxx/   带尾斜杠  → 目录段，匹配任意层级（node_modules、build、dist…）
  #     /xxx    无尾斜杠  → 路径段前缀，匹配任意层级的"以该名字开头"的段
  #                        （/_dist_stale_ → /_dist_stale_20261027/、
  #                          /tmp_        → /tmp_analysis/、
  #                          /local.properties → 精确结尾）
  #     .xxx    扩展名    → 只比文件名后缀
  #
  #   这样每一种排除项的含义都是明确的，不再依赖子串巧合。
  local rel="/$1" pat base
  base="${rel##*/}"
  for pat in "${EXCLUDES[@]}"; do
    case "$pat" in
      /*/)
        case "$rel" in *"$pat"*) return 0 ;; esac
        ;;
      /*)
        # 完整段（/dist/ 已由上面处理）或段前缀
        case "$rel" in *"$pat"/*) return 0 ;; esac
        # 结尾精确匹配（/local.properties、/verify.txt）
        case "$rel" in *"$pat") return 0 ;; esac
        # 段前缀匹配：/tmp_ 命中 /tmp_analysis/，/_dist_stale_ 命中 /_dist_stale_2026/
        case "$rel" in *"$pat"*) return 0 ;; esac
        ;;
      .*)
        case "$base" in *"$pat") return 0 ;; esac
        ;;
      *)
        case "$rel" in *"$pat"*) return 0 ;; esac
        ;;
    esac
  done
  return 1
}


# ---------------------------------------------------------------------------
# 收集文件并映射目标路径
# ---------------------------------------------------------------------------
declare -a SRC_FILES=()
declare -A _SEEN=()   # 去重：hacds.com 整目录与 hacds.com/whitepaper 会重叠

for w in "${WHITELIST[@]}"; do
  [ -e "$SRC/$w" ] || { warn "白名单项不存在，跳过：$w"; continue; }
  if [ -d "$SRC/$w" ]; then
    while IFS= read -r f; do
      [ -n "${_SEEN["$w/$f"]+x}" ] && continue
      _SEEN["$w/$f"]=1
      SRC_FILES+=("$w/$f")
    done < <(cd "$SRC/$w" && find . -type f | sed 's|^\./||')
  else
    [ -n "${_SEEN["$w"]+x}" ] && continue
    _SEEN["$w"]=1
    SRC_FILES+=("$w")
  fi
done

# 输出该源文件应落到的**所有**目标路径（每行一个）。
#
# ⚠ 2026-11-20 修正两处历史缺陷：
#  1) 原实现用 ${p%%/*} 只取**第一段**查 MAP，于是 ["hacds.com/whitepaper"]
#     这种两段式键永远匹配不到 —— 映射静默失效，Whitepaper/ 一直停在旧文档。
#     现在改为**最长前缀匹配**，MAP 键可以是任意深度。
#  2) 原实现一个源文件只能有一个目标，无法表达「官网目录 + 顶层文档目录」。
#     现在值可含多个目标，逐个展开。
map_path() {
  local p="$1" k best="" rest tgt base
  for k in "${!MAP[@]}"; do
    if [ "$p" = "$k" ]; then
      best="$k"; break
    fi
    case "$p" in
      "$k"/*) [ ${#k} -gt ${#best} ] && best="$k" ;;
    esac
  done
  if [ -z "$best" ]; then
    echo "$p"
    return 0
  fi
  rest="${p#"$best"}"
  rest="${rest#/}"
  base="${rest##*/}"
  for tgt in ${MAP[$best]}; do
    # 该目标是否要跳过这个文件名
    local skip_re="" e
    for e in $ALIAS_SKIP; do
      case "$e" in
        "${tgt}:"*) skip_re="${e#"${tgt}:"}" ;;
      esac
    done
    if [ -n "$skip_re" ] && [ -n "$base" ] && printf '%s' "$base" | grep -Eq "$skip_re"; then
      continue
    fi
    if [ -z "$rest" ]; then echo "$tgt"; else echo "$tgt/$rest"; fi
  done
}

NEW=(); CHANGED=(); SAME=(); SKIPPED=()
declare -a PAIRS=()   # "src|dst"，已排除、已展开多目标后的最终清单

for rel in "${SRC_FILES[@]}"; do
  if should_exclude "$rel"; then SKIPPED+=("$rel"); continue; fi
  while IFS= read -r dstrel; do
    [ -z "$dstrel" ] && continue
    PAIRS+=("$rel|$dstrel")
    if [ ! -f "$DST/$dstrel" ]; then
      NEW+=("$rel -> $dstrel")
    elif ! cmp -s "$SRC/$rel" "$DST/$dstrel"; then
      CHANGED+=("$rel -> $dstrel")
    else
      SAME+=("$rel -> $dstrel")
    fi
  done < <(map_path "$rel")
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
for pair in "${PAIRS[@]}"; do
  rel="${pair%%|*}"
  dstrel="${pair#*|}"
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
