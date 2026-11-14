# HacdsDeFi Kullanım Kılavuzu

2026-11-11　PC cüzdanı 0.4.0 / Android 0.2.0 için

> Bu belge #3000 kontratına karşılık gelir (adres
> `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`, varlık serial 3000).
>
> **Bu sürüm oracle'ı, puanlama sertifikalarını ve yöneticiyi kaldırdı.** Artık
> hiçbir servisin sertifika düzenlemesini beklemiyorsunuz ve "yönetici kontratı
> durdurdu" hiç yaşanamaz — o fonksiyon yok.

---

## Bu kılavuz kimin için

Bu cüzdanı almış, ilk kez açmış ve nereye tıklayacağını bilmeyen biri için.

Kontrat ya da HVM hakkında hiçbir şey bilmediğinizi varsayıyoruz, bilmeniz de
gerekmiyor. Okuduktan sonra hepsini kendiniz yapabilmelisiniz: kurmak, cüzdan
oluşturmak, elmasları hacds'e çevirmek, havuzda takas yapmak, teminatla borç
almak ve başkasına coin göndermek.

Tutarın geçtiği her yerde birim belirtilmiştir. **Hata yapılması en kolay yer burasıdır — lütfen §9'u okuyun.**

---

## 1. Hazırlanacak üç şey

**Bir bilgisayar** (Windows 64-bit) **veya bir Android telefon**.

| Platform | Dosya | Not |
|---|---|---|
| PC | `HacdsDeFi-Setup-0.4.0-x64.exe` | Kurulum paketi, çift tıklayıp kurun |
| PC | `HacdsDeFi-0.4.0-x64.exe` | Taşınabilir, çift tıklayıp çalıştırın |
| Android | `HacdsDeFi-0.2.0-arm64.apk` | "Bilinmeyen kaynaklardan kurulum"a izin vermelisiniz |

PC için ikisinden birini seçin. Telefonlar arm64 olmalı (son yılların tüm yaygın
modelleri).

**Sunuculara ağ erişimi.** Cüzdan zincir verisi saklamaz; iki servise bağlanır:

| Servis | Adres | Amaç |
|---|---|---|
| Düğüm | `node.hacds.com` | Bakiye, yayın, kontrat durumunu okuma |
| İndeksleyici | `indexer.hacds.com` | Tasfiye defteri (isteğe bağlı) |

İkisi de önceden doldurulmuştur. Ağ çalışıyorsa hiçbir şeyi değiştirmeniz
gerekmez. Değiştirmek için üstteki alanları düzenleyin.

> **Artık yalnızca iki servis var — oracle yok.** Eski sürümde elmaslar için
> puanlama sertifikası düzenleyen üçüncü bir servis vardı. Tamamen kaldırıldı:
> kontrat artık elmas genini okuyup kendisi puanlıyor, zincir dışı hiçbir adım yok.

---

## 2. İlk açılış

PC'de üst satır şöyle görünür:

```
[Düğüm] [Dizinleyici] [Kontrat] [Kaydet] [Test]     [−] 100% [+] [⟲]   [Dil▾]
```

**İlk iş: "Test" düğmesine tıklayın.**

Sonra alttaki günlük alanına bakın. `Düğüm OK, yükseklik 79xxxx` görmelisiniz.

Düğüme ulaşılamıyorsa önce ağınızı kontrol edin. **İndeksleyicinin kapalı olması sizi engellemez** — yalnızca tasfiye sayfası yavaşlar (blokları yerel taramaya
döner).

---

## 3. Cüzdan oluşturun (ya da içe aktarın)

### 3.1 Yeni kullanıcılar: cüzdan oluşturma

"Cüzdan oluştur"a tıklayın ve bir parola belirleyin.

**En az 8 karakter ve kaybolursa kurtarılamaz.** Cüzdan dosyası şifrelenip bu
makinede saklanır; kurtarma yok, destek yok, arka kapı yok. Kağıda yazın —
yalnızca bilgisayarda tutmayın.

