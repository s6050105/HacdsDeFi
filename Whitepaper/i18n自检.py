# -*- coding: utf-8 -*-
"""钱包多语言键一致性自检。

用法：  python -I Whitepaper/i18n自检.py
         python -I Whitepaper/i18n自检.py --dir <wallet-app 目录>
退出码： 0 = 三语键集合完全一致；1 = 有缺键 / 多键

为什么需要它：本项目历史上反复出现「某语块缺键」或「词条插错语言块」的问题
（同一对象里重复键会静默覆盖，肉眼 grep 数不出所属语言块）。见设计文档 §4.20.1。
"""
import io
import os
import re
import sys
from collections import Counter

try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

_HERE = os.path.dirname(os.path.abspath(__file__))
_DEF = os.path.join(_HERE, '..', 'wallet-app')
if '--dir' in sys.argv:
    _DEF = sys.argv[sys.argv.index('--dir') + 1]

PATH = os.path.join(_DEF, 'renderer', 'i18n.js')
LANGS = ['zh-CN', 'en', 'tr']

if not os.path.isfile(PATH):
    print('✗ 找不到 %s' % PATH)
    sys.exit(1)

s = io.open(PATH, encoding='utf-8').read()

# 按语言块切分（下一块的起点作为本块的终点）
bounds = {}
for lang in LANGS:
    i = s.find("'%s': {" % lang)
    if i == -1:
        print('✗ 找不到语言块 %s' % lang)
        sys.exit(1)
    nxt = len(s)
    for l2 in LANGS:
        k = s.find("'%s': {" % l2, i + len(lang) + 5)
        if k != -1 and k < nxt:
            nxt = k
    bounds[lang] = s[i:nxt]

# 同时匹配单引号与双引号键名（土耳其语块里出现过双引号）
keys = {}
for lang in LANGS:
    ks = re.findall(r"""['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]\s*:""", bounds[lang])
    keys[lang] = ks

fail = False
for lang in LANGS:
    c = Counter(keys[lang])
    dup = [k for k, v in c.items() if v > 1]
    if dup:
        fail = True
        print('✗ %s 有重复键（会静默覆盖）：%s' % (lang, dup))
    print('  %-6s 键数 %d（唯一 %d）' % (lang, len(keys[lang]), len(set(keys[lang]))))

base = set(keys['zh-CN'])
for lang in LANGS[1:]:
    cur = set(keys[lang])
    miss = sorted(base - cur)
    extra = sorted(cur - base)
    if miss or extra:
        fail = True
        print('✗ %s 与 zh-CN 不一致：缺 %s，多 %s' % (lang, miss, extra))
    else:
        print('  %s 与 zh-CN 完全一致 ✓' % lang)

if fail:
    sys.exit(1)
print('✓ i18n 三语键集合一致（%d 键 × %d 语言）' % (len(base), len(LANGS)))
