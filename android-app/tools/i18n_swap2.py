# -*- coding: utf-8 -*-
"""第二批：把剩余硬编码中文换成 tr()；能命中 PC 词条的复用，其余用新增键。"""
import json, os, re, subprocess

KT = r'D:\hacds_server-main\android-app\app\src\main\java\com\hacds\defi'
dump_js = r'D:\hacds_server-main\android-app\tools\dump_i18n.js'
i18n_js = r'D:\hacds_server-main\wallet-app\renderer\i18n.js'

r = subprocess.run(['node', dump_js, i18n_js], capture_output=True, encoding='utf-8')
DICT = json.loads(r.stdout)
zh2key = {}
for k, v in DICT['zh-CN'].items():
    v = v.strip()
    if v and v not in zh2key:
        zh2key[v] = k

# 新增键（Android 特有）: key -> (zh, en, tr)
NEW = {
 'x_txPreview':   ('交易预览', 'Transaction preview', 'İşlem önizleme'),
 'x_buildFail2':  ('构建失败：%1$s', 'Build failed: %1$s', 'Oluşturma hatası: %1$s'),
 'x_kind':        ('类型', 'Type', 'Tür'),
 'x_bytes':       ('字节数', 'Size (bytes)', 'Boyut (bayt)'),
 'x_digest':      ('摘要', 'Digest', 'Özet'),
 'x_selfcheck':   ('签名自检', 'Signature self-check', 'İmza öz-denetimi'),
 'x_unsignedOnly':('仅未签名体', 'Unsigned only', 'Yalnızca imzasız'),
 'x_curCollVal':  ('当前抵押价值', 'Current collateral value', 'Mevcut teminat değeri'),
 'x_maxBorrow':   ('可借上限', 'Borrow limit', 'Borç limiti'),
 'x_needColl':    ('本笔需抵押', 'Collateral needed now', 'Bu işlem için teminat'),
 'x_valueApprox': ('本笔 ≈ 价值', 'This ≈ value', 'Bu ≈ değer'),
 'x_newMaxBorrow':('追加后总可借', 'Total borrowable after', 'Sonra toplam borçlanılabilir'),
 'x_whoHint':     ('地址（留空 = 当前）', 'Address (blank = current)', 'Adres (boş = mevcut)'),
 'x_signed':      ('已签名', 'Signed', 'İmzalandı'),
 'x_nBytes':      ('%1$s 字节', '%1$s bytes', '%1$s bayt'),
 'x_saved':       ('已保存：%1$s', 'Saved: %1$s', 'Kaydedildi: %1$s'),
 'x_scanNote':    ('逐张扫描冷端的 HXDS 分片，收齐后自动校验并广播',
                   'Scan HXDS shards one by one; auto-verify and broadcast when complete',
                   'HXDS parçalarını tek tek tarayın; tamamlanınca doğrula ve yayınla'),
 'x_notShard':    ('扫码失败：不是 HXDS 分片', 'Scan failed: not an HXDS shard',
                   'Tarama hatası: HXDS parçası değil'),
 'x_scannedSeq':  ('已扫第 %1$s/%2$s 片', 'Scanned %1$s/%2$s', '%1$s/%2$s tarandı'),
 'x_aimQr':       ('对准冷端的分片二维码', 'Aim at the cold side shard QR',
                   'Soğuk taraf parça QR\'ına doğrultun'),
 'x_netCfg':      ('网络配置', 'Network settings', 'Ağ ayarları'),
 'x_cfgSaved':    ('配置已保存', 'Settings saved', 'Ayarlar kaydedildi'),
 'x_lockedOk':    ('已锁定', 'Locked', 'Kilitlendi'),
 'x_switched':    ('已切换：%1$s', 'Switched: %1$s', 'Değiştirildi: %1$s'),
 'x_openFail':    ('打开失败：%1$s', 'Open failed: %1$s', 'Açma hatası: %1$s'),
 'x_bioFail':     ('生物识别未通过：%1$s', 'Biometric failed: %1$s', 'Biyometri başarısız: %1$s'),
 'x_deleted':     ('已删除', 'Deleted', 'Silindi'),
 'x_randKey':     ('随机私钥', 'Random key', 'Rastgele anahtar'),
 'x_pwDerived':   ('口令派生', 'Passphrase-derived', 'Parola türevli'),
 'x_passphrase':  ('口令', 'Passphrase', 'Parola'),
 'x_pwMin':       ('密码至少 6 位', 'Password must be at least 6 chars',
                   'Parola en az 6 karakter olmalı'),
 'x_created':     ('已创建并解锁：%1$s', 'Created & unlocked: %1$s', 'Oluşturuldu ve açıldı: %1$s'),
 'x_createFail':  ('创建失败：%1$s', 'Create failed: %1$s', 'Oluşturma hatası: %1$s'),
 'x_imported':    ('已导入并解锁：%1$s', 'Imported & unlocked: %1$s', 'İçe aktarıldı ve açıldı: %1$s'),
 'x_importFail':  ('导入失败：%1$s', 'Import failed: %1$s', 'İçe aktarma hatası: %1$s'),
 'x_nSelected':   ('%1$s 颗 · 已选 %2$s', '%1$s diamonds · %2$s selected', '%1$s elmas · %2$s seçili'),
 'x_sortScore':   ('按分数', 'By score', 'Puana göre'),
 'x_sortNumber':  ('按编号', 'By number', 'Numaraya göre'),
 'x_sortName':    ('按名称', 'By name', 'Ada göre'),
 'x_cancel':      ('取消', 'Cancel', 'İptal'),
 'x_harvestHint': ('调 lp_harvest 领取你的 LP 奖励', 'Call lp_harvest to claim your LP rewards',
                   'LP ödüllerinizi almak için lp_harvest çağırın'),
 'x_pendHac':     ('待领 LP 奖励 HAC', 'Pending LP reward HAC', 'Bekleyen LP ödülü HAC'),
 'x_pendDs':      ('待领 LP 奖励 hacds', 'Pending LP reward hacds', 'Bekleyen LP ödülü hacds'),
 'x_treTransfer': ('向金库地址转账即可（合约自动扣减 tre:）',
                   'Just transfer to the treasury (contract auto-deducts tre:)',
                   'Hazineye transfer yeterli (sözleşme tre: düşer)'),
 'x_treHac':      ('金库待结算 HAC', 'Treasury pending HAC', 'Hazine bekleyen HAC'),
 'x_treDs':       ('金库待结算 hacds', 'Treasury pending hacds', 'Hazine bekleyen hacds'),
 'x_sweepNote':   ('清扫 = 普通 HAC/资产转账到金库地址 %1$s（见「链上转账」页）。',
                   'Sweep = plain HAC/asset transfer to treasury %1$s (see "On-chain transfer").',
                   'Süpürme = hazine %1$s adresine normal transfer ("Zincir transferi").'),
 'x_needIdx':     ('需要链下索引器（D57）', 'Requires off-chain indexer (D57)',
                   'Zincir dışı indeksleyici gerekir (D57)'),
 'x_srcServer':   ('来源：服务端索引器', 'Source: server indexer', 'Kaynak: sunucu indeksleyici'),
 'x_idxDown':     ('未连接索引器：%1$s', 'Indexer not connected: %1$s', 'İndeksleyici bağlı değil: %1$s'),
 'x_liquidatable':('⚠ 可清算', '⚠ Liquidatable', '⚠ Tasfiye edilebilir'),
 'x_noDebt':      ('无债务', 'No debt', 'Borç yok'),
 'x_safe':        ('安全', 'Safe', 'Güvenli'),
 'x_safeNoDebt':  ('安全 · 无债务', 'Safe · no debt', 'Güvenli · borç yok'),
}

RES = r'D:\hacds_server-main\android-app\app\src\main\res'
DIRS = {'values': 0, 'values-en': 1, 'values-tr': 2}
for d, idx in DIRS.items():
    p = os.path.join(RES, d, 'strings.xml')
    s = open(p, encoding='utf-8').read()
    ins = []
    for k, vals in NEW.items():
        if f'name="{k}"' not in s:
            v = vals[idx].replace('&', '&amp;').replace('<', '&lt;').replace('>', '&gt;')
            ins.append(f'    <string name="{k}">{v}</string>')
    if ins:
        s = s.replace('</resources>', '\n'.join(ins) + '\n</resources>')
        open(p, 'w', encoding='utf-8').write(s)
    print(d, '新增', len(ins))
print('新增键总数', len(NEW))
