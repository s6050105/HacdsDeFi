# -*- coding: utf-8 -*-
"""QrUi 的 6 处中文 → i18n。"""
import os
RES = r'D:\hacds_server-main\android-app\app\src\main\res'
KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'

NEW = {
 'x_qrNoData':   ('无内容可出码', 'Nothing to encode', 'Kodlanacak veri yok'),
 'x_qrShard':    ('第 %1$s / %2$s 片 · CRC %3$s', 'Shard %1$s / %2$s · CRC %3$s',
                  'Parça %1$s / %2$s · CRC %3$s'),
 'x_qrChars':    ('本片 %1$s 字符', 'This shard: %1$s chars', 'Bu parça: %1$s karakter'),
 'x_qrPrev':     ('上一片', 'Previous', 'Önceki'),
 'x_qrNext':     ('下一片', 'Next', 'Sonraki'),
 'x_qrTotal':    ('共 %1$s 片；热端逐张扫码，收齐后自动校验 CRC。',
                  '%1$s shards total; scan one by one on the hot side; CRC verified when complete.',
                  'Toplam %1$s parça; sıcak tarafta tek tek tarayın; tamamlanınca CRC doğrulanır.'),
}
for d, i in {'values': 0, 'values-en': 1, 'values-tr': 2}.items():
    p = os.path.join(RES, d, 'strings.xml')
    s = open(p, encoding='utf-8').read()
    ins = []
    for k, v in NEW.items():
        if f'name="{k}"' not in s:
            ins.append(f'    <string name="{k}">{v[i]}</string>')
    if ins:
        s = s.replace('</resources>', '\n'.join(ins) + '\n</resources>')
        open(p, 'w', encoding='utf-8').write(s)
    print(d, len(ins))

p = os.path.join(KT, 'qr', 'QrUi.kt')
s = open(p, encoding='utf-8').read()
subs = [
 ('"无内容可出码"', 'com.hacds.defi.ui.tr("x_qrNoData")'),
 ('"第 ${cur.seq} / ${cur.total} 片 · CRC ${cur.crc}"',
  'com.hacds.defi.ui.tr("x_qrShard", cur.seq, cur.total, cur.crc)'),
 ('"本片 ${cur.data.length} 字符"', 'com.hacds.defi.ui.tr("x_qrChars", cur.data.length)'),
 ('Text("上一片")', 'Text(com.hacds.defi.ui.tr("x_qrPrev"))'),
 ('Text("下一片")', 'Text(com.hacds.defi.ui.tr("x_qrNext"))'),
 ('"共 ${shards.size} 片；热端逐张扫码，收齐后自动校验 CRC。"',
  'com.hacds.defi.ui.tr("x_qrTotal", shards.size)'),
]
n = 0
for a, b in subs:
    if a in s:
        s = s.replace(a, b); n += 1
    else:
        print('  MISS', a[:40])
open(p, 'w', encoding='utf-8').write(s)
print('QrUi 替换', n)