Tamamlandığında adresiniz (`1` ile başlar, yaklaşık 34 karakter) ve 12 kelimelik
anımsatıcı gösterilir. **Anımsatıcıyı yazıp çevrimdışı saklayın.** Cüzdanınızı geri
yüklemenin tek yolu odur.

### 3.2 Mevcut cüzdanlar: üç içe aktarma yöntemi

| Yöntem | Ne zaman |
|---|---|
| Anımsatıcı | Başka bir cüzdandan taşınırken |
| Keystore dosyası | PC ve Android birbiriyle uyumludur; aynı biçim (`hacds-keystore v1`) |
| Özel anahtar | Eski anahtarlar için |

### 3.3 Birden fazla cüzdan yönetimi

"Cüzdan yöneticisi"ne tıklayarak bu makinedeki tüm cüzdanları görür, geçiş yapar,
yeniden adlandırır veya silersiniz.

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
| Protokol durumu | Havuzun iki tarafı, referans fiyat, kullanım oranı |
| Kredi durumu | Borcunuz, teminatınız, sağlık |

Üçü de sağ üst köşedeki `▾` ile kapatılabilir.

---

## 5. Üç kart nasıl okunur

### 5.1 Varlık özeti

| Öğe | Anlamı |
|---|---|
| HAC | Cüzdanınızdaki doğrudan harcanabilir HAC |
| HACD | Elindeki elmas adedi |
| hacds (kota) | **Kontrat içindeki** hacds, henüz zincire alınmamış |
| hacds (zincirde) | Kendi adresinizde zaten duran standart varlık |

**Gerçekten sahip olduğunuz miktar iki hacds rakamının toplamıdır.**

### 5.2 Protokol durumu

| Öğe | Anlamı |
|---|---|
| Havuz HAC / havuz hacds | AMM havuzunun iki tarafındaki rezervler |
| Referans fiyat | Kontratın tasfiye değerlemesinde kullandığı düzleştirilmiş fiyat |
| Kullanım | Borç verilen / verilebilir; %50 üzerinde yeni borç yok |

### 5.3 Kredi durumu

**En önemli alan sağlık değeridir**:

| Gösterim | Durum | Ne olur |
|---|---|---|
| > 10000 | Güvenli | Hiçbir şey |
| = 10000 | Tehlikeli | Tam tasfiye çizgisinde |
| < 10000 | Tasfiye edilebilir | Herkes her an sizi tasfiye edebilir |
| < 9000 | Derin su | Tüm borç tek seferde kapatılabilir |

**Ödemesiz süre yoktur.** %160 teminat oranının altında, önceden bildirim
yapılmadan her an tasfiye edilebilirsiniz.

---

## 6. Her işlem aynı adımları izler

Ne yaparsanız yapın akış aynıdır:

```
Parametreleri doldur → "İşlem oluştur" → gözden geçir → "Yayınla" → onay bekle
```

**Önizleme gösterir**: eylem, bayt boyutu, ücret, imza özeti.

**Yayından sonra üç olası sonuç**:

| Sonuç | Anlamı |
|---|---|
| `ret:0` | Belleğe ulaştı, **henüz zincirde değil** |
| Onaylandı | Bakiyeler değişir |
| Hata | Günlüğe bakın; sade dille açıklanır |

**Bloklar yaklaşık 300 saniye sürer.** Başarılı yayın anında etki demek değildir;
cüzdan otomatik olarak yeniden yoklar (15/45/90/180/320 saniye).

---

## 7. Yaygın işlemler

### 7.1 Elmasları hacds'e çevirme (en sık kullanılan)

1. "HACD" sekmesini açın
2. "Elmaslarımı yükle"ye tıklayın
3. **Yatırmak istediğiniz elmasları seçin** — çok sayıda birden, en fazla 200
4. "Toplu yatır"a tıklayın

