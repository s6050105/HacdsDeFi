#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
从 PC 版 renderer/i18n.js 生成 Android 字符串资源（values-*/strings.xml）。

- 键 'a.b.c' → 资源名 a_b_c
- 文案里的 {n} / {h} 等占位 → %1$s（Android 参数化）
- XML 转义 & < > ' "
用法： python -I gen_i18n.py <wallet-app/renderer/i18n.js> <android-app/app/src/main/res>
"""
import json, os, re, subprocess, sys, xml.sax.saxutils as sx

SRC = sys.argv[1]
RES = sys.argv[2]

# MSYS 的 /d/xx 路径在 subprocess 下不会自动转成 D:\xx，先归一化
def winpath(p: str) -> str:
    m = re.match(r"^/([a-zA-Z])/(.*)$", p)
    return f"{m.group(1).upper()}:\\{m.group(2).replace('/', chr(92))}" if m else p

# 用 node 把 DICT 导出为 JSON（i18n.js 是浏览器 IIFE）
here = winpath(os.path.dirname(os.path.abspath(__file__)))
dump_js = os.path.join(here, "dump_i18n.js")
dump = subprocess.run(
    ["node", dump_js, winpath(SRC)],
    capture_output=True, check=True,
    encoding="utf-8", errors="replace",
)
DICT = json.loads(dump.stdout)

LANG_DIR = {"zh-CN": "values", "en": "values-en", "tr": "values-tr"}

PLACEHOLDER = re.compile(r"\{[^}]+\}")

def resname(k: str) -> str:
    return re.sub(r"[^0-9a-zA-Z_]", "_", k)

def to_android(v: str) -> str:
    # {n} → %1$s；注意 XML 转义顺序：先做占位替换，再转义
    v = PLACEHOLDER.sub("%1$s", v)
    v = sx.escape(v)                 # & < >
    v = v.replace("'", "\\'")        # Android 字符串里的单引号需转义
    v = v.replace('"', '\\"')
    return v

os.makedirs(RES, exist_ok=True)
for lang, sub in LANG_DIR.items():
    d = DICT[lang]
    out = os.path.join(RES, sub)
    os.makedirs(out, exist_ok=True)
    lines = ['<?xml version="1.0" encoding="utf-8"?>', "<resources>"]
    for k in sorted(d):
        lines.append(f'    <string name="{resname(k)}">{to_android(d[k])}</string>')
    lines.append("</resources>")
    with open(os.path.join(out, "strings.xml"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"{sub}: {len(d)} strings")
print("keys total:", len(DICT["zh-CN"]))
