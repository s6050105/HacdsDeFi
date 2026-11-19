# HacdsDeFi RPC Belgeleri

2026-11-18　Kontrat #4000　Geliştiriciler için

> Bu belge, Hacash ana ağındaki `HacdsDeFi3000.fitsh` kontratını açıklar
> (adres `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`, hacds varlık serial 4000, ondalık 0;
> pay varlığı serial 4001, ihraççı dağıtıcı adresidir).
>
> **Bu belge hiçbir #2000 dönemi arayüzü içermez.** Oracle, puanlama sertifikaları
> ve yönetici fonksiyonları yeni kontratta **artık yok** — yetkiler alındığı için
> değil, bu fonksiyonlar hiç yazılmadığı için.

---

## 0. Servislere genel bakış

hacds dört HTTP servisi içerir. İlk ikisi zinciri okur, diğer ikisi kolaylıktır.

| Servis | Adres | Protokol | Amaç |
|---|---|---|---|
| Tam düğüm RPC | `node.hacds.com` | HTTP/JSON | Zincir verisi sorgulama, sandbox salt okunur çağrı, işlem doğrulama/yayınlama |
| API vekili | `api.hacds.com` | HTTP/JSON | Tam düğüme yönlendirir, CORS + HTTPS ekler |
| İndeksleyici | `indexer.hacds.com` | HTTP/JSON | Borçlu defteri (kim tasfiye edilebilir) |
| İşlem oluşturma servisi | `build.hacds.com` | HTTP/JSON | İnsan girdisini imzasız işleme çevirir |

```
                  ┌───────────────┐
 istemci ──GET──► │ Tam düğüm RPC │◄── indeksleyici (zinciri tarar, defter kurar)
    │             └───────────────┘
    │                     ▲
    └──POST──► oluşturma ─┘   (yalnızca oluşturur, imzalamaz)
```

**API vekili neden gerekli**: tam düğüm CORS başlığı döndürmez, tarayıcıdan doğrudan
çağrı engellenir. `api.hacds.com` yalnızca yönlendirme ve başlık ekleme yapan bir
Cloudflare Worker'dır; anlamı değiştirmez. Sunucu tarafı portlar 80/443 değildir,
Cloudflare kaynağa Tunnel üzerinden ulaşır.

**Yanıt kuralı**: tüm arayüzler JSON döndürür ve üst düzeyde `ret` alanı bulunur.
`ret: 0` başarıyı, sıfır dışı değer başarısızlığı gösterir (başarısızlıkta genellikle
`err` bulunur).

> ⚠ **Başarısızlık da HTTP 200 döner.** Yalnızca durum koduna bakmayın, gövdedeki
> `ret` alanını kontrol etmelisiniz.

**Düğüm adresleri neden `IP:port` değil de alt alan adı**: Cloudflare Workers
yalnızca 80/443 portlarına erişebilir. `IP:8082` biçimindeki her adres bağlantı
kurulmadan reddedilir (`error code: 1003`). Bu nedenle dışarıya karşı her şey
`*.hacds.com` alt alan adı + Tunnel üzerinden gider.

---

## 1. Tam düğüm API'si

### 1.1 Blok yüksekliği sorgulama

```
GET /query/block/height/latest
```

```json
{"ret":0,"height":798812}
```

VM durumu (etkin mi, güncel yükseklik):

```
GET /api/vm/status
```

```json
{"ret":0,"vm":"enabled","height":798812}
```

---

### 1.2 Ortalama ücret oranı sorgulama

İşlem ücretini tahmin etmek için kullanılır.

```
GET /query/fee/average
```

```json
{"ret":0,"purity":"6024000000","purity_unit":232}
```

`purity` = `fee / billing_size (bayt)`; düğüm kabul koşulu `purity ≥ min_purity`.

---

### 1.3 Bakiye sorgulama (HAC / elmas / varlık)

```
GET /query/balance?address={adres}&assets=true&asset_meta=true&diamonds=true
```

Üç anahtar da isteğe bağlıdır:

| Parametre | Etkisi |
|---|---|
| `assets=true` | Varlık listesini ekler (hacds buradadır) |
| `asset_meta=true` | Varlık adı / arz gibi üst verileri ekler |
| `diamonds=true` | HACD elmas listesini ekler |

```json
{
  "ret": 0,
  "list": [{
    "address": "1P2tsn...",
    "hacash": "1234567:248",
    "diamond": 3,
    "assets": [{"serial": 4000, "amount": "100000000"}]
  }]
}
```

**Tutarlar `<değer>:<birim>` biçimindedir**: `5:249` 50 HAC demektir
(5 × 10^(249−248)), 5.0038 değil. Dönüşüm formülü için bkz. §8.3.

---

### 1.4 Elmas ayrıntısı sorgulama

```
GET /query/diamond?name={6 karakterli elmas adı}
```

Elmasın numarasını, görsel genini, ait olduğu adresi vb. döndürür. Puanlama için
gereken `number` ve `visual_gene` buradadır.

---

### 1.5 Sandbox salt okunur çağrı (**kontrat durumunu okumanın ana yolu**)

```
GET /query/contract/sandboxcall?contract={kontrat}&function={fonksiyon}&params={parametreler}&caller={çağıran}
```

Salt okunur çalışır: zincir durumuna yazmaz, işlem göndermez, ücret harcamaz.

**Ölçülmüş yanıt**:

```json
{"ret":0,"use_gas":377,"gas_use":{"compute":132,"resource":209,"storage":36},"ret_val":120200677111}
```

| Alan | Anlamı |
|---|---|
| `ret` | 0 = çağrı başarılı |
| `ret_val` | Fonksiyonun dönüş değeri |
| `use_gas` / `gas_use` | Bu çağrıdaki tüketim, tahmin için kullanılır |

> ⚠ **Adres yanlışsa burada `NotFindContract` döner.** Kontrat 2026-11-18'de ana ağa
> dağıtıldı (ikinci tur); geçerli güncel adres §8.2'dedir. Eski adres
> `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` iptal edilmiş birinci tur dağıtımıdır, onu
> çağırmak bu hatayı verir.

#### 1.5.1 Bilmeniz gereken iki tuzak

**Tuzak 1: `caller` verilmezse başarısız olur.**

```json
{"ret":1,"err":"[revert] address \"1111...\" balance 0:0 is insufficient, at least 559555:242"}
```

Varsayılan çağıranın bakiyesi 0'dır ve ön ödemeli gas'ı karşılayamaz. **`caller={kontrat
adresi}` verirseniz çalışır** — bir kontratın kendini çağırması bakiye gerektirmez.

**Tuzak 2: IP başına eşzamanlılık sınırı 2'dir.** Sınırı aşan istekler **doğrudan
reddedilir**, kuyruğa alınmaz:

