# HacdsDeFi Kullanım Kılavuzu

2026-11-18　PC cüzdanı 0.4.4 / Android 0.2.3 için

> Bu belge #4000 kontratına karşılık gelir (adres
> `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h`, hacds varlık serial 4000,
> pay varlığı serial 4001).
>
> **Bu sürüm oracle'ı, puanlama sertifikalarını ve yöneticiyi kaldırdı.** Artık
> hiçbir servisin sertifika düzenlemesini beklemiyorsunuz ve "yönetici kontratı
> durdurdu" diye bir şey hiç yaşanamaz — o fonksiyon kontratta yok.

---

## Bu kılavuz kimin için

Bu cüzdanı almış, ilk kez açmış ve nereye tıklayacağını bilmeyen biri için.

Kontrat ya da HVM hakkında hiçbir şey bilmediğinizi varsayıyoruz, bilmeniz de
gerekmiyor. Okuduktan sonra hepsini kendiniz yapabilmelisiniz: kurmak, cüzdan
oluşturmak, elmasları hacds'e çevirmek, havuzda takas yapmak, teminatla borç
almak ve başkasına coin göndermek.

Tutarın geçtiği her yerde birim belirtilmiştir. **Hata yapılması en kolay yer burasıdır — lütfen §11'i mutlaka okuyun.**

---

## 1. Hazırlanacak üç şey

**Bir bilgisayar** (Windows 64-bit) **veya bir Android telefon**.

| Platform | Dosya | Not |
|---|---|---|
| PC | `HacdsDeFi-Setup-0.4.4-x64.exe` | Kurulum paketi, çift tıklayıp kurun |
| PC | `HacdsDeFi-0.4.4-x64.exe` | Taşınabilir, çift tıklayıp çalıştırın |
| Android | `HacdsDeFi-0.2.3-arm64.apk` | "Bilinmeyen kaynaklardan kurulum"a izin vermelisiniz |

PC için ikisinden birini seçin. Telefonlar arm64 olmalı (son yılların tüm yaygın
modelleri).

**Sunuculara bağlantı kurabilmek.** Cüzdan zincir verisi saklamaz; iki servise
bağlanır:

| Servis | Adres | Ne yapar |
|---|---|---|
| Düğüm | `node.hacds.com` | Bakiye sorgular, işlem yayınlar, kontrat durumunu okur |
| İndeksleyici | `indexer.hacds.com` | Kredi tasfiyeleri için defter (isteğe bağlı) |

Her iki adres de önceden doldurulmuştur. Ağ çalışıyorsa değiştirilecek bir şey
yok. Değiştirmek isterseniz üstteki alandan düzenleyin.

> **Artık yalnızca iki servis var, oracle yok.** Eski sürümde elmaslar için
> puanlama sertifikası düzenleyen bir servis daha vardı. O tamamen silindi —
> artık kontrat elmas genlerini kendisi okuyup puanlıyor, zincir dışı hiçbir
> adım gerekmiyor.

---

## 2. İlk açılış

PC'de üst satır şöyle görünür:

```
[Düğüm] [İndeksleyici] [Kontrat] [Kaydet] [Test]     [−] 100% [+] [⟲]   [Dil▾]
```

**İlk iş: "Test"e tıklayın.**

Sonra alttaki günlük alanına bakın. `Düğüm OK, yükseklik 79xxxx` görmelisiniz.

Düğüme ulaşılamıyorsa önce ağınızı kontrol edin. **İndeksleyiciye ulaşılamaması kullanımı engellemez** — yalnızca tasfiye sayfası biraz yavaşlar
(blokları yerel olarak taramaya döner).

---

## 3. Cüzdan oluşturma (veya mevcut birini içe aktarma)

### 3.1 Yeni kullanıcılar: cüzdan oluşturma

"Cüzdan oluştur"a tıklayın ve bir parola belirleyin.

**En az 8 karakter; kaybederseniz kurtarılamaz.** Cüzdan dosyası şifrelenip bu
makinede saklanır; "kurtarma" özelliği yok, müşteri hizmetleri yok, arka kapı
yok. Bir kâğıda yazın — yalnızca bilgisayarda tutmayın.

Oluşturma bitince adresinizi (`1` ile başlar, yaklaşık 34 karakter) ve 12
kelimelik anımsatıcıyı gösterir. **Anımsatıcıyı yazıp çevrimdışı saklayın.**
Cüzdanınızı geri yüklemenin tek yolu budur.

### 3.2 Mevcut cüzdanlar: üç içe aktarma yöntemi

