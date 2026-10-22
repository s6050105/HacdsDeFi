# -*- coding: utf-8 -*-
"""检查三语言 strings.xml 的键集合差异 + 检测「非中文语言里仍含中文」的异常值。"""
import re, os

RES = r'D:\hacds_server-main\android-app\app\src\main\res'
CJK = re.compile('[\u4e00-\u9fa5]')

def load(d):
    p = os.path.join(RES, d, 'strings.xml')
    s = open(p, encoding='utf-8').read()
    return dict(re.findall(r'<string name="([^"]+)">(.*?)</string>', s, re.S))

zh = load('values')
en = load('values-en')
tr = load('values-tr')

print('键数: zh=%d en=%d tr=%d' % (len(zh), len(en), len(tr)))
print('en 缺少:', sorted(set(zh) - set(en))[:40])
print('tr 缺少:', sorted(set(zh) - set(tr))[:40])
print('en 多出:', sorted(set(en) - set(zh))[:20])
print('tr 多出:', sorted(set(tr) - set(zh))[:20])

# 非中文语言里仍含中文的值（排除语言自称）
print('\n--- en 中含中文的值 ---')
for k, v in en.items():
    if CJK.search(v) and k not in ('x_langTitle',):
        print(' ', k, '=', v[:50])
print('--- tr 中含中文的值 ---')
for k, v in tr.items():
    if CJK.search(v) and k not in ('x_langTitle',):
        print(' ', k, '=', v[:50])
