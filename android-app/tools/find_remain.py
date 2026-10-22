import re, os

KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'
OUT = r'D:\hacds_server-main\android-app\remain.txt'
files = ['ui/screens/OpScreens.kt', 'ui/screens/ExtraScreens.kt', 'ui/screens/WalletScreen.kt',
         'ui/screens/HacdScreen.kt', 'ui/screens/LiquidationScreen.kt', 'ui/screens/HomeScreen.kt',
         'ui/AppRoot.kt']

CJK = re.compile('[\u4e00-\u9fa5]')
lines = []
for rel in files:
    p = os.path.join(KT, rel.replace('/', os.sep))
    s = open(p, encoding='utf-8').read()
    # 简单的字符串字面量扫描（不处理转义，够用）
    for m in re.finditer(r'"([^"\n]*)"', s):
        if CJK.search(m.group(1)):
            ln = s[:m.start()].count('\n') + 1
            lines.append('%s:%d\t%s' % (rel, ln, m.group(1)[:70]))
open(OUT, 'w', encoding='utf-8').write('\n'.join(lines))
print('剩余硬编码中文串:', len(lines))
