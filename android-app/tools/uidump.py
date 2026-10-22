import re

SRC = r'D:\hacds_server-main\tmp_analysis\u.xml'
OUT = r'D:\hacds_server-main\tmp_analysis\ui.txt'

s = open(SRC, encoding='utf-8', errors='replace').read()
lines = []
for m in re.finditer(r'<node[^>]*>', s):
    t = re.search(r'text="([^"]*)"', m.group(0))
    b = re.search(r'bounds="([^"]*)"', m.group(0))
    c = re.search(r'class="([^"]*)"', m.group(0))
    if b and b.group(1) != '[0,0][0,0]':
        txt = t.group(1) if (t and t.group(1)) else '<' + (c.group(1).split('.')[-1] if c else '?') + '>'
        lines.append(txt[:50] + '  ' + b.group(1))
open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
print('wrote', len(lines), 'nodes')