| Yöntem | Ne zaman kullanılır |
|---|---|
| Anımsatıcı | Başka bir cüzdandan taşınırken |
| Keystore dosyası | PC ve Android uyumludur; biçim aynıdır (`hacds-keystore v1`) |
| Özel anahtar | Elinizde eski bir özel anahtar varsa |

### 3.3 Birden fazla cüzdan yönetimi

"Cüzdan yönetimi"ne tıklayarak bu makinedeki tüm cüzdanları görürsünüz. Geçiş
yapma, yeniden adlandırma ve silme hep buradadır.

---

## 4. Kilit açıldıktan sonra ne görürsünüz

Üstte **yedi sekme** vardır, web sürümüyle birebir aynı:

```
[Takas] [Likidite] [Kredi] [HACD] [Transfer] [Fon] [Araçlar]
```

Altında üç kalıcı kart:

| Kart | İçerik |
|---|---|
| Varlık özeti | HAC, HACD adedi, hacds bakiyesi, kontrat içi kota |
| Protokol durumu | Havuzun iki tarafındaki rezervler, referans fiyat, kredi kullanım oranı |
| Kredi durumu | Borcunuz, teminatınız, sağlık |

Üçü de sağ üst köşedeki `▾` ile kapatılabilir.

---

## 5. Üç kart nasıl okunur

### 5.1 Varlık özeti

| Öğe | Anlamı |
|---|---|
| HAC | Cüzdanınızda doğrudan harcayabileceğiniz HAC |
| HACD | Elinizde tuttuğunuz elmas adedi |
| hacds (kota) | **Kontrat içindeki** kayıtlarda duran, henüz zincire alınmamış hacds |
| hacds (zincirde) | Kendi adresinizde zaten duran standart varlık |

**Gerçekten sahip olduğunuz her şey, iki hacds rakamının toplamıdır.**

### 5.2 Protokol durumu

| Öğe | Anlamı |
|---|---|
| Havuz HAC / havuz hacds | AMM havuzunun iki tarafındaki rezervler |
| Referans fiyat | Kontratın tasfiye değerlemesinde kullandığı düzleştirilmiş fiyat |
| Kullanım oranı | Verilen borç / verilebilir borç; %50'nin üzerinde yeni borç alınamaz |

### 5.3 Kredi durumu

**En önemli sütun sağlık değeridir:**

| Gösterim | Durum | Ne olur |
|---|---|---|
| > 10000 | Güvenli | Hiçbir şey olmaz |
| = 10000 | Tehlikeli | Tam tasfiye çizgisinde |
| < 10000 | Tasfiye edilebilir | Herkes sizi her an tasfiye edebilir |
| < 10500 | Derin su | Tasfiyeci devralabilir (`DEEP_TRIGGER_BPS = 10500`) |
| < 9000 | Derin tehlike | **Tüm borç** tek seferde kapatılabilir (`DEEP_WATER_BPS = 9000`) |

**Bu iki eşik aynı şey değildir, karıştırmayın:**

- **10500 (%105)** bir "teminat değeri / borç" karşılaştırmasıdır; tetiklendiğinde
  tasfiyeci %3 indirimle devralır
- **9000 (%90)** bir "sağlık" değeridir; altına düşünce tasfiye "borcun yalnızca
  bir kısmı" kısıtına tabi olmaz ve tüm pozisyon tek işlemde kapatılabilir

Kontrattaki sabitler `DEEP_TRIGGER_BPS = 10500` ve `DEEP_WATER_BPS = 9000`'dir;
ikisi de mevcuttur.

**Ödemesiz süre yoktur.** %160 teminat oranının altına düşünce, önceden
bildirim yapılmadan her an tasfiye edilebilirsiniz.

---

## 6. Her işlem aynı adımları izler

Ne yaparsanız yapın akış aynıdır:

```
Parametreleri doldur → "İşlem oluştur"a tıkla → önizlemeye bak → "Yayınla"ya tıkla → zincire girmesini bekle
```

**Önizleme alanı şunları gösterir**: eylem, bayt boyutu, ücret, imza özeti.

**Yayından sonra üç olası sonuç**:

| Sonuç | Anlamı |
|---|---|
| `ret:0` | Bellek havuzuna ulaştı, **henüz zincirde değil** |
| Zincire girdi | Bakiyeler değişir |
| Hata | Günlüğe bakın; sorun sade dille açıklanır |

**Bloklar yaklaşık 300 saniye sürer.** Başarılı yayın anında etki demek değildir;
cüzdan otomatik olarak birkaç kez yeniden yoklar (15/45/90/180/320 saniye).

