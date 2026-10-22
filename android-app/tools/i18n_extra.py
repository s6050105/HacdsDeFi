# -*- coding: utf-8 -*-
"""为 Android 特有话术补三语言词条，并把源文件里的硬编码中文换成 tr("key")。"""
import os, re

RES = r'D:\hacds_server-main\android-app\app\src\main\res'
KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'

# key: (zh, en, tr)  —— 只收短、稳定的 UI 文案；带变量的走 %1$s
EXTRA = {
 'x_noop':        ('此页无操作', 'No actions here', 'Bu sayfada işlem yok'),
 'x_batchResult': ('批量结果', 'Batch result', 'Toplu sonuç'),
 'x_noTx':        ('尚未构建交易', 'No transaction built yet', 'Henüz işlem oluşturulmadı'),
 'x_buildFail':   ('构建失败：%1$s', 'Build failed: %1$s', 'Oluşturma hatası: %1$s'),
 'x_hacdP2P':     ('HACD 点对点转账', 'HACD peer-to-peer transfer', 'HACD eşler arası transfer'),
 'x_poolEmptyIsq':('池为空：首次注入两侧自定，份额 ≈ isqrt(hac × ds)',
                   'Pool is empty: for the first deposit set both sides freely; share ≈ isqrt(hac × ds)',
                   'Havuz boş: ilk yatırımda iki tarafı siz belirleyin; pay ≈ isqrt(hac × ds)'),
 'x_poolRatio':   ('池内比例：%1$s HAC ↔ %2$s atoms', 'Pool ratio: %1$s HAC ↔ %2$s atoms',
                   'Havuz oranı: %1$s HAC ↔ %2$s atoms'),
 'x_legMismatch': ('⚠ 两腿不匹配：按池内比例，hac_amt 应对应 %1$s atoms（差 %2$s）',
                   '⚠ Legs mismatch: at pool ratio, hac_amt should match %1$s atoms (diff %2$s)',
                   '⚠ Bacaklar uyuşmuyor: havuz oranında hac_amt %1$s atoms olmalı (fark %2$s)'),
 'x_poolEmptyNoVal':('池为空，无法折算抵押价值', 'Pool is empty; cannot value collateral',
                     'Havuz boş; teminat değerlenemiyor'),
 'x_overBorrow':  ('✘ 超出可借上限', '✘ Over borrow limit', '✘ Borç limiti aşıldı'),
 'x_canBorrow':   ('✔ 可借', '✔ Can borrow', '✔ Borç alınabilir'),
 'x_sandboxNote': ('查询走节点 sandboxcall，已做并发串行化 + 退避重试（D45）。',
                   'Queries use node sandboxcall, serialized with backoff retry (D45).',
                   'Sorgular düğüm sandboxcall kullanır; serileştirme + geri çekilme (D45).'),
 'x_protoHint':   ('点首页「协议状态」刷新，或下一行的按钮',
                   'Refresh "Protocol status" on Home, or use the buttons below',
                   'Ana sayfada "Protokol durumu"nu yenileyin veya aşağıdaki düğmeleri kullanın'),
 'x_coldNote':    ('冷端：手机不联网也能构建未签名体并签名；把 signed hex 交给联网机广播。',
                   'Cold side: build and sign offline; hand the signed hex to an online device to broadcast.',
                   'Soğuk taraf: çevrimdışı oluşturup imzalayın; imzalı hex\'i çevrimiçi cihaza verin.'),
 'x_fnName':      ('合约函数名', 'Contract function', 'Sözleşme fonksiyonu'),
 'x_params':      ('参数（value:type,… 或 -）', 'Args (value:type,… or -)', 'Argümanlar (value:type,… veya -)'),
 'x_buildUnsigned':('构建未签名体', 'Build unsigned body', 'İmzasız gövde oluştur'),
 'x_signNow':     ('用当前钱包签名', 'Sign with current wallet', 'Mevcut cüzdanla imzala'),
 'x_broadcastNow':('直接广播（本机联网时）', 'Broadcast directly (if online)',
                   'Doğrudan yayınla (çevrimiçiyse)'),
 'x_exportHex':   ('导出 hex 文件（兜底）', 'Export hex file (fallback)', 'Hex dosyası dışa aktar (yedek)'),
 'x_scanRecv':    ('扫码接收（热端）', 'Scan to receive (hot side)', 'Almak için tara (sıcak taraf)'),
 'x_scanOne':     ('扫描一张', 'Scan one', 'Bir tane tara'),
 'x_clear':       ('清空', 'Clear', 'Temizle'),
 'x_scannedN':    ('已收 %1$s 片', 'Received %1$s shards', '%1$s parça alındı'),
 'x_missingN':    ('还差第 %1$s 片', 'Missing shard(s): %1$s', 'Eksik parça(lar): %1$s'),
 'x_assembled':   ('✔ 已收齐并通过 CRC 校验（%1$s 字节）',
                   '✔ Complete, CRC verified (%1$s bytes)', '✔ Tamam, CRC doğrulandı (%1$s bayt)'),
 'x_broadcastTx': ('广播这笔交易', 'Broadcast this transaction', 'Bu işlemi yayınla'),
 'x_notAdmin':    ('当前地址不是合约管理员（或未探测）。',
                   'Current address is not the contract admin (or not probed).',
                   'Mevcut adres sözleşme yöneticisi değil (veya sorgulanmadı).'),
 'x_probeAdmin':  ('探测管理员身份', 'Probe admin identity', 'Yönetici kimliğini sorgula'),
 'x_langTitle':   ('语言 / Language', 'Language / 语言', 'Dil / Language'),
 'x_langInstant': ('切换后立即生效（无需重启）。', 'Applies immediately (no restart needed).',
                   'Hemen uygulanır (yeniden başlatma gerekmez).'),
 'x_bioOpen':     ('打开钱包需生物识别（指纹/面容）', 'Require biometrics to open wallet',
                   'Cüzdanı açmak için biyometri gerekli'),
 'x_delete':      ('删除', 'Delete', 'Sil'),
 'x_noWallet':    ('暂无钱包，点上方「创建钱包」', 'No wallets yet; tap "Create wallet" above',
                   'Henüz cüzdan yok; yukarıdan "Cüzdan oluştur"'),
 'x_pwPc':        ('密码（PC 兼容钱包需要）', 'Password (needed for PC-compatible wallet)',
                   'Parola (PC uyumlu cüzdan için)'),
 'x_pwEnc':       ('加密密码（≥6 位）', 'Encryption password (≥6 chars)', 'Şifreleme parolası (≥6)'),
 'x_importHint':  ('64 位 hex 私钥，或 PC keystore JSON', '64-hex private key, or PC keystore JSON',
                   '64 hex özel anahtar veya PC keystore JSON'),
 'x_pwKs':        ('口令（导入 keystore 时需要）', 'Passphrase (needed to import keystore)',
                   'Parola (keystore içe aktarmak için)'),
 'x_note':        ('备注', 'Note', 'Not'),
 'x_keyWarn':     ('私钥明文可完全控制该地址资产。切勿截图、外发或联网环境暴露。',
                   'The plaintext key fully controls this address. Never screenshot, share, or expose online.',
                   'Açık anahtar bu adresi tamamen kontrol eder. Ekran görüntüsü almayın, paylaşmayın.'),
 'x_showKey':     ('我已了解风险，显示私钥', 'I understand the risk; show the key',
                   'Riski anladım; anahtarı göster'),
 'x_selectAll':   ('全选', 'Select all', 'Tümünü seç'),
 'x_queryByAddr': ('按地址查询 HACD（留空=当前）', 'Query HACD by address (blank = current)',
                   'Adrese göre HACD sorgula (boş = mevcut)'),
 'x_query':       ('查询', 'Query', 'Sorgula'),
 'x_noHacd':      ('无 HACD 或未加载（解锁钱包后点「刷新资产」）',
                   'No HACD or not loaded (unlock wallet then tap "Refresh assets")',
                   'HACD yok veya yüklenmedi (cüzdanı açıp "Varlıkları yenile")'),
 'x_liqLp':       ('① LP 奖励结算', '① LP reward settlement', '① LP ödül takası'),
 'x_genHarvest':  ('生成 lp_harvest 交易', 'Build lp_harvest tx', 'lp_harvest işlemi oluştur'),
 'x_liqTre':      ('② 金库清扫', '② Treasury sweep', '② Hazine süpürme'),
 'x_liqTreNote':  ('清扫 = 普通 HAC/资产转账到金库地址 %1$s（见「链上转账」页）。',
                   'Sweep = plain HAC/asset transfer to treasury %1$s (see "On-chain transfer").',
                   'Süpürme = hazine %1$s adresine normal HAC/varlık transferi ("Zincir transferi").'),
 'x_liqDesk':     ('③ 借贷清算台', '③ Liquidation desk', '③ Tasfiye masası'),
 'x_pullLedger':  ('拉取台账', 'Pull ledger', 'Defteri çek'),
 'x_probeIdx':    ('探测索引器', 'Probe indexer', 'İndeksleyiciyi sorgula'),
 'x_watchAddr':   ('观察地址', 'Watch address', 'İzlenecek adres'),
 'x_add':         ('加入', 'Add', 'Ekle'),
 'x_remove':      ('移除', 'Remove', 'Kaldır'),
 'x_pullHint':    ('点「拉取台账」加载', 'Tap "Pull ledger" to load', 'Yüklemek için "Defteri çek"'),
 'x_ledgerEmpty': ('台账为空（服务端索引器未配置时属正常）',
                   'Ledger is empty (normal when no server indexer is configured)',
                   'Defter boş (sunucu indeksleyici yoksa normal)'),
 'x_liqThis':     ('清算该账户', 'Liquidate this account', 'Bu hesabı tasfiye et'),
}

# 写三份 strings
DIRS = {'values': 0, 'values-en': 1, 'values-tr': 2}
for d, idx in DIRS.items():
    p = os.path.join(RES, d, 'strings.xml')
    s = open(p, encoding='utf-8').read()
    ins = []
    for k, vals in EXTRA.items():
        if f'name="{k}"' not in s:
            v = vals[idx].replace("'", "\\'").replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            ins.append(f'    <string name="{k}">{v}</string>')
    if ins:
        s = s.replace('</resources>', '\n'.join(ins) + '\n</resources>')
        open(p, 'w', encoding='utf-8').write(s)
    print(d, '新增', len(ins))

print('总新增词条:', len(EXTRA))
