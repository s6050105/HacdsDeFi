#!/usr/bin/env bash
# 设备测试辅助：dump UI 文本（UTF-8 安全），避免每次手写 python 踩编码/引号的坑
# 用法：  ./dev.sh dump        # 打印当前屏所有可见文本+坐标
#         ./dev.sh tap X Y     # 点击
#         ./dev.sh text STR    # 输入
#         ./dev.sh key N       # 按键
#         ./dev.sh shot NAME   # 截图到 tmp_analysis/NAME.png
#         ./dev.sh log [PAT]   # 抓日志
export PATH="/d/Android/sdk/platform-tools:$PATH"
export MSYS2_ARG_CONV_EXCL="*"
OUT='D:\hacds_server-main\tmp_analysis'

case "$1" in
  dump)
    adb shell uiautomator dump /sdcard/u.xml >/dev/null 2>&1
    adb pull /sdcard/u.xml "$OUT\\u.xml" >/dev/null 2>&1
    python -I - "$OUT\\u.xml" <<'PY'
import re,sys
s=open(sys.argv[1],encoding='utf-8',errors='replace').read()
for m in re.finditer(r'<node[^>]*>', s):
    t=re.search(r'text="([^"]*)"', m.group(0)); b=re.search(r'bounds="([^"]*)"', m.group(0))
    c=re.search(r'class="([^"]*)"', m.group(0))
    if b and b.group(1)!='[0,0][0,0]':
        txt=t.group(1)[:52] if (t and t.group(1)) else '<'+((c.group(1) if c else '?').split('.')[-1])+'>'
        print(txt, b.group(1))
PY
    ;;
  tap) adb shell input tap "$2" "$3" ;;
  text) adb shell input text "$2" ;;
  key) adb shell input keyevent "$2" ;;
  shot)
    adb shell screencap -p /sdcard/shot.png >/dev/null 2>&1
    adb pull /sdcard/shot.png "$OUT\\$2.png" >/dev/null 2>&1
    echo "$OUT\\$2.png" ;;
  log) adb logcat -d 2>&1 | grep -iE "${2:-FATAL|Exception}" | head -20 ;;
  *) echo "usage: dev.sh dump|tap X Y|text S|key N|shot NAME|log PAT" ;;
esac
