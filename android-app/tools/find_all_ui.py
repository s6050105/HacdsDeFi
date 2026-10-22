import re, os

KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'
OUT = r'D:\hacds_server-main\android-app\remain_all.txt'
CJK = re.compile('[\u4e00-\u9fa5]')
PATS = [
    re.compile(r'\bText\(\s*"([^"\n]*)"'),
    re.compile(r'\bSection\(\s*"([^"\n]*)"'),
    re.compile(r'\bNotice\(\s*"([^"\n]*)"'),
    re.compile(r'\bKV\(\s*"([^"\n]*)"'),
    re.compile(r'\blabel\s*=\s*\{\s*Text\(\s*"([^"\n]*)"'),
]
lines = []
for root, _, files in os.walk(KT):
    for fn in files:
        if not fn.endswith('.kt'):
            continue
        p = os.path.join(root, fn)
        rel = os.path.relpath(p, KT).replace('\\', '/')
        s = open(p, encoding='utf-8').read()
        for pat in PATS:
            for m in pat.finditer(s):
                if CJK.search(m.group(1)):
                    ln = s[:m.start()].count('\n') + 1
                    lines.append('%s:%d\t%s' % (rel, ln, m.group(1)[:60]))
open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
print('remaining UI-position Chinese:', len(lines))
