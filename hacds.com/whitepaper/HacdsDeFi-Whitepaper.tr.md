# HacdsDeFi Teknik Raporu

2026-11-18　Sürüm 3 (kontrat #4000, ana ağın ikinci dağıtımı)

> Bu belge, Hacash ana ağındaki `HacdsDeFi3000.fitsh` kontratını açıklar
> (kontrat adresi `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`, varlık serial 4000).
> Buradaki her sayı kontrat kaynak kodundaki bir sabittir ve dağıtımdan sonra
> değiştirilemez.

---

## Başlamadan önce

hacds, Hacash ana ağında bir zincir üstü varlıktır: serial 4000, ondalık 0.

Hacash'in ilk DeFi kontratı üzerinde çalışır. Hacash'in HVM'si (Turing-tam akıllı
sözleşme VM'i) 765.432 blok yüksekliğinde etkinleşti. Bu kontrat, ana ağda dört
DeFi işlevini — takas piyasa yapıcılığı, kredi, tasfiye ve kasa — tek bir
kontratta eksiksiz biçimde uygulayan ilk gerçeklemedir.

Bu sürüm ile önceki arasındaki fark parametre ayarı değil; **üç merkezî bileşen
tamamen silindi**:

| Önceki sürüm | Bu sürüm |
|---|---|
| Zincir dışı oracle puanı hesaplar ve sertifika imzalar, kontrat imzayı doğrular | Kontrat elmas genini zincir üzerinde doğrudan okur ve puanı kendisi hesaplar |
| Altı yönetici parametre fonksiyonu | Yönetici yok. Hiç yok. |
| `set_paused` küresel durdurma anahtarı | Durdurma anahtarı yok |
| serial 2000, ondalık 8 | serial 4000, ondalık 0 |
| İşlem başına 1 elmas | İşlem başına 200 elmas |

Silinen şeyler geri gelmez. Bu bir tasarım tercihidir, yol haritası değil.

Belge sekiz bölümden oluşur: önceki sürümün sorunları, bu sürümün tasarımı, dört
belirleyici özellik, sistemin bileşimi, **ekosistem kasası ve erken ortakların
hakları**, mevcut durum, bilinen sınırlar ve sık sorulan sorular.

---

## 1. İlk sürümün dersleri (yazıt dönemi)

### 1.1 Özgün tasarım

İlk sürüm hacds'i HACD elmaslarına kazınan bir yazıt olarak tanımlıyordu.
Tasarım dört parçadan oluşuyordu.

**Yazıtla arz.** Her HACD bir Hacds yazıtı taşır ve elmas başına yalnızca biri
geçerlidir. Sıradan bir elmas 10.000 hacds ödüyordu. Özel bir elmasın ne kadar
ödeyeceği (kalp için 500.000, dört ardışık harf için 300.000, özel şekil için
200.000) topluluk oylamasıyla belirleniyordu.

**Eklentiyle ticaret.** Merkeziyetsiz borsa MoneyNex adlı bir eklenti cüzdanı
olarak yapıldı. Kullanıcılar eklentiyi kurup piyasaya giriş çıkışı eklentinin
cüzdanı üzerinden yapıyordu.

**Listelenmeyi hedef saymak.** Teknik raporda yazılan ilk listeleme hedefi
xeggex.com idi.

**Zincir taramasıyla keşif.** Her istemci tüm ağdaki yazıtları kendisi tarıyordu;
üçüncü taraf sunucular ek olarak arama sağlayabiliyordu.

### 1.2 Yaptık ve listelendi

Bunların hiçbiri kâğıt üstünde bir tasarım değildi. Yazıt sistemi yapıldı,
MoneyNex eklentisi çalıştı ve hacds iki borsada listelendi: xeggex.com ve
nonkyc.io.

Sonra işlem durduruldu.

### 1.3 Yanlış giden neydi

Düğüm noktası ilk maddedir; diğer üçü onun sonuçlarıdır.

**Fiyatın çıpası yoktu.** Arz oranı oylamaya dayandığı için, her elmas sınıfının
kaç hacds ettiği her an bir oylamayla değiştirilebiliyordu. Borsalar yeniden
üretilebilir bir dönüşüm dayanağı elde edemedi, piyasa yapıcılar istikrarlı fiyat
veremedi ve derinlik hiç oluşmadı.

**Ticaret halkası başkasına bağlanmıştı.** Merkeziyetsiz borsa üçüncü taraf bir
eklentiydi; eklenti güncellenmeyi bırakırsa borsa durur. Merkezî borsalar daha da
doğrudandı: işlem de dolaşım da xeggex ve nonkyc'in elindeydi.

**Geri dönüş yolu yoktu.** Bu iki borsa tüm dolaşım kanalıydı. Durduklarında
zincir üzerinde işlem yapılacak başka hiçbir yer kalmıyordu.

Bir arada: token serbestçe dolaşamıyorsa fiyatlanamaz; fiyatlanamıyorsa piyasa
yapılamaz; piyasa yapılamıyorsa yalnızca borsalara bağımlı kalınır; borsa
durursa her şey kopar.

Listelenip listelenmemek asıl mesele değildi. Listelense bile tasarımdaki
kusurlar kaybolmuyordu — yalnızca işlemin durdurulduğu güne erteleniyordu. Bu
sürümde tasarımın değiştirilmesinin doğrudan nedeni budur.

### 1.4 Bu sürüm neyi değiştirdi

Yalnızca tek bir şey yaptı: tokeni elmasların üzerinden aldı.

hacds, hiçbir elmasa bağlı olmayan, serbestçe bölünebilen ve transfer edilebilen
standart bir zincir üstü varlık oldu. Finansal mantık eklentilerden ve
borsalardan kontrata taşındı. Dolaşım artık listelenmeye bağlı değil; zincir üstü
AMM kendi başına işlem yapabiliyor, listelenme ise sonrasında yalnızca isteğe
bağlı bir seçenek, artık hayatta kalmanın ön koşulu değil.

Bunun üzerine, önceki sürümden kalan iki merkezî bileşen — **oracle** ve
**yönetici** — de silindi.

---

## 2. Bu sürümün tasarımı

### 2.1 Arz nereden geliyor

hacds'in toplam arzı uydurma değil; ağdaki tüm elmaslardan hesaplanır.

Her HACD, beş HIP-5 boyutunda puanlanır (şekil, desen, renk, isimlendirme, numara).
Kontrat `SCORE_SCALE = 1e8` ayarlar: **1 puan 100 milyon hacds basar**. Toplam,
ağdaki tüm elmasların tam ortalamasını kullanır:

```
Ağ toplam puanı  = ortalama puan × toplam HACD arzı
                 = 3.55440306 × 16.777.216
                 = 59.632.987 puan

Toplam arz       = toplam puan × puan başına 1e8
                 = 59.632.987 × 100.000.000
                 = 5.963.298.700.000.000 hacds
```

Bu sayıyı herkes kendisi yeniden hesaplayabilir: gezgin API'sini bir kez çekip
her elması puanlayın, sonuç aynıdır. Önceki sürümde eksik olan tam olarak buydu:
hiç kimsenin kararına bağlı olmayan bir dayanak.

### 2.2 Puanlama nasıl çalışıyor: zincir üstü okuma, oracle yok

Önceki sürümün yöntemi şuydu: puanı zincir dışında hesapla → sertifika olarak
imzala → kontrat imzayı doğrulasın → zincir üzerinde yeniden hesaplayıp
karşılaştırsın. **Bu sürüm o zincirin tamamını sildi.**

Artık kontrat, HACD'yi kabul ettiği işlemin içinde VM'den doğrudan elmasın gen
verisini ister:

```
hacd_number_batch(names)        → her elmasın numarası (u64)
hacd_visual_gene_batch(names)   → her elmasın görsel geni (10 bayt)
```

Genleri aldıktan sonra kontrat bunları HIP-5'in beş boyutuna göre kendisi
puanlar. **Sürecin hiçbir yerinde zincir dışı katılım yok, sertifika yok, imza
yok, taklit edilebilecek bir halka yok.**

Bu yetenek, Hacash düğümlerinin v1.3.0'dan itibaren sağladığı "HACD gen görünümü"ne
dayanır ve 800.000 blok yüksekliğinde etkinleşir. İki koşul da zorunludur — düğüm
sürümü yetmiyorsa genler alınamaz, yükseklik yetmiyorsa VM bu çağrıyı tanımaz.

### 2.3 Toplu işlem: tek seferde 200 elmas

Bu, v1.3.0'ın getirdiği ikinci değişikliktir.

Önceki sürümde tek işlemde yalnızca 1 elmas yatırılabiliyordu. Nedeni gazdı:
FitSH'te bir elmasın puanını hesaplamak yaklaşık 3.270 birim `resource` kovası
yakıyordu ve tek kova sınırı 6.100'dür. İki elmas bunu aşıyordu.

Bu sürüm puanlama mantığını FitSH'ten bir **RV64IM hesap çekirdeğine**
(`score_sum`) taşıdı: tek çağrıda en fazla 200 elmasın adı, numarası ve geni
verilir, doğrudan toplam puan döner.

```
girdi   names[6n] ‖ numbers[8n] ‖ visual_genes[10n]
çıktı   Σ score (8 bayt büyük uçlu u64)
```

200 elması puanlamak yalnızca 3.587 birim `compute` harcar; tek kova yeter.
**İşlem başına 200 elmas, tek imza.**

Yatırma toplu, geri alma hâlâ tek seferde bir elmas. Nedeni §7.1'de.

### 2.4 Varlık özellikleri

| Öğe | Değer |
|---|---|
| serial | 4000 |
| ticket / name | HACDS / hacds |
| **decimal** | **0** (1 en küçük birim = 1 hacds) |
| Toplam arz | 5.963.298.700.000.000 |
| issuer | bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h (kontratın kendisi) |
| Basım maliyeti | 8 HAC (protokol ücreti, blok ödülüyle birlikte dalgalanır) |

Zincir üzerindeki #1028 numaralı varlığın ticket'ı da HACDS (adı "HACD
Fragments" — başkasının varlığı). Protokol name ile ticket'ın çakışıp
çakışmadığını kontrol etmez; yalnızca serial'in alınıp alınmadığına bakar.
**Tanınan serial 4000'dir.**

Kasa temettüleri için ayrı bir bağımsız pay varlığı da vardır:

| Öğe | Değer |
|---|---|
| serial | 4001 |
| ticket | HACDS-SHARE |
| decimal | 0 |
| supply | 10.000 (`SHARE_TOTAL`) |
| issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` (dağıtıcı adresi, **kontrat değil**) |

Paylar dağıtıcıya basılır ve dağıtıcı bunları sahiplerine dağıtır. **Faiz
yalnızca Kasa Temettü Kontratı B'ye yatırıldığında işler** — kullanıcılar
arasındaki varlık transferi hiçbir kontrat kancasını tetiklemez ve kasa "satış
anında" hesap kapatamaz; bu yüzden pay bakiyesi yalnızca kancanın
yakalayabildiği iki anda değişir: yatırma ve geri alma. Kontrat B'nin adresi
`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`.

> İlk turun dersi buraya yazıldı: o zaman pay varlığının `AssetCreate`
> işleminde issuer alanı Kontrat B'nin kendisi olarak doldurulmuştu ve
> `AssetCreate` arzı doğrudan issuer'ın adına yazar, **hiçbir kancadan
> geçmez**. Sonuçta zincir üstü bakiye 10.000 iken B'nin `sh:` defteri 0 kaldı,
> `PermitAsset` bakiye yetersizliğinden hiçbir zaman geçirmedi ve payların
> tamamı kilitlendi. issuer dağıtıcı olmalı, paylar da dağıtıcı tarafından
> sıradan transferlerle dağıtılmalıdır.

> ⚠ Eski serial 2000 (adres `VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1`) kullanımdan
> kaldırıldı. serial 3000 (issuer `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`, ilk ana
> ağ dağıtımı) ve serial 3001 (ilk tur payları) birlikte geçersizdir. İki turun
> serial'leri birbirinden bağımsızdır: karıştırılamaz, dönüştürülemez.

---

## 3. Dört belirleyici özellik

### 3.1 Açık kaynak

Kontrat (fitsh kaynağı + RV64IM çekirdeği), indeksleyici, işlem oluşturma
servisi ve cüzdanlar (PC + Android) — tüm kaynak kodlar açıktır.

Bir DeFi protokolü başkalarının parasıyla çalışır. Kullanıcının kendini
koruyabilmesinin tek yolu kodu okuyabilmesi ve hesabı doğrulayabilmesidir. Önceki
sürümün cüzdanı üçüncü taraf bir eklentiydi; kullanıcı yalnızca güvenmek ya da
güvenmemek arasında seçim yapabiliyordu. Bu sürüm mantığı açıkça ortaya koyuyor.

Kod açık olduğunda üç şey doğrudan yapılabilir:

- **Puanlama bağımsız olarak yeniden hesaplanabilir.** Herkes ağdaki tüm
  elmasları çekip aynı algoritmayla puanı yeniden hesaplayabilir ve arzın
  kontratın ödediğiyle uyuşup uyuşmadığını görebilir. Test ağında 119 fark testi,
  çekirdeğin FitSH referans uygulamasıyla tam olarak aynı sonucu verdiğini
  doğruladı.
- **Kontrat davranışı denetlenebilir.** Yönetici olmaması, fonksiyon listesinde
  parametre değiştirebilecek, bakiye değiştirebilecek veya protokolü
  durdurabilecek hiçbir giriş noktası bulunmadığı anlamına gelir — bu, sözümüze
  güvenmeden fonksiyon fonksiyon doğrulanabilir.
- **Servisler değiştirilebilir.** İndeksleyici ve işlem oluşturma servisi
  durumsuz HTTP servisleridir. Herkes kendi servisini çalıştırıp istemcinin
  servis adresini ona yöneltebilir.

### 3.2 Merkeziyetsizlik

Bu maddede sınırları konuşmak gerekir. Genel geçer "tamamen merkeziyetsiz" demek
bir anlam ifade etmez.

**Başarılanlar:**

Kurallar da yürütme de zincir üzerindedir. AMM fiyatlaması, kredinin geçiş
koşulları, tasfiye eşiği, ücretlerin bölüşümü — hepsi kontrat kodudur.
Katılımcılar aynı kurallarla işlem yapar; biz ortada değiliz ve araya
giremiyoruz.

**Yönetici yok.** Önceki sürümde altı yönetici fonksiyonu vardı (`set_fee` /
`set_loan_rate` / `set_liquidate_bonus` / `set_paused` / `set_oracle` /
`rent_batch`). Bu sürümde **hiçbiri yok**; zincir üzerinde çağrılması
`CallNotExist(51)` döndürür — "size yetki verilmedi" değil, **fonksiyon hiç
yok**.

Tüm parametreler derleme zamanı sabitidir. Ücret oranı, faiz eğrisi, tasfiye
çizgisi, rezerv hedefi — hepsi kaynak kodda sabit yazılıdır, dağıtımdan sonra
kimse, biz dahil, değiştiremez.

Kontrat yükseltilemez, arka kapısı yoktur. Kontratın tamamında kendini imha
fonksiyonu, yükseltme fonksiyonu, tek bir kullanıcıya yönelik dondurma fonksiyonu
yoktur. Ne dağıtıldıysa sonsuza kadar odur.

Katılım izin gerektirmez. Takas, piyasa yapıcılığı, kredi, tasfiye ve hatta
anahtar kirasının yenilenmesi (`rent_keys`) herkese açıktır. Beyaz liste yok,
onay yok.

Varlıklar kendi elinizde kalabilir. hacds standart bir zincir üstü varlıktır ve
kullanıcının kendi adresinde durur. Saklamıyoruz ve donduramıyoruz.

**Sınırlar ve henüz başarılamayanlar, birlikte:**

Kasa bir özel anahtar değil, bir kontrattır. Ücretler kontratın kendi `tre:hac:` /
`tre:ds:` hesaplarında birikir; süpürme sırasında **Kasa Temettü Kontratı B**'ye
(`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`) aktarılır ve B bunları yatırılmış paylara
göre pay sahiplerine dağıtır. Süpürme bizim imzamızı gerektirmez — herkes
başlatabilir ve B yalnızca küresel bir toplayıcıyla defter tutar, kimin
tetiklediğinden bağımsızdır. Kontratta çekim fonksiyonu yoktur; kimse kullanıcı
varlıklarını alamaz.

Geriye kalan tek nokta paylardır. 10.000 payın (serial 4001) tamamı dağıtıcının
soğuk cüzdanı `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` adresine basılmıştır ve
protokol geliri nihayetinde bu paylara aittir. Bu sürümde proje ekibine
güvenilmesi gereken tek yer burasıdır.

Sunucular tek noktadır. İndeksleyici (borçlu defteri) ve işlem oluşturma servisi
bizim sunucularımızda çalışır. **Hiçbir özel anahtar tutmazlar ve konsensüse
katılmazlar**; kullanıcılar kendi çalıştırdıkları servislerle değiştirebilir ya
da işlemi çevrimdışı imzalayıp sonra yayınlayabilir. Ancak kapandıklarında web
sürümünün kolaylık özellikleri etkilenir.

Bu birkaç madde, mevcut merkeziyetsizlik düzeyinin gerçek sınırlarıdır.

### 3.3 Güvenlik

İki yarı: kullanıcının parasının nasıl saklandığı ve protokolün kurallarının nasıl
garanti edildiği.

**Özel anahtarlar ağa hiç dokunmaz.** Cüzdan soğuk ve sıcak olarak ikiye
ayrılmıştır: çevrimdışı makine işlemi oluşturur ve imzalar, çevrimiçi makine
yalnızca sorgular ve yayınlar. Özel anahtar yalnızca ana sürecin belleğinde bir
kez görünür, oluşturma sırasında ortam değişkeniyle alt sürece geçirilir ve
diske yazılmaz. Bu akış Hacash işlemlerinin nonce'u ve zaman damgası sona ermesi
olmaması sayesinde çalışır — çevrimdışı imzalanmış bir işlem, ne kadar beklerse
beklesin yayınlandığında geçerlidir.

**İmzalama yerelde yapılır.** İşlemler paket içindeki Rust programı tarafından
yerelde imzalanır, hiçbir düğümden geçmez. Düğümler yalnızca çeviri, doğrulama ve
yayın için kullanılır. Düğümün `/util/transaction/sign` uç noktası özel anahtarın
HTTP üzerinden gönderilmesini gerektirir; biz onu kullanmıyoruz.

**Cüzdan dosyaları şifrelidir.** Parola scrypt ile türetilir (N=2¹⁵, r=8, p=1),
şifreleme AES-256-GCM'dir ve format sürümü AAD olarak bağlanır. PC ile Android
aynı keystore biçimini (`hacds-keystore v1`) paylaşır ve birbirine aktarılabilir.

**Arayüz sürecinin sistem yetkisi yoktur.** Renderer `contextIsolation` açar,
`nodeIntegration` kapatır ve ana sürece yalnızca preload beyaz listesi üzerinden
erişebilir. Renderer katmanına kötü niyetli içerik verilse bile dosya sistemine
veya özel anahtara ulaşamaz.

**Puanlama taklit edilemez.** Puanlama kontratta, zincir üzerinde hesaplanır;
girdi VM'in döndürdüğü elmas genleridir. Ele geçirilebilecek zincir dışı bir adım
ve taklit edilebilecek bir imza yoktur.

**Varlıklar korunur.** Zincir üstü özdeşlik: kullanıcıların elindeki miktar artı
kontratın elindeki miktar toplam arza eşittir. Her işlem bu denklemi korur ve
herkes bunu her an doğrulayabilir.

### 3.4 DeFi bütünlüğü

Önceki sürümün "finansı" yalnızca iki şeydi: token basmak ve tokeni borsaya
listelemek. Finansal ilkel yoktu, piyasa yapılamıyordu, teminat verilemiyordu,
borç alınamıyordu; getiri yalnızca fiyat artışından gelebiliyordu.

Bu sürüm bunu tamamladı. Tek kontratta dört blok:

| Modül | İçerik |
|---|---|
| AMM | HAC ile hacds arasında iki yönlü takas. Sabit çarpım `x × y = k`, ücret %0,5, **LP %80 / kasa %20** |
| Kredi | hacds'i teminat verip HAC borç al. Borç çizgisi %200 teminat oranı, tasfiye çizgisi %160, dalgalı faiz %2–%46 |
| Tasfiye | İki kademe: normal tasfiye (%105–%160, tek seferde borcun yarısı) + derin su devralma (<%105, tamamı) |
| Kasa | Ücretler orada birikir; herkes Kasa Temettü Kontratı B'ye süpürme tetikleyebilir, paya göre dağıtılır |

Ayrıca birkaç araç var.

**Atomik işlemler.** Birden fazla işlem tek bir işlemde birleşir; ya hepsi olur
ya hiçbiri. Protokol sınırı 200 eylemdir.

**Sosyalize edilmiş batık borç (hcut).** Aşırı durumlarda batık borç tüm mevduat
sahiplerine orantılı olarak dağıtılır ve yalnızca azalan küresel bir `hcut`
faktörüyle ifade edilir. Bu, kamuya açık, tek seferlik ve geri alınamaz bir
kayıptır — hata değil, son savunma hattıdır.

**Depolama kirası.** Hacash kontrat durumu kira ödemek zorundadır ve anahtarların
süresi dolar. Kontrat izinsiz `rent_keys` sunar: herkes kirayı yenileyebilir ve
anahtar başına 0,07 HAC kazanır. Keeper böyle çalışır ve herkes bir tane
çalıştırabilir.

**Faiz tembel hesaplanır.** Zamanlanmış iş yok, keeper bağımlılığı yok. Biri
kontratla etkileşime girdiğinde faiz blok yüksekliği farkına göre tamamlanır.
Gaz tasarrufu sağlar ve kimse bakım yapmadığı için durmaz.

---

## 4. Sistemin bileşimi

Bütün üç katmandan oluşur: zincir üstü kontrat ve varlıklar, sunucu tarafındaki
düğüm ve yardımcı servisler ve istemci tarafındaki cüzdanlar. Soğuk/sıcak ayrımı
bir kullanım biçimidir, ayrı bir katman değildir.

### 4.1 Üç katman ve sorumlulukları

| Katman | Bileşen | Yapabilir | Yapamaz |
|---|---|---|---|
| ① Zincir üstü | HacdsDeFi kontratı · `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` | Kural gereği varlık taşır, borç kaydeder, tasfiye eder, puan hesaplar | Hiçbir adres tarafından parametresi değiştirilemez veya durdurulamaz |
| ① Zincir üstü | hacds varlığı · serial 4000 · ondalık 0 | Serbestçe bölünür, transfer edilir, borsaya listelenir | Basılamaz (basım fonksiyonu yok) |
| ① Zincir üstü | Kasa Temettü Kontratı B · `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` | Kasa gelirini yatırılmış paya göre dağıtır | Parametresi değiştirilemez veya durdurulamaz |
| ② Sunucu | Tam düğüm RPC · `node.hacds.com` | Zinciri okur, doğrular, yayınlar | Özel anahtarı alamaz (imza uç noktasını kullanmıyoruz) |
| ② Sunucu | API vekili · `api.hacds.com` | Düğüme yönlendirir, CORS + HTTPS ekler | Hiçbir semantiği değiştirmez |
| ② Sunucu | İndeksleyici · `indexer.hacds.com` | Zinciri tarayıp "kimin borcu var, kim tasfiye edilebilir" kaydeder | Hiçbir zincir üstü durumu etkilemez |
| ② Sunucu | Oluşturma servisi · `build.hacds.com` | İnsan girdisini imzasız işleme çevirir | İmzalamaz (özel anahtar her zaman istemcide) |
| ③ İstemci | PC konsolu / Android | Yerelde imzalar, yayınlar | Kontrat kurallarını atlayamaz |

**Veri akışı**: istemci durumu "API vekili → tam düğüm" üzerinden, defteri
indeksleyiciden okur; işlem göndermek istediğinde kendisi oluşturabilir veya
oluşturma servisinden imzasız işlem isteyebilir — **imzalama her zaman istemcide
yerelde tamamlanır**.

**⚠ Sert bir kısıt**: tam düğüm sandbox çağrıları IP başına 2 eşzamanlı istekle
sınırlıdır. Sınırı aşan istekler kuyruğa alınmaz, doğrudan reddedilir. İstemci
sıralamalı çalışmalı ve geri çekilmeli yeniden denemelidir.

**Servis adresleri neden `IP:port` değil de alt alan adı**: Cloudflare Workers
yalnızca 80/443 portlarına erişebilir; `IP:8082` biçimindeki her adres bağlantı
kurulmadan reddedilir. Bu yüzden dışarıya her şey tek biçimde `*.hacds.com` alt
alan adları + Tunnel üzerinden gider.

### 4.2 Sorumluluk sınırları

| Bileşen | Yapabilir | Yapamaz |
|---|---|---|
| Kontrat | Kural gereği varlık taşır, borç kaydeder, tasfiye eder | Hiçbir adres tarafından parametresi değiştirilemez veya durdurulamaz |
| Tam düğüm | Zinciri okur, doğrular, yayınlar | Özel anahtarı alamaz (imza uç noktasını kullanmıyoruz) |
| İndeksleyici | Kimin borcu olduğunu kaydeder, sağlık hesaplar | Hiçbir zincir üstü durumu etkilemez |
| Oluşturma servisi | Parametreleri imzasız işleme çevirir | İmzalamaz (özel anahtar her zaman istemcide) |
| İstemci | Yerelde imzalar, yayınlar | Kontrat kurallarını atlayamaz |

---

## 5. Ekosistem kasası ve erken ortakların hakları

### 5.1 Tarihin seyri: başıboş başlangıçtan konsensüse

HacdsDeFi bir çırpıda doğmadı; son derece derin bir dönüşümden ve yeniden
doğuştan geçti.

2024'ün başında Hacds protokolünün ilk sürümü (yazıt sürümü) topluluk içinde
başlatıldı. 30'dan fazla erken dönem Web3 inşacısı, Hacash ekosistemine duydukları
konsensüs ve çekirdek geliştiriciye duydukları güven nedeniyle erken geliştirme
fonlarını birlikte topladı. Ancak o dönemin son derece ilkel yazıt mimarisi
(üçüncü taraf eklentilere ve merkezî sunuculara ağır bağımlılık) nedeniyle proje
büyük bir darbe aldı ve erken fonların tamamı kaybedildi.

Hiçbir hukuki sözleşmenin bağlayıcı olmadığı bir ortamda, üç yıl boyunca tek bir
kişi bile geliştiriciden hesap sormadı.

Bu son derece ender, klasik anlamda bir güven, protokolün defalarca yeniden
inşa edilmesinin arkasındaki çekirdek itici güç oldu. Bu güveni boşa çıkarmamak
için çekirdek geliştirici ardından ilk yeniden inşayı (#2000 sürümü) bağımsız
olarak başlattı. Ancak titiz güvenlik denetimi ve kendi tasarımını reddetme
sürecinin ardından #2000 sürümünde de zincir dışı oracle'a ağır bağımlılık gibi
yapısal merkezileşme riskleri bulunuyordu.

Böylece tamamen güvensizleştirilmiş #4000 sürümü yeniden inşası doğdu. Bu yeniden
inşa tüm yeni dış finansmanı reddetti; çekirdek geliştirici tüm altyapıyı ve kod
yeniden inşasını tek başına ve bağımsız olarak tamamladı, tüm geliştirme ve
işletme maliyetlerini de tek başına üstlendi.

### 5.2 Ana ağ dağıtım kazası kaydı ve kaza sonrası yeniden inşa

Mühendisliğin yolu hiçbir zaman düz değildir. Ana ağ dağıtımı aşamasında son
derece ağır bir teknik kaza yaşandı.

Pay varlığının (başlangıçta Serial 3001 olarak öngörülmüştü) basımı bir `issuer`
parametresinin doldurulmasını gerektiriyordu. Bu parametre yanlışlıkla kasa
kontratının kendi adresiyle dolduruldu. Hacash'in `AssetCreate` eylemi ise
**sıfırdan basar ve doğrudan issuer adresine yatırır**, hiçbir kontrat kancasından
geçmez — böylece şu durum ortaya çıktı:

| Öğe | Değer |
|---|---|
| Kasa Kontratı B'nin zincir üstü 3001 bakiyesi | 10.000 pay |
| Kasa Kontratı B'nin `sh:` pay defteri | **0** |
| Sonuç | `PermitAsset` transferin geçmesi için yeterli `sh:` bakiyesi ister → **her zaman 11 döndürür** |

Bu aynı zamanda şu anlama gelir: Kasa Kontratı B'nin 15 harici fonksiyonundan
hiçbiri `sh:` defterini başlatamaz. Bu bir kilitlenmeydi ve zincir üzerinden
telafi edilemezdi. Hacash'in alt katman mekanizması mutlak biçimde değiştirilemez
olduğu için bu 10.000 pay varlığı bir anda kilitlendi.

**Çekirdek geliştirici ana ağ dağıtımındaki tüm gaz kaybını tek başına üstlendi.**
Serial yeniden verilemediği için (`state.asset(&serial)` varsa çağrı reddedilir),
3000 / 3001 numaralandırma sisteminin tamamını kararlılıkla terk ettik ve nihai
yeniden inşa için tamamen **Serial 4000 (ana protokol varlığı)** ve **Serial 4001
(pay senedi)** numaralarına geçtik; iki kontrat da yeni nonce'larla yeniden
dağıtıldı.

Bu kaza bize değiştirilemez koda duyulan saygıyı daha da artırdı. Geliştiricinin
kendisi bile tek bir parametre hatası yüzünden bedel ödüyorsa, bu "yöneticisiz"
mekanizmanın mutlak otoritesini daha da kanıtlar — kimse, onu yazan kişi dahil,
"bir düzeltiveremez". 4000'den itibaren HacdsDeFi kusursuz bir duruşla yeniden
yola çıktı.

### 5.3 Hakların varlığa dönüşmesi: HACDS-SHARE (Serial 4001)

Erken dönem katkıcıların haklarını tamamen şeffaf ve zincir üstü hale getirmek
için protokol bunları tokenlaştırdı.

| Alan | Değer |
|---|---|
| Varlık adı | HACDS-SHARE |
| Varlık Serial | **4001** |
| Toplam arz | **10.000 pay** (ek basım yok, `decimal = 0`) |
| **Issuer** | **çekirdek geliştiricinin soğuk cüzdan adresi** `15fv6cNE…` |
| Dağıtım ilkesi | 2024 başındaki erken ortakların tarihsel katkı oranlarıyla birebir örtüşür |

**Issuer neden kasa kontratı değil**: bu, tam olarak 5.2'deki kazanın doğrudan
dersidir. `issuer` şu soruyu yanıtlar: "**bu varlık grubu nerede doğdu**";
"**bu varlık grubunu nihayetinde kim yönetir**" sorusunu değil. Kontrata
yatırılması gereken senet türü varlıklar, serbestçe transfer edilebilen sıradan
bir adrese basılmalı, yatırıp yatırmamaya da sahibi kendisi karar vermelidir.
Kasa kontratı kendi pay varlığını **asla basmaz ve asla tutmaz**.

Bu bir borç değil; ekosistemin erken dönemde riski paylaşanlara verdiği kalıcı,
zincir üstü bir onur ve hak senedidir.

### 5.4 Bağımsız Kasa Kontratı B ve gelir dağıtımı

Ana protokolün ürettiği protokol geliri (AMM ücret payı, kredi faizi payı vb.)
otomatik olarak bağımsız dağıtılan Kasa Kontratı B'de toplanır (adres
`duEkx1E3…`, ana kontratın `TREASURY` sabiti burayı gösterir).

Kasa Kontratı B'nin tasarımı "kod kanundur" ve "mutlak güvensizlik" ilkelerine
uyar:

**① Önce kira rezervi (%20)**

Kasa her gelir aldığında otomatik olarak %20'yi `reserve:rent` dahili hesabına
aktarır. Bu HAC dilimi yalnızca ana protokolün ve Kontrat B'nin zincir üstü
depolama kirasının yenilenmesi (keeper ödemesi) için kullanılır; böylece protokol
insan müdahalesi olmadan çalışmaya devam eder.

**② Hak dağıtım havuzu (%80)**

Kalan %80 temettü havuzuna girer. Kontrat bir **rpu (pay başına birikimli ödül)
toplayıcısı** mekanizması kullanır:

```
rpu:share += div_part × RPU_SCALE / tot:staked
bir adrese düşen = pay × (rpu_now − chk) / RPU_SCALE
```

> ⚠ **Açıkça söylenmesi gereken anlam: cüzdanda 4001 tutmak otomatik temettü
> demek değildir.**
>
> Yalnızca **Kontrat B'ye yatırılmış** paylar faiz işletir; çünkü kullanıcılar
> arasındaki varlık transferi hiçbir kontrat kancasını tetiklemez ve kontrat
> "satış anında" hesap kapatamaz. Yatırılan paylar `sh:<adres>` defterine
> kaydedilir ve temettünün tek dayanağı budur.

Temettü böleni sabit 10.000 değil, **o anda yatırılmış toplam miktardır**
(`tot:staked`). Bu bilinçli bir tasarımdır: sabit bölen kullanıldığında yatırma
oranı düştükçe sızıntı büyür (%25 yatırma oranında 80 HAC'in yalnızca 20'si
dağıtılır, 60'ı kalıcı olarak havada kalır); dinamik bölen kullanıldığında her
ödeme o anda kayıtlı paylar tarafından tamamen emilir ve yapısal sızıntı sıfır
olur.

Temettü çekmek için `claim()` fonksiyonunun etkin biçimde çağrılması gerekir.
`claim` yalnızca artışı `due:` defterine işler; para hâlâ kontrattadır. Gerçekten
hesaba geçmesi için ayrıca bir `TransferHacFromTo` çekimi gerekir (istemci iki
adımı zaten tek bir atomik işlemde birleştiriyor).

**③ Yöneticisiz**

Kontratta hiçbir admin kavramı yoktur: pause yok, parametre değiştirme girişi
yok, fon taşıma yeteneği yok. 15 harici fonksiyonunun tamamı ya "kullanıcı
işlemi" ya da "salt okunur görünüm"dür. Herkes `pay_rent` / `pay_rent_shares`
fonksiyonlarını izinsiz çağırıp kirasının yenilenmesine yardım edebilir ve
gerçekte yenilenen anahtar sayısına göre `reserve:rent` hesabından ödeme alabilir
— bu da "protokolü ayakta tutmayı" kârlı bir iş haline getirir ve belirli bir
keeper hesabına bağımlı kılmaz.

### 5.5 Hakların devri: mutlak serbest P2P

Protokol, **zincir üstü kontratta** merkezî bir emir defteri veya AMM havuzu
**kurmaz**. Yüksek değerli, son derece düşük likiditeli bir varlığı AMM havuzuna
koymak manipülasyona son derece açıktır.

Serial 4001 varlığı, sıradan bir zincir üstü varlık gibi serbestçe dolaşır.
Çıkmak isteyen sahipler, Hacash'in yerel **atomik işlemini (Atomic Transaction)**
kullanarak bir alıcıyla, birden fazla varlık (HAC, HACD veya başka herhangi bir
zincir üstü varlık) üzerinden noktadan noktaya "parayı ver, malı al" biçiminde
takas yapabilir.

Atomik işlemin semantiği şunu garanti eder: **ya işlemin tamamı gerçekleşir ya
da tamamı geri alınır**. "Parayı verdim ama malı almadım" olasılığı yoktur; bu,
karşı tarafın temerrüt riskini tamamen ortadan kaldırır. İstemciye bu özellik
yerleşiktir (pay OTC); en fazla 3 bedel varlığının birleşimini destekler ve
imzasız işlem gövdesinin insan tarafından okunabilir çevirisini sunar — böylece
taraflar imzalamadan önce "neyi veriyorum, neyi alıyorum" maddesini tek tek
kontrol edebilir.

### 5.6 Sonuç: kuralları kod tanımlar, konsensüsü güven belirler

2024'ün başıboş yazıt döneminden 2000'in yoklamasına, oradan 3000'in deneme
yanılmalarına ve 4000'in yeniden doğuşuna. Bu üç yılı aşkın süre, HacdsDeFi'nin en
derin ruhudur.

Yöneticiyi sildik, tüm araçları açık kaynağa taşıdık, hatta ana ağ dağıtımının
acı veren hatasını kamuya açtık. Sistemin yaşamını matematiğe, kasanın anahtarını
koda teslim ettik. Bu yalnızca o 30 küsür erken ortağa bir hesap verme değil, aynı
zamanda tüm Hacash ekosistemindeki en saf geek sözleşme ruhudur.

---

## 6. Mevcut durum

### 6.1 Tamamlananlar

| Öğe | Durum |
|---|---|
| Kontrat kaynağı | Kesinleşti, 16.201 bayt (sınır 16.384), tam güvenlik denetiminden geçti |
| Puanlama çekirdeği | RV64IM çekirdeği, 2.026 bayt, 119 fark testi FitSH referans uygulamasıyla aynı |
| Test ağı | Yerel tam düğüm + çok adres, A/B/C/G dört grubu 40 işlevsel testin tamamı geçti |
| Saldırı testleri | 43 saldırı senaryosu (yeniden giriş, önden koşma, fiyat manipülasyonu, alt taşma vb.) |
| Sunucu tarafı | Tam düğüm / indeksleyici / oluşturma servisi / keeper hepsi çevrimiçi, açılışta otomatik başlıyor |
| PC cüzdanı | v0.4.4, Windows kurulum paketi + kurulumsuz sürüm |
| Android | v0.2.3, imzalı APK, arm64 |
| Web sitesi | hacds.com (teknik rapor, belgeler, web konsolu) |

### 6.2 Dağıtım

**Kontrat ana ağa dağıtıldı** (2026-11-18, ikinci tur). Dağıtımın iki ön koşulu
da karşılandı:

| Koşul | Durum |
|---|---|
| Düğüm ≥ v1.3.0 (HACD gen görünümü sağlar) | ✅ Hazır |
| Blok yüksekliği ≥ 800.000 | ✅ Geçildi |

İlk tur dağıtım geçersiz: pay varlığı basılırken issuer Kontrat B olarak
doldurulmuştu ve Hacash'in `AssetCreate` işlemi arzı doğrudan issuer'ın adına
yazar, hiçbir kancadan geçmez — zincir üstü bakiye 10.000 iken Kontrat B'nin
`sh:` defteri 0 kaldı, bu yüzden `PermitAsset` hiçbir zaman geçirmedi ve paylar
transfer edilemedi. Serial yeniden verilemediği için tüm set baştan, yeni
numaralarla yapılmak zorunda kaldı: iki kontrat yeniden dağıtıldı (nonce 5 /
nonce 4), varlıklar serial 4000 / 4001'e taşındı.

Web sitesi, cüzdanlar ve bu belge ikinci turun adreslerine ve serial'lerine
geçmiştir; ayrıntılar için Ek A'ya bakın.

### 6.3 Test ağı neyi doğruladı

- **Toplu yatırma**: tek işlemde 54 elmas gerçek ölçümle başarılı; fark testleri
  200 elmas sınırını kapsıyor
- **AMM**: sabit çarpım birime kadar kesin; kayma koruması ve ilk yatırımın ölü
  payları beklendiği gibi çalışıyor
- **Kredi**: borç limiti, faiz birikimi, geri ödeme, sağlık görünümü — hepsi
  beklentiyle uyumlu
- **Tasfiye**: normal tasfiye de derin su tasfiyesi de gerçekten tetiklendi,
  kayıtlar tam olarak kapandı
- **Transfer**: HAC / hacds / HACD, üç varlık birbirine transfer edildi
- **Saldırı simülasyonu**: 43 senaryonun tamamı beklendiği gibi başarısız oldu,
  istismar edilebilir bir yol yok

Toplamda 2 gerçek kusur bulundu ve düzeltildi (ikisi de tasfiye yolunda ve
yalnızca test ağındaki gerçek zincir üstü yürütmeyle ortaya çıktı): bir
`resource` kovası aşımı, bir alt taşma. Düzeltme notları depoda
`hacds_exchange/修复说明-清算gas与下溢.md` dosyasındadır.

---

## 7. Bilinen sınırlar

Birkaç şey yapılmadığı için değil, tartışılıp şimdilik böyle bırakıldığı için
böyle. Buraya yazıldı ki sonradan gelenler aynı taşlara basmasın.

### 7.1 Geri alma hâlâ tek seferde bir elmas

Yatırmada 200'e kadar toplu; geri almada yalnızca 1. Bu bilinçli.

Geri alma "elmas seçme primi"ni fiyatlamak zorundadır: yüksek puanlı bir elması
geri almak daha fazla ödeme gerektirir ve oran, o elmasın puanının **havuz
ortalamasına** göre konumuna bağlıdır. Toplu geri almada her elmasın
değerlendirmesi farklıdır ve geri alma otomatik AMM tamamlamasını tetiklediği
için her birinin bakiyesi ayrıca kontrol edilmelidir.

Daha kritiği **muhasebe ölçütüdür**: toplu geri almada ortadaki bir elmas
başarısız olursa, önceden işlenmiş kısım nasıl geri alınır? Kontrat yükseltilemez
ve bu geri alma mantığı yanlış yazılırsa fonlar kilitlenir.

Bu yüzden: **yatırma toplu, geri alma tek.** Cüzdan seçiminizi otomatik olarak
birden fazla işleme böler; kullanıcı bir kez tıklar.

### 7.2 Paylar tek nokta

Kasa geliri Kontrat B'nin temettüsünden geçer ve zincirin kendisi hiçbir kişiye
güven gerektirmez: süpürme izinsizdir, B'nin kancası başlatanı okumaz, bölüşüm
paya göredir. Tek nokta **payların aidiyetidir** — 10.000 pay (serial 4001)
dağıtıcının soğuk cüzdanı `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` tarafından
tutulur ve dağıtılır. Payı alan temettüyü alır; bu zincir üzerinde
doğrulanabilir.

### 7.3 Sunucular tek nokta

İndeksleyici ve oluşturma servisi bizim tarafımızdan çalıştırılır. Zincir üstü
durumu değiştiremezler, ancak kapandıklarında web sürümü elverişsiz olur. Herkes
kendi servisini çalıştırabilir — kaynak kod açıktır.

### 7.4 300 saniyelik bloklar

Yayının başarılı olması zincire girmekle aynı şey değildir; `ret:0` yalnızca
bellek havuzuna girdiği anlamına gelir. Cüzdan blok temposuna göre birkaç kez
yeniden sorgular (15, 45, 90, 180, 320 saniye).

### 7.5 Faiz ayrı gösterilmez

Kontrat faizi tembel hesaplar ve faizin başlangıç noktasının dışa açık bir
arayüzü yoktur; cari borçlu faiz hesaplanamaz, yalnızca geri ödeme anında zincir
üstü kapatılmış sonuç olarak görünür.

### 7.6 Çekimler geçici olarak reddedilebilir

Çok fazla borç verilmiş ve nakit yetersizse, HAC yatıranların çekimleri
reddedilir. Bu bilinçlidir — protokol sizi bekletmeyi, kilitlenebilecek bir
kuyruk sistemi yazmaya tercih eder. Neyse ki iki katman koruma bu durumu nadir
kılar: toplam borç üst sınırı %50, AMM'deki HAC'in yalnızca %30'u borç
verilebilir.

### 7.7 Kontrat yükseltilemez

Bir hata bulunsa bile düzeltilemez. Parametrelerin muhafazakâr tasarlanmasının
nedeni budur (%20 tasfiye tamponu, %50 borç sınırı, iki katman nakit koruması)
ve bir nedeni daha vardır: **tüm birikiminizi içine koymayın**.

---

## 8. Sık sorulan sorular

**S: hacds ek basım yapar mı?**
Hayır. Elmas değerine karşılık basılır, toplam 5.963.298.700.000.000 ile sabittir
ve kontratta basım fonksiyonu yoktur. Yatırmada kontrat
`basılmış + bu basım ≤ toplam arz` kontrolünü yapar ve aşanı doğrudan reddeder
(return 53).

**S: Paramı alabilecek bir yönetici var mı?**
Yönetici yok. Kontratta hiçbir `set_*` fonksiyonu yoktur; çağrılması
`CallNotExist(51)` döndürür — yetki yetersizliği değil, fonksiyon gerçekten yok.
Kimse protokolü durduramaz, parametre değiştiremez veya kullanıcı varlıklarını
başka yere taşıyamaz.

**S: Tek seferde kaç elmas yatırabilirim?**
200. Tek işlem, tek imza.

**S: Geri almada neden yalnızca bir elmas?**
Bkz. §7.1. Elmas seçme primi elmas başına fiyatlanmalıdır ve toplu geri alma
mantığı yükseltilemeyen bir kontratta çok risklidir.

**S: APY nedir?**
Dalgalı. Mevduat getirisi ne kadar borç verildiğine bağlıdır; borçlanma maliyeti
%2 ile %46 arasında dalgalanır. Arayüz canlı değerleri gösterir.

**S: Elmas fiyatı düşerse ne olur?**
Tasfiye çizgisinin altına düşerse tasfiye edenler borcunuzu öder ve teminatın bir
kısmını alır. Geri kalanı hâlâ sizindir.

**Ödemesiz dönem yoktur** — oran %160'ın altına düştüğü anda her an tasfiye
edilebilirsiniz, önceden bildirim yapılmaz. Tek tasfiye borcun yalnızca yarısını
keser, ancak fiyat düşmeye devam ederse tekrar tekrar tasfiye edilirsiniz;
%105'in altına düşerse bir seferde tamamı kapatılır.

Düşüşten önce teminat ekler veya borcun bir kısmını geri öderseniz tasfiye
edilmezsiniz.

**S: Tasfiye beni bir seferde silip süpürür mü?**
Normal tasfiye (%105–%160) tek seferde en fazla borcun %50'sini keser ve tasfiye
bonusu **geri ödenen tutar üzerinden** hesaplanır, borcun oranı üzerinden değil.
Bu yüzden borcun yarısının tasfiye edilmesi teminatın yalnızca yaklaşık üçte
birini alır — tasfiye bittiğinde teminat oranı aslında %200'ün üzerine çıkar ve
tehlike bölgesinden hemen ayrılır.

Ancak fiyat düşmeye devam ederse yeniden tasfiye edilirsiniz. %105'in altına
düşünce derin su bölgesine girersiniz ve tüm borç bir seferde kapatılır.

**S: Yüksek puanlı bir elması geri almak neden daha fazla ödeme gerektirir?**
Havuzdaki iyi elmasları birilerinin seçip almasını önlemek için. Bu
"seçiciliğe" uygulanan bir vergidir, en fazla %30'dur; sıradan ve düşük puanlı
elmaslardan alınmaz.

**S: Protokolün kazandığı para nereye gidiyor?**
Kasa Temettü Kontratı B'ye,
`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4`, pay sahiplerine paya göre dağıtılır.
Süpürme izinsizdir, herkes başlatabilir; B içindeki dağıtım kuralları derleme
zamanı sabitidir ve zincir üzerinde doğrulanabilir.

**S: Ekip kaçabilir mi?**
Kontratta çekim fonksiyonu yok, yönetici yetkisi yok, kod açık ve denetlenebilir.
Ancak **paylar dağıtıcının elinde toplanmıştır** (10.000 pay, serial 4001) — bu,
proje ekibine güvenilmesi gereken tek yerdir. Ayrıca kontrat yükseltilemez, bu
yüzden tüm birikiminizi içine koymayın.

**S: Elmas fiyat verisi nereden geliyor?**
Dış veri kaynağı gerekmez. Doğrudan AMM havuzunun bakiye oranını okur, kimse
taklit edemez. Tek bir işlem referans fiyatı en fazla %10 hareket ettirebilir;
bu da fiyatı çökertme manipülasyonunu son derece pahalı kılar.

**S: Anahtarın süresi dolarsa ne olur?**
Hacash kontrat durumu kira ödemek zorundadır ve süresi dolan anahtar etkisiz
olur (`StorageNotActive`). Kontrat izinsiz `rent_keys` sunar: herkes kirayı
yenileyebilir ve anahtar başına 0,07 HAC kazanır. Keeper böyle çalışır.

---

## Ek A: Adresler ve parametreler

| Öğe | Değer |
|---|---|
| Dağıtıcı | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| Kontrat nonce | 5 |
| **Kontrat adresi** | **`bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`** |
| Kasa Temettü Kontratı B | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (nonce 4) |
| `TREASURY` | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` (Kontrat B'yi gösterir, artık soğuk cüzdan değil) |
| `BURN_ADDR` | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` (Kontrat A'nın kendisi) |
| hacds serial | **4000** (ondalık **0**) |
| hacds toplam arz | 5.963.298.700.000.000 |
| Pay serial | **4001** (ondalık **0**, supply 10.000) |
| Pay issuer | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` (dağıtıcı adresi, **kontrat değil**) |
| `SCORE_SCALE` | 1e8 (1 puan = 100 milyon hacds) |
| `RPU_SCALE` | 1e12 (ödül toplayıcısının sabit nokta ölçeği) |
| `MINIMUM_LIQUIDITY` | 1.000 (ilk yatırımın ölü payları, kontratın kendi adresinde kayıtlı) |
| `SHARE_TOTAL` | 10.000 (toplam pay, Kontrat B) |
| `RENT_RATIO_BPS` | 2.000 (kira rezervi %20 / temettü %80, Kontrat B) |
| Ağ toplam puanı | 59.632.987 puan (= ortalama 3.55440306 × 16.777.216 elmas) |
| `FEE_BPS` | 50 (AMM ücreti %0,5) |
| Ücret dağıtımı | LP %80 / kasa %20 |
| `BORROW_RATIO_BPS` | 20.000 (borç çizgisi: %200 teminat oranı, yani en fazla %50 borç) |
| `LIQ_COLL_RATIO_BPS` | 16.000 (tasfiye çizgisi: %160) |
| `CLOSE_FACTOR_BPS` | 5.000 (normal tasfiye tek seferde en fazla borcun %50'si) |
| `DEEP_TRIGGER_BPS` | 10.500 (%105 altına düşüş → derin su tam tasfiye) |
| `LIQ_BONUS_BPS` | 500 (tasfiye bonusu %5, geri ödenen tutar üzerinden) |
| `LIQ_PROTOCOL_BPS` | 100 (bunun %1'i rezerve gider) |
| Faiz eğrisi | U=0 → %2, U=35% → %6, U=50% → %46 |
| `LENDABLE_AMM_BPS` | 3.000 (AMM'deki HAC'in yalnızca %30'u borç verilebilir) |
| `U_MAX_BPS` | 5.000 (küresel kullanım üst sınırı %50) |
| `BORROWER_CAP_BPS` | 2.000 (tek borçlu üst sınırı %20) |
| `RES_TARGET_BPS` | 300 (batık borç rezervi üst sınırı %3) |
| `MAX_DEPOSIT_COUNT` | 200 (işlem başına yatırma üst sınırı) |
| `RENT_PERIOD` | 300 blok |
| `REF_WINDOW` | 300 blok (EMA zaman sabiti, yaklaşık 1 gün) |
| `EMA_MAX_STEP_BPS` | 1.000 (referans fiyatın tek seferde en fazla %10 hareketi) |
| `REF_DEV_BPS` | 2.000 (devre kesici eşiği: spot referans fiyattan %20 saparsa → yeni borçlanma durur) |
| VM üç kova sınırı | compute 18.009 / resource 6.100 / storage 111.911 |
| İşlem sınırı | 16.384 bayt |
| Hedef blok süresi | 300 saniye |

## Ek B: Birimler

hacds **ondalık 0** olan bir varlıktır. Zincir üstündeki tamsayı sayının
kendisidir: 1, 1'dir; ondalık kısım yoktur. Bu, önceki sürümden (ondalık 8) daha
basittir — atom ile "adet" arasında gidip gelen dönüşüm gerekmez.

**Üç kural:**

1. **hacds her zaman adet olarak sayılır, dönüşüm yapılmaz.** Bakiye, havuz,
   teminat, giriş alanı, fiyat teklifi — görülen her yerde aynı sayıdır.
2. **HAC ayrı bir ölçektir.** Zincir üstü birim zhu'dur (1 HAC = 1e8 zhu),
   arayüzlerde her zaman HAC kullanılır. Bu yüzden `add_liquidity(hac_amt, ds_amt)`
   fonksiyonunun iki parametresinin boyutu farklıdır: biri zhu, diğeri hacds
   adedi. 1e8 kat hata yapmanın en kolay olduğu yer burasıdır; biz de ilk
   yatırımda bir kez yaptık.
3. **Toplam arz 5.963.298.700.000.000, JS güvenli tamsayı sınırını aşmıştır.**
   `Number.MAX_SAFE_INTEGER` 9.007.199.254.740.991'dir ve toplam arz bunun
   %66'sına ulaşır — değer hâlâ sığar, ancak "tam gösterim" psikolojik kırmızı
   çizgisi çoktan geçilmiştir; herhangi bir ara işlem (örneğin havuz adediyle
   çarpmak) hassasiyet kaybeder. Bu yüzden JS'te `BigInt`, Kotlin'de `BigInteger`
   kullanmak zorunludur; `Long` (üst sınırı yaklaşık 9,2×10¹⁸) yetmez.

---

*Bu belge, `HacdsDeFi3000.fitsh` kontratının kesinleşmiş parametrelerine karşılık
gelir.*