---

## 7. Yaygın işlemler nasıl yapılır

### 7.1 Elmasları hacds'e çevirme (en sık kullanılan)

1. "HACD" sekmesine tıklayın
2. "Elmaslarımı yükle"ye tıklayın
3. **Yatırmak istediğiniz elmasları işaretleyin** — aynı anda çok sayıda
   işaretleyebilirsiniz, en fazla 200
4. "Toplu yatır ve çevir"e tıklayın

**Tek işlem, tek imza, en fazla 200 elmas.** Bu sürümün en büyük değişikliği:
eski sürüm işlem başına yalnızca 1 tane yatırabiliyordu.

Arayüz basılacak hacds miktarını gösterir: **1 puan = 100 milyon hacds**.

> **Not**: yatırdıktan sonra aldığınız şey **kontrat içinde bir kota (due)**,
> henüz zincir üstü varlık değil. Zincir üstü cüzdanınıza almak için 7.2'ye bakın.

### 7.2 hacds'inizi elinize alma

"Fon" sekmesine tıklayın → "hacds al" → tutarı girin → oluştur → yayınla.

**hacds'i gerçekten adresinize taşıyan adım budur.** Aldıktan sonra standart bir
zincir üstü varlık olur; Hacash varlıklarını destekleyen herhangi bir cüzdana
veya borsaya gönderebilirsiniz.

### 7.3 Kontrata HAC yatırma / çekme

"Fon" sekmesinde:

| İşlem | Ne yapar |
|---|---|
| HAC yatır | Cüzdandaki HAC → kontrat içi HAC kredisi (likidite eklemek, borç ödemek için) |
| HAC çek | Kontrat içi kredi → cüzdan |
| hacds yatır | Zincirdeki hacds → kontrat içi kota (likidite eklemek, teminat için) |
| hacds al | Kontrat içi kota → zincire |

**Ayrımı koruyun**: kontrat içindeki "kredi", zincirdeki "varlık"tır. İkisi aynı
şey değildir. AMM ve kredi işlemlerinin ikisi de **kontrat içindeki** kısım
üzerinde çalışır.

### 7.4 Havuzda takas (AMM)

"Takas" sekmesi, iki yön:

| İşlem | Ne girilir |
|---|---|
| HAC → hacds | Giren HAC (birim: HAC) |
| hacds → HAC | Giren hacds (birim: adet) |

Girdikten sonra alt kısım **ne kadar alacağınızı** ve **güncel havuz fiyatını**
gerçek zamanlı gösterir.

**Kayma koruması**: `min_out` almayı kabul ettiğiniz en az miktardır; `0` =
sınırsız. Piyasa dalgalıyken bir sayı girmeniz, birinin önünüze geçmesini
önlemek için iyi olur.

### 7.5 Likidite ekleyip ücret kazanma

"Likidite" sekmesi.

HAC tarafındaki miktarı girin; **hacds tarafı havuz içi orandan otomatik hesaplanır**. Bu, oranı yanlış kurup paranızı boşa vermenizi önlemek içindir.

| Öğe | Açıklama |
|---|---|
| Ücret paylaşımı | İşlem ücretlerinin **%80'i LP'lere**, %20'si kasaya |
| Geri alma ücreti paylaşımı | Geri alma ücretlerinin **%80'i de LP'lere** |
| Geçici kayıp | Var. Her AMM'in doğasında vardır |
| Kredi riski | Havuzdaki HAC'in %30'u borç olarak verilir; en kötü durumda bu %30'u kaybedersiniz |

**Havuzdan çıkmak iki adımdır**: önce "LP ödüllerini al", sonra "likiditeyi çek".
Cüzdan bunu sizin için iki işleme böler; siz bir kez tıklarsınız.

> Neden bölünüyor? Tek işlem ana ağdaki `resource` kova üst sınırına çarpıyor
> (6.102 > 6.100). Bu, gerçek testte karşılaştığımız bir tuzak; kontrat
> değiştirilemediği için yalnızca cüzdan tarafında bölünebiliyor.

### 7.6 Teminatla borç alma

"Kredi" sekmesi.

1. Önce "Teminat ekle" — teminat olarak verilen şey **kontrat içindeki hacds kotasıdır**
2. Sonra "Borç al", en fazla teminat değerinin yarısı kadar

**Giriş alanlarının altında gerçek zamanlı gösterilir**: mevcut borç üst
limitiniz, bu işlemin gerektirdiği teminat ve güncel teminat değeri. Deneme
yanılma yok.

