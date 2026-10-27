# HacdsDeFi Kullanım Kılavuzu

2026-10-21　Cüzdan sürümü 0.1.0 (Windows 64-bit) için

> ⚠️ **Bu belge, kullanımdan kaldırılmış #2000 sürümünü açıklar. Güncel uygulama referansı olarak kullanmayın.**
>
> #3000, **oracle, sertifika ve yöneticiyi** kaldırır: HACD puanlaması artık elmas geninden
> zincir üzerinde hesaplanır; sertifika akışı ve `init_admin` / `set_paused` / `set_oracle` yoktur.
> Varlık parametreleri serial 3000 / decimal 0 olarak değişti; kontrat adresi
> `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH`.
>
> **Güncel uygulama için bkz:**
> - [README](../README.md)
> - [Ekonomik tasarım (kesin)](../hacds_exchange/HacdsDeFi3000-经济设计-定稿.md)
> - [Dağıtım parametreleri](../hacds_exchange/发行参数-正式.md)
> - [Nihai güvenlik denetimi](../安全审计/上线前安全审计报告-2026-10-27-终审.md)
>
> Bu belgenin #3000 sürümü, kontrat dağıtıldıktan sonra resmi sürümle birlikte yayımlanacaktır.


## Bu kılavuz kimin için

Cüzdanı eline almış, ilk kez açmış ve nereye tıklayacağını bilmeyen kişi için.

Kontrat bilmediğinizi, HVM bilmediğinizi varsayıyor ve bilmenize de gerek yok. Sonunda şunları kendiniz yapabilir durumda olmalısınız: kurulum, cüzdan oluşturma, elması hacds'e çevirme, havuzda takas, teminatla borç alma ve başkasına coin gönderme.

Para geçen her yerde birim açıkça yazılı. **En kolay hata burada yapılır — lütfen 9. bölümü okuyun.**

---

## 1. Önce üç şey

**Bir Windows bilgisayar** (64-bit). Cüzdan bir masaüstü uygulamasıdır; web sürümü ve mobil sürümü yoktur (Android sürümü geliştiriliyor).

**İki dosyadan biri**: `HacdsDeFi-Setup-0.1.0-x64.exe` kurulum sürümüdür, çift tıklayıp kurun. `HacdsDeFi-0.1.0-x64.exe` taşınabilir sürümdür, çift tıklayınca çalışır. Hangisi olursa.

**Sunuculara erişim.** Cüzdan zincir verisini kendisi saklamaz; üç servise bağlanır:

