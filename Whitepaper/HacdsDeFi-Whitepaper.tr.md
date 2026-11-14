# HacdsDeFi Teknik Raporu

2026-11-11　Sürüm 3 (kontrat #3000)

> Bu belge, Hacash ana ağındaki `HacdsDeFi3000.fitsh` kontratını açıklar
> (kontrat adresi `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`, varlık serial 3000).
> Buradaki her sayı kontrat kaynak kodundaki bir sabittir ve dağıtımdan sonra
> değiştirilemez.

---

## Başlamadan önce

hacds, Hacash ana ağında bir zincir üstü varlıktır: serial 3000, ondalık 0.

Hacash'in ilk DeFi kontratı üzerinde çalışır. Hacash, HVM'yi (Turing-tam akıllı
kontrat VM'i) 765.432 blok yüksekliğinde etkinleştirdi ve bu kontrat, dört DeFi
ilkelini — AMM piyasa yapıcılığı, kredi, tasfiye ve hazine — tek bir kontratta
toplayan ana ağdaki ilk uygulamadır.

Bu sürüm ile önceki arasındaki fark parametre ayarı değil; **üç merkezî bileşen tamamen silindi**:

| Önceki sürüm | Bu sürüm |
|---|---|
| Zincir dışı oracle puanlar ve sertifika imzalar; kontrat imzayı doğrular | Kontrat elmas genini zincir üzerinde okur ve kendisi puanlar |
| Altı yönetici parametre fonksiyonu | Yönetici yok. Hiç yok. |
| `set_paused` küresel durdurma anahtarı | Durdurma anahtarı yok |
| serial 2000, ondalık 8 | serial 3000, ondalık 0 |
| İşlem başına 1 elmas | İşlem başına 200 elmas |

Silinen şeyler geri gelmez. Bu bir tasarım tercihidir, yol haritası değil.

Belge altı bölümden oluşur: geçen sefer neyin yanlış gittiği, bu sürümün tasarımı,
dört belirleyici özellik, sistem mimarisi, mevcut durum ve bilinen sınırlar.

---

## 1. Önceki sürüm

### 1.1 Özgün tasarım

Önceki sürüm hacds'i HACD elmaslarına kazınan bir yazıt olarak tanımlıyordu.
Dört parçadan oluşuyordu.

**Yazıtla arz.** Her HACD bir Hacds yazıtı taşır ve elmas başına yalnızca biri
geçerlidir. Sıradan bir elmas 10.000 hacds ödüyordu. Özel bir elmasın ne kadar
ödeyeceği (kalp için 500.000, dört ardışık harf için 300.000, özel şekil için
200.000) topluluk oylamasıyla belirleniyordu.

**Eklentiyle ticaret.** Merkeziyetsiz borsa MoneyNex adlı bir eklenti cüzdanı
olarak yapıldı. Kullanıcılar eklentiyi kurup onun cüzdanı üzerinden işlem
yapıyordu.

**Listelenmeyi hedef saymak.** Teknik raporda yazılan ilk listeleme hedefi
xeggex.com idi.

**Zincir taramasıyla keşif.** Her istemci tüm zinciri kendisi tarayıp yazıtları
arıyordu; üçüncü taraf sunucular ek olarak arama sağlayabiliyordu.

### 1.2 Yaptık ve listelendi

Bunların hiçbiri kâğıt üstünde bir tasarım değildi. Yazıt sistemi yapıldı,
MoneyNex eklentisi çalıştı ve hacds iki borsada listelendi: xeggex.com ve
nonkyc.io.

Sonra işlem durduruldu.

### 1.3 Yanlış giden neydi

Kök neden ilk maddedir. Diğer üçü onun sonuçlarıdır.

**Fiyatın çıpası yoktu.** Arz oranı oylamayla belirlendiği için, her elmas sınıfının
kaç hacds ettiği her an bir oylamayla değiştirilebiliyordu. Borsalar yeniden
üretilebilir bir dönüşüm dayanağı bulamadı, piyasa yapıcılar istikrarlı fiyat
veremedi ve derinlik hiç oluşmadı.

**Ticaret başkasına bağlıydı.** Merkeziyetsiz borsa üçüncü taraf bir eklentiydi.
Eklenti güncellenmeyi bırakırsa borsa da durur. Merkezî borsalar daha da
doğrudandı: işlem ve dolaşım xeggex ve nonkyc'in elindeydi.

**Geri dönüş yolu yoktu.** Bu iki borsa tüm dolaşım kanalıydı. Dururlarsa zincir
üzerinde işlem yapılacak başka yer kalmıyordu.

Özetle: token serbestçe dolaşamıyorsa fiyatlanamaz; fiyatlanamıyorsa piyasa
yapılamaz; piyasa yoksa her şey borsalara bağlıdır; borsa durursa her şey durur.

Listelenme hiçbir zaman asıl mesele değildi. Listelense bile tasarımdaki kusurlar
kaybolmuyordu — yalnızca işlemin durdurulduğu güne erteleniyordu. Bu sürümde
tasarımın değişmesinin doğrudan nedeni budur.

### 1.4 Bu sürüm neyi değiştirdi

Önce tek bir şey: token elmasların üzerinden alındı.

hacds, hiçbir elmasa bağlı olmayan, serbestçe bölünebilen ve transfer edilebilen
standart bir zincir üstü varlık oldu. Finansal mantık eklentilerden ve borsalardan
kontrata taşındı. Dolaşım artık listelenmeye bağlı değil; zincir üstü AMM kendi
başına işlem yapıyor. Listelenme artık hayatta kalmanın ön koşulu değil, isteğe
bağlı bir seçenek.

Bunun üzerine, önceki sürümden kalan iki merkezî bileşen — **oracle** ve
**yönetici** — de silindi.

---

## 2. Bu sürümün tasarımı

### 2.1 Arz nereden geliyor

hacds'in toplam arzı keyfî değil. Ağdaki tüm elmaslardan hesaplanır.

Her HACD, beş HIP-5 boyutunda puanlanır (şekil, desen, renk, isimlendirme, numara).
Kontrat `SCORE_SCALE = 1e8` ayarlar: **1 puan 100 milyon hacds basar**. Toplam,
ağ genelindeki tam ortalamayı kullanır:

```
Ağ toplam puanı  = ortalama puan × toplam HACD arzı
                 = 3.55440306 × 16.777.216
                 = 59.632.987 puan

Toplam arz       = toplam puan × puan başına 1e8
                 = 59.632.987 × 100.000.000
                 = 5.963.298.700.000.000 hacds
```

Bunu herkes yeniden hesaplayabilir: gezgin API'sini çekin, her elması aynı
algoritmayla puanlayın, aynı sayıya ulaşırsınız. Önceki sürümde eksik olan tam
olarak buydu — kimsenin kararına bağlı olmayan bir dayanak.

### 2.2 Puanlama nasıl çalışır: zincir üzerinde okuma, oracle yok

Önceki sürüm zincir dışında puanlıyor, sertifika imzalıyor, kontrata imzayı
doğratıyor ve karşılaştırmak için zincir üzerinde yeniden hesaplıyordu. **Bu sürüm bu yolun tamamını siliyor.**

Kontrat artık HACD'yi teslim alan işlemin içinde doğrudan VM'den elmas genini
istiyor:

```
hacd_number_batch(names)        → her elmasın numarası (u64)
hacd_visual_gene_batch(names)   → her elmasın görsel geni (10 bayt)
```

Genleri aldıktan sonra kontrat, beş HIP-5 boyutunda kendisi puanlıyor.
**Zincir dışı katılım yok, sertifika yok, imza yok ve taklit edilebilecek hiçbir şey yok.**

Bu yetenek, Hacash düğümlerinin v1.3.0'dan itibaren sağladığı "HACD gen görünümü"ne
ve 800.000 blok yüksekliğinde etkinleştirilmesine bağlıdır. İki koşul birlikte
gereklidir — eski düğüm genleri veremez, daha düşük yükseklikte VM çağrıyı
reddeder.

### 2.3 Toplu işlem: tek seferde 200 elmas

Bu, v1.3.0'ın getirdiği ikinci değişiklik.

Önceki sürüm işlem başına yalnızca bir elmas yatırabiliyordu. Nedeni gazdı: FitSH
içinde bir elması puanlamak `resource` kovasından yaklaşık 3.270 birim yakıyordu ve
bu kovanın sınırı 6.100. İki elmas taşırıyordu.

Bu sürüm puanlamayı FitSH'ten çıkarıp bir **RV64IM hesap çekirdeğine** taşıyor
(`score_sum`). Tek çağrı, en fazla 200 elmasın adını, numarasını ve genini geçirip
toplam puanı döndürür:

```
girdi   names[6n] ‖ numbers[8n] ‖ visual_genes[10n]
çıktı   Σ puan (8 bayt büyük-endian u64)
```

200 elması puanlamak `compute` kovasından 3.587 birim tutuyor — tek kova yeter.
**200 elmas, tek işlem, tek imza.**

Yatırma toplu; geri alma hâlâ tek elmas. Nedeni §6.1'de.

### 2.4 Varlık özellikleri

| Öğe | Değer |
|---|---|
| serial | 3000 |
| ticket / name | HACDS / hacds |
| **ondalık** | **0** (1 en küçük birim = 1 hacds) |
| Toplam arz | 5.963.298.700.000.000 |
| issuer | T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH (kontratın kendisi) |
| Basım maliyeti | 8 HAC (protokol ücreti, blok ödülüyle dalgalanır) |

#1028'deki zincir üstü varlık da HACDS ticket'ını kullanır (adı "HACD Fragments",
başkasının varlığı). Protokol name ve ticket çakışmasını kontrol etmez; yalnızca
serial'in alınıp alınmadığına bakar. **Protokol serial 3000'i tanır.**

> ⚠ Eski serial 2000 (`VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1` adresi) kullanımdan
> kaldırıldı. İki serial bağımsız varlıklardır: birbirine çevrilemez, dönüştürülemez.

---

## 3. Dört belirleyici özellik

### 3.1 Açık kaynak

Kontrat (fitsh kaynağı ve RV64IM çekirdeği), indeksleyici, işlem oluşturma servisi
ve cüzdanlar (PC ve Android) tamamen açık kaynak.

Bir DeFi protokolü başkalarının parasıyla çalışır. Kullanıcının kendini korumasının
tek yolu kodu okuyup hesabı doğrulayabilmesidir. Önceki sürümün cüzdanı üçüncü
taraf bir eklentiydi — kullanıcı yalnızca güvenmek ya da güvenmemek arasında
seçim yapabiliyordu. Bu sürüm mantığı açıkça ortaya koyuyor.

Kod açık olduğunda üç şey doğrudan mümkün olur:

- **Puanlama bağımsız olarak yeniden hesaplanabilir.** Herkes ağdaki tüm elmasları
  çekip aynı algoritmayla yeniden puanlayabilir ve arzın kontratın ödediğiyle
  eşleşip eşleşmediğini kontrol edebilir. Test ağında 119 fark testi, çekirdeğin
  FitSH referans uygulamasıyla tam olarak eşleştiğini doğruladı.
- **Kontrat davranışı denetlenebilir.** Yönetici olmaması, fonksiyon listesinde
  parametre değiştirebilecek, bakiye değiştirebilecek veya protokolü
  durdurabilecek hiçbir giriş noktası olmadığı anlamına gelir. Bu, fonksiyon
  fonksiyon doğrulanabilir — sözümüze güvenmeniz gerekmez.
- **Servisler değiştirilebilir.** İndeksleyici ve işlem oluşturma servisi durumsuz
  HTTP servisleridir. Herkes kendi servisini çalıştırıp istemciyi ona
  yönlendirebilir.

### 3.2 Merkeziyetsizlik

Bunun sınırları olmalı. Nitelendirmeden "tamamen merkeziyetsiz" demek bir şey
ifade etmez.

**Yapılanlar:**

Kurallar ve yürütme zincir üzerinde. AMM fiyatlaması, kredi uygunluğu, tasfiye
eşikleri ve ücret dağıtımı tamamen kontrat kodudur. Katılımcılar aynı kurallarla
işlem yapar. Biz ortada değiliz ve araya giremiyoruz.

**Yönetici yok.** Önceki sürümde altı yönetici fonksiyonu vardı (`set_fee`,
`set_loan_rate`, `set_liquidate_bonus`, `set_paused`, `set_oracle`, `rent_batch`).
Bu sürümde **hiçbiri yok**. Zincir üzerinde çağrılmaları `CallNotExist(51)`
döndürür — "yetkiniz yok" değil, **fonksiyon gerçekten yok**.

Her parametre derleme zamanı sabitidir. Ücretler, faiz eğrisi, tasfiye çizgisi,
rezerv hedefi — hepsi kaynak kodda yazılı. Dağıtımdan sonra kimse, biz dahil,
değiştiremez.

Kontrat yükseltilemez ve arka kapısı yok. Kendini imha fonksiyonu, yükseltme
fonksiyonu, kullanıcı bazlı dondurma fonksiyonu yok. Ne dağıtıldıysa o kalır.

Katılım izinsizdir. Takas, piyasa yapıcılığı, kredi, tasfiye ve hatta anahtar
yenileme (`rent_keys`) herkese açıktır. Beyaz liste yok, onay yok.

Varlıklar sizin elinizde kalır. hacds, kullanıcının kendi adresinde tutulan
standart bir zincir üstü varlıktır. Saklamıyoruz ve donduramıyoruz.

**Yapılmayanlar, açıkça:**

Hazine anahtarı tek noktadır. Ücretler hazine adresinde
`1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK` birikir; bu, özel anahtarı yalnızca bizde
olan soğuk bir cüzdandır. Kontratta çekim fonksiyonu yok, dolayısıyla kimse
kullanıcı varlıklarını alamaz; ancak **hazinedeki protokol geliri** bu tek
anahtarın kontrolündedir. Bu sürümün proje ekibine güvenmenizi istediği tek yer
burasıdır.

Sunucular tek noktadır. İndeksleyici (borçlu defteri) ve işlem oluşturma servisi
bizim donanımımızda çalışır. **Hiçbir özel anahtar tutmazlar ve konsensüse katılmazlar.** Kullanıcılar kendi servislerini koyabilir veya çevrimdışı imzalayıp
yayınlayabilir. Ancak kapalı olduklarında web uygulamasının kolaylık özellikleri
etkilenir.

Bu ikisi, buradaki merkeziyetsizliğin gerçek sınırlarıdır.

### 3.3 Güvenlik

İki yarı: paranızın nasıl saklandığı ve protokol kurallarının nasıl garanti
edildiği.

**Özel anahtarlar ağa hiç dokunmaz.** Cüzdan soğuk ve sıcak yarıya bölünmüştür.
Çevrimdışı makine oluşturur ve imzalar, çevrimiçi makine yalnızca sorgular ve
yayınlar. Özel anahtar ana sürecin belleğinde tam olarak bir kez görünür, bir alt
sürece ortam değişkeniyle geçirilir ve diske yazılmaz. Bu, Hacash işlemlerinin
nonce ve zaman damgası süresi olmaması sayesinde çalışır — çevrimdışı imzalanmış
bir işlem, ne zaman yayınlanırsa yayınlansın geçerliliğini korur.

**İmzalama yerelde yapılır.** İşlemler paket içindeki Rust programı tarafından
yerel makinede imzalanır, asla bir düğüm üzerinden değil. Düğümler yalnızca
çevirmek, doğrulamak ve yayınlamak için kullanılır. Düğümün
`/util/transaction/sign` uç noktası özel anahtarın HTTP üzerinden gönderilmesini
gerektirir; biz onu kullanmıyoruz.

**Cüzdan dosyaları şifrelidir.** Parola scrypt ile genişletilir (N=2¹⁵, r=8, p=1),
şifreleme AES-256-GCM'dir ve format sürümü AAD olarak bağlanır. PC ve Android
cüzdanları aynı keystore biçimini (`hacds-keystore v1`) paylaşır ve birbirlerinin
dosyalarını içe aktarabilir.

**Arayüz sürecinin sistem yetkisi yoktur.** Renderer `contextIsolation` açar,
`nodeIntegration` kapatır ve ana sürece yalnızca preload beyaz listesi üzerinden
erişebilir. Renderer'a kötü niyetli içerik verilse bile dosya sistemine veya özel
anahtara ulaşamaz.

**Puanlama taklit edilemez.** Puanlama kontratta, VM'in döndürdüğü girdiler
üzerinde yapılır. Ele geçirilecek zincir dışı adım ve taklit edilecek imza yoktur.

**Varlıklar korunur.** Zincir üstü özdeşlik geçerlidir: kullanıcıların elindeki
miktar artı kontratın elindeki miktar toplam arza eşittir. Her işlem bunu korur ve
herkes her an kontrol edebilir.

### 3.4 DeFi bütünlüğü

Önceki sürümün "finansı" iki şeydi: token basmak ve onu bir borsaya listelemek.
Finansal ilkeller yoktu — piyasa yapıcılığı yok, teminat yok, borç yok; getiri
yalnızca fiyat artışından geliyordu.

Bu sürüm bu boşluğu dolduruyor. Tek kontrat, dört modül:

| Modül | İçerik |
|---|---|
| AMM | İki yönlü HAC ↔ hacds. Sabit çarpım `x × y = k`, %0,5 ücret, **LP %80 / hazine %20** |
| Kredi | hacds'i teminat olarak yatır, HAC borç al. %200 borç oranı, %160 tasfiye çizgisi, %2–%46 dalgalı faiz |
| Tasfiye | İki kademe: normal (%105–%160, borcun yarısı) ve derin su (<%105, tamamı) |
| Hazine | Ücretler birikir; herkes soğuk cüzdana süpürme tetikleyebilir |

Ayrıca birkaç araç.

**Atomik işlemler.** Tek işlemde birden fazla eylem, ya hep ya hiç. Protokol
sınırı 200 eylem.

**Sosyalize edilmiş batık borç (hcut).** Aşırı durumlarda batık borç tüm
mevduat sahiplerine orantılı olarak dağıtılır ve yalnızca azalan küresel bir
`hcut` faktörüyle ifade edilir. Bu, kamuya açık, tek seferlik ve geri
alınamaz bir kayıptır — hata değil, son savunma hattıdır.

**Depolama kirası.** Hacash kontrat durumu kira öder ve anahtarlar süresi dolar.
Kontrat izinsiz `rent_keys` sunar: herkes yenileyebilir ve anahtar başına 0,07 HAC
kazanabilir. Keeper böyle çalışır ve herkes bir tane çalıştırabilir.

**Tembel faiz tahakkuku.** Cron işi yok, keeper bağımlılığı yok. Faiz, biri
kontratla etkileşime girdiğinde blok yüksekliği farkıyla tamamlanır. Gaz tasarrufu
sağlar ve kimse bakım yapmadığı için duramaz.

---

## 4. Sistem mimarisi

Dört katman: zincir üstü kontrat ve varlık, düğüm ve destek servisleri, istemci
cüzdanları ve soğuk/sıcak ayrımı.

### 4.1 Üç katman ve sorumlulukları

| Katman | Bileşen | Yapabilir | Yapamaz |
|---|---|---|---|
| (1) Zincir üstü | HacdsDeFi kontratı · `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` | Koda göre varlık taşır, borç kaydeder, tasfiye eder, puanlar | Hiçbir adres tarafından değiştirilemez veya durdurulamaz |
| (1) Zincir üstü | hacds varlığı · serial 3000 · ondalık 0 | Bölünebilir, transfer edilebilir, listelenebilir | Basılamaz (basım fonksiyonu yok) |
| (2) Servisler | Tam düğüm RPC · `node.hacds.com` | Zinciri okur, doğrular, yayınlar | Özel anahtar elde edemez (imza uç noktasını kullanmıyoruz) |
| (2) Servisler | API vekili · `api.hacds.com` | Düğüme yönlendirir, CORS + HTTPS ekler | Hiçbir semantiği değiştirmez |
| (2) Servisler | İndeksleyici · `indexer.hacds.com` | Zinciri tarar, kimin borcu olduğunu kaydeder | Hiçbir zincir üstü durumu etkileyemez |
| (2) Servisler | Oluşturma servisi · `build.hacds.com` | İnsan girdisini imzasız işleme çevirir | İmzalayamaz (özel anahtarlar istemcide) |
| (3) İstemciler | PC konsolu / Android | Yerelde imzalar, yayınlar | Kontrat kurallarını atlayamaz |

**Veri akışı**: istemciler durumu "API vekili → tam düğüm" üzerinden, defteri
indeksleyiciden okur. İşlem göndermek için kendileri oluşturabilir veya oluşturma
servisinden imzasız işlem isteyebilir — **imzalama her zaman istemcide yerelde yapılır**.

**⚠ Sert bir kısıt**: tam düğüm sandbox çağrıları IP başına 2 eşzamanlı istekle
sınırlıdır. Fazlası kuyruğa alınmaz, doğrudan reddedilir. İstemciler geri
çekilmeli sıralama yapmalıdır.

**Servis adresleri neden `IP:port` değil de alt alan adı**: Cloudflare Workers
yalnızca 80 ve 443 portlarına ulaşabilir; `IP:8082` biçimindeki her adres bağlantı
denenmeden reddedilir. Bu yüzden dışarıya her şey Tunnel destekli `*.hacds.com`
alt alan adları üzerinden gider.

### 4.1 Sorumluluk sınırları

| Bileşen | Yapabilir | Yapamaz |
|---|---|---|
| Kontrat | Kod kurallarına göre varlık taşır, borç kaydeder, tasfiye eder | Hiçbir adres tarafından değiştirilemez veya durdurulamaz |
| Tam düğüm | Zinciri okur, doğrular, yayınlar | Özel anahtar elde edemez (imza uç noktasını kullanmıyoruz) |
| İndeksleyici | Kimin borcu olduğunu kaydeder, sağlık hesaplar | Hiçbir zincir üstü durumu etkileyemez |
| Oluşturma servisi | Parametreleri imzasız işleme çevirir | İmzalayamaz (özel anahtarlar istemcide kalır) |
| İstemci | Yerelde imzalar, yayınlar | Kontrat kurallarını atlayamaz |

---

## 5. Mevcut durum

### 5.1 Tamamlananlar

| Öğe | Durum |
|---|---|
| Kontrat kaynağı | Kesin. 16.198 bayt (sınır 16.384). Tam güvenlik denetiminden geçti. |
| Puanlama çekirdeği | RV64IM çekirdeği, 2.026 bayt. 119 fark testi FitSH referansıyla eşleşiyor. |
| Test ağı | Yerel tam düğüm ve çok sayıda adres. A/B/C/G grupları — 40 işlevsel test — hepsi geçti. |
| Saldırı testleri | 43 saldırı senaryosu (yeniden giriş, önden koşma, fiyat manipülasyonu, alt taşma vb.) |
| Servisler | Düğüm, indeksleyici, oluşturma servisi, keeper hepsi çevrimiçi, açılışta otomatik başlıyor |
| PC cüzdanı | v0.3.1 — Windows kurulum paketi ve taşınabilir sürüm |
| Android | v0.2.0 — imzalı APK, arm64 |
| Web sitesi | hacds.com (teknik rapor, belgeler, web konsolu) |

### 5.2 Henüz yapılmayan: dağıtım

**Kontrat henüz ana ağa dağıtılmadı.** Tek bir nedeni var: VM yükseltmesinin
etkinleşme yüksekliğine ulaşılmadı.

| Koşul | Durum |
|---|---|
| Düğüm ≥ v1.3.0 (HACD gen görünümü sağlar) | ✅ Hazır |
| Blok yüksekliği ≥ 800.000 | ⏳ Şu an 798.812; yaklaşık 1.188 blok kaldı |

İkisi birlikte gereklidir. Yüksekliğe ulaşıldığında dağıtım yapılacak.

O zamana kadar web sitesi ve cüzdanlar #3000 özelliklerine göre oluşturulmuştur;
işaret ettikleri kontrat adresinde dağıtıma kadar kod olmayacak.

### 5.3 Test ağının doğruladıkları

- **Toplu yatırma**: tek işlemde 54 elmas doğrulandı; fark testleri 200 elmas
  sınırının tamamını kapsıyor
- **AMM**: sabit çarpım birime kadar doğru; kayma koruması ve ilk yatırım ölü
  payları doğru çalışıyor
- **Kredi**: borç limitleri, faiz tahakkuku, geri ödeme ve sağlık görünümleri
  beklentilerle uyumlu
- **Tasfiye**: hem normal hem derin su tasfiyesi gerçekten tetiklendi ve muhasebe
  tam olarak kapandı
- **Transferler**: HAC, hacds ve HACD adresler arasında transfer edildi
- **Saldırı simülasyonu**: 43 senaryonun tamamı beklendiği gibi başarısız oldu;
  sömürülebilir yol yok

İki gerçek kusur bulundu ve düzeltildi; ikisi de tasfiye yolunda ve yalnızca test
ağındaki gerçek zincir üstü yürütmeyle ortaya çıktı: bir `resource` kovası taşması
ve bir alt taşma. Düzeltme notları `hacds_exchange/修复说明-清算gas与下溢.md`
dosyasında.

---

## 6. Bilinen sınırlar

Bunlardan bazıları eksiklik değil, bilinçli ödünleşimlerdir. Yeniden keşfedilmesin
diye yazıldılar.

### 6.1 Geri alma hâlâ tek elmas

Yatırma 200'e kadar toplu; geri alma tek seferde bir elmas. Bu bilinçlidir.

Geri alma "kiraz toplama primi"ni fiyatlamak zorundadır: yüksek puanlı bir elması
geri almak daha pahalıdır ve oran, o elmasın puanının **havuz ortalamasına** göre
konumuna bağlıdır. Toplu işlemde her elmas farklı değerlendirilir ve geri alma
ayrıca otomatik AMM tamamlamasını tetikler, dolayısıyla her biri kendi bakiye
kontrolünü gerektirir.

Daha temelde, **muhasebe anlamı** zorlaşır: toplu işlemde 47. elmas başarısız
olursa, işlenmiş 46 tanesi nasıl geri alınır? Kontrat yükseltilemez ve bu geri
alma mantığını yanlış yazmak fonların kilitlenmesi demektir.

Yani: **toplu yatırma, tek geri alma.** Cüzdan seçiminizi otomatik olarak birden
fazla işleme böler; kullanıcı bir kez tıklar.

### 6.2 Hazine tek nokta

Soğuk cüzdan, sabit. Projenin gelir hesabı ve bize güvenmeniz gereken tek yer.

### 6.3 Sunucular tek nokta

İndeksleyici ve oluşturma servisi bizim donanımımızda çalışır. Zincir üstü durumu
etkileyemezler, ancak kapalı olduklarında web uygulaması daha az kullanışlıdır.
Herkes kendi servisini çalıştırabilir — kaynak açık.

### 6.4 300 saniyelik bloklar

Başarılı yayın onay değildir; `ret:0` yalnızca belleğe (mempool) ulaştığı anlamına
gelir. Cüzdan blok temposunda yeniden sorgular (15, 45, 90, 180, 320 saniye).

### 6.5 Faiz ayrı gösterilmez

Kontrat faizi tembel tahakkuk ettirir ve tahakkuk başlangıcının herkese açık alıcısı
yoktur. Cari borçlu faiz dışarıdan hesaplanamaz; yalnızca geri ödeme anında
kapatılmış sonuç olarak görünür.

### 6.6 Çekimler geçici olarak reddedilebilir

Çok fazla borç verilmişse ve nakit yetersizse HAC mevduat sahiplerinin çekimleri
reddedilir. Bu bilinçlidir — protokol, kilitlenebilecek bir kuyruk yazmak yerine
beklemenizi tercih eder. İki koruma katmanı bunu nadir kılar: toplam borçlanma
%50 ile sınırlıdır ve AMM'deki HAC'in yalnızca %30'u borç verilebilir.

### 6.7 Kontrat yükseltilemez

Sonradan bulunan bir hata düzeltilemez. Parametrelerin muhafazakâr olmasının nedeni
budur (%20 tasfiye tamponu, %50 borç sınırı, iki katman nakit koruması) ve bir neden
daha: **tüm birikiminizi içine koymayın**.

---

## 7. SSS

**hacds enflasyon yaşar mı?**
Hayır. Elmas değerine karşı, 5.963.298.700.000.000 sabit toplamla basılır ve basım
fonksiyonu yoktur. Yatırmada kontrat `basılmış + bu basım ≤ toplam arz` kontrolü
yapar ve aşanı reddeder (return 53).

**Paramı alabilecek bir yönetici var mı?**
Yönetici yok. Kontratta hiçbir `set_*` fonksiyonu yok; çağrılması
`CallNotExist(51)` döndürür — yetki hatası değil, fonksiyon gerçekten yok. Kimse
protokolü durduramaz, parametre değiştiremez veya kullanıcı varlıklarını taşıyamaz.

**Tek seferde kaç elmas yatırabilirim?**
200. Tek işlem, tek imza.

**Neden geri almada yalnızca bir elmas?**
Bkz. §6.1. Kiraz toplama primi elmas başına fiyatlanmalıdır ve toplu geri alma
mantığı yükseltilemeyen bir kontratta çok risklidir.

**APY nedir?**
Dalgalıdır. Mevduat getirisi ne kadar borç verildiğine bağlıdır; borçlanma maliyeti
%2 ile %46 arasında dalgalanır. Arayüz canlı değerleri gösterir.

**Elmas fiyatı düşerse ne olur?**
Tasfiye çizgisinin altında, tasfiye edenler borcunuzu öder ve teminatınızın bir
kısmını alır. Geri kalanı hâlâ sizindir.

**Ödemesiz süre yok** — oran %160'ın altına düştüğünde herkes her an tasfiye
edebilir, önceden bildirim yapılmaz. Tek tasfiye borcun yalnızca yarısını kapatır,
ancak fiyat düşmeye devam ederse tekrarlanan tasfiyeler olur; %105'in altında tüm
pozisyon bir kerede kapatılır.

Bu olmadan önce teminat eklemek veya borcun bir kısmını geri ödemek bunu önler.

**Tasfiye beni tek seferde silip süpürür mü?**
Normal tasfiye (%105–%160) borcun en fazla %50'sini kapatır ve tasfiye eden bonusu
**geri ödenen tutar** üzerinden hesaplanır, borcun payı üzerinden değil. Yani
borcun yarısını tasfiye etmek teminatın yaklaşık üçte birini alır — ardından oran
%200'ün üzerine çıkar ve tehlike bölgesinden hemen ayrılır.

Ancak fiyatlar düşmeye devam ederse tekrar tasfiye edilirsiniz. %105'in altında
derin suya girersiniz ve tüm borç bir kerede kapatılır.

**Yüksek puanlı bir elması geri almak neden daha pahalı?**
İnsanların havuzdan en iyi elmasları seçmesini önlemek için. Kiraz toplamaya
yönelik bir vergidir, en fazla %30'dur. Sıradan ve düşük puanlı elmaslar ek ücret
ödeme.

**Protokol geliri nereye gidiyor?**
Hazine soğuk cüzdanı `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK`. Adres herkese açıktır
ve herkes bakiyesini kontrol edebilir.

**Ekip fonlarla kaçabilir mi?**
Kontratta çekim fonksiyonu yok, yönetici ayrıcalığı yok ve kod açık ve
denetlenebilir. Ancak **hazine anahtarı tek noktadır** — projeye güvenmeniz gereken
tek yer. Kontrat da yükseltilemez, bu yüzden her şeyinizi içine koymayın.

**Elmas fiyatı nereden geliyor?**
Dış veri kaynağı yok. Doğrudan AMM havuzunun bakiye oranını okur ve kimse bunu
taklit edemez. Tek bir işlem referans fiyatı en fazla %10 hareket ettirebilir; bu
da manipülasyonu çok pahalı kılar.

**Anahtarın süresi dolduğunda ne olur?**
Hacash kontrat durumu kira öder ve süresi dolan anahtarlar etkisiz olur
(`StorageNotActive`). Kontrat izinsiz `rent_keys` sunar: herkes yenileyebilir ve
anahtar başına 0,07 HAC kazanabilir. Keeper böyle çalışır.

---

## Ek A: Adresler ve parametreler

| Öğe | Değer |
|---|---|
| Dağıtıcı | `15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q` |
| Kontrat nonce | 2 |
| **Kontrat adresi** | **`T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`** |
| Hazine (soğuk cüzdan) | `1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK` |
| hacds serial | **3000** (ondalık **0**) |
| hacds toplam arz | 5.963.298.700.000.000 |
| `SCORE_SCALE` | 1e8 (1 puan = 100 milyon hacds) |
| Ağ toplam puanı | 59.632.987 puan (= ortalama 3.55440306 × 16.777.216 elmas) |
| `FEE_BPS` | 50 (AMM ücreti %0,5) |
| Ücret bölüşümü | LP %80 / hazine %20 |
| `BORROW_RATIO_BPS` | 20.000 (borç çizgisi: %200 teminat oranı, yani en fazla %50 borç) |
| `LIQ_COLL_RATIO_BPS` | 16.000 (tasfiye çizgisi: %160) |
| `CLOSE_FACTOR_BPS` | 5.000 (normal tasfiye en fazla borcun %50'si) |
| `DEEP_TRIGGER_BPS` | 10.500 (%105 altı → derin su tam tasfiye) |
| `LIQ_BONUS_BPS` | 500 (%5 tasfiye eden bonusu, geri ödenen tutar üzerinden) |
| `LIQ_PROTOCOL_BPS` | 100 (bunun %1'i rezerve) |
| Faiz eğrisi | U=0 → %2, U=35% → %6, U=50% → %46 |
| `LENDABLE_AMM_BPS` | 3.000 (AMM HAC'inin yalnızca %30'u borç verilebilir) |
| `U_MAX_BPS` | 5.000 (küresel kullanım sınırı %50) |
| `BORROWER_CAP_BPS` | 2.000 (tek borçlu sınırı %20) |
| `RES_TARGET_BPS` | 300 (batık borç rezervi sınırı %3) |
| `MAX_DEPOSIT_COUNT` | 200 (işlem başına yatırma sınırı) |
| `RENT_PERIOD` | 300 blok |
| `REF_WINDOW` | 300 blok (EMA zaman sabiti, yaklaşık bir gün) |
| `EMA_MAX_STEP_BPS` | 1.000 (referans fiyat tek hareket en fazla %10) |
| `REF_DEV_BPS` | 2.000 (devre kesici: %20 sapma → yeni borçlanma durur) |
| VM kova sınırları | compute 18.009 / resource 6.100 / storage 111.911 |
| İşlem sınırı | 16.384 bayt |
| Hedef blok süresi | 300 saniye |

## Ek B: Birimler

hacds **ondalık 0**'dır. Zincir üstündeki tam sayı sayının kendisidir — 1 bir
demektir ve kesir yoktur. Bu, önceki sürümden (ondalık 8) daha basittir: atom ile
"birim" arasında gidip gelen dönüşüm yoktur.

**Üç kural:**

1. **hacds her zaman birim olarak sayılır, dönüşüm yok.** Bakiyeler, havuzlar,
   teminat, giriş alanları, fiyat teklifleri — hepsi aynı sayıyı gösterir.
2. **HAC farklı bir ölçektir.** Zincir üstü birim zhu'dur (1 HAC = 1e8 zhu) ve
   arayüzler baştan sona HAC kullanır. Dolayısıyla `add_liquidity(hac_amt, ds_amt)`
   farklı ölçeklerde iki parametre alır: bir tarafta zhu, diğerinde hacds sayısı.
   1e8 kat hata yapmanın en kolay olduğu yer burasıdır; ilk yatırımda biz de
   yaptık.
3. **Toplam arz 5.963.298.700.000.000, JS `Number.MAX_SAFE_INTEGER`'ın %66'sını aşıyor.** JavaScript'te BigInt, Kotlin'de BigInteger kullanın. `Long` yetmez.

---

*Bu belge, `HacdsDeFi3000.fitsh` kontratının kesinleşmiş parametrelerine karşılık
gelir.*
