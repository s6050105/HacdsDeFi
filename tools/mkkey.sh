#!/usr/bin/env bash
# =============================================================================
# mkkey.sh —— 在 Windows 上安全录入私钥，写出文件并收紧到「仅属主」访问
#             （NTFS ACL 层面等价于 chmod 0600：只有当前用户可以读写）。
#
# 运行环境：Git-Bash（本机 shell）。依赖 Windows 自带 icacls。
#
# 用法：
#   bash mkkey.sh                       # 交互输入（不回显），默认写到 ~/hacash_keys/deployer.key
#   bash mkkey.sh -o D:/keys/x.key      # 指定输出文件
#   echo -n "<64hex>" | bash mkkey.sh   # 从 stdin 读（脚本化；注意别留进 shell 历史）
#   bash mkkey.sh --verify D:/keys/x.key    # 只检查已有文件的 ACL
#   bash mkkey.sh --check               # 检查本工具自身（自检）
#
# 私钥格式：64 位十六进制（32 字节），可带 0x 前缀；大小写皆可。
#   —— 与预言机 `hacds_oracle.py genkey` 输出一致。
#
# 安全约定：
#   * 私钥绝不出现在命令行参数 / shell 历史里（交互输入用 read -s）。
#   * 写文件期间 umask 077，写完立刻用 icacls 关继承、只留属主 (R,W)。
#   * 不打印私钥内容；只报告长度与文件路径。
# =============================================================================
set -euo pipefail

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; RST=$'\033[0m'
say()  { printf '%s\n' "$*" >&2; }
ok()   { printf '%s%s%s\n' "$GRN" "$*" "$RST" >&2; }
warn() { printf '%s%s%s\n' "$YEL" "$*" "$RST" >&2; }
die()  { printf '%s%s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

# ---- Windows 当前用户名（icacls 用）----
WINUSER="${USERNAME:-$(whoami | sed 's/.*\\//')}"

winpath() { cygpath -w "$1" 2>/dev/null || printf '%s' "$1"; }

harden_dir() {   # 只属主可进（0700 等价）
  local d="$1"
  icacls "$(winpath "$d")" /inheritance:r /grant:r "${WINUSER}:(OI)(CI)F" >/dev/null 2>&1 || true
}
harden_file() {  # 只属主可读写（0600 等价）
  local f="$1"
  icacls "$(winpath "$f")" /inheritance:r /grant:r "${WINUSER}:(R,W)" >/dev/null 2>&1 || true
}

# 判断 ACL 是否已收紧：只看 ACE 主体（形如 "主体:(权限)"），
# 避免命中路径里的 "C:\Users\..." —— 驱动器冒号后跟 "\" 而非 "("，故不会误匹配。
acl_is_private() {
  local f="$1" out principals
  out="$(icacls "$(winpath "$f")" 2>/dev/null)"
  principals="$(printf '%s\n' "$out" | grep -oE '[^[:space:]]+:\(.*' | sed -E 's/:\(.*$//')"
  if printf '%s\n' "$principals" | grep -qiE '(^|\\)(Everyone|Users|INTERACTIVE)($)|Authenticated Users$'; then
    return 1
  fi
  return 0
}

show_acl() {
  local f="$1"
  say "  ACL:"
  icacls "$(winpath "$f")" 2>/dev/null | sed 's/^/    /' >&2 || true
}

verify_only() {
  local f="$1"
  [ -f "$f" ] || die "文件不存在: $f"
  say "检查文件: $f"
  show_acl "$f"
  if acl_is_private "$f"; then
    ok "  ✔ ACL 已收紧（未发现 Everyone/Users/Authenticated 等广域主体）"
  else
    warn "  ✘ 该文件仍可被其他主体读取，建议执行:"
    warn "      icacls \"$(winpath "$f")\" /inheritance:r /grant:r \"${WINUSER}:(R,W)\""
    return 1
  fi
}

selfcheck() {
  local d f
  d="$(mktemp -d)"; f="$d/k"
  printf 'x\n' > "$f"
  harden_file "$f"
  say "自检目录: $d"
  show_acl "$f"
  acl_is_private "$f" && ok "  ✔ 自检通过：收紧后仅属主可见" || die "自检失败"
  rm -rf "$d"
}

# ---------------- 参数解析 ----------------
OUT=""
DO_VERIFY=""
while [ $# -gt 0 ]; do
  case "$1" in
    -o|--out) OUT="${2:-}"; shift 2 ;;
    --verify) DO_VERIFY="${2:-}"; shift 2 ;;
    --check) selfcheck; exit 0 ;;
    -h|--help) sed -n '2,25p' "$0"; exit 0 ;;
    *) die "未知参数: $1（用 -h 看用法）" ;;
  esac
