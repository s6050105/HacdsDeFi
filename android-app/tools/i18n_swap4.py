# -*- coding: utf-8 -*-
"""第四批：处理带变量的剩余硬编码中文。"""
import os

KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'
SUBS = {
 'ui/screens/OpScreens.kt': [
   ('"池内比例：${com.hacds.defi.ui.screens.formatHac(ph.toString())} HAC ↔ ${pd} atoms"',
    'tr("x_poolRatio", com.hacds.defi.ui.screens.formatHac(ph.toString()), pd.toString())'),
   ('"⚠ 两腿不匹配：按池内比例，hac_amt 应对应 ${expectDs} atoms（差 ${diff}）"',
    'tr("x_legMismatch", expectDs.toString(), diff.toString())'),
 ],
 'ui/screens/ExtraScreens.kt': [
   ('"还差第 ${a.missing.joinToString(",")} 片"', 'tr("x_missingN", a.missing.joinToString(","))'),
   ('"✔ 已收齐并通过 CRC 校验（${a.hex.length / 2} 字节）"', 'tr("x_assembled", a.hex.length / 2)'),
   ('"简体中文"', '"中文"'),
 ],
 'ui/screens/LiquidationScreen.kt': [
   ('"清扫 = 普通 HAC/资产转账到金库地址 ${com.hacds.defi.core.AppConfig.DEFAULT_TREASURY}（见「链上转账」页）。"',
    'tr("x_sweepNote", com.hacds.defi.core.AppConfig.DEFAULT_TREASURY)'),
   ('"来源：服务端索引器"', 'tr("x_srcServer")'),
   ('"未连接索引器：${s.error}"', 'tr("x_idxDown", s.error ?: "")'),
 ],
 'ui/screens/HomeScreen.kt': [
   ('tr("ov.expect").ifEmpty { "预期 hacds" }', 'tr("ov_expect")'),
   ('tr("ov.due").ifEmpty { "待领取 hacds" }', 'tr("ov_due")'),
   ('tr("ov.hacPoints").ifEmpty { "合约内 HAC 积分" }', 'tr("ov_hacPoints")'),
   ('tr("ov.onchain").ifEmpty { "已持有 hacds" }', 'tr("ov_onchain")'),
   ('tr("ov.others").ifEmpty { "其它资产" }', 'tr("ov_others")'),
 ],
}

tot = 0
for rel, subs in SUBS.items():
    p = os.path.join(KT, rel.replace('/', os.sep))
    s = open(p, encoding='utf-8').read(); o = s; n = 0
    for a, b in subs:
        if a in s:
            s = s.replace(a, b); n += 1
        else:
            print('  MISS', rel, a[:44])
    if s != o: open(p, 'w', encoding='utf-8').write(s)
    print(f'{rel:44s} {n}')
    tot += n
print('总计', tot)
