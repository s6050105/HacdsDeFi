import json
import re
import subprocess
import os

KtRoot = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'
dump_js = r'D:\hacds_server-main\android-app\tools\dump_i18n.js'
i18n_js = r'D:\hacds_server-main\wallet-app\renderer\i18n.js'

# 取 PC 三语言词表
r = subprocess.run(['node', dump_js, i18n_js], capture_output=True, encoding='utf-8')
DICT = json.loads(r.stdout)

# 反查表：中文原文 -> 词条 key（用于把硬编码中文换回 tr('key')）
zh2key = {}
for k, v in DICT['zh-CN'].items():
    v = v.strip()
    if v and v not in zh2key:
        zh2key[v] = k

# 需要替换的 UI 文案（人工挑选：仅界面可见的短文案，不含日志/注释/异常）
# 只替换「整个字符串字面量恰好等于某词条」的情况，避免误伤
TARGET_FILES = [
    'ui/AppRoot.kt',
    'ui/screens/OpScreens.kt',
    'ui/screens/HomeScreen.kt',
    'ui/screens/ExtraScreens.kt',
    'ui/screens/WalletScreen.kt',
    'ui/screens/HacdScreen.kt',
    'ui/screens/LiquidationScreen.kt',
]

# 只在这些「UI 位置」替换：Text("…")、Section("…")、Chip、label = { Text("…") }
PATTERNS = [
    (re.compile(r'(?<!tr\()Text\("([^"]+)"'), 'Text'),
    (re.compile(r'Section\("([^"]+)"'), 'Section'),
    (re.compile(r'FilterChip[^\n]*?label\s*=\s*\{\s*Text\("([^"]+)"'), 'Chip'),
]

total = 0
for rel in TARGET_FILES:
    p = os.path.join(KtRoot, rel.replace('/', os.sep))
    if not os.path.exists(p):
        print('MISS', rel); continue
    src = open(p, encoding='utf-8').read()
    orig = src
    cnt = 0

    # Text("中文") -> Text(tr("key"))
    def repl_text(m):
        global cnt
        s = m.group(1)
        if s in zh2key:
            cnt += 1
            return f'Text(tr("{zh2key[s]}")'
        return m.group(0)

    src = re.sub(r'(?<!tr\()Text\("([^"]+)"\)', lambda m: (
        f'Text(tr("{zh2key[m.group(1)]}"))' if m.group(1) in zh2key else m.group(0)
    ), src)

    # Section("中文") -> Section(tr("key"))
    src = re.sub(r'Section\("([^"]+)"\)', lambda m: (
        f'Section(tr("{zh2key[m.group(1)]}"))' if m.group(1) in zh2key else m.group(0)
    ), src)

    # Notice("中文") -> Notice(tr("key"))（提示类，用户可见）
    src = re.sub(r'Notice\("([^"]+)"\)', lambda m: (
        f'Notice(tr("{zh2key[m.group(1)]}"))' if m.group(1) in zh2key else m.group(0)
    ), src)

    changed = sum(1 for a, b in zip(orig.splitlines(), src.splitlines()) if a != b)
    if src != orig:
        open(p, 'w', encoding='utf-8').write(src)
    print(f'{rel:42s} 改动行 {changed}')
    total += changed

print('总计改动行:', total)
