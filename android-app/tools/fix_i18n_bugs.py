# -*- coding: utf-8 -*-
"""修两个资源编译错误：
1) x_aimQr 的土耳其语含单引号 → 去掉（Android 会吞 \'）
2) amm_quoteLine 有多个相同 %1$s → 改成位置参数 %1$s %2$s %3$s %4$s
"""
import os, re
RES = r'D:\hacds_server-main\android-app\app\src\main\res'

FIX = {
 'values': {
   'amm_quoteLine': '价格 1→%1$s   费率 %2$s%%（默认）   池 %3$s / %4$s',
 },
 'values-en': {
   'amm_quoteLine': 'Price 1→%1$s   Fee %2$s%% (default)   Pool %3$s / %4$s',
 },
 'values-tr': {
   'x_aimQr': 'Soğuk taraf parça QR koduna doğrultun',
   'amm_quoteLine': 'Fiyat 1→%1$s   Ücret %2$s%% (varsayılan)   Havuz %3$s / %4$s',
 },
}

for d, items in FIX.items():
    p = os.path.join(RES, d, 'strings.xml')
    s = open(p, encoding='utf-8').read()
    for k, v in items.items():
        s = re.sub(r'(<string name="%s">)[^<]*(</string>)' % re.escape(k),
                   lambda m: m.group(1) + v + m.group(2), s)
    open(p, 'w', encoding='utf-8').write(s)
    print(d, 'fixed', list(items))
