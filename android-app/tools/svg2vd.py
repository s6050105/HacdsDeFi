#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
把单/多路径 SVG 转成 Android VectorDrawable XML。

仅支持本项目用到的形态：<path d="..." fill-rule="evenodd" class="s0"/> + <style>.s0{fill:#xxx}
用法： python -I svg2vd.py <in.svg> <out.xml> <drawableName>
"""
import re, sys, os

src, out, name = sys.argv[1], sys.argv[2], sys.argv[3]
s = open(src, encoding="utf-8").read()

viewbox = re.search(r'viewBox="([^"]+)"', s)
vb = viewbox.group(1).split() if viewbox else ["0", "0", "1200", "1200"]
w, h = vb[2], vb[3]

# 取颜色（<style> 里的 .s0 { fill: #xxx }）
colors = dict(re.findall(r"\.(s\d+)\s*\{\s*fill:\s*(#[0-9a-fA-F]{3,8})", s))
default_fill = "#000000"
# SVG path -> VectorDrawable path 属性
paths = []
for m in re.finditer(r"<path\b([^>]*)/>", s):
    attrs = m.group(1)
    d = re.search(r'\bd="([^"]+)"', attrs)
    if not d:
        continue
    d = d.group(1)
    cls = re.search(r'class="(s\d+)"', attrs)
    fill = colors.get(cls.group(1)) if cls else None
    if not fill:
        fill = re.search(r'fill="(#[0-9a-fA-F]{3,8})"', attrs)
        fill = fill.group(1) if fill else default_fill
    evenodd = 'fill-rule="evenodd"' in attrs
    paths.append((d, fill, evenodd))

if not paths:
    print("no path found in", src); sys.exit(1)

lines = ['<?xml version="1.0" encoding="utf-8"?>',
         '<vector xmlns:android="http://schemas.android.com/apk/res/android"',
         f'    android:width="48dp"',
         f'    android:height="48dp"',
         f'    android:viewportWidth="{w}"',
         f'    android:viewportHeight="{h}">']
for d, fill, evenodd in paths:
    ft = ' android:fillType="evenOdd"' if evenodd else ''
    lines.append(f'    <path android:fillColor="{fill}"{ft}')
    lines.append(f'        android:pathData="{d}" />')
lines.append('</vector>')

os.makedirs(os.path.dirname(out), exist_ok=True)
open(out, "w", encoding="utf-8").write("\n".join(lines) + "\n")
print(f"{name}: {len(paths)} path(s), {w}x{h} -> {out}")