**Faiz değişkendir**: kullanım %0 → %2, %35 → %6, %50 → %46.

**Ödeyemezseniz tasfiye edilirsiniz.** Ödemesiz süre yok. Öneriler:
- Tamamına kadar borç almayın (%30–%40 borç almak, sınıra dayanmaktan çok daha
  rahattır)
- Sağlık %150 civarına gelince teminat ekleyin
- "Kredi durumu" kartındaki sağlığı izleyin; zincir üstü tasfiyeyle **aynı
  fiyatı** kullanır

### 7.7 Başkasına coin gönderme

"Transfer" sekmesi, dört tür:

| Tür | Açıklama |
|---|---|
| HAC gönder | Zincirdeki HAC |
| hacds gönder | Zincirdeki hacds varlığı |
| HACD gönder | Elmaslar, aynı anda birden fazla olabilir |
| Diğer varlık | serial + miktar girin |

> hacds'in serial'ı **4000**, payın (HACDS-SHARE) serial'ı **4001**'dir.
> Eski sürümdeki 2000 / 3000'i yazmayın — o iki varlık seti geçersizdir; karşı
> taraf bunlarda bir değer tanımaz, yani göndermek boşa gider.

### 7.8 HACD sekmesi: elmasları görme, toplu işlemler

"HACD" sekmesinin üst ve alt olmak üzere iki bölümü vardır:

**Üst yarı: yatırma**
- Elmaslarımı yükle → işaretle → toplu yatır
- İşlem başına en fazla 200

**Alt yarı: geri alma**
- Havuz elmaslarını yükle → birini seç → geri al
- **Geri alma seferde yalnızca bir elmas**

> Neden geri alma toplu yapılamıyor? Geri alma, her elmas için "seçme primi"ni
> ayrı ayrı hesaplamak zorundadır (yüksek puanlı elmaslar daha pahalıdır) ve
> toplu işlem yarıda başarısız olursa geri alma mantığı yükseltilemeyen bir
> kontratta fazla risklidir. Cüzdan seçiminizi sizin için birkaç işleme böler;
> siz bir kez tıklarsınız.

---

## 8. Gelişmiş özellikler (kullanmasanız da olur)

### 8.1 Salt okunur sorgu

"Araçlar" sekmesi → "Salt okunur sorgu". Kontratın herhangi bir salt okunur
fonksiyonunu doğrudan çağırıp dönüş değerine bakabilirsiniz. Sorun giderirken
çok işe yarar.

### 8.2 Atomik işlemler

Birden fazla eylem tek işlemde birleştirilir: ya hepsi başarılı olur ya da hepsi
başarısız. Protokol üst sınırı 200 eylemdir.

### 8.3 Çevrimdışı imzalama (soğuk/sıcak ayrımı)

"Araçlar" sekmesi → "Çevrimdışı imzalama":

1. Soğuk taraf (ağa bağlanmayan makine): parametreleri girin, oluşturun, imzalayın
2. QR kod veya dosya olarak çıkarın
3. Sıcak taraf (ağa bağlı makine): kodu okutun veya dosyayı yükleyin, yayınlayın

**Özel anahtar hiçbir aşamada ağa dokunmaz.** Hacash işlemlerinde nonce yoktur ve
zaman damgası süresi yoktur; çevrimdışı imzalanmış bir işlem ne kadar beklerse
beklesin yayınlandığında geçerli kalır.

### 8.4 Tasfiye / kapatma

"Araçlar" sekmesi → "Tasfiye". Tasfiye edilebilir tüm adresleri ve sağlıklarını
listeler.

Tasfiyede para var: başkasının borcunu ödersiniz ve "ödenen tutar + %5" değerinde
teminat alırsınız. Normal tasfiye tek seferde karşı tarafın borcunun en fazla
yarısını işler.

### 8.5 Depolama anahtarlarını yenileme (operasyon)

"Araçlar" sekmesi → "Yenile".

Hacash kontrat durumu kira ödemek zorundadır ve anahtarların süresi dolar.
**Herkes anahtar yenileyebilir ve ödül alabilir (anahtar başına 0,07 HAC)**.
Keeper tam olarak böyle çalışır.

Sıradan kullanıcılar bunu dert etmeyebilir — projenin keeper'ı otomatik yeniler.

---

## 9. Kasa temettüleri (pay sahiplerinin mutlaka okuması gereken bölüm)

**serial 4001 (HACDS-SHARE)** tutuyorsanız, cüzdan otomatik olarak altın renkle
vurgulanmış bir **"Kasa temettüleri"** sekmesi ekler.