done
[ -n "$DO_VERIFY" ] && { verify_only "$DO_VERIFY"; exit $?; }

[ -z "$OUT" ] && OUT="$HOME/hacash_keys/deployer.key"

# ---------------- 读取私钥（不回显、不进历史）----------------
KEY=""
if [ -t 0 ]; then
  say "粘贴私钥（64 位 hex，可带 0x 前缀；输入不回显），回车结束："
  IFS= read -rs KEY || true
  printf '\n' >&2
else
  say "从 stdin 读取私钥…"
  IFS= read -r KEY || true
fi

# 去空白、去 0x 前缀、转小写
KEY="$(printf '%s' "$KEY" | tr -d '[:space:]' | sed 's/^0[xX]//')"
KEY="$(printf '%s' "$KEY" | tr 'A-F' 'a-f')"

[ -n "$KEY" ] || die "未读到内容。"
if ! printf '%s' "$KEY" | grep -Eq '^[0-9a-f]{64}$'; then
  die "格式不对：期望 64 位十六进制（32 字节），实际长度 ${#KEY}。"
fi
# 基本健康检查：不能是明显低熵值（全 0 / 全同字符）
case "$KEY" in
  0000000000000000000000000000000000000000000000000000000000000000)
    die "私钥为全 0，明显无效。" ;;
esac
if [ "$(printf '%s' "$KEY" | fold -w1 | sort -u | wc -l)" -le 2 ]; then
  warn "警告：私钥字符种类极少，可能是占位/测试值——请确认。"
fi

# ---------------- 写文件 + 收紧 ----------------
DIR="$(dirname "$OUT")"
umask 077
mkdir -p "$DIR"
harden_dir "$DIR"

if [ -e "$OUT" ]; then
  warn "文件已存在: $OUT"
  if [ -t 0 ]; then
    printf "覆盖？(y/N) " >&2; IFS= read -r ans
    case "$ans" in y|Y) ;; *) die "已取消，未改动。" ;; esac
  else
    die "文件已存在（非交互模式不覆盖）。"
  fi
fi

# 用临时文件+原子改名，避免半截文件
TMP="$OUT.tmp.$$"
( umask 077; printf '%s\n' "$KEY" > "$TMP" )
harden_file "$TMP"
mv -f "$TMP" "$OUT"
harden_file "$OUT"

# 立刻从内存变量抹掉
KEY=""

# ---------------- 结果 ----------------
say ""
ok "✔ 已写入: $OUT"
say "  长度: 64 hex（未显示内容）"
show_acl "$OUT"
if acl_is_private "$OUT"; then
  ok "  ✔ 访问已收紧：仅当前用户 ${WINUSER} 可读写（0600 等价）"
else
  warn "  ✘ 收紧未完全生效，请手动执行:"
  warn "      icacls \"$(winpath "$OUT")\" /inheritance:r /grant:r \"${WINUSER}:(R,W)\""
fi
say ""
say "提示：Windows 下管理员账户仍可通过『取得所有权』读取任何文件——"
say "      若威胁模型包含本机管理员，请改用 BitLocker 全盘加密或独占账户。"