**Tek işlem, tek imza, en fazla 200 elmas.** Bu sürümün en büyük değişikliği: eski
sürüm işlem başına yalnızca bir taneye izin veriyordu.

Arayüz beklenen hacds'i gösterir: **1 puan = 100 milyon hacds**.

> **Not**: aldığınız şey **kontrat içinde bir kota (due)**, henüz zincir üstü
> varlık değil. Cüzdanınıza almak için 7.2'ye bakın.

### 7.2 hacds'inizi alın

"Fon" sekmesi → "hacds al" → tutarı girin → oluştur → yayınla.

**Bu adım hacds'i gerçekten adresinize taşır.** Sonrasında herhangi bir Hacash
varlık cüzdanına veya borsaya gönderilebilen standart bir zincir üstü varlıktır.

### 7.3 Kontrata HAC yatırma / çekme

"Fon" sekmesinde:

| İşlem | Ne yapar |
|---|---|
| HAC yatır | Cüzdan HAC → kontrat içi HAC kredisi (likidite, geri ödeme) |
| HAC çek | Kontrat kredisi → cüzdan |
| hacds yatır | Zincirdeki hacds → kontrat içi kota (likidite, teminat) |
| hacds al | Kontrat kotası → zincire |

**Ayrımı koruyun**: kontrat içindeki "kredi", zincirdeki "varlık"tır. Aynı şey
değiller. AMM ve kredi **kontrat içi** kısım üzerinde çalışır.

### 7.4 Havuzda takas (AMM)

"Takas" sekmesi, iki yön:

| İşlem | Ne girilir |
|---|---|
| HAC → hacds | Giren HAC (birim: HAC) |
| hacds → HAC | Giren hacds (birim: adet) |

Girdikten sonra arayüz **ne kadar alacağınızı** ve **güncel havuz fiyatını**
gerçek zamanlı gösterir.

**Kayma koruması**: `min_out` kabul edeceğiniz en az miktardır; `0` = sınırsız.
Piyasa oynakken önden koşmayı önlemek için bir sayı girin.

### 7.5 Likidite ekleyip ücret kazanma

"Likidite" sekmesi.

HAC tarafını girin; **hacds tarafı havuz oranından otomatik hesaplanır.** Bu, oranı
kaçırıp para kaybetmenizi önler.

| Öğe | Not |
|---|---|
| Ücret payı | İşlem ücretlerinin **%80'i LP'lere**, %20'si hazineye |
| Geri alma ücreti payı | Geri alma ücretlerinin **%80'i de LP'lere** |
| Geçici kayıp | Var. Her AMM'in doğasında |
| Kredi riski | Havuz HAC'inin %30'u borç verilir; en kötü durumda o %30'u kaybedersiniz |

**Likidite çekmek iki adımdır**: önce "LP ödüllerini al", sonra "likiditeyi çek".
Cüzdan bunu sizin için iki işleme böler; siz bir kez tıklarsınız.

> Neden bölünüyor? Tek işlem ana ağdaki `resource` kova sınırına çarpıyor
> (6.102 > 6.100). Bu gerçek testte bulundu; kontrat değiştirilemez, bu yüzden
> cüzdan bölüyor.

### 7.6 Teminatla borç alma

"Kredi" sekmesi.

1. Önce "Teminat ekle" — teminat **kontrat içindeki hacds kotasıdır**
2. Sonra "Borç al", en fazla teminat değerinin yarısı kadar

**Girişin altında gerçek zamanlı ipuçları görünür**: mevcut borç limitiniz, bu
işlemin gerektirdiği teminat ve güncel teminat değeri. Tahmin yok.

**Faiz dalgalıdır**: kullanım %0 → %2, %35 → %6, %50 → %46.

