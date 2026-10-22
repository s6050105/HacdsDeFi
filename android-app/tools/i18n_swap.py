# -*- coding: utf-8 -*-
"""把各 Screen 里的硬编码中文替换为 tr("key")。"""
import os

KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'

SIMPLE = {
 'ui/screens/OpScreens.kt': [
   ('"此页无操作"', 'tr("x_noop")'),
   ('"批量结果"', 'tr("x_batchResult")'),
   ('"尚未构建交易"', 'tr("x_noTx")'),
   ('"HACD 点对点转账"', 'tr("x_hacdP2P")'),
   ('"池为空：首次注入两侧自定，份额 ≈ isqrt(hac × ds)"', 'tr("x_poolEmptyIsq")'),
   ('"池为空，无法折算抵押价值"', 'tr("x_poolEmptyNoVal")'),
   ('"✘ 超出可借上限"', 'tr("x_overBorrow")'),
   ('"✔ 可借"', 'tr("x_canBorrow")'),
 ],
 'ui/screens/ExtraScreens.kt': [
   ('"查询走节点 sandboxcall，已做并发串行化 + 退避重试（D45）。"', 'tr("x_sandboxNote")'),
   ('"点首页「协议状态」刷新，或下一行的按钮"', 'tr("x_protoHint")'),
   ('"冷端：手机不联网也能构建未签名体并签名；把 signed hex 交给联网机广播。"', 'tr("x_coldNote")'),
   ('"合约函数名"', 'tr("x_fnName")'),
   ('"参数（value:type,… 或 -）"', 'tr("x_params")'),
   ('"构建未签名体"', 'tr("x_buildUnsigned")'),
   ('"用当前钱包签名"', 'tr("x_signNow")'),
   ('"直接广播（本机联网时）"', 'tr("x_broadcastNow")'),
   ('"导出 hex 文件（兜底）"', 'tr("x_exportHex")'),
   ('"扫码接收（热端）"', 'tr("x_scanRecv")'),
   ('"扫描一张"', 'tr("x_scanOne")'),
   ('"清空"', 'tr("x_clear")'),
   ('"广播这笔交易"', 'tr("x_broadcastTx")'),
   ('"当前地址不是合约管理员（或未探测）。"', 'tr("x_notAdmin")'),
   ('"探测管理员身份"', 'tr("x_probeAdmin")'),
   ('"语言 / Language"', 'tr("x_langTitle")'),
   ('"切换后立即生效（无需重启）。"', 'tr("x_langInstant")'),
 ],
 'ui/screens/WalletScreen.kt': [
   ('"打开钱包需生物识别（指纹/面容）"', 'tr("x_bioOpen")'),
   ('"删除"', 'tr("x_delete")'),
   ('"暂无钱包，点上方「创建钱包」"', 'tr("x_noWallet")'),
   ('"密码（PC 兼容钱包需要）"', 'tr("x_pwPc")'),
   ('"加密密码（≥6 位）"', 'tr("x_pwEnc")'),
   ('"64 位 hex 私钥，或 PC keystore JSON"', 'tr("x_importHint")'),
   ('"口令（导入 keystore 时需要）"', 'tr("x_pwKs")'),
   ('"备注"', 'tr("x_note")'),
   ('"私钥明文可完全控制该地址资产。切勿截图、外发或联网环境暴露。"', 'tr("x_keyWarn")'),
   ('"我已了解风险，显示私钥"', 'tr("x_showKey")'),
 ],
 'ui/screens/HacdScreen.kt': [
   ('"全选"', 'tr("x_selectAll")'),
   ('"按地址查询 HACD（留空=当前）"', 'tr("x_queryByAddr")'),
   ('"无 HACD 或未加载（解锁钱包后点「刷新资产」）"', 'tr("x_noHacd")'),
 ],
 'ui/screens/LiquidationScreen.kt': [
   ('"① LP 奖励结算"', 'tr("x_liqLp")'),
   ('"生成 lp_harvest 交易"', 'tr("x_genHarvest")'),
   ('"② 金库清扫"', 'tr("x_liqTre")'),
   ('"③ 借贷清算台"', 'tr("x_liqDesk")'),
   ('"拉取台账"', 'tr("x_pullLedger")'),
   ('"探测索引器"', 'tr("x_probeIdx")'),
   ('"观察地址"', 'tr("x_watchAddr")'),
   ('"加入"', 'tr("x_add")'),
   ('"移除"', 'tr("x_remove")'),
   ('"点「拉取台账」加载"', 'tr("x_pullHint")'),
   ('"台账为空（服务端索引器未配置时属正常）"', 'tr("x_ledgerEmpty")'),
   ('"清算该账户"', 'tr("x_liqThis")'),
 ],
}

tot = 0
for rel, subs in SIMPLE.items():
    p = os.path.join(KT, rel.replace('/', os.sep))
    s = open(p, encoding='utf-8').read()
    o = s
    n = 0
    for a, b in subs:
        if a in s:
            s = s.replace(a, b); n += 1
        else:
            print('  MISS', rel, a[:34])
    if s != o:
        open(p, 'w', encoding='utf-8').write(s)
    print(f'{rel:44s} 替换 {n}')
    tot += n
print('总计', tot)