| Servis | Adres | Ne yapar |
|---|---|---|
| Düğüm | `43.251.101.101:8082` | Bakiye sorgulama, işlem yayınlama |
| Oracle | `43.251.101.101:8123` | Elmas puanlama sertifikası verir (hacds'e çevirmek için gerekli) |
| İndeksleyici | `43.251.101.101:8124` | Kredi tasfiyesi için defter (isteğe bağlı) |

Bu adresler önceden doldurulmuştur. Ağ çalıştığı sürece değiştirmeniz gerekmez. Sunucu değiştirirseniz üstten değiştirin.

---

## 2. İlk açılış

Açıldığında üst kısım şöyle görünür:

```
[Düğüm] [Oracle] [Kontrat] [İndeksleyici] [Kaydet] [Kontrol]     [−] 100% [+] [⟲]   [Dil▾]
```

**Yapılacak ilk şey: "Kontrol" düğmesine basın.**

Sonra aşağıdaki günlük alanına bakın. İki satır görünmelidir:

- `Düğüm OK, yükseklik 79xxxx`
- `Oracle OK, 1H3sFZ53…`

İkisi de OK ise ağ erişilebilir demektir, devam edebilirsiniz. Hata varsa 10. bölüme bakın.

Sağdaki `100%` arayüz yakınlaştırmasıdır; yazı küçükse `+` düğmesine basın. En sağdaki açılır liste dili değiştirir (简体中文 / English / Türkçe).

---

## 3. Cüzdan oluşturma (veya içe aktarma)

Bu aşamada ortada "Cüzdan kilitli" yazar ve altında bir düğme sırası vardır:

```
Cüzdan kilitli   [Cüzdan oluştur] [Cüzdan içe aktar] [Cüzdan dosyası aç…] [Cüzdanlar] [Harici anahtar dosyası kullan]
```

### 3.1 Yeni kullanıcılar: cüzdan oluşturma

"Cüzdan oluştur" düğmesine basın ve iki şey girin:

- **Parola**: bir tane belirleyin. Bu parola cüzdan dosyanızı korur; kaybederseniz bir daha açamazsınız.
- **Etiket** (isteğe bağlı): örneğin "Ana cüzdan".

Onaylayın, cüzdan oluşur. Adres üstte görünür.

### 3.2 Mevcut cüzdanlar: üç içe aktarma yolu

| Durumunuz | Hangi düğme |
|---|---|
| Elinizde 64 karakterlik özel anahtar var (hex dizisi) | "Cüzdan içe aktar" |
| Daha önce kaydettiğiniz bir keystore dosyanız var | "Cüzdan dosyası aç…" |
| Özel anahtar bir dosyada ve içe aktarmak istemiyorsunuz | "Harici anahtar dosyası kullan" |

İçe aktarıldıktan sonra hesap alanında aynı şekilde görünür.

### 3.3 Birden fazla cüzdanı yönetme

"Cüzdanlar" düğmesine basın; tüm cüzdanların adresini, etiketini ve bakiyesini görürsünüz. Açabilir, yeniden adlandırabilir ve silebilirsiniz.

**Geçiş için bir kısayol var**: üstteki yeşil adrese tıklayın, bir liste açılır. Birini seçip geçin (parola sorulur). Önce "Cüzdanlar" ekranına girmeniz gerekmez.

---

## 4. Kilit açıldıktan sonra ne görünür

Üst kısım şuna döner:

```
🔓 1You…Addr   [Yönetici]   [Yenile] [Anahtarı dışa aktar] [Kilitle / Çık]
```

**"Yenile"**: zincir verisi kendi kendine güncellenmez. Güncel bakiyeyi görmek istediğinizde basın.

**"Kilitle / Çık"**: işiniz bittiğinde basmayı unutmayın. Kilitleme özel anahtarı bellekten siler; bilgisayarı alan biri paranızı hareket ettiremez.

Altında yapabileceğiniz her şeyin bulunduğu sekme sırası vardır:

```
Takas / Yatır | AMM & Likidite | Kredi | Transferler | HACD Galeri | Salt-okunur
Tasfiye | Atomik işlem | Çevrimdışı imza
```

"Yönetici" sekmesi yalnızca kontrat yöneticisinde görünür. Sıradan kullanıcılarda bu sekme yoktur — dikkate almayın.

---

## 5. Ana ekrandaki üç kartı okumak

Kilit açıldıktan sonra en üstte üç kart vardır. **Bu üçünü anlarsanız gerisi kolaydır.**

### 5.1 Varlıklar

| Gösterilen | Anlamı |
|---|---|
| **HAC** | Zincirde ne kadar HAC tutuyorsunuz |
| **HACD elmasları** | Kaç elmasınız var |
| **Beklenen hacds** | Bu elmaslar çevrilse yaklaşık kaç hacds eder |
| **Bekleyen hacds** | Elmaslar kontrata yatırıldı; kontratın size borcu (kaydi değer) |
| **Elde tutulan hacds** | Alınmış ve serbestçe transfer edilebilen hacds |
| **Kontrat içi HAC puanı** | Kontrata yatırdığınız HAC (takas ve kredinin kullandığı bakiye) |

hacds için şu çizgiyi hatırlamanız yeterli:

```
elinizde elmas  →(yatır)→  kontrat size borçlu (bekleyen)  →(al)→  elinize geçen hacds
```

**"Beklenen" ile "elde tutulan" iki farklı şeydir**, karıştırmayın. İlki bir tahmin, ikincisi harcayabileceğiniz para.

### 5.2 Protokol durumu

Havuzda ne kadar var, payınız ne, kredi durumunuz ne. Günlük olarak şunlara bakarsınız:

- **Havuz HAC / Havuz hacds**: havuzun büyüklüğü, takas fiyatını belirler
- **Havuz fiyatı**: şu anda 1 hacds kaç HAC eder
- **LP'm / Borcum / Teminatım**: size ait olanlar

### 5.3 Kredi durumu

**Bu kart deneme yanılma yapmayasınız diye var.** Sürekli şunları gösterir:

- Borcunuz, teminatınız ve teminatın kaç HAC ettiği
- **Kullanılabilir borç limitim** — şu anda daha ne kadar borç alabilirsiniz
- Tasfiye durumu: Güvenli / Tasfiye edilebilir / Borç yok

**Borç almadan önce bu karta bakın**; o zaman tekrar tekrar hata alarak öğrenmek zorunda kalmazsınız.

---

## 6. Her işlem aynı beş adımdır

Hangi sayfada olursanız olun, akış aynıdır:

```
Parametreleri gir  →  [İşlem oluştur]  →  önizleme çıkar  →  [Doğrula]  →  [Yayınla]
```

**① İşlem oluştur**: yerelde imzalanır. Bu adımda hiçbir şey harcanmaz ve zincire çıkmaz.

**② Önizleme alanı**: bir panel ve birkaç düğme görünür:

| Düğme | Ne yapar |
|---|---|
| **hex kopyala** | İşlemin ham halini kopyalar |
| **Kaydet…** | Dosyaya kaydeder |
| **Doğrula** | Düğümden işlem biçiminin geçerli olup olmadığını sorar (ağ gerekir) |
| **Çevir** | Düğümden işlemin ne yaptığını sade bir dille açıklamasını ister |
| **Yayınla** | Gerçekten gönderir |

**③ Şiddetle önerilir: önce "Çevir" düğmesine basın.** İşlemin ne yaptığını sade bir dille listeler, örneğin "Transfer 1 HAC from … to …". Doğru olduğunu onayladıktan sonra yayınlayın.

**④ Yayınladıktan sonra** günlük başarıyı ve işlem hash'ini gösterir.

**⑤ Blok bekleyin.** Hacash yaklaşık **5 dakikada** bir blok üretir. Başarılı yayın yalnızca bekleyen kuyruğa girdiği anlamına gelir — **ancak bir sonraki blokta yürürlüğe girer**. Yani "Yenile" düğmesine basıp sayıların değişmediğini görmek normaldir. Cüzdan 15, 45, 90, 180 ve 320 saniye sonra otomatik olarak tekrar tazeler.

---

## 7. Sık yapılan işler

### 7.1 Elması hacds'e çevirmek (en sık)

**"Takas / Yatır"** sayfasına gidin ve **"HACD → hacds (yatır)"** öğesini bulun.

1. "Elmas adları (virgülle ayrılmış)" alanına elmas adlarını virgülle ayırarak yazın, örneğin `MVUUBA,HYXYHY`
2. "İşlem oluştur" → "Çevir" ile bakın → "Yayınla"

**⚠ İşlem başına en fazla bir elmas.**

Bu bir yazılım sınırı değil, zincirdeki katı bir sınırdır. Her elmasın sertifikasını doğrulamak puanın yeniden hesaplanmasını gerektirir ve yaklaşık 3.000 birim hesaplama kaynağı tüketir; bir işlemin kaynak sınırı 6.100'dür. İki elmas 6.101 eder — azıcık üstünde — ve işlem doğrudan başarısız olur.

**Bir seferde birkaç tane yatırmak isterseniz**: **"HACD Galeri"** sayfasına gidin, birkaçını seçin ve "Toplu yatır" düğmesine basın — cüzdan bunları işlem başına bir elmas olacak şekilde böler ve tek tek yayınlar.

Yatırdıktan sonra hacds "Bekleyen hacds" altında kaydedilir; henüz elinize geçmemiştir.

### 7.2 hacds'i elinize almak

Yine **"Takas / Yatır"** sayfasında **"hacds al (kontrat → ben)"** öğesini bulun.

Miktarı girin (**birim atoms**, bkz. 9. bölüm), sonra oluştur, çevir, yayınla.

Sonrasında "Elde tutulan hacds" artar. Ancak o zaman hacds serbestçe transfer edilebilir.

### 7.3 Kontrata HAC yatırmak / çekmek

- **"HAC yatır (HAC → kontrat, puan kazandırır)"**: cüzdandaki HAC'i kontrata gönderir, kontrat bunu "HAC puanı" olarak kaydeder. **AMM takası ve kredi bu bakiyeyi kullanır**, dolayısıyla bunları kullanmak istiyorsanız önce yatırın.
- **"HAC çek (kontrat → ben)"**: puanı zincirdeki HAC'e geri çeker.

Miktar için **birim HAC'tir** — 10 HAC için `10` yazın.

### 7.4 Havuzda takas (AMM)

**"AMM & Likidite"** sayfasına gidin.

**HAC → hacds**:
- "Giren HAC puanı (HAC)" ve "Min çıkış (atoms, 0 = sınırsız)" alanlarını doldurun
- Altındaki panel hemen ne kadar alacağınızı, güncel havuz fiyatını ve komisyonu gösterir
- Uygunsa oluşturup yayınlayın

**hacds → HAC**: aynı şekilde, giren hacds (atoms) ve min çıkış (HAC).

**"Min çıkış" kayma korumasıdır.** 0 yazmak sınır koymamak demektir. Takas sırasında fiyat çok oynar ve elinize geçecek miktar yazdığınız sayının altına düşerse işlem otomatik olarak başarısız olur (para kaybetmezsiniz). **0 yerine kabul edebileceğiniz bir taban yazın.**

### 7.5 Likidite ekleyip komisyon kazanmak

**"AMM & Likidite"** sayfasına gidin ve **"Likidite ekle"** öğesini bulun.

Likidite eklemek, havuza aynı anda hem HAC hem hacds koyup karşılığında LP payı almaktır; sonra bu pay komisyondan pay alır.

**Kullanımı basittir: yalnızca bir tarafı doldurun, diğerini cüzdan sizin için hesaplar.**

- "HAC tarafı (HAC)" alanına bir miktar yazın, hacds tarafı hemen eşleşen miktarla doldurulur
- hacds yazmak da ters yönde aynı şekilde çalışır

**Neden otomatik hesaplanıyor**: kontrat, iki tarafın oranının havuzdakiyle aynı olmasını şart koşar. Oran tutmazsa fazla koyduğunuz taraf **size hiç pay kazandırmaz — doğrudan havuza bağışlanır**. Bu yüzden cüzdan oranı zorla hizalar.

Doldurduktan sonra altındaki panel "Tahmini LP payı: X" gösterir. İki taraf oranlı değilse (örneğin birini elle değiştirdiyseniz) kırmızı bir uyarı çıkar ve sayının ne olması gerektiğini söyler.

**Havuzda ne HAC ne hacds varken** (ilk yatırım) istisnadır: hizalanacak oran yoktur, iki tarafı da siz belirlersiniz ve pay `√(HAC × hacds)` olur.

**Likidite çıkarma**: yakılacak LP payını girin, iki varlık oranlı olarak geri döner.

**LP ödülü alma**: "LP ödülü al" düğmesine basın, biriken komisyonlar bakiyenize geçer. Basmasanız da kaybolmaz.

### 7.6 Teminatla borç almak

**"Kredi"** sayfasına gidin. **Sıra önemlidir: önce teminat, sonra borç.**

**① Teminat ekle**

"Teminat ekle" kartına hacds miktarını girin (**birim atoms**).

Altında canlı olarak şunu söyler: bu teminat kaç HAC eder ve toplamda ne kadar borç alabilirsiniz.

**② HAC borç al**

"HAC borç al" kartına ne kadar istediğinizi girin (**birim HAC**).

Altında canlı olarak şunlar görünür:
- Mevcut borç limitiniz
- Bu kredinin gerektirdiği teminat (`≥ X atoms`)
- Yeterli mi (✔ veya ✘)

**✘ görünüyorsa ve yine de gönderirseniz, hata ile başarısız olur.** Bu yüzden önce uyarıya bakın.

**③ Geri ödeme**

"Geri öde" kartına miktarı girin ve HAC puanının hazır olduğundan emin olun. Ödeme tamamlanınca teminat otomatik olarak serbest kalır.

**Faiz hakkında**: oran yıllık %5'tir, ancak arayüz ne kadar faiz borcunuz olduğunu ayrıca göstermez — kontrat faizi içine katmıştır. **Geri ödemede zincirde kapanır; cüzdanın gösterdiği tutarı ödemeniz yeterlidir.**

**Tasfiye hakkında**: teminatınızın değeri çok düşerse (teminat oranı %200'ün altına inerse) herkes gelip pozisyonunuzu tasfiye edebilir; teminatınız alınır ve tasfiye edene prim verilir. **Ana ekrandaki "Kredi durumu" kartının tasfiye durumunu takip edin** — "Güvenli" yazıyorsa sorun yok.

### 7.7 Başkasına coin göndermek

**"Transferler"** sayfasına gidin.

| Ne göndereceksiniz | Hangi öğe |
|---|---|
| HAC | "HAC transferi" — tutarı `1:248` biçiminde yazın, 1 HAC demektir |
| hacds | "Başkasına hacds" — miktarı **atoms** olarak girin |
| hacds kontrata geri | "Kontrata hacds" |
| Diğer varlıklar (CARAT, HACP, …) | "Diğer varlık transferi" — serial, adres, miktar girin |
| **HACD elmasları** | **"HACD gönder" — elmas adlarını ve alıcı adresini girin** |

**"HACD gönder"** (elmasları başkasına vermek): elmas adlarını (virgülle ayrılmış, örn. `KWTVSH,VHUSMI`) ve hedef adresi girin.

- **Bir işlemde en fazla 200 elmas**; "takas için yatır" birer birer yapılır — eşten eşe transfer kontrattan geçmediği için o hesaplama sınırı geçerli değildir
- Ücret kutusu `0.0002 HAC × adet` ile önceden doldurulur. **Daha az ödemek için temizleyin** — cüzdan düğüm oranından hesaplar (çok elmas gönderirken belirgin tasarruf)
- Bu öğe **kontrata dokunmaz**; elmaslarınızı doğrudan alıcının adresine taşır

**"Diğer varlık transferi" için serial düz sayıdır**, örneğin `1111`. `#` ile de çalışır ama gerekmez.

### 7.8 HACD Galeri: elmasları görme, toplu işlemler

**"HACD Galeri"** sayfasında solda tüm elmasların küçük resimleri vardır; birine tıklayınca sağda detay görünür (görsel, ad, numara, puan, beş boyut, yazıtlar).

Üstten şekle, stile ve minimum puana göre filtreleyebilirsiniz.

**Toplu işlemler**:
- Bir karta `Ctrl` basılı tutup tıklayın = seçime bir tane ekler
- `Shift` basılı tutup tıklayın = o karta kadar aralık seçer
- Sonra "Toplu yatır" veya "Toplu geri al" düğmesine basın
- Cüzdan "N işleme bölünecek, her birinde 1 elmas" diyen bir pencere açar; onaylayınca tek tek yayınlar

Ayrıca seçili elmas adlarını virgülle birleştirip kopyalayan bir **"Adları kopyala"** düğmesi vardır; başka yere yapıştırmak için kullanışlıdır.

---

## 8. İleri özellikler (okumasanız da olur)

### 8.1 Salt-okunur sorgular

**"Salt-okunur"** sayfasında bir düğme sırası vardır. Birine basmak zincirden sorgular — işlem yok, ücret yok. HAC puanı, bekleyen hacds, havuz fiyatı, havuz rezervleri, borcunuz ve teminatınız, LP payınız ve daha fazlasını kapsar.

"Para hareket ettirmek istemiyorum, sadece durumu görmek istiyorum" diyenler için.

### 8.2 Atomik işlemler

**"Atomik işlem"** sayfası. Birkaç işlemi **tek** işlemde birleştirebilirsiniz: hepsi başarılı ya da hepsi başarısız — asla "yarısı oldu" durumu olmaz.

Nasıl: herhangi bir işlem kartında **"Komboya ekle"** düğmesine basıp işlemleri biriktirin, sonra bu sayfaya gelip "Atomik işlem oluştur" düğmesine basın.

**Not: birleştirmek "işlem başına bir elmas" sınırını aşamaz.** Bir işlem tek bir hesaplama bütçesini paylaşır, dolayısıyla iki elmas yine taşar. Elmas için toplu işlevi kullanın.

### 8.3 Çevrimdışı imzalama (soğuk/sıcak ayrımı)

**"Çevrimdışı imza"** sayfası, güvenliğe önem veren kullanıcılar için.

Fikir şu: **özel anahtar ağa bağlı bir makinede hiç durmaz**.

1. Çevrimiçi bir makinede işlemi doldurup **imzasız** işlem gövdesini oluşturun; dosyaya kaydedin veya metni not edin
2. Çevrimdışı bir makineye götürün (uçak modu, ağ kablosu çıkarılmış), bu sayfada yapıştırın ve "İmzasız gövdeyi mevcut cüzdanla imzala" düğmesine basın
3. İmzalanmış işlem metnini çevrimiçi makineye geri götürüp "İmzalı işlemi yayınla" düğmesine basın

Böylece özel anahtarı tutan makine baştan sona ağa hiç çıkmaz. Hacash işlemlerinde zaman aşımı yoktur, dolayısıyla çevrimdışı imzalayıp günler sonra yayınlamak sorun olmaz.

**İmzalamadan önce "İmzasız gövdeyi doğrula" ve "İşlemi çevir"** ile işlemin istediğiniz işlem olduğunu doğrulayın.

### 8.4 Tasfiye / kapanış

**"Tasfiye"** sayfasında üç blok vardır:

1. **LP ödüllerim** — tek tıkla kapanış
2. **Hazine süpürme** — biriken komisyonları hazineye aktarma
3. **Tasfiye konsolu** — tasfiye edilebilir tüm pozisyonları listeler; herkes yürütebilir ve prim vardır

İlk ikisi sıradan kullanıcıları ilgilendirir. Üçüncüsü ileri kullanıcılar içindir: **başkasının pozisyonunu tasfiye etmek prim kazandırır**, ama riski kendiniz değerlendirirsiniz.

"Defteri eşitle" düğmesine basmak indeksleyiciden veri çeker (indeksleyici yoksa blokları yerel tarar, bu çok daha yavaştır).

---

## 9. ⚠ Sayıları okumak (en çok para kurtaran bölüm)

**hacds ile HAC tamamen farklı birimler kullanır. Yanlış girerseniz yüz milyon kat sapma olur.**

### 9.1 hacds atoms cinsindendir

hacds'in en küçük birimi **atom**'dur. Cüzdanda **her hacds sayısı atoms cinsindendir** — bakiyeler, havuzlar, giriş kutuları, hepsi.

```
1 hacds = 100.000.000 atoms
```

Yani bir giriş kutusunda gördüğünüz varsayılan değer `100000000` ise bu **1 hacds**'tir.

**Asla adedi yazmayın.** Örneğin 70 hacds göndermek için `70` yazmamalısınız — bu 70 atoms'tır, bir hacds'in milyonda birinden az. `7000000000` yazmalısınız.

**Nasıl hatırlanır**: giriş etiketi `(atoms)` yazıyorsa atoms girin. `(HAC)` yazıyorsa doğrudan HAC adedini girin.

### 9.2 HAC doğrudan adet alır

HAC basittir. Etiketi "(HAC)" olan yerde 10 HAC yatırmak için `10` yazın.

**Bir istisna**: Transferler sayfasında HAC tutarı `1:248` biçiminde yazılır (`1:248` = 1 HAC). Bu Hacash'in tutar yazımıdır — girişin varsayılan değerinin biçimine uyun.

### 9.3 Hızlı başvuru

| Ne yapıyorsunuz | Girilecek birim | Örnek |
|---|---|---|
| Likidite ekle — HAC tarafı | HAC | `1` |
| Likidite ekle — hacds tarafı | atoms | `33183372` |
| Takas — giren HAC | HAC | `1` |
| Takas — giren hacds | atoms | `100000000` |
| Teminat ekle | atoms | `100000000` |
| Borç al / geri öde | HAC | `0.5` |
| hacds gönder | atoms | `100000000` |
| Diğer varlık gönder | atoms | `100000000` |

---

## 10. Bir şey ters giderse

### 10.1 Önce günlük alanına bakın

Her işlemin sonucu ve her hatanın nedeni alttaki günlük alanına yazılır. **Hata mesajları yerelleştirilmiştir**: ne olduğunu, sonra ne yapılacağını söyler.

### 10.2 Sık görülen hatalar

| Gördüğünüz | Anlamı | Ne yapmalı |
|---|---|---|
| **Düğüm/oracle erişilemiyor** | Servise ulaşılamıyor | "Kontrol" düğmesine basın; ağı doğrulayın; üstteki adresleri doğrulayın |
| **Adres boş veya biçimi hatalı** | Adres tam girilmemiş | Alıcı adresini baştan tamamen kopyalayın |
| **Adres sağlama basamağı hatalı** | Kopyalarken karakter düşmüş | Yeniden kopyalayın |
| **Bakiye yetersiz** | Adreste ücret/gaz için HAC yok | O adrese biraz HAC gönderin |
| **resource gaz kovası aşıldı** | Bir işlemde birden fazla elmas var | İşlem başına bir tane yapın veya "Toplu yatır" kullanın. **Gazı artırmak işe yaramaz** |
| **Borç limiti aşıldı** | Teminat yetersizken borç alınıyor | Önce "Teminat ekle" |
| **Bekleyen hacds yetersiz** | Kontratın borcundan fazlasını istiyorsunuz | "Bekleyen hacds" değerine bakın, üstüne çıkmayın |
| **Geri alım için hacds yetersiz, otomatik tamamlama başarısız** | Elmas geri alınırken kota yetmiyor; kontrat HAC ile tamamlamayı denedi ve olmadı | Önce HAC yatırın veya biraz hacds takas edin |
| **Kontrat duraklatıldı** | Yönetici kontratı duraklattı | Devam etmesini bekleyin; operatöre sorun |
| **Durum değişti, tekrar deneyin** | Bu arada zincir değişti | Yenileyip tekrar yapın |
| **İstek zaman aşımı / sunucu hatası** | Sunucu yavaş veya geçici olarak kullanılamaz | Biraz bekleyip tekrar deneyin veya düğüm değiştirin |

### 10.3 Yayın başarılı ama bakiye değişmedi

**Normal.** Blok bekleyin (yaklaşık 5 dakika). Cüzdan birkaç kez otomatik tazeler; beklemeniz yeterli.

### 10.4 Arayüz yazısı çok küçük / çok büyük

Üstteki `+` ve `−` ile ayarlayın; `⟲` %100'e döndürür.

### 10.5 Üç kart katlanabilir

"Varlıklar", "Protokol durumu" veya "Kredi durumu" başlığının solundaki küçük üçgene basarak o kartı katlayabilir ve alttaki işlem alanına ekran alanı kazandırabilirsiniz.

---

## 11. Güvenlik notları

**Parolanızı kimseye söylemeyin ve "Anahtarı dışa aktar" sonucunu kimseye göstermeyin.** Özel anahtar tüm bakiyenizdir — kim alırsa her şeyi taşıyabilir.

**"Anahtarı dışa aktar" özel anahtarı düz metin olarak gösterir** ve cüzdan iki kez onay ister. Dışa aktardıktan sonra çevrimdışı olarak yazın. Ekran görüntüsü almayın, bulut depolamaya koymayın.

**İşiniz bittiğinde "Kilitle / Çık" düğmesine basın.**

**Cüzdanınızı ortak kullanılan bir bilgisayarda içe aktarmayın.**

**Zincir üstü işlemler geri alınamaz.** Yayınlamadan önce her zaman "Çevir" düğmesine basıp alıcı adresini ve tutarı kontrol edin. Yanlış yere gönderirseniz kimse geri getiremez.

**Göndermeden önce adresi okuyun.** Elle yazmak yerine kopyalama düğmesini tercih edin.

---

## 12. Sade dille terimler

| Terim | Sade anlatım |
|---|---|
| **HAC** | Ana zincirin yerel coin'i |
| **HACD** | Elmaslar. Değerlidir ve hacds'e çevrilebilir |
| **hacds** | Elmaslardan elde edilen varlık; serbestçe transfer edilir, işlem görür, teminat olur |
| **atoms** | hacds'in en küçük birimi; 1 hacds = 100 milyon atoms |
| **LP payı** | Havuza koyduğunuz paranın makbuzu; komisyondan pay kazandırır |
| **Havuz / AMM** | Otomatik takas yapan bir fon havuzu; fiyat, içindeki iki coin miktarından gelir |
| **Kayma koruması** | Gerçekleşme fiyatı belirlediğiniz tabandan kötü olamaz, yoksa otomatik iptal olur |
| **Teminat oranı** | Aldığınız borç ile rehin verdiğiniz değer arasındaki ilişki; çok düşerse tasfiye edilir |
| **Tasfiye** | Teminat yetersizse başkası borcu kapatmak için zorla satabilir |
| **gaz** | Zincir üstü işlemin tükettiği hesaplama kaynağı, HAC ile ödenir |
| **Yayınlama** | İşlemi zincire gönderme |
| **Blok** | Zincirde onay, yaklaşık 5 dakikada bir |
| **Soğuk cüzdan / çevrimdışı imza** | İmzalayan makine ağa bağlı değildir; özel anahtar için en güvenli düzen |
| **Oracle** | Elmasları puanlayan servis; hacds'e çevirmek için imzalı sertifikası gerekir |
| **İndeksleyici** | Hangi kredilerin tasfiye edilmesi gerektiğini hesaplayan arka plan servisi |

---

## 13. Bir dakikalık özet (yanınızda tutun)

```
Cüzdan oluştur  → Cüzdan oluştur → parola belirle
Durum sorgula   → "Yenile" düğmesine bas
hacds al        → Takas/Yatır → HACD→hacds → işlem başına bir elmas
hacds'i al       → Takas/Yatır → hacds al
HAC yatır       → Takas/Yatır → HAC yatır (AMM/krediden önce yapın)
Takas           → AMM & Likidite → bir tarafı doldur → fiyata bak → yayınla
Likidite ekle   → AMM & Likidite → Likidite ekle → bir tarafı doldur, diğeri otomatik
Borç al         → Kredi → önce "Teminat ekle" → sonra "HAC borç al"
Coin gönder     → Transferler
Her işlem       → Oluştur → Çevir → Yayınla → 5 dakika bekle

Birimler: hacds atoms alır (1 hacds = 100000000)
          HAC doğrudan adet alır (10 demek 10)
```