```json
{"ret":1,"err":"sandbox_per_ip_concurrency_exceeded"}
```

İstemciler **serileştirme + geri çekilmeli yeniden deneme** yapmalıdır. `Promise.all`
ile bir düzine isteği aynı anda göndermeyin.

#### 1.5.2 Parametre biçimi

`params` virgülle ayrılmış `değer:tür` biçimindedir. `:` karakteri `%3A` olarak URL
kodlanmalıdır.

| Tür | Örnek |
|---|---|
| `u128` | `100000000:u128` |
| `address` | `1P2tsn...:address` |
| `bytes` | `WTYUIA:bytes` |

#### 1.5.3 Salt okunur fonksiyonların tam listesi

**AMM ve likidite**

| Fonksiyon | Parametreler | Dönüş | Açıklama |
|---|---|---|---|
| `amm_reserves` | — | u128 | Havuzdaki HAC (**zhu**) |
| `amm_reserve_ds` | — | u128 | Havuzdaki hacds (**adet**) |
| `pool_price` | — | u128 | Havuz fiyatı = `amm:hac × 1e8 / amm:ds` |
| `lp_total` | — | u128 | Toplam LP payı |
| `lp_share_of` | `who:address` | u128 | Bir adresin LP payı |
| `lp_pending_hac` | `who:address` | u128 | Bekleyen LP ödülü (HAC, zhu) |
| `lp_pending_ds` | `who:address` | u128 | Bekleyen LP ödülü (hacds, adet) |
| `total_staked` | `kind:u128` | u128 | kind `0`=HAC, `1`=hacds |

**Borç verme**

| Fonksiyon | Parametreler | Dönüş | Açıklama |
|---|---|---|---|
| `loan_debt_of` | `who:address` | u128 | Anapara (zhu), hesaplanmamış faiz **hariç** |
| `loan_debt_now` | `who:address` | u128 | Faiz dahil gerçek zamanlı borç (zhu) |
| `loan_coll_of` | `who:address` | u128 | Kilitli teminat (hacds adet) |
| `loan_health` | `who:address` | u128 | **On binde bir cinsinden sağlık**, aşağıya bakın |
| `loan_status` | `who:address` | u128 | Teminat oranı ×100, aşağıya bakın |
| `total_debt` | — | u128 | Küresel borç (zhu) |
| `providers_total` | — | u128 | Ödünç verilebilir tüm fonlar |
| `utilization` | — | u128 | Güncel kullanım oranı (bps) |
| `borrow_coll_ratio` | — | u128 | Borçlanma çizgisi yüzdesi (`200`) |
| `liq_coll_ratio` | — | u128 | Tasfiye çizgisi yüzdesi (`160`) |
| `borrow_paused` | — | u128 | Sıfır dışı = yeni borçlanma durduruldu (kullanım oranı veya devre kesici) |
| `ref_paused` | — | u128 | Sıfır dışı = fiyat sapması devre kesicisi aktif |
| `lendable_amm` | — | u128 | AMM'nin ödünç verilebilir kısmı (%30) |
| `net_claims` | — | u128 | Ağ geneli alacaklar |
| `reserve_hac` | — | u128 | Takipteki alacak rezervi |
| `deficit_hac` | — | u128 | Açık |

**Sağlık değeri nasıl doğru okunur**

| `loan_health` dönüşü | Anlamı |
|---|---|
| `1000000` | Borç yok (kontratın döndürdüğü sentinel değer, son derece sağlıklı kabul edilir) |
| `> 10000` | Güvenli |
| `= 10000` | Tam tasfiye çizgisinde |
| `< 10000` | **Tasfiye edilebilir** |
| `< 9000` | Derin su bölgesi, tamamen tasfiye edilebilir |

**Kritik nokta**: bu değer `coll_to_hac_liq()` ile hesaplanır, yani **muhafazakâr fiyat
`min(spot fiyat, yumuşatılmış referans fiyat)`** kullanılır ve `loan_liquidate`
kararıyla **aynı kaynaktan** gelir. Bu nedenle "arayüz güvenli diyor ama zincirde
tasfiye edilebilir" durumu oluşamaz. Sağlığı `loan_status` üzerinden kendiniz
hesaplamayın; bunu kullanın.

`loan_status` eski ölçüdür (`coll_hac × 100 / debt`, spot fiyatla) ve uyumluluk için
korunmuştur:

| Dönüş | Anlamı |
|---|---|
| `0` | Borç yok, teminat yok |
| `999` | Teminat var ama borç yok |
| Diğer | Teminat oranı ×100 |

**HACD havuzu**

| Fonksiyon | Parametreler | Dönüş | Açıklama |
|---|---|---|---|
| `hacd_score_total` | — | u128 | Havuzdaki toplam HACD puanı (×`SCORE_SCALE` uygulanmış) |
| `hacd_count` | — | u128 | Havuzdaki HACD adedi |
| `hacd_avg_score` | — | u128 | Ortalama puan (×`SCORE_SCALE` uygulanmış) |
| `hacd_coverage` | — | u128 | Kapsama oranı (bps, 10000 = %100) |
| `quote_redeem` | `sc:u128` | tuple | Geri alma teklifi, aşağıya bakın |
| `quote_score` | `name:bytes,vg:bytes,num:u128` | u128 | Ad + gen + numaradan puan hesaplar |

**`quote_redeem` dönüş değeri**: `tuple(charge, fee, premium_bps, ok)`

| Öğe | Anlamı |
|---|---|
| `charge` | Toplam düşülen (anapara + ücret) |
| `fee` | Bunun içindeki ücret |
| `premium_bps` | Elmas seçme primi (bps) |
| `ok` | `1` = geri alınabilir; `0` = gerçek işlem `61` döndürür (havuzda kayıt yok veya puan yetersiz) |

**Fiyatlar ve çarpanlar**

| Fonksiyon | Parametreler | Dönüş | Açıklama |
|---|---|---|---|
| `ref_price_of` | — | u128 | Yumuşatılmış referans fiyat |
| `ref_price_zhu_per_ds` | — | u128 | Referans fiyat (hacds başına zhu) |
| `ref_height` | — | u128 | Referans fiyatın son güncellendiği blok yüksekliği |
| `hcut` | — | u128 | HAC toplumsallaştırma çarpanı (1e12 ölçekli, yalnızca düşer) |
| `lcut` | — | u128 | LP ödülü toplumsallaştırma çarpanı |

**Hesap ve kasa**