### 9.1 En önemli şey: tutmak ≠ temettü almak

**4001'i cüzdanınızda taşımak size otomatik temettü kazandırmaz. Faiz işlemeye başlaması için onu mutlaka kontrat B'ye yatırmanız gerekir.**

Neden böyle tasarlandı? Kullanıcı A, 4001'i kullanıcı B'ye devrettiğinde bu işlem
zincirde kontratın hiç yanından geçmez — kontrat bunu göremez. "Satışın olduğu
anda" hesaplama yapamaz; bu yüzden tek yol sizden **aktif olarak yatırma
yapmanızı** istemektir. Böylece paylar kontrat defterine (`sh:<adresiniz>`) girer
ve ancak o zaman kontrat sizi tanır.

Sekme bunu net biçimde ayırır:

| Alan | Anlamı |
|---|---|
| Cüzdanda tutulan | Cüzdanınızda hâlâ kaç pay var |
| Yatırılmış (faiz işliyor) | Temettüye gerçekten katılan pay adedi |
| Yatırılmamış (faiz işlemiyor) | Hâlâ cüzdanınızda duran, **temettü almayan** paylar |

**"Yatırılmamış > 0" olduğu sürece** sekmenin altında, bu kısmın temettüye
katılmadığını söyleyen belirgin bir uyarı ve bir "Hemen yatır" düğmesi çıkar.

### 9.2 Üç adımlı işlem

**① Yatırma**

"Hemen yatır"a tıklayın → pay adedini girin → onaylayın.

⚠ Onay penceresi size açıkça şunu söyler: **bu işlem N payı kasa kontratına
aktaracak; aktarıldıktan sonra cüzdan bakiyenizde görünmeyecek, ama yine de
size ait olacak ve dilediğiniz zaman geri alınabilecek.**

Bu bir transferdir, "mevduat" değildir. Paylar cüzdan bakiyenizden çıkıp kontrat
defterine girer. Sahiplik değişmez.

**② Temettünün birikmesini bekleyin**

Protokol geliri (AMM ücret payı, kredi faizi payı vb.) kasa kontratı B'de
(`duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` — bakiyesini ve dağıtım geçmişini
herhangi bir Hacash tarayıcısında görebilirsiniz)
toplanır:

```
100 HAC geldi
  ├─ 20 HAC → kira rezervi (yalnızca keeper'ın depolama kirasını ödemek için)
  └─ 80 HAC → tüm yatırımcılara pay oranında dağıtılır
```

Temettü, payınızın "toplam yatırılmış" içindeki oranına göre hesaplanır. Ne kadar
çok yatırırsanız ve ne kadar erken yatırırsanız, o kadar çok alırsınız.

**③ Al ve çek**

"Al ve çek"e tıklayın, tek adımda biter:

```
claim()                  → artışı due defterinize işler (para hâlâ kontratta)
TransferHacFromTo(B→siz) → para gerçekten cüzdanınıza gelir
```

İki adımın da yapılması gerekir. **Yalnızca claim'e tıklarsanız para kontratta
kalır ve cüzdan bakiyeniz değişmez.**

⚠ **Sekmedeki "toplam çekilebilir" değeri claim'den sonra değişmez** — çünkü
artış "hesaplanmamış"tan "hesaplanmış, çekilmeye hazır"a geçer; toplam aynı
kalır. Bu bir hata değildir.

### 9.3 Yatırımı geri alma

Paylarınızı geri almak istiyorsanız "Yatırımı geri al"a tıklayın. Kontrat şunu
yapar:

1. Önce o ana kadarki temettünüzü hesaplar
2. Sonra payları defterden düşer
3. 4001 cüzdan bakiyenize döner

Sıra tersine çevrilemez — önce hesapla, sonra payı düş; böylece çıkmadan önceki
temettünüzden tek kuruş eksilmez.

### 9.4 Yaygın yanlış anlamalar

| Belki şöyle sanıyorsunuz | Gerçek |
|---|---|
| 4001 tutmak temettü getirir | ❌ Yatırmanız gerekir |
| Yatırınca paylar elden gider | ❌ Yalnızca kontrat defterine taşınır, dilediğiniz an geri alabilirsiniz |
| claim'e tıklayınca para hesaba geçer | ❌ Çekme adımı da gerekir |
| claim'den sonra sayının değişmemesi hatadır | ❌ "Hesaplanmamış" "çekilmeye hazır"a dönmüştür |
| Almazsam süresi dolar | ❌ Temettü kontratta kayıtlı kalır, geri alınmaz |

### 9.5 Almaya gelmeyi unutursam kaybolur mu?