**Geri ödeyememek tasfiye demektir.** Ödemesiz süre yok. Öneriler:
- Maksimuma kadar borç almayın (%30–%40 çok daha rahat)
- Sağlık %150'ye yaklaşınca teminat ekleyin
- "Kredi durumu" kartındaki sağlığı izleyin; zincir üstü tasfiye ile **aynı fiyatı** kullanır

### 7.7 Başkasına coin gönderme

"Transfer" sekmesi, dört tür:

| Tür | Not |
|---|---|
| HAC gönder | Zincirdeki HAC |
| hacds gönder | Zincirdeki hacds varlığı |
| HACD gönder | Elmaslar, birden fazla |
| Diğer varlık | Serial + tutar girin |

### 7.8 HACD sekmesi: elmasları görme, toplu işlemler

"HACD" sekmesinin iki yarısı vardır:

**Üst: yatırma**
- Elmaslarımı yükle → seç → toplu yatır
- İşlem başına en fazla 200

**Alt: geri alma**
- Havuz elmaslarını yükle → birini seç → geri al
- **Geri alma seferde bir elmas**

> Neden toplu geri alma yok? Her elmas kendi "kiraz toplama primi"ni gerektirir
> (yüksek puanlı elmaslar daha pahalı) ve toplu işlem yarıda başarısız olursa geri
> alma mantığı yükseltilemeyen bir kontratta çok risklidir. Cüzdan seçiminizi
> birden fazla işleme böler; siz bir kez tıklarsınız.

---

## 8. Gelişmiş özellikler (isteğe bağlı)

### 8.1 Salt okunur sorgu

"Araçlar" sekmesi → "Salt okunur sorgu". Herhangi bir salt okunur kontrat
fonksiyonunu doğrudan çağırıp dönüş değerini inceleyin. Sorun gidermede çok
faydalıdır.

### 8.2 Atomik işlemler

Tek işlemde birden fazla eylem, ya hep ya hiç. Protokol sınırı 200 eylem.

### 8.3 Çevrimdışı imzalama (soğuk/sıcak ayrımı)

"Araçlar" sekmesi → "Çevrimdışı imzalama":

1. Soğuk makine (asla çevrimiçi olmayan): parametreleri gir, oluştur, imzala
2. QR kod veya dosya çıkar
3. Sıcak makine (çevrimiçi): tara veya dosyayı yükle, yayınla

**Özel anahtar ağa hiç dokunmaz.** Hacash işlemlerinde nonce ve zaman damgası
süresi yoktur, bu yüzden çevrimdışı imzalanmış bir işlem ne kadar beklerse
beklesin geçerlidir.

### 8.4 Tasfiye / kapatma

"Araçlar" sekmesi → "Tasfiye". Tasfiye edilebilir tüm adresleri ve sağlıklarını
listeler.

Tasfiye kârlıdır: birinin borcunu ödersiniz ve "geri ödeme + %5" değerinde teminat
alırsınız. Normal tasfiye seferde en fazla borcun yarısını işler.

### 8.5 Depolama anahtarı yenileme (operasyon)

"Araçlar" sekmesi → "Yenile".

Hacash kontrat durumu kira öder ve anahtarların süresi dolar. **Herkes yenileyebilir ve ödül kazanabilir (anahtar başına 0,07 HAC)**. Keeper böyle çalışır.

Sıradan kullanıcılar bunu yok sayabilir — projenin keeper'ı otomatik yeniler.

---

## 9. ⚠ Sayılar nasıl okunur (hata yapılması en kolay yer)

### 9.1 hacds yalnızca bir adettir

**Bu sürümde hacds ondalık 0'dır — 1 bir demektir, kesir yok.**

Bakiyeler, havuzlar, teminat, giriş alanları aynı sayıyı gösterir.

```
70 hacds göndermek için → 70 girin
```