| Fonksiyon | Parametreler | Dönüş | Açıklama |
|---|---|---|---|
| `balance_hac` | `who:address` | u128 | Etkin HAC bakiyesi (zhu, hcut ile çarpılmış) |
| `balance_hac_nominal` | `who:address` | u128 | Nominal pay (zhu) |
| `balance_ds` | `who:address` | u128 | Adresin alacağı hacds kotası due |
| `bad_of` | `who:address` | u128 | O adresin takipteki alacağı |
| `treasury_pending` | `kind:u128` | u128 | Kasanın süpürülmeyi bekleyen tutarı. `0`=HAC, `1`=hacds |
| `treasury_ds` | — | u128 | Kasada birikmiş hacds |
| `tot_hac` | — | u128 | Toplam HAC (etkin değer) |
| `tot_hac_nominal` | — | u128 | Toplam HAC (nominal pay) |
| `lpr_hac_effective` | — | u128 | LP ödül havuzunun etkin değeri |

**İşletim**

| Fonksiyon | Parametreler | Dönüş | Açıklama |
|---|---|---|---|
| `self_check` | — | u128 | İç tutarlılık öz denetimi, `0` = geçti |
| `rent_key_group_count` | — | u128 | Anahtar grubu sayısı (sabit `7`) |
| `rent_key_len_at` | `idx:u128` | u128 | idx numaralı grubun anahtar uzunluğu |
| `rent_keys_group` | `klen:u128` | bytes | O uzunluk grubundaki tüm anahtarlar (doğrudan `rent_keys`'e verilebilir) |

#### 1.5.4 Ölçülmüş örnek

```
GET {node}/query/contract/sandboxcall?contract=bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
    &function=loan_health&params=1P2tsn...%3Aaddress&caller=bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h
→ {"ret":0,"use_gas":830,"gas_use":{"compute":363,"resource":323,"storage":144},"ret_val":1000000}
```

`ret_val: 1000000` = bu adresin borcu yok.

---

### 1.6 Blok özeti sorgulama

İndeksleyici bunu blokları tarayıp borçluları bulmak için kullanır.

```
GET /query/block/intro?height={yükseklik}&tx_hash_list=true
```

---

### 1.7 İşlem sorgulama

```
GET /query/transaction?hash={işlem karması}
```

---

### 1.8 İşlem doğrulama (insan tarafından okunabilir açıklama ile)

```
POST /util/transaction/check
Content-Type: application/json

{"tx": "040000...(hex)"}
```

Başarılı olduğunda ayrıştırma sonucunu ve okunabilir eylem açıklamasını döndürür, örneğin:

```json
{"ret":0,"describe":"[CallContract] bw2sRC... -> swap_hac_to_ds(...)"}
```

**Bu arayüz imzalamaz ve yayınlamaz, yalnızca doğrular.** Cüzdanlar yayınlamadan önce
son kontrol olarak bunu kullanır.

---

### 1.9 İşlem yayınlama

```
POST /submit/transaction
Content-Type: application/json

{"tx": "040000...(hex)"}
```

```json
{"ret":0}
```

> ⚠ `ret: 0` **yalnızca bellek havuzuna girdiğini** gösterir, zincire yazıldığı
> anlamına gelmez. Blok hedefi 300 saniyedir, `/query/transaction` sorgusunu blok
> ritmine göre tekrarlayın.

---

### 1.10 Kontrat depolama ücreti parametreleri

```
GET /query/contract/storage_cost?contract={kontrat}
```

Kira yenileme maliyetini tahmin etmek için kullanılır.

---

## 2. İndeksleyici API'si

İndeksleyici zinciri tarar ve "kimin borcu var, kim tasfiye edilebilir" defterini tutar.
**Cüzdanlar zinciri yerel olarak taramaz.**

### 2.1 Sağlık kontrolü

```
GET /health
```

```json
{"ok": true, "service": "hacds-indexer", "head": 798812, "watched": 0}
```

### 2.2 Defter anlık görüntüsü (**istemcinin ihtiyaç duyduğu tek arayüz**)

```
GET /snapshot
```

İzlenen tüm adreslerin sağlık anlık görüntüsünü döndürür:

```json
{
  "head": 798812,
  "updated": 1762900000,
  "items": [
    {"addr": "1P2tsn...", "debt": "100000000", "coll": "300000000",
     "health": 16000, "ratio": 160, "liq": true}
  ]
}
```

| Alan | Açıklama |
|---|---|
| `debt` | `loan_debt_now` (faiz dahil) |
| `coll` | Teminat hacds adedi |
| `health` | On binde bir cinsinden, `loan_health` ile aynı ölçü |
| `ratio` | Teminat oranı yüzdesi |
| `liq` | `true` = şu anda tasfiye edilebilir |

### 2.3 Yalnızca anlık görüntü (senkronizasyon tetiklemez)

```
GET /snapshot?cached=1
```

### 2.4 Hemen senkronize et

```
POST /sync
```

En son bloğa kadar taramayı zorlar. İşletim içindir; normalde çağırmaya gerek yoktur.

### 2.5 İzleme listesi bakımı

```
POST /watch/add?addr={adres}
POST /watch/remove?addr={adres}
```

İndeksleyici borçluları otomatik keşfeder; bu iki arayüz elle eksik kapatmak içindir.

### 2.6 Varlık karşılığı kapsama izleme

```
GET /backing
```

"Kontratın kaydettiği toplam due" ile "zincirde gerçekten ihraç edilmiş hacds"
karşılaştırılır; anormallik tespiti içindir.

### 2.7 Kira partileri

```
GET /rent_batches
```

Uzunluğa göre gruplanmış ve doğrudan `rent_keys`'e verilebilen anahtar partilerini
döndürür. Keeper'lar bunu kira yenileme için kullanır.

### 2.8 Dağıtım

```bash
python3 hacds_indexer.py --node http://127.0.0.1:8082 \
    --contract bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h --port 8124
```

---

## 3. İşlem oluşturma servisi

Bu servis "insan tarafından okunabilir parametreleri" "imzasız işleme" çevirir.
**Hiçbir özel anahtar tutmaz; oluşturduğu işlem istemci tarafından imzalanmalıdır.**

Kaynak: `hacds_exchange/indexer/hacds_build_server.py`

### 3.0 Neden gerekli

Hacash işlem yapısı hassas fee / gas / eylem kodlaması gerektirir, ayrıca elmas adı
listelerinin wire biçimini de ele almak gerekir. Her istemcinin bunu kendisi
uygulaması, "üç uçta farklı davranış" garantisi demektir. Oluşturma mantığını tek bir
serviste toplayın, istemci yalnızca imzalasın — **imzalanan şey değişti, ama imzalayan
kişi değişmedi.**

### 3.1 Sağlık kontrolü

```
GET /health
```

```json
{"ok": true, "service": "hacds-build", "version": "2026-11-18.1",
 "txbuild_ok": true, "contract": "bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h"}
```

`version` önemlidir: Python sıcak yeniden yükleme yapmaz, betik değiştiyse süreç
yeniden başlatılmalıdır. Davranış `version` ile uyuşmuyorsa önce sürecin gerçekten
yeniden başlatıldığını doğrulayın.

### 3.2 Kontrat çağrısı oluşturma

```
POST /api/build
Content-Type: application/json

{
  "mode": "call",
  "main": "1P2tsn...",
  "fn": "swap_hac_to_ds",
  "params": "100000000:u128,0:u128,0:u128",
  "fee": "0:248",
  "gasMax": 99
}
```

| Alan | Zorunlu | Açıklama |
|---|---|---|
| `mode` | Hayır | `call` (varsayılan) veya `transfer` |
| `main` | ✅ | Başlatan adres (ücreti ödeyen) |
| `fn` | ✅ | Kontrat fonksiyon adı, beyaz liste için §3.4 |
| `params` | Hayır | Virgülle ayrılmış `değer:tür`, varsayılan `-` |
| `fee` | Hayır | `0:248` biçiminde |
| `gasMax` | Hayır | `1–99` arası tam sayı, varsayılan `99` |

Yanıt:

```json
{"ok": true, "unsigned_tx": "040000...", "fn": "swap_hac_to_ds",
 "fee": "0:248", "gas_max": 99}
```

### 3.3 Transfer oluşturma

```
POST /api/build
{
  "mode": "transfer",
  "main": "1P2tsn...",
  "sub": "hacd-from-to",
  "fee": "0:248"
}
```

`sub`, `hacds_txbuild transfer` komutunun alt komutudur; ek parametreler alt komuta
göre verilir. **`from` kontrat adresine kilitlidir** — bu bir güvenlik kısıtıdır,
birinin bu servisi kullanarak "herhangi bir adresten transfer" işlemi oluşturmasını
engeller.

### 3.4 Fonksiyon beyaz listesi

```
swap_hac_to_ds · swap_ds_to_hac
add_liquidity · remove_liquidity · lp_harvest
loan_add_collateral · loan_borrow · loan_repay · loan_liquidate
rent_keys · topup_keys
```

Beyaz listede olmayan fonksiyonlar reddedilir. **Bu bir beyaz listedir, kara liste
değil** — yeni fonksiyonlar açıkça eklenmelidir.

### 3.5 Sınırlar

| Sınır | Değer | Neden |
|---|---|---|
| IP başına dakikada istek | 30 | Kötüye kullanımı önleme |
| İstek gövdesi | 8 KB | Parametre dizisi üst sınırı 1024 bayt, en fazla 16 öğe |
| Elmas adı listesi | En fazla 200 | `MAX_DEPOSIT_COUNT` ile eşleşir |
| `gasMax` | 1–99 | Kontrat/motor için geçerli aralık |

### 3.6 Hata kodları

| `error` | Anlamı |
|---|---|
| `bad_json` | İstek gövdesi geçerli JSON değil |
| `bad_length` | İstek gövdesi boş veya 8 KB'ı aşıyor |
| `bad_main` | `main` geçerli bir adres değil |
| `bad_fee` | `fee` `değer:mantis` biçiminde değil |
| `bad_gasMax` | `gasMax` 1–99 arası bir tam sayı değil |
| `fn_not_allowed` | Fonksiyon beyaz listede değil |
| `bad_params` | Parametre dizisi biçimi hatalı |
| `rate_limited` | Dakikada 30 isteği aştınız |
| `build_timeout` | Motor zaman aşımı (30 saniye) |
| `engine_missing` | Sunucuda `hacds_txbuild` bulunamadı |

---

## 4. Kontrat B (Kasa temettüleri)

Kontrat B ayrı dağıtılmış **saf temettü havuzudur**, adresi
`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (nonce 4).

**Yöneticisizdir; pause'u yoktur, parametre değiştirme arayüzü yoktur**; tüm
parametreler derleme zamanı sabitleridir.

Okuma yöntemi kontrat A ile aynıdır, yalnızca `contract` parametresini B'nin adresiyle
değiştirin:

```
GET /query/contract/sandboxcall?contract=duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4&function=<fn>
```

### 4.1 ⚠ Önce şunu anlayın: elde tutmak ≠ temettü

Kullanıcı A, 4001'i kullanıcı B'ye transfer eder; bu eylem **kontrat B'den hiç geçmez**
(kanca yalnızca kontrat `from` veya `to` olduğunda tetiklenir).

Bu nedenle kontrat "satış anını" algılayamaz ve o anda hesaplayamaz. Çözümü şudur:
**yalnızca kontrat B'ye yatırılan paylar faiz işletir.**

| Konum | Temettüye katılır mı |
|---|---|
| Kullanıcı cüzdanındaki 4001 | ❌ Katılmaz |
| B'ye yatırılmış paylar (`sh:<adres>`) | ✅ Katılır |

Kontrat içinde `sh:<addr>` **tek yetkili** temettü payı defteridir.

### 4.2 Salt okunur görünümler

| Fonksiyon | Parametreler | Dönüş | Açıklama |
|---|---|---|---|
| `share_serial()` | — | u128 | Her zaman **4001** olmalıdır. Kontrat kimliğini doğrulamak için |
| `share_total()` | — | u128 | Pay ihraç üst sınırı (10000), yalnızca üst veri |
| `get_shares(who)` | `address` | u128 | **Yatırılmış paylar** (temettünün tek dayanağı) |
| `get_due(who)` | `address` | u128 | **Hesaplanmış, çekilmeye hazır** (HAC, zhu) |
| `get_claimable(who)` | `address` | u128 | **Toplam çekilebilir** = due + hesaplanmamış artış |
| `get_checkpoint(who)` | `address` | u128 | O adresin kontrol noktası (×1e12) |
| `get_current_rpu()` | — | u128 | Küresel biriktirici (×1e12) |
| `get_total_dividend()` | — | u128 | Kümülatif toplam temettü (zhu) |
| `get_reserve()` | — | u128 | Kira yenileme rezervi (zhu) |
| `rent_ratio_bps()` | — | u128 | Kira ayırma oranı (2000 = %20) |
| `rpu_scale()` | — | u128 | Sabit nokta ölçek çarpanı (1e12) |
| `ahac_group_count()` | — | u128 | A'nın anahtar grup sayısını geçirir (şu anda 7) |

**⚠ `get_claimable` semantiğindeki tuzak:**

```
get_claimable(who) = due(who) + hesaplanmamış artış
```

`claim()` artışı `due` içine hesaplar ve kontrol noktasını ilerletir, dolayısıyla
**claim sonrasında `get_claimable` değeri değişmez**.

Arayüz bunu "çekilebilir" değil "çekilmeye hazır" olarak göstermelidir; aksi halde
kullanıcı claim'e basar, sayının değişmediğini görür ve özelliğin bozuk olduğunu
düşünür.

**Doğru üçlü ayrım:**

| Alan | Anlamı |
|---|---|
| `get_due` | Hesaplanmış, yalnızca çekme kaldı |
| `get_claimable − get_due` | Henüz hesaplanmamış artış |
| `get_claimable` | İkisinin toplamı |

### 4.3 Yazma işlemleri

| İşlem | Gerçek zincir eylemi | Açıklama |
|---|---|---|
| **Yatırma** | `TransferAssetFromTo(kendisi → B, 4001, N)` | `PayableAsset` tetiklenir, `sh:<kendisi>` artar |
| **Geri alma** | `TransferAssetFromTo(B → kendisi, 4001, N)` | `PermitAsset` tetiklenir, **önce hesaplanır sonra pay azalır** |
| **Temettü alma** | `ContractMainCall(B, 'claim')` | Artışı `due` içine hesaplar, **para hâlâ kontratta** |
| **Çekme** | `TransferHacFromTo(B → kendisi, X)` | `PermitHAC` tetiklenir, para gerçekten ulaşır |

**Alma ve çekme iki adımdır, ikisi de yapılmalıdır.** Yalnızca claim yapılırsa cüzdan
bakiyesi değişmez.

İki adımı `combo` atomik işlemle birleştirmeniz önerilir (bkz. Bölüm 5):

```json
{
  "contract": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
  "actions": [
    { "type": "call", "contract": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
      "fn": "claim", "params": "-" },
    { "type": "hac-from-to", "from": "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4",
      "to": "<adresiniz>", "hac": "23.52940000" }
  ]
}
```

⚠ **Sıra tersine çevrilemez.** Önce çekip sonra claim yaparsanız yalnızca eski `due`
çekilir, yeni temettü kontratta kalır (kaybolmaz ama kullanıcı deneyimi kötüdür).

### 4.4 Kira yenileme altyapısı

Kontrat B depolama anahtarlarını düzenli olarak yenilemelidir, aksi halde defter
silinir. Herkesin çağırıp ödül alabileceği dört **izinsiz** giriş noktası sunar:

| Fonksiyon | Neyi yeniler | Ödül kaynağı |
|---|---|---|
| `claim()` | Yalnızca **çağıranın kendi** 3 anahtarını | Yok (kendi gas'ını kendisi öder) |
| `pay_rent(period)` | B'nin kendi 3 küresel anahtarını | `reserve:rent` |
| `pay_rent_ahac(group, period)` | **Kontrat A**'nın belirli bir anahtar grubunu | `reserve:rent` |
| `pay_rent_shares(addrs, period)` | **Pay sahiplerinin** adres anahtarlarını | `reserve:rent` |

**`pay_rent_shares` 2026-11-18'de eklendi.** Parametre açıklaması:

| Parametre | Tür | Açıklama |
|---|---|---|
| `addrs` | `bytes` | **Bitişik 21 baytlık adresler** (okunabilir dizeler değil), `size % 21 == 0` |
| `period` | `u128` | Hedef kira süresi, aralık `[30, 3000]` |

Dönüş değerleri:

| Kod | Anlamı |
|---|---|
| 0 | Başarılı |
| 2 | Boş parametre |
| 3 | Uzunluk 21'e tam bölünmüyor |
| 60 | Çok fazla adres (tek çağrı kapasitesi period'a göre değişir) |
| 62 | period çok küçük |
| 63 | period çok büyük |

**Tek çağrıya kaç adres sığdığı period'a bağlıdır:**

| period | Adres başına gas | Tek çağrı üst sınırı |
|---|---|---|
| 30 | 3,240 | 34 adres |
| 100 | 10,800 | 10 adres |
| 300 | 32,400 | 3 adres |
| 1000 | 108,000 | 1 adres |
| 1027 | 110,916 | 1 adres (fiziksel sınır) |
| 1028+ | — | **0 (bir tanesi bile sığmaz)** |

Hesap formülü: `3 anahtar × 36 unit × period ≤ 111,000` (storage kovası üst sınırı).

### 4.5 İndeksleyicinin yeni uç noktası

**`GET /vault_addr_batches?max=N`**

Kasa B'nin **pay sahibi adreslerini** (bitişik 21 baytlık hex) döndürür; keeper'lar
bunu `pay_rent_shares` çağrısı oluşturmak için kullanır.

```json
{
  "ret": 0,
  "batches": [{ "blob": "00333ca1f19b602275f871a308675dfece685ae8e7", "count": 1 }],
  "total": 1,
  "max_addrs": 10
}
```

⚠ Yalnızca **B ile etkileşime girmiş** adresler döner (2026-11-20'den itibaren). Önceden
A'nın kullanıcıları da karışıyordu, bu da B'de var olmayan anahtarlar için boşuna
ücret ödenmesine yol açıyordu.

---

## 5. Atomik işlem (combo)

Birden fazla eylemi tek işlemde tamamlar: **ya hepsi başarılı olur ya da hepsi geri
alınır.** OTC pay devri buna dayanır.

### 5.1 Oluşturma

```
POST /api/build
{
  "mode": "combo",
  "main": "<işlemin ana adresi>",
  "spec": { "contract": "...", "actions": [...] },
  "gasMax": 99
}
```

`spec.contract` **yalnızca `call` eylemi içerdiğinde gereklidir**. Saf transferlerde
gerekmez.

### 5.2 Desteklenen eylem türleri

| type | Alanlar | Açıklama |
|---|---|---|
| `hac-to` | `to`, `hac` | main HAC gönderir |
| `hac-from-to` | `from`, `to`, `hac` | Belirtilen adres HAC gönderir (o adresin imzası gerekir) |
| `asset-to` | `to`, `serial`, `atoms` | main varlık gönderir |
| `asset-from-to` | `from`, `to`, `serial`, `atoms` | Belirtilen adres varlık gönderir |
| `hacd-to` | `to`, `names` | main elmas gönderir |
| `hacd-from-to` | `from`, `to`, `names` | Belirtilen adres elmas gönderir |
| `call` | `contract`, `fn`, `params` | Kontrat çağrısı |

### 5.3 Adım adım imzalama (OTC için zorunlu)

Zincir kuralı (`protocol/src/codec/tx.rs:450` `verify_type3_signatures_exact`):
**Type-3 işlemdeki imza sayısı imzalayan sayısına eşit olmalıdır** ve **yayınlama
anında** hepsi tamamlanmış olmalıdır.

Ancak `insert_sign` yalnızca ekleme yapar, sayı kontrolü yapmaz — bu nedenle "A bir
sürüm imzalar → B'ye gönderir → B imza ekler" protokol katmanında tamamen
uygulanabilirdir.

**Akış:**

```
① A imzasız gövdeyi oluşturur    → /api/build mode=combo
② A imzalar                      → tx:signRaw
   signed_check = PARTIAL (1/2) döner — 1 imza daha gerekli
③ A, signed_tx_hex'i B'ye gönderir
④ B bu işlem gövdesini çevirir   → /util/transaction/check?description=true&action=true
   ⚠ "Ne ödeyeceğinizi" ve "ne alacağınızı" madde madde kontrol etmelisiniz
⑤ B imza ekler                   → tx:signRaw (aynı hex)
   signed_check = OK (all signers signed) döner
⑥ Yayınlama
```

**A'nın imzası B'ye aktarıldığı için geçersizleşmez** — imzalama mevcut olanın üzerine
ekleme yapar, yeniden imzalama değildir.

### 5.4 ⚠ İşlem gövdesinin geçerlilik süresi yok

Zincirde "son kullanma zamanı" alanı yoktur. İmza karşı tarafa verildikten sonra bu
işlem **her an yayınlanabilir ve geri alınamaz**.

İstemciler bu cümleyi en görünür yerde göstermelidir.

### 5.5 Çeviricinin alan adları (sık yapılan hata)

Düğümün `/util/transaction/check` arayüzünün döndürdüğü eylem alan adları **spec'in
alan adlarıyla aynı değildir**:

| Zincir eylemi | JSON alanı |
|---|---|
| `TransferHacFromTo`(14) | `hacash` (**`hac` değil**) |
| `TransferAssetFromTo`(19) | `asset: { serial, amount }` |
| `TransferHacdFromTo`(6) | `diamonds` (tek olan `diamond`dır; **`names` değil**) |
| Adres | `AddrOrPtr` — bir **işaretçi indeks numarası** olabilir, bu durumda okunabilir adres elde edilemez |

Adres işaretçi biçiminde olduğu için elde edilemediğinde, o kalem için "alıcı ben miyim"
belirlemesi boş döner → bütünü doğrulanmamış olarak işaretlenir, arayüz uyarı
göstermelidir. **Bir sorun görünmüyor diye bunu geçiştirmeyin.**

---

## 6. Borsa listeleme entegrasyonu

### 6.0 Önce şunu unutmayın: amount tam sayı adettir

hacds **ondalık 0** bir varlıktır. Zincirden dönen `amount` adedin kendisidir,
**hiçbir dönüşüm yapılmaz**.

```json
{"serial": 4000, "amount": "100000000"}   →  100,000,000 adet hacds
```

Önceki sürüm ondalık 8'di ve 1e8'e bölmek gerekiyordu. **Bu sürümde bölmeyin.**

### 6.1 Varlık kimliği (listeleme kaydı için)

| Alan | Değer |
|---|---|
| serial | `4000` |
| ticket | `HACDS` |
| name | `hacds` |
| decimal | `0` |
| supply | `5963298700000000` |
| issuer | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |

⚠ Zincirde serial `1028` olan ve yine HACDS adını taşıyan bir varlık daha var (adı
"HACD Fragments", başkasının). **serial'a göre tanımlayın, ticket'a göre değil.**

⚠ serial `2000` ve `3000` iptal edilmiş tarihsel ihraçlardır (2000 #2000 sürümüdür;
3000 birinci tur ana ağ dağıtımıdır ve beraberindeki pay ihraççısı yanlış doldurulduğu
için bütünüyle terk edilmiştir). Kayıt için **kullanmayın**.

Ayrı bir pay varlığı vardır (listeleme hedefi değil, yalnızca kasa temettüsü
tanımlaması için):

| Alan | Değer |
|---|---|
| serial | `4001` |
| ticket | `HACDS-SHARE` |
| decimal | `0` |
| supply | `10000` |
| issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` (dağıtıcı adresi, **kontrat değil**) |

### 6.2 Yatırma tespiti

Blokları tarayın, `serial == 4000` ve `to == yatırma adresiniz` olan
`TransferAssetFromTo` eylemlerini bulun.

```
GET /query/block/intro?height={H}&tx_hash_list=true
  → tx_hash_list üzerinde dolaşın, her biri için GET /query/transaction?hash={h}
  → actions içindeki varlık transferlerine bakın
```

**Önerilen onay sayısı**: 3 blok (yaklaşık 15 dakika). Hacash blok hedefi 300
saniyedir, ancak dalgalanma olabilir.

### 6.3 Çekme oluşturma

Çekme standart bir varlık transferidir:

```bash
hacds_txbuild transfer {main} {ts} asset-from-to {from} {to} 4000 {amount}
```

> ⚠ **serial mutlaka `4000` sayısı olarak yazılmalı, `hacds` takma adı yazılmamalıdır.**
> `hacds_txbuild` içindeki `hacds` takma adı eski serial `2000`'i gösterir, #4000
> sürümü kontratın `HACDS_SERIAL = 4000` değeriyle uyuşmaz ve zincirde `PermitAsset`
> tarafından `return 1` ile reddedilir.
> `/api/build` üzerinden giderken sunucu `hacds`'i kendi `HACDS_SERIAL_MAINNET`
> değerine çevirir, ancak **komut satırından doğrudan çağrı** bu korumadan yararlanmaz.
>
> ⚠ İşletim notu: `hacds_build_server.py` içindeki `HACDS_SERIAL_MAINNET`, kontratın
> `HACDS_SERIAL` değeriyle aynı olmalıdır (bu turda `4000` olmalı). Her iki dağıtım
> turunda da serial değişti (3000 → 4000); numara değiştiğinde en kolay gözden kaçan
> yer burasıdır, kaçırıldığında belirti "`hacds` takma adıyla transfer başarısız olur,
> sayı yazınca başarılı olur" şeklindedir.

Veya oluşturma servisi üzerinden gidin (`mode=transfer`, `sub=asset-from-to`).

### 6.4 Yayınlama ve onay

```bash
POST {node}/submit/transaction
{"tx": "...hex..."}
```

`ret:0` yalnızca bellek havuzuna girdiğini gösterir. Blok yüksekliğine göre
`/query/transaction?hash=` tekrar sorgulanır; onay ancak `block_height` göründüğünde
gerçekleşmiş sayılır.

### 6.5 Ücret ve gas

| Öğe | Açıklama |
|---|---|
| fee biçimi | `değer:mantis`, örn. `0:248` (çok küçük), `2:247` (0.02 HAC) |
| Ücret formülü | `fee = purity × billing_size` |
| `gasMax` | `1–99`, varsayılan 99. **Kontrat çağrılarında 99'un altına inmeyin** |

### 6.6 Bilmeniz gereken üç kesin sınır

**① Tek işlem 16,384 bayt.** Bu derleme zamanı sabitidir. 200 elmas yatırıp çeken bir
işlem bu üst sınıra yaklaşır.

**② Sandbox IP başına eşzamanlılık = 2.** Aşılırsa doğrudan reddedilir, kuyruğa
alınmaz. Borsa arka ucu serileştirmelidir.

**③ Üç gas kovası**: compute 18,009 / resource 6,100 / storage 111,911. Aşılırsa
`OutOfGas(31): <kova adı> N > M` hatası verir. **`gasMax` artırmak işe yaramaz** — o
toplam kotadır, kova başına üst sınır kesin bir kısıttır.

> #4000'ün "işlem başına 1 elmas"tan "işlem başına 200 elmas"a çıkabilmesinin nedeni,
> puanlamanın RV64IM çekirdeğine taşınmasıdır: 200 elmas yalnızca 3,587 compute
> harcar, tek kovaya sığar. Eski FitSH sürümü 1 elmas için 3,270 resource harcıyordu,
> 2 tanesi 6,100'ü aşıyordu.

### 6.7 Piyasa yapıcılığı / fiyat kotasyonu için gereken veriler

```
GET {node}/query/contract/sandboxcall?contract={kontrat}&function=amm_reserves&caller={kontrat}
GET {node}/query/contract/sandboxcall?contract={kontrat}&function=amm_reserve_ds&caller={kontrat}
```

Spot fiyat (hacds başına zhu) = `amm_reserves × 1e8 / amm_reserve_ds`.

Toplu çekmek daha az zahmetlidir:

| Fonksiyon | Tek çağrıda aldığı |
|---|---|
| `ref_price_zhu_per_ds` | Yumuşatılmış referans fiyat |
| `pool_price` | Havuz fiyatı (×1e8) |
| `total_debt` / `utilization` | Borç verme kullanım oranı |
| `hacd_count` / `hacd_avg_score` | Havuz büyüklüğü |

### 6.8 Mutabakat

Zincirdeki özdeşlik:

```
kullanıcı due toplamı + AMM havuzu + kasa birikimi + LP ödül havuzu  ==  zincirde ihraç edilmiş toplam hacds
```

Bir tane daha:

```
etkin HAC bakiye toplamı × hcut == nominal pay toplamı
```

İndeksleyicinin `GET /backing` arayüzü her senkronizasyonda bunu doğrular. Uyuşmuyorsa
bir hata vardır.

### 6.9 Listeleme entegrasyon kontrol listesi

- [ ] serial `4000` ile kaydedin, decimal `0` (**8 değil**)
- [ ] Yatırmada yalnızca serial 4000 kabul edin, aynı ticket'lı #1028'i yok sayın
- [ ] Çekmede `asset-from-to` kullanın, `serial` doğrudan `4000` yazılsın (takma ad kullanmayın)
- [ ] Onay sayısı ≥ 3
- [ ] Arka uçta sandbox çağrılarını serileştirin (eşzamanlılık sınırı 2)
- [ ] Büyük çekmelerde işlem boyutunun 16,384 bayt sınırına çarpıp çarpmadığını kontrol edin
- [ ] Mutabakat için `/backing` ve zincir özdeşliklerini kullanın

---

## 7. Hata işleme

### 7.1 Kontrat dönüş kodları

Sandbox çağrısının döndürdüğü `ret_val` sıfır dışıysa, bu kontrat fonksiyonu içindeki
bir `return N` ifadesidir.

**Genel**

| Kod | Anlamı |
|---|---|
| `2` | Parametre biçimi hatası (örn. HACD ad listesinin wire biçimi geçersiz) |
| `48` | Adet aralık dışı (0 elmas yatırma / 200'den fazla / geri alma tam 1 değil) |
| `5` | Puan 0 |
| `53` | Toplam arz üst sınırı aşıldı |
| `54` | Kapsama yetersiz (%100 ihraçta hiç tetiklenmez) |
| `59` | Süresi dolmuş (`deadline`) |
| `61` | HACD havuzunda kayıt yok / puan yetersiz (geri alma) |

**AMM**

| Kod | Anlamı |
|---|---|
| `2` | Bir taraf 0 |
| `23` | Havuz boş değil ama pay sıfıra indi (ölçek sıfırlamasını önler) |
| `24` | Hesaplanan pay 0 (oran çok küçük) |
| `25` | LP payı yetersiz |
| `26` | İlk yatırımda tek taraf `1e18` üst sınırını aşıyor |
| `56` | Kayma koruması tetiklendi (`min_out` / `min_share` karşılanmadı) |

**Borç verme**

| Kod | Anlamı |
|---|---|
| `40` | Borçlanma limiti aşıldı (`(debt+hac) × %200 > coll_hac`) |
| `41` | Borç 0 (geri ödeme) |
| `50` | Küresel kullanım oranı %50'nin üzerinde |
| `51` | Borçlanma durduruldu (kullanım oranı doldu veya fiyat devre kesicisi) |
| `52` | Tek borçlu üst sınırı aşıldı (%20) |

**Tasfiye**

| Kod | Anlamı |
|---|---|
| `42` | O adresin borcu yok |
| `43` | Tasfiye çizgisine ulaşılmadı (tasfiye edilemez) |
| `44` | Tasfiye tutarı asgari tutarın altında (1 HAC) |
| `45` | Teminat çıktısı `min_coll_out` altında |
| `46` | Derin su tasfiyesi tamamını gerektirir (`repay < deep_pay`) |
| `47` | Referans fiyat başlatılmamış, tasfiye reddedildi |

**Yöneticiyle ilgili hiçbir şey yok**

`set_fee` / `set_loan_rate` / `set_liquidate_bonus` / `set_paused` / `set_oracle`
#4000'de **uygulanmamıştır**. Çağrılmaları şunu döndürür:

```
CallNotExist(51)
```

Bu yetki yetersizliği değil, **fonksiyonun var olmamasıdır**. Bu çağrıları yazmayı
bırakın.

### 7.2 Düğüm / sandbox hataları

Dize eşleştirmesiyle; yaygın kategoriler şunlardır:

| Ham mesaj | Anlamı | İşlem |
|---|---|---|
| `NotFindContract` | O adreste kontrat kodu yok | Kontrat adresinin bu turun `bw2sRC…` adresi olup olmadığını kontrol edin |
| `invalid address argument` / `InvalidChecksum` | Adres biçimi veya sağlama basamağı hatası | Tam adresi yeniden alın |
| `balance ... is insufficient` | Çağıranın bakiyesi ön ödemeli gas'a yetmiyor | Sandbox çağrısında `caller={kontrat adresi}` verin |
| `sandbox_per_ip_concurrency_exceeded` | Eşzamanlılık sınırı aşıldı | Serileştirme + geri çekilmeli yeniden deneme |
| `resource gas limit exceeded` | resource kovası aşıldı | İşlemi bölün; **gas_max artırmak işe yaramaz** |
| `compute gas limit exceeded` | compute kovası aşıldı | İşlemi bölün |
| `storage gas limit exceeded` | storage kovası aşıldı | Yeni anahtarları azaltın veya kira süresini düşürün |
| `OutOfGas(31)` | Bir kova yetersiz | Parantez içindeki kova adına bakın, işlemi bölün |
| `Arithmetic(90)` | Aritmetik alt/üst taşması | Parametreleri kontrol edin; bu bir kontrat hatasıdır, lütfen bildirin |
| `CallNotExist` | Kontratta bu fonksiyon yok | Fonksiyon adını kontrol edin (yönetici fonksiyonları kaldırıldı) |
| `state changed` | Bu sırada zincir durumu değişti | Yeniden deneyin |
| `transaction parse failed` | İşlem gövdesi ayrıştırılamadı | hex / bayt eksik |
| `StorageNotActive` | Depolama anahtarının süresi dolmuş | `rent_keys` çağırarak kira yenileyin |
| `ECONNREFUSED` / `timeout` | Servise ulaşılamıyor | Servisin çalışıp çalışmadığını kontrol edin |

**Ayırt etme anahtarı**: bu hataların çoğu **HTTP 200 + `{"ret":1,"err":"..."}`**
biçimindedir; yalnızca HTTP durum koduna bakmak bunları kaçırır.

---

## 8. Hızlı referans

### 8.1 Uç nokta özeti

```
# Tam düğüm
GET  /query/block/height/latest
GET  /query/fee/average
GET  /query/balance?address={A}&assets=true&diamonds=true
GET  /query/diamond?name={N}
GET  /query/contract/sandboxcall?contract={C}&function={F}&params={P}&caller={C}
GET  /query/block/intro?height={H}&tx_hash_list=true
GET  /query/transaction?hash={H}
POST /util/transaction/check        {"tx": "hex"}
POST /submit/transaction            {"tx": "hex"}

# İndeksleyici
GET  /health
GET  /snapshot
POST /sync
GET  /backing
GET  /rent_batches

# Oluşturma servisi
GET  /health
POST /api/build
```

### 8.2 Sabitler

| Sabit | Değer |
|---|---|
| Dağıtıcı | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| Kontrat adresi | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |
| Kontrat nonce | `5` |
| Kasa temettü kontratı B | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (nonce 4) |
| `TREASURY` | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (kontrat B'yi gösterir) |
| `BURN_ADDR` | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` (kontrat A'nın kendisi) |
| hacds serial | `4000` |
| hacds decimal | `0` |
| hacds toplam arz | `5963298700000000` |
| Pay serial | `4001` |
| Pay ihraççısı | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| `SHARE_TOTAL` | `10000` |
| `RENT_RATIO_BPS` | `2000` (kira yenileme %20 / temettü %80) |
| `RPU_SCALE` | `1000000000000` (1e12) |
| `MINIMUM_LIQUIDITY` | `1000` |
| `SCORE_SCALE` | `100000000` (1e8) |
| `MAX_DEPOSIT_COUNT` | `200` |
| `FEE_BPS` | `50` (%0.5) |
| `BORROW_RATIO_BPS` | `20000` (%200) |
| `LIQ_COLL_RATIO_BPS` | `16000` (%160) |
| `CLOSE_FACTOR_BPS` | `5000` (%50) |
| `DEEP_TRIGGER_BPS` | `10500` (%105, derin su devralma) |
| `DEEP_WATER_BPS` | `9000` (%90, tamamı tasfiye edilebilir) |
| `DEEP_DISCOUNT_BPS` | `300` (%3, derin suda tasfiyeciye verilen indirim) |
| `LIQ_PROTOCOL_BPS` | `100` (%1, tasfiye ödülünden rezerve giden kısım) |
| —— Kontrat B —— | |
| `PERIOD_NEW` (B) | `100` |
| `RENT_PERIOD` (B) | `300` |
| `RENT_MIN_PERIOD` (B) | `30` |
| `RENT_MAX_PERIOD` (B) | `3000` |
| `AHAC_MIN_PERIOD` | `300` |
| `AHAC_MAX_PERIOD` | `3000` |
| `RENT_REWARD_ZHU` | `5000000` (anahtar başına 0.05 HAC) |
| `STORAGE_BUDGET` | `111000` |
| `RENT_KEY_UNIT` | `36` |
| `LIQ_BONUS_BPS` | `500` (%5) |
| `U_MAX_BPS` | `5000` |
| `LENDABLE_AMM_BPS` | `3000` |
| VM üç kovası | compute 18,009 / resource 6,100 / storage 111,911 |
| İşlem üst sınırı | 16,384 bayt |
| gasMax aralığı | 1–99 |

### 8.3 Birim dönüşümü

**HAC** (zincirde zhu):

```
HAC = zhu / 1e8
"5:249" = 5 × 10^(249−248) = 50 HAC
"1:248" = 1 HAC
```

**hacds** (ondalık 0):

```
hacds adedi == zincirdeki tam sayı, dönüşüm yapılmaz
```

⚠ **hacds'i 1e8'e bölmeyin.** Bu önceki sürümün (ondalık 8) yöntemiydi.

### 8.4 Minimum çalışan bir durum okuma kodu

```javascript
const NODE = 'https://api.hacds.com';
const CONTRACT = 'bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h';

async function call(fn, params = '') {
  const q = new URLSearchParams({
    contract: CONTRACT,
    function: fn,
    params,
    caller: CONTRACT,       // verilmezse yetersiz bakiye nedeniyle başarısız olur
  });
  const r = await fetch(`${NODE}/query/contract/sandboxcall?${q}`);
  const j = await r.json();
  if (j.ret !== 0) throw new Error(j.err || 'call failed');
  return j.ret_val;
}

// Havuzun iki tarafındaki rezervler
const hacZhu = await call('amm_reserves');
const ds     = await call('amm_reserve_ds');

// Spot fiyat (hacds başına zhu)
const spot = Number(hacZhu) * 1e8 / Number(ds);
```

**Eşzamanlılık notu**: her IP'nin yalnızca 2 eşzamanlılık yuvası vardır. Toplu
okumalar kuyruğa alınmalıdır, `Promise.all` kullanmayın.

---

*Bu belge, `HacdsDeFi3000.fitsh` kontratının kesinleşmiş sürümüne, ikinci ana ağ
dağıtımına (2026-11-18) karşılık gelir.*