Hayır. Temettü `due:` defterinizde kayıtlı kalır.

Ama bir koşul var: **defter anahtarını birinin yenilemesi gerekir.** Kontratın
depolama anahtarları kiralıktır ve süresi dolunca silinir. Projenin keeper'ı
sizin için otomatik yeniler (347 günde bir), yani normal koşullarda bunu
dert etmenize gerek yok.

Daha güvende olmak isterseniz, **arada bir gelip "Al ve çek"e tıklayın** — bu
işlem aynı zamanda anahtarınızı da yeniler.

---

## 10. Pay devri (OTC atomik işlem)

4001'i başkasına satmak istiyorsanız, "Kasa temettüleri" sekmesinin en altındaki
**"Pay devri"** alanını kullanın.

### 10.1 Neden iki kişinin imzası gerekiyor

Tek bir işlem hem "sizin pay vermenizi" hem "onun para vermesini" içerir; iki
tarafın da kabul etmesi gerekir. Hacash'in kuralı **imza sayısının imzalayan
sayısına eşit olması**dır, dolayısıyla:

```
Siz (satıcı) işlemi oluşturur + imzalarsınız
        ↓
    İşlem gövdesini ona gönderirsiniz (WeChat / e-posta / QR kod hepsi olur)
        ↓
O, kendi cüzdanıyla bu işlemi "tercüme eder" ve içeriğini görür
        ↓
    Doğru olduğunu onaylar + kendi imzasını ekler
        ↓
      Yayınlanır; iki tarafın varlıkları aynı anda değişir
```

**İşlem ya tamamen gerçekleşir ya da tamamen geri alınır.** "Payı verdim ama
parayı almadım" durumu olamaz.

### 10.2 Satıcı ne yapar

1. "Pay devri" alanında "Pay satıyorum"u seçin
2. Pay adedini ve karşı tarafın adresini girin
3. Karşılığını seçin (en fazla 3 tür: HAC / zincirdeki varlık / HACD elması)
4. "İmza bekleyen işlem oluştur"a tıklayın
5. "Özel anahtarımla imzala"ya tıklayın → "imzalar tamamlanmadı" uyarısı gelir;
   işlem gövdesini kopyalayıp ona gönderin

### 10.3 Alıcı ne yapar (önemli)

**Önce iyice bakın, sonra imzalayın.** Bu bölüm, tüm özelliğin en kritik
kısmıdır.

1. "Pay devri" alanındaki "Başkasının işlem gövdesini doğrula"yı açın
2. Karşı tarafın gönderdiği işlem gövdesini yapıştırın
3. "Bu işlemi tercüme et"e tıklayın
4. **Her satırı kontrol edin**:
   - "Ödeyeceğiniz" tutar doğru mu
   - "Alacağınız" pay adedi doğru mu
   - **Alıcı adresi siz misiniz** (bu satır vurgulanır; siz değilseniz kırmızı
     uyarı çıkar)
5. Doğruladıktan sonra "Karşı tarafın işlem gövdesine imzamı ekle"ye tıklayın
6. İmzalar tamamlanınca otomatik olarak yayınlanır

⚠ **Tercüme etmeden imzalamanıza izin verilmez** — bu, kör imzalamayı önlemek
için konulmuş katı bir sınırdır.

### 10.4 ⚠ İşlem gövdesinin geçerlilik süresi yoktur

En çok dikkat edilmesi gereken nokta bu:

**İmzalayıp işlem gövdesini karşı tarafa verdikten sonra bu işlem her an
yayınlanabilir ve geri alınamaz.**

Zincirde "son kullanma zamanı" diye bir alan yoktur. Bu yüzden:

- Yalnızca tamamen güvendiğiniz kişilerle OTC yapın
- Görüşmeler bozulursa karşı tarafa işlem gövdesini hemen yok ettirin
- "Bir bakayım" diye imzalamayın

---

## 11. ⚠ Sayılar nasıl okunur (hata yapılması en kolay bölüm)

### 11.1 hacds yalnızca bir adettir

**Bu sürümde hacds ondalık 0'dır — 1 bir tane demektir, kesir yoktur.**

Bakiyeler, havuz, teminat ve giriş alanları hep aynı sayıyı gösterir.

```
70 hacds göndermek istiyorsanız → giriş alanına 70 yazın
```

