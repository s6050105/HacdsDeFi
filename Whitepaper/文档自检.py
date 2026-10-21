# -*- coding: utf-8 -*-
"""设计文档一致性自检（PC 与 Android 两份）。

用法：  python -I Whitepaper/文档自检.py          # 自动定位 wallet-app/
         python -I 文档自检.py --dir <含设计文档的目录>
退出码： 0 = 全部通过；1 = 有错（逐条打印）

核对项：
  1. 两文档共同口径常量一致（地址 / 三桶上限 / 词条数 / serial）
  2. 已废弃数值不再出现（同口径的旧数字）
  3. 小节编号唯一、有序、标题层级与编号深度匹配、无重复标题
  4. 「见 x.y」引用不悬空
  5. PC 决策 D1–D61 完整且连续；状态列不与「全部已实现」矛盾；Android 覆盖全部 D 编号
  6. 代码块围栏成对；表格每行列数一致
"""
import io
import os
import re
import sys

# 文档位置：默认从脚本自身位置推导，不依赖当前工作目录
# （CI / 任意目录下调用都能跑；本地也可用 --dir 指定）
_HERE = os.path.dirname(os.path.abspath(__file__))
_DEF = os.path.join(_HERE, '..', 'wallet-app')
if '--dir' in sys.argv:
    _DEF = sys.argv[sys.argv.index('--dir') + 1]
PC = os.path.join(_DEF, '设计文档.md')
AN = os.path.join(_DEF, 'Android设计文档.md')

# Windows 控制台默认 GBK，直接输出中文/符号会 UnicodeEncodeError
try:
    sys.stdout.reconfigure(encoding='utf-8')
except Exception:
    pass

errors = []
notes = []
_dmax = [61]   # 决策表实际最大编号，由 check_decisions 填充


def read(p):
    return io.open(p, encoding='utf-8').read()


def _real_i18n_count():
    """从 renderer/i18n.js 实测唯一键数（不写死，文档必须与代码一致）。"""
    p = os.path.join(_DEF, 'renderer', 'i18n.js')
    if not os.path.isfile(p):
        return None
    s = io.open(p, encoding='utf-8').read()
    i = s.find("'zh-CN': {")
    if i == -1:
        return None
    nxt = len(s)
    for l2 in ('zh-CN', 'en', 'tr'):
        k = s.find("'%s': {" % l2, i + 9)
        if k != -1 and k < nxt:
            nxt = k
    return len(set(re.findall(r"""['"]([a-zA-Z0-9_]+(?:\.[a-zA-Z0-9_]+)+)['"]\s*:""", s[i:nxt])))


def check_constants(pc, an):
    # 必须同时出现在两份文档中的口径
    n_i18n = _real_i18n_count()
    shared = ['18,009', '6,100', '111,911']
    if n_i18n:
        shared.append(str(n_i18n))     # 词条数由 i18n.js 实测得出
    for k in shared:
        if not pc.count(k):
            errors.append('PC 文档缺少口径常量：%s' % k)
        if not an.count(k):
            errors.append('Android 文档缺少口径常量：%s' % k)
    # 已废弃值
    for k in ['104,589', '452 词条', '452/452', '440 词条', '364×3']:
        if pc.count(k):
            errors.append('PC 文档残留废弃值：%s' % k)
        if an.count(k):
            errors.append('Android 文档残留废弃值：%s' % k)
    # 地址只在 PC §0.1 定义
    for addr in ['VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1',
                 '1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK']:
        if not pc.count(addr):
            errors.append('PC 文档缺少地址：%s' % addr)