> **Eski sürümden farklı!** Eski sürüm (#2000) ondalık 8'di; atom giriyordunuz ve
> 70 için `7000000000` gerekiyordu. **Burada 1e8 ile çarpmayın.**

### 9.2 HAC de bir adettir

Etiket "(HAC)" diyorsa, 10 HAC yatırmak için `10` girin.

**İstisna**: zincir üstü transfer sayfasında HAC tutarları `1:248` biçimindedir
(`1:248` = 1 HAC). Bu Hacash'in tutar gösterimidir; alandaki varsayılan değerin
biçimini izleyin.

> `a:b` = a × 10^(b−248). Yani `5:249` = 50 HAC, 5,0038 değil.

### 9.3 Hızlı tablo

| Yaptığınız işlem | Girilecek birim | Örnek |
|---|---|---|
| Likidite ekle — HAC tarafı | HAC | `1` |
| Likidite ekle — hacds tarafı | adet | `33183372` |
| Takas — giren HAC | HAC | `1` |
| Takas — giren hacds | adet | `100000000` |
| Teminat ekle | adet | `100000000` |
| Borç al / geri öde | HAC | `0.5` |
| hacds gönder | adet | `100000000` |
| HAC gönder (zincirde) | `değer:mantis` | `1:248` |

**Tek cümle**: hacds adet alır, HAC HAC adedi alır (zincir üstü transferler
hariç).

### 9.4 Bu neden kolayca karışır

HAC ve hacds farklı ölçeklerdedir:

- **HAC** zincirde zhu'dur, 1 HAC = 1e8 zhu; arayüzler HAC kullanır
- **hacds** zincirde adedin kendisidir, 1 = bir

Dolayısıyla `add_liquidity(hac_amt, ds_amt)` farklı ölçeklerde iki parametre alır:
bir tarafta zhu, diğerinde hacds adedi. 1e8 kat hata yapmanın en kolay olduğu yer
burasıdır — ilk yatırımda biz de yaptık.

---

## 10. Sorun giderme

### 10.1 Önce günlüğe bakın

Her işlemin sonucu ve başarısızlık nedeni alttaki günlük alanında görünür.
**Hatalar sade dille yazılır**: ne oldu, sonra ne yapmalı.

### 10.2 Yaygın hatalar

| Gördüğünüz | Anlamı | Ne yapmalı |
|---|---|---|
| Yetersiz bakiye | Kontrat kredisi düşük | Önce "Fon" sekmesinden yatırın |
| `resource gas limit exceeded` | Tek kova sınırı aştı | Birden fazla işleme bölün; **gas_max artırmak işe yaramaz** |
| `compute gas limit exceeded` | Aynı | Birden fazla işleme bölün |
| `CallNotExist(51)` | Kontratta bu fonksiyon yok | Yönetici fonksiyonları kaldırıldı; tıklamayı bırakın |
| `NotFindContract` | O adreste kontrat yok | Kontrat dağıtılmamış veya adres yanlış |
| `StorageNotActive` | Depolama anahtarının süresi doldu | "Araçlar" sekmesinden yenileyin |
| `state changed` | Zincir üstü durum değişti | Yeniden deneyin |
| `sandbox_per_ip_concurrency_exceeded` | Eşzamanlılık aşıldı | Birkaç saniye bekleyip yeniden deneyin (düğüm IP başına 2) |
| Ağ hatası | Servise ulaşılamıyor | Düğüm adresini ve ağınızı kontrol edin |

### 10.3 Yayın başarılı ama bakiye değişmedi

Normal. Bloklar yaklaşık 300 saniye sürer. Bekleyip "Varlıkları yenile"ye tıklayın.

### 10.4 Yazı çok küçük / çok büyük

Üstteki `−` / `+` ile ayarlayın; `⟲` sıfırlar.

### 10.5 Üç kart kapatılabilir

Sağ üstlerindeki `▾` ile.

---

## 11. Güvenlik notları

1. **Anımsatıcıyı ve parolayı çevrimdışı saklayın.** Kurtarma yok, destek yok.
2. **Tüm birikiminizi içine koymayın.** Kontrat yükseltilemez; sonradan bulunan
   bir hata düzeltilemez.
3. **Hazine anahtarı tek noktadır.** Kontratta çekim fonksiyonu yok, dolayısıyla
   kimse varlıklarınızı alamaz; ancak hazinedeki protokol geliri projenin soğuk
   cüzdanının kontrolündedir — onlara güvendiğiniz tek yer.
4. **Yönetici yok.** Kimse kontratı durduramaz, parametre değiştiremez veya
   hesabınızı donduramaz. Bu, fonksiyon listesinden doğrudan doğrulanabilir.
5. **Ekip size asla önce yazmaz.** "Cüzdanınızı doğrulayın" veya "anımsatıcınızı
   gönderin" diyen herkes dolandırıcıdır.
6. **Çevrimdışı imzalamada özel anahtar ağa hiç dokunmaz.** Soğuk makine ideal
   olarak kalıcı olarak bağlantısız olmalıdır.

---

## 12. Sade dille sözlük

| Terim | Sade anlamı |
|---|---|
| **hacds** | Elmasları kontrata yatırınca aldığınız token; 1 puan elmas = 100 milyon |
| **HAC** | Hacash ana parası — harcayabileceğiniz para |
| **HACD** | Elmaslar; yatırınca hacds alırsınız |
| **due / kota** | Kontrat içinde sizin için kaydedilen hacds, henüz zincire alınmamış |
| **AMM** | Otomatik piyasa yapıcılığı: tek havuz, herkes işlem yapar, fiyat kendi ayarlanır |
| **LP** | Likidite sağlayıcı — havuza para koyup ücret kazanan kişi |
| **Kayma** | İşleminizin fiyatı ne kadar ittiği; büyük işlemlerde daha fazla |
| **Teminat oranı** | Teminat değeri ÷ borç; %200 borç çizgisi, %160 tasfiye çizgisi |
| **Sağlık** | Teminat oranının başka bir gösterimi; 10000 = tam çizgide |
| **Tasfiye** | Geri ödeyemiyorsunuz, biri sizin için öder ve teminatınızın bir kısmını alır |
| **Derin su** | Teminat oranı %105 altında; tüm borç tek seferde kapatılabilir |
| **hcut** | Aşırı batık borçta küresel küçülme faktörü; yalnızca azalır |
| **keeper** | Kontratın depolama kirasını ödül karşılığında yenileyen kişi; herkes çalıştırabilir |
| **Referans fiyat** | Kontratın değerlemede kullandığı düzleştirilmiş fiyat; spot'tan farklı, manipülasyona dayanıklı |
| **Atomik işlem** | Birkaç eylemin tek işlemde paketlenmesi, ya hep ya hiç |

---

## 13. Bir dakikalık özet (yanınızda tutun)

```
Elmas yatır:      HACD sekmesi → elmaslarımı yükle → seç (en fazla 200) → toplu yatır
hacds al:         Fon sekmesi → hacds al → tutar → yayınla
Takas:            Takas sekmesi → yön seç → tutar → oluştur → yayınla
Likidite ekle:    Likidite sekmesi → HAC tarafını gir → hacds otomatik → oluştur → yayınla
Borç al:          Kredi sekmesi → teminat ekle → borç al → oluştur → yayınla
Transfer:         Transfer sekmesi → tür seç → adres ve tutar → oluştur → yayınla

Birimler:  hacds adet alır (1 bir demek)
           HAC HAC adedi alır (zincir üstü transferlerde 1:248)
           1e8 ile çarpmayın!

Tasfiye:   %160 teminat oranı, ödemesiz süre yok
Sağlık:    10000 = tehlikeli, > 10000 güvenli
Bloklar:   yaklaşık 300 saniye
```

---

*Bu belge, `HacdsDeFi3000.fitsh` kontratının 2026-11-11 tarihli kesinleşmiş
sürümüne karşılık gelir.*