> **Eski sürümden farklı!** Eski sürüm (#2000) ondalık 8'di; giriş alanına atom
> yazılıyordu ve 70 için `7000000000` girmek gerekiyordu. **Bu sürümde 1e8 ile
> çarpmayın.**

### 11.2 HAC de bir adettir

Etikette "(HAC)" yazan her yerde, 10 HAC yatırmak için `10` girin.

**İstisna**: zincir üstü transfer sayfasında HAC tutarları `1:248` biçiminde
yazılır (`1:248` = 1 HAC). Bu Hacash'in tutar yazım biçimidir; giriş alanındaki
varsayılan değerin biçimine uyup değiştirmeniz yeterli.

> `a:b` = a × 10^(b−248). Yani `5:249` = 50 HAC, 5,0038 değil.

### 11.3 Karşılaştırma tablosu

| Yaptığınız işlem | Girilecek birim | Örnek |
|---|---|---|
| Likidite ekleme — HAC tarafı | HAC | `1` |
| Likidite ekleme — hacds tarafı | adet | havuz içi orandan **otomatik hesaplanır** (sabit değer değil) |
| Takas — giren HAC | HAC | `1` |
| Takas — giren hacds | adet | `100000000` |
| Teminat ekleme | adet | `100000000` |
| Borç alma / ödeme | HAC | `0.5` |
| hacds gönderme | adet | `100000000` |
| HAC gönderme (zincirde) | `değer:mantis` | `1:248` |

**Bir cümle unutmayın**: hacds adet alır, HAC HAC adedi alır (zincir üstü
transferler hariç).

### 11.4 Neden karıştırmak kolay

HAC ile hacds'in ölçekleri farklıdır:

- **HAC** zincirde zhu'dur, 1 HAC = 1e8 zhu; arayüzde HAC kullanılır
- **hacds** zincirde doğrudan adettir, 1 = 1 tane

Yani `add_liquidity(hac_amt, ds_amt)` fonksiyonunun iki parametresi farklı
birimlerdedir: biri zhu, diğeri hacds adedi. 1e8 katı hata yapmanın en kolay
olduğu yer burasıdır — ilk yatırımda biz de bir kez yaptık.

---

## 12. Bir sorun çıkarsa ne yapmalı

### 12.1 Önce günlük alanına bakın

Tüm işlemlerin sonucu ve başarısızlık nedeni alttaki günlük alanına yazılır.
**Hatalar sade dille yazılır**: önce sorunun ne olduğu, sonra öneri gelir.

### 12.2 Yaygın hatalar

| Gördüğünüz | Ne anlama gelir | Ne yapmalı |
|---|---|---|
| Yetersiz bakiye | Kontrat içi kredi yetersiz | Önce "Fon" sekmesinden yükleme yapın |
| `resource gas limit exceeded` | Tek kovanın gas sınırı aşıldı | Birkaç işleme bölün; **gas_max'ı artırmak işe yaramaz** |
| `compute gas limit exceeded` | Aynı şey | Birkaç işleme bölün |
| `CallNotExist(51)` | Kontratta bu fonksiyon yok | Yönetici fonksiyonlarının tamamı silindi, tıklamayı bırakın |
| `NotFindContract` | O adreste kontrat yok | Adres yanlış yazılmış (bu turun kontratı `bw2sRC…`) |
| `StorageNotActive` | Depolama anahtarının süresi dolmuş | "Araçlar" sekmesinden yenileyin |
| `state changed` | Bu sırada zincirdeki durum değişti | Yeniden deneyin |
| `sandbox_per_ip_concurrency_exceeded` | Eşzamanlılık sınırı aşıldı | Birkaç saniye bekleyip yeniden deneyin (düğüm IP başına 2 eşzamanlıya izin verir) |
| Ağ hatası | Servise ulaşılamıyor | Düğüm adresini ve ağınızı kontrol edin |

### 12.3 Yayın başarılı ama bakiye değişmedi

Bu normaldir. Bloklar yaklaşık 300 saniye sürer. Biraz bekleyip "Varlıkları
yenile"ye tıklayın.

### 12.4 Arayüz yazısı çok küçük / çok büyük

Üstteki `−` / `+` ile ayarlayın; `⟲` sıfırlar.

### 12.5 Üç kart kapatılabilir

Kartların sağ üst köşesindeki `▾` ile.

---

## 13. Güvenlik notları

1. **Anımsatıcıyı ve parolayı çevrimdışı saklayın.** Kurtarma özelliği yok,
   müşteri hizmetleri yok.
2. **Tüm birikiminizi içine koymayın.** Kontrat yükseltilemez; bir hata
   bulunursa düzeltilemez.
3. **Tek nokta, payların kimde olduğudur.** Kontratta çekim fonksiyonu yok,
   dolayısıyla kimse varlıklarınızı alamaz; kasa geliri yatırılmış paylara göre
   otomatik dağıtılır (§9'a bakın) ve dağıtım kod tarafından garanti edilir,
   kimse müdahale edemez. Ancak **10.000 adet 4001'in tamamı şu anda projenin
   elinde, onlar tarafından dağıtılıyor** — onlara güvenmeniz gereken tek yer
   burasıdır: ne kadar pay tutuyorlarsa, o kadar temettü hakkına sahipler.
4. **Yönetici yok.** Hiç kimse kontratı durduramaz, parametreleri değiştiremez
   veya hesabınızı donduramaz. Bu, fonksiyon listesinden doğrudan
   doğrulanabilir.
5. **Resmi ekip size asla önce yazmaz.** Sizden "cüzdanınızı doğrulamanızı" veya
   "anımsatıcınızı göndermenizi" isteyen herkes dolandırıcıdır.
6. **Çevrimdışı imzalamada özel anahtar hiçbir aşamada ağa dokunmaz.** Soğuk
   makinenin kalıcı olarak bağlantısız tutulması en iyisidir.

---

## 14. Bazı terimlerin sade açıklaması

| Terim | Sade anlatım |
|---|---|
| **hacds** | Elmasları kontrata yatırdıktan sonra aldığınız token; 1 puan elmas = 100 milyon |
| **HAC** | Hacash ana parası, yani harcanabilen para |
| **HACD** | Elmaslar; kontrata yatırınca hacds alırsınız |
| **due / kota** | Kontrat kayıtlarında sizin adınıza yazılı hacds, henüz zincire alınmamış |
| **AMM** | Otomatik piyasa yapıcılığı: tek havuz, herkes gelip takas yapar, fiyat kendi kendine ayarlanır |
| **LP** | Likidite sağlayıcı — havuza para koyup ücret kazanan kişi |
| **Kayma** | İşleminizin fiyatı ne kadar ittiği; büyük işlemlerde kayma daha büyük |
| **Teminat oranı** | Teminat değeri ÷ borç; %200 borç çizgisi, %160 tasfiye çizgisi |
| **Sağlık** | Teminat oranının başka bir yazımı; 10000 = tam tasfiye çizgisinde |
| **Tasfiye** | Borcunuzu ödeyemiyorsunuz, başkası sizin yerinize öder ve teminatınızın bir kısmını alır |
| **Derin su** | Teminat değeri borcun %105'inin altına düşmüş (`DEEP_TRIGGER_BPS`); tasfiyeci devralabilir |
| **Derin tehlike** | Sağlık 9000'in altına düşmüş; borç tek seferde kapatılabilir (`DEEP_WATER_BPS`) |
| **hcut** | Aşırı batık borç durumunda küresel küçülme katsayısı; yalnızca düşer, yükselmez |
| **keeper** | Kontratın kirasını otomatik yenileyen ve ödül alan kişi; herkes çalıştırabilir |
| **Referans fiyat** | Kontratın değerlemede kullandığı düzleştirilmiş fiyat; spot fiyattan farklıdır, manipülasyona dayanıklıdır |
| **Atomik işlem** | Birden fazla işlemin tek işlemde paketlenmesi; ya hepsi olur ya hiçbiri |

---

## 15. Bir dakikalık hızlı başvuru (yanınızda bulundurun)

```
Elmas yatırma:  HACD sekmesi → elmaslarımı yükle → işaretle (en fazla 200) → toplu yatır
hacds alma:     Fon sekmesi → hacds al → miktar gir → yayınla
Takas:          Takas sekmesi → yön seç → miktar gir → oluştur → yayınla
Likidite ekle:  Likidite sekmesi → HAC tarafını gir → hacds otomatik dengelenir → oluştur → yayınla
Borç alma:      Kredi sekmesi → teminat ekle → borç al → oluştur → yayınla
Transfer:       Transfer sekmesi → tür seç → adres ve miktar gir → oluştur → yayınla

Birimler:  hacds adet alır (1 = 1 tane)
           HAC HAC adedi alır (zincir üstü transferlerde 1:248)
           1e8 ile çarpmayın!

Tasfiye çizgisi: %160 teminat oranı, ödemesiz süre yok
Sağlık:          10000 = tehlikeli, > 10000 güvenli
Bloklar:         yaklaşık 300 saniye
```

---

*Bu belge, `HacdsDeFi3000.fitsh` kontratının kesinleşmiş sürümüne, ana ağın ikinci dağıtımına (2026-11-18) karşılık gelir.*