def check_headings(p, name):
    hs = re.findall(r'^#{2,5} .+$', p, re.M)
    from collections import Counter
    dup = [h for h, c in Counter(hs).items() if c > 1]
    if dup:
        errors.append('%s 有重复标题：%s' % (name, dup))

    # 标题层级必须与编号深度匹配（x 级 → ##，x.y → ###，x.y.z → ####）
    for m in re.finditer(r'^(#{2,6}) +([0-9]+(?:\.[0-9]+)*)', p, re.M):
        want = '#' * (1 + m.group(2).count('.')) + '#'
        if m.group(1) != want:
            errors.append('%s 标题层级不匹配：%s 用了 %s，应为 %s'
                          % (name, m.group(2), m.group(1), want))
            break

    nums = [m.group(1) for m in re.finditer(r'^#{3,5} +([0-9]+(?:\.[0-9]+)*)', p, re.M)]
    if len(nums) != len(set(nums)):
        d = [n for n, c in Counter(nums).items() if c > 1]
        errors.append('%s 有小节号重复：%s' % (name, d))
    # 顶层（x.y）需递增
    top = [n for n in nums if n.count('.') == 1]
    if top != sorted(top, key=lambda x: tuple(int(i) for i in x.split('.'))):
        errors.append('%s 的 x.y 小节号未按顺序排列：%s' % (name, top))


def check_refs(p, name):
    secs = set(re.findall(r'^#{2,5} +([0-9]+(?:\.[0-9]+)*)', p, re.M))
    bad = []
    for r in set(re.findall(r'见 +§?([0-9]+\.[0-9]+(?:\.[0-9]+)?)', p)):
        if r not in secs:
            bad.append(r)
    if bad:
        errors.append('%s 悬空小节引用：%s' % (name, bad))


def check_decisions(pc, an):
    dpc = set(re.findall(r'^\| (D\d+) \|', pc, re.M))
    if not dpc:
        errors.append('PC 决策表为空')
        return
    # 按表内最大编号推导应有集合：要求 D1..Dmax 连续无缺、无越界
    dmax = max(int(d[1:]) for d in dpc)
    _dmax[0] = dmax
    expect = set('D%d' % i for i in range(1, dmax + 1))
    if dpc != expect:
        miss = sorted(expect - dpc, key=lambda x: int(x[1:]))
        extra = sorted(dpc - expect)
        errors.append('PC 决策表不连续：缺 %s 多 %s' % (miss, extra))

    # 状态列不得残留「待实现 / 部分做 / 已定」（与 §8.1「全部已实现」矛盾）
    i = pc.find('| 编号 | 决策 | 状态 |')
    j = pc.find('### 5.1', i)
    if i != -1 and j != -1:
        stale = []
        for ln in pc[i:j].split('\n'):
            if not ln.startswith('| D'):
                continue
            st = [c.strip() for c in ln.split('|')][-2]
            if '待实现' in st or '部分做' in st or st.endswith('已定'):
                stale.append(ln.split('|')[1].strip())
        if stale:
            errors.append('PC 决策表状态与 §8.1 矛盾：%s' % stale)

    dan = set('D%d' % int(x) for x in re.findall(r'\bD(\d{1,2})\b', an)
              if 1 <= int(x) <= dmax)
    miss = sorted(expect - dan, key=lambda x: int(x[1:]))
    if miss:
        errors.append('Android 文档未覆盖决策：%s' % miss)


def check_fences(p, name):
    if p.count('```') % 2:
        errors.append('%s 代码块围栏不成对（``` 数为奇数）' % name)


def check_tables(p, name):
    """表格每行列数必须一致（单元格内的裸 | 会破坏表格）。"""
    lines = p.split('\n')
    i = 0
    while i < len(lines):
        if lines[i].startswith('|'):
            blk = []
            while i < len(lines) and lines[i].startswith('|'):
                blk.append(lines[i])
                i += 1
            base = blk[0].count('|')
            if any(l.count('|') != base for l in blk):
                errors.append('%s 表格列数不齐（表头：%s）' % (name, blk[0][:40]))
        else:
            i += 1


def main():
    pc, an = read(PC), read(AN)
    check_constants(pc, an)
    for p, n in ((pc, 'PC 文档'), (an, 'Android 文档')):
        check_headings(p, n)
        check_refs(p, n)
        check_fences(p, n)
        check_tables(p, n)
    check_decisions(pc, an)

    if errors:
        print('✗ 自检未通过（%d 项）：' % len(errors))
        for e in errors:
            print('  - ' + e)
        return 1
    print('✓ 文档自检全部通过')
    print('  PC 决策 D1–D%d 连续完整、Android 全覆盖' % _dmax[0])
    print('  口径常量一致；无废弃值；编号唯一有序；引用无悬空')
    return 0


if __name__ == '__main__':
    sys.exit(main())
