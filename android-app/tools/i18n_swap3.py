# -*- coding: utf-8 -*-
"""第三批：替换剩余硬编码中文（含带变量的），改为 tr() 调用。"""
import os

KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'

# (文件, 原文, 替换)
SUBS = {
 'ui/screens/OpScreens.kt': [
   ('"交易预览"', 'tr("x_txPreview")'),
   ('"构建失败：${last.error}"', 'tr("x_buildFail2", last.error)'),
   ('KV("类型"', 'KV(tr("x_kind")'),
   ('KV("字节数"', 'KV(tr("x_bytes")'),
   ('KV("摘要"', 'KV(tr("x_digest")'),
   ('KV("签名自检"', 'KV(tr("x_selfcheck")'),
   ('"仅未签名体"', 'tr("x_unsignedOnly")'),
   ('KV("当前抵押价值"', 'KV(tr("x_curCollVal")'),
   ('KV("可借上限"', 'KV(tr("x_maxBorrow")'),
   ('KV("本笔需抵押"', 'KV(tr("x_needColl")'),
   ('KV("本笔 ≈ 价值"', 'KV(tr("x_valueApprox")'),
   ('KV("追加后总可借"', 'KV(tr("x_newMaxBorrow")'),
 ],
 'ui/screens/ExtraScreens.kt': [
   ('"地址（留空 = 当前）"', 'tr("x_whoHint")'),
   ('KV("已签名"', 'KV(tr("x_signed")'),
   ('"${signed.length / 2} 字节"', 'tr("x_nBytes", signed.length / 2)'),
   ('"已保存：${f.absolutePath}"', 'tr("x_saved", f.absolutePath)'),
   ('"逐张扫描冷端的 HXDS 分片，收齐后自动校验并广播"', 'tr("x_scanNote")'),
   ('"扫码失败：不是 HXDS 分片"', 'tr("x_notShard")'),
   ('"已扫第 ${sh.seq}/${sh.total} 片"', 'tr("x_scannedSeq", sh.seq, sh.total)'),
   ('"对准冷端的分片二维码"', 'tr("x_aimQr")'),
   ('"已收 ${scanned.size} 片"', 'tr("x_scannedN", scanned.size)'),
   ('"网络配置"', 'tr("x_netCfg")'),
   ('"配置已保存"', 'tr("x_cfgSaved")'),
 ],
 'ui/screens/WalletScreen.kt': [
   ('"已锁定"', 'tr("x_lockedOk")'),
   ('"已切换：$it"', 'tr("x_switched", it)'),
   ('"打开失败：${it.message}"', 'tr("x_openFail", it.message ?: "")'),
   ('"生物识别未通过：$it"', 'tr("x_bioFail", it)'),
   ('"已删除"', 'tr("x_deleted")'),
   ('"● 随机私钥"', 'tr("x_randKey")'),
   ('"随机私钥"', 'tr("x_randKey")'),
   ('"● 口令派生"', 'tr("x_pwDerived")'),
   ('"口令派生"', 'tr("x_pwDerived")'),
   ('"口令"', 'tr("x_passphrase")'),
   ('"密码至少 6 位"', 'tr("x_pwMin")'),
   ('"已创建并解锁：$it"', 'tr("x_created", it)'),
   ('"创建失败：${it.message}"', 'tr("x_createFail", it.message ?: "")'),
   ('"已导入并解锁：$it"', 'tr("x_imported", it)'),
   ('"导入失败：${it.message}"', 'tr("x_importFail", it.message ?: "")'),
 ],
 'ui/screens/HacdScreen.kt': [
   ('"${names.size} 颗 · 已选 ${selected.size}"', 'tr("x_nSelected", names.size, selected.size)'),
   ('"按分数" to ', '"x_sortScore" to '),
   ('"按编号" to ', '"x_sortNumber" to '),
   ('"按名称" to ', '"x_sortName" to '),
   ('Text(if (sortBy == k) "● $label" else label', 'Text(if (sortBy == k) "● " + tr(label) else tr(label)'),
   ('Text("取消")', 'Text(tr("x_cancel"))'),
   ('Text("查询")', 'Text(tr("x_query"))'),
 ],
 'ui/screens/LiquidationScreen.kt': [
   ('"调 lp_harvest 领取你的 LP 奖励"', 'tr("x_harvestHint")'),
   ('KV("待领 LP 奖励 HAC"', 'KV(tr("x_pendHac")'),
   ('KV("待领 LP 奖励 hacds"', 'KV(tr("x_pendDs")'),
   ('"向金库地址转账即可（合约自动扣减 tre:）"', 'tr("x_treTransfer")'),
   ('KV("金库待结算 HAC"', 'KV(tr("x_treHac")'),
   ('KV("金库待结算 hacds"', 'KV(tr("x_treDs")'),
   ('"需要链下索引器（D57）"', 'tr("x_needIdx")'),
   ('KV("健康度"', 'KV(tr("p_health")'),
   ('KV("债务"', 'KV(tr("p_debt")'),
   ('KV("抵押"', 'KV(tr("p_coll")'),
   ('"⚠ 可清算"', 'tr("x_liquidatable")'),
   ('"无债务"', 'tr("x_noDebt")'),
   ('"安全"', 'tr("x_safe")'),
 ],
 'ui/screens/HomeScreen.kt': [
   ('"${a.diamondCount} 颗"', 'tr("x_nDiamonds", a.diamondCount)'),
   ('"已持有 hacds"', 'tr("ov_onchain")'),
   ('"其它资产"', 'tr("ov_others")'),
   ('"安全 · 无债务"', 'tr("x_safeNoDebt")'),
   ('"⚠ 可清算"', 'tr("x_liquidatable")'),
   ('"安全"', 'tr("x_safe")'),
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
            print('  MISS', rel, a[:36])
    if s != o: open(p, 'w', encoding='utf-8').write(s)
    print(f'{rel:44s} {n}')
    tot += n
print('总计', tot)
