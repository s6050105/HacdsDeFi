# -*- coding: utf-8 -*-
"""FitSH 评分逻辑的 Python 参考实现 —— 严格照抄 HacdsDeFi3000.fitsh 的代码。

用法：喂 (name, num, vg) 三元组，输出总分。
用于与 rv64im 内核 score_sum 做差分测试。
"""
import sys

LETTERS = "WTYUIAHXVMEKBSZN"


def vg_hex(vg, idx):
    """合约里的 vg_hex：第 idx 个十六进制半字节。"""
    b = vg[idx // 2]
    if idx % 2 == 0:
        return b // 16
    return b % 16


def popcount16(bm):
    """合约里的 popcount16（SWAR）。"""
    x = bm & 65535
    x = x - ((x >> 1) & 21845)
    x = (x & 13107) + ((x >> 2) & 13107)
    x = (x + (x >> 4)) & 3855
    x = x + (x >> 8)
    return x & 31


def shape_score(vg):
    a = vg_hex(vg, 0)
    b = vg_hex(vg, 1)
    if a == 0:
        return {1: 30, 2: 30, 3: 50, 4: 20, 5: 30,
                6: 30, 7: 20, 8: 20}.get(b, 0)
    return 0


def style_score(vg):
    c13 = vg_hex(vg, 14)
    c14 = vg_hex(vg, 15)
    c15 = vg_hex(vg, 16)
    c16 = vg_hex(vg, 17)

    # 候选 1：位置规则 elif 互斥链（首次命中）
    if c13 == c14 and c14 == c15 and c15 == c16:
        pos = 250
    elif c13 == c14 and c14 == c15 and c14 != c16:
        pos = 20
    elif c13 == c15 and c15 == c16 and c14 != c13:
        pos = 20
    elif c13 == c14 and c14 == c16 and c15 != c13:
        pos = 20
    elif c14 == c15 and c15 == c16 and c14 != c13:
        pos = 20
    elif c16 == c15 and c13 == c14:
        pos = 20
    elif c16 == c14 and c13 == c15:
        pos = 20
    elif c15 * 16 + c13 == c14 * 16 + c16:
        pos = 20
    elif c13 == c14 and c15 != c16:
        pos = 3
    elif c15 == c16 and c14 != c13:
        pos = 3
    else:
        pos = 0

    # 候选 2 + 3：单次遍历
    bitmap = 0
    all_dark = 1
    all_light = 1
    for i in range(2, 18):
        hv = vg_hex(vg, i)
        bitmap |= 1 << hv
        if hv > 4:
            all_dark = 0
        if hv <= 4:
            all_light = 0

    distinct = popcount16(bitmap)
    cnt = {4: 200, 5: 100, 6: 50, 7: 20,
           14: 30, 15: 100, 16: 200}.get(distinct, 0)

    dl = 20 if (all_dark == 1 or all_light == 1) else 0

    best = pos
    if cnt > best:
        best = cnt
    if dl > best:
        best = dl
    return best


COLOR = {ord('A'): 7, ord('B'): 6, ord('E'): 1, ord('H'): 8,
         ord('I'): 8, ord('K'): 8, ord('M'): 2, ord('N'): 6,
         ord('S'): 6, ord('T'): 8, ord('U'): 3, ord('V'): 8,
         ord('W'): 3, ord('X'): 5, ord('Y'): 3, ord('Z'): 10}


def color_score(vg, name):
    s = COLOR.get(name[0], 0)
    all_dark = 1
    all_light = 1
    for i in range(2, 19):
        v = vg_hex(vg, i)
        if v > 4:
            all_dark = 0
        if v <= 4:
            all_light = 0
    bonus = 0
    if all_dark == 1:
        bonus = 20
    if all_light == 1:
        bonus = 20
    return bonus if bonus > s else s


def nameliteral_score(name):
    maxrun, run = 1, 1
    for i in range(1, 6):
        if name[i] == name[i - 1]:
            run += 1
            if run > maxrun:
                maxrun = run
        else:
            run = 1

    bitmap = 0
    for i in range(6):
        idx = LETTERS.find(chr(name[i]))
        if idx < 0:
            idx = 16
        bitmap |= 1 << idx
    distinct = popcount16(bitmap)

    best = 0
    if maxrun >= 3:
        v = {6: 200, 5: 50, 4: 10}.get(maxrun, 2)
        if v > best:
            best = v
    if distinct == 2:
        if 10 > best:
            best = 10
    elif distinct == 3:
        if 3 > best:
            best = 3
    if name[0:3] == name[3:6]:
        if 20 > best:
            best = 20
    if name[0] == name[5] and name[1] == name[4] and name[2] == name[3]:
        if 10 > best:
            best = 10
    if name[0] == name[1] and name[3] == name[4]:
        if 10 > best:
            best = 10
    if name[1] == name[2] and name[4] == name[5]:
        if 10 > best:
            best = 10
    return best


def is_sequential(d):
    n = len(d)
    if n < 2:
        return True
    up, down = 1, 1
    for i in range(1, n):
        cur, pre = d[i], d[i - 1]
        if cur <= pre:
            up = 0
        elif cur - pre != 1:
            up = 0
        if cur >= pre:
            down = 0
        elif pre - cur != 1:
            down = 0
    return up == 1 or down == 1


def is_symmetric_dec(d):
    n = len(d)
    for i in range(n // 2):
        if d[i] != d[n - 1 - i]:
            return False
    return True


def numberliteral_score(num):
    best = 0
    if num < 10:
        if 30 > best:
            best = 30

    digits = str(num).encode()
    n = len(digits)

    bitmap = 0
    for i in range(n):
        bitmap |= 1 << (digits[i] - 48)
    if popcount16(bitmap) == 1:
        if 50 > best:
            best = 50

    if is_sequential(digits):
        if 25 > best:
            best = 25

    if is_symmetric_dec(digits):
        if 10 > best:
            best = 10

    maxrun, run = 1, 1
    for i in range(1, n):
        if digits[i] == digits[i - 1]:
            run += 1
            if run > maxrun:
                maxrun = run
        else:
            run = 1
    if maxrun >= 4:
        v = {7: 200, 6: 100, 5: 50}.get(maxrun, 20)
        if v > best:
            best = v
    return best


def diamond_score(name, vg, num):
    shape = shape_score(vg)
    colorish = style_score(vg) if shape == 0 else color_score(vg, name)
    nl = nameliteral_score(name)
    nu = numberliteral_score(num)
    total = shape + colorish + nl + nu
    return 1 if total < 1 else total
