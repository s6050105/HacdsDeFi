#!/usr/bin/env bash
# =============================================================================
# build.sh —— 把 hacds.com/ 摊成可部署的静态站
#
# 为什么要摊：
#   hacds.com/ 里有不该公开的东西（worker/index.js 是反代服务源码、
#   README.md、部署指南.md）。直接在这个目录 deploy 会把它们一起传上去。
#   实测过一次：/worker/index.js 返回 200。
#
# 用法：
#   bash deploy-site/build.sh          # 只摊，不部署
#   bash deploy-site/build.sh --deploy # 摊完直接部署
# =============================================================================
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$(cd "$HERE/.." && pwd)"
OUT="$HERE/.build"

echo "源目录: $SRC"
echo "输出:   $OUT/public"

rm -rf "$OUT"
mkdir -p "$OUT/public"

# 只拷要公开的文件（白名单，不用通配）
FILES=(
  index.html
  app/index.html
  docs/index.html
  whitepaper/index.html
  docs/user-guide/index.html
  docs/rpc/index.html
  # 三份文档 × 三语（md 供在线阅读，pdf 供下载）
  whitepaper/HacdsDeFi-白皮书.md
  whitepaper/HacdsDeFi-白皮书.pdf
  whitepaper/HacdsDeFi-Whitepaper.en.md
  whitepaper/HacdsDeFi-Whitepaper.en.pdf
  whitepaper/HacdsDeFi-Whitepaper.tr.md
  whitepaper/HacdsDeFi-Whitepaper.tr.pdf
  whitepaper/HacdsDeFi-操作说明书.md
  whitepaper/HacdsDeFi-操作说明书.pdf
  whitepaper/HacdsDeFi-User-Guide.en.md
  whitepaper/HacdsDeFi-User-Guide.en.pdf
  whitepaper/HacdsDeFi-User-Guide.tr.md
  whitepaper/HacdsDeFi-User-Guide.tr.pdf
  whitepaper/HacdsDeFi-RPC文档.md
  whitepaper/HacdsDeFi-RPC文档.pdf
  whitepaper/HacdsDeFi-RPC-Doc.en.md
  whitepaper/HacdsDeFi-RPC-Doc.en.pdf
  whitepaper/HacdsDeFi-RPC-Doc.tr.md
  whitepaper/HacdsDeFi-RPC-Doc.tr.pdf
  assets/css/main.css
  assets/css/app.css
  assets/css/docs.css
  # 与 PC 钱包共用的设计变量（app/index.html 引用）
  assets/css/design-tokens.css
  assets/js/api.js
  assets/js/app.js
  assets/js/config.js
  assets/js/docs.js
  assets/js/home.js
  assets/js/i18n.js
  assets/js/markdown.js
  assets/js/txbuild.js
  assets/js/wallet.js
  # 通用文档查看器（白皮书 / 使用说明 / RPC 三页共用）
  assets/js/docview.js
  # HACD 卡片渲染 / 评分 / 基因解析（app/index.html 引用，缺一个就白屏）
  assets/js/hacd-ui.js
  assets/js/diamond-score.js
  assets/js/diamondgene.js
  assets/js/diamondsvgimg.js
  assets/img/hac.svg
  assets/img/hacd.svg
  assets/img/hacds_icon_32.png
  assets/img/hacds_icon_64.png
)

missing=0
for f in "${FILES[@]}"; do
  if [ -f "$SRC/$f" ]; then
    mkdir -p "$OUT/public/$(dirname "$f")"
    cp -p "$SRC/$f" "$OUT/public/$f"
  else
    echo "⚠ 缺失: $f"
    missing=$((missing+1))
  fi
done

# 安全头（Worker 也补，这里兜底，二者不冲突）
cat > "$OUT/public/_headers" <<'EOF'
/*
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  X-Frame-Options: SAMEORIGIN
  Permissions-Policy: geolocation=(), microphone=(), camera=(), payment=()
  Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' https://api.hacds.com http://127.0.0.1:8082; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests

/assets/*
  Cache-Control: public, max-age=3600

/whitepaper/*
  Cache-Control: public, max-age=600
EOF

cp -p "$HERE/worker.js"   "$OUT/worker.js"

# wrangler.jsonc 要针对 .build 目录重新生成 —— 源目录那份的
# assets.directory 是 "../public"（相对 deploy-site/），
# 拷到 .build/ 后就会指向不存在的路径。
cat > "$OUT/wrangler.jsonc" <<'EOF'
{
  "name": "hacds",
  "main": "worker.js",
  "compatibility_date": "2026-10-23",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS",
    "run_worker_first": true
  }
}
EOF

n=$(find "$OUT/public" -type f | wc -l | tr -d ' ')
echo "已摊 $n 个文件（缺失 $missing）"

# 自检：不该出现的文件
for bad in worker README.md 部署指南.md 前端约定.md wrangler.jsonc .assetsignore worker.js; do
  if [ -e "$OUT/public/$bad" ]; then
    echo "✘ 严重：$bad 出现在 public/ 里" >&2
    exit 1
  fi
done
echo "✔ 自检通过：worker/ 与文档未进入 public/"

if [ "${1:-}" = "--deploy" ]; then
  : "${CLOUDFLARE_ACCOUNT_ID:?请设置 CLOUDFLARE_ACCOUNT_ID}"
  npx --yes wrangler@4 deploy --cwd "$OUT"
fi
