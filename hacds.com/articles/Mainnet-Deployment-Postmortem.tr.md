# Mainnet Dağıtım Olay İncelemesi: 10.000 Pay Nasıl Kalıcı Olarak Kilitlendi

> Bu, HacdsDeFi #4000 mainnet lansmanı sırasında yaşanmış gerçek bir olaydır. Tüm veriler zincir üstü gerçek durumdan ve
> depodaki kayıtlardan geliyor (beyaz kitap §5.2, `安全审计/` (güvenlik denetimi) altındaki tur raporları). Bunu yazıyoruz çünkü oluşum biçimi son derece tipik:
> **bir parametre, yanlış yazılmış bir belge, geri verilemeyen bir sorumluluk.**

## 1. Olay neydi

2026-11-18, ilk mainnet dağıtım turu (#3000).

Pay varlığı `HACDS-SHARE` (serial 3001, toplam 10.000 pay) ihraç edildikten sonra zincir üstünde şu durum ortaya çıktı:

| Kalem | Değer |
|---|---|
| Vault kontrat B'nin zincir üstü 3001 bakiyesi | 10.000 pay |
| Vault kontrat B'nin `sh:` pay defteri | **0** |
| Sonuç | `PermitAsset` transfer çıkışına izin vermek için yeterli `sh:` bakiyesi ister → **her zaman 11 döndürür** |

10.000 pay hissenin tamamı kontrat adresinin kendi adına düştü, kontratın iç pay defteri ise boş.

Kontratın 15 harici fonksiyonu var ve **hiçbiri `sh:` defterini başlatamaz**.
Bu bir kilitlenme. Üstelik kontratın yöneticisi yok, yükseltilemiyor — kimse "bir düzelteyim" diyemez, onu yazan kişi dahil.

**Bu 10.000 varlık oracıkta kalıcı olarak kilitlendi.**

## 2. Kök neden: `issuer` gerçekte "kim"

### Doğrudan neden

Pay varlığı ihraç edilirken `issuer` parametresine **vault kontratın kendi adresi** yazıldı.

Hacash'in `AssetCreate` işlemi şöyle çalışır:

> **Supply'ı yoktan basar, doğrudan `issuer` adresinin adına yazar, hiçbir kontrat hook'undan geçirmez.**

Kritik nokta bu. Kontrat B'nin `PermitAsset` mantığı aslında `sh:` defter bakiyesinin giren miktardan büyük veya ona eşit olmasını isterdi —
ama `AssetCreate` bu hook'tan hiç geçmez. Sadece 10.000 payı o adrese yazdı.
Kontratın defterinin bundan haberi yok, hâlâ 0.

Yani:

- Varlık zincirde, görünür durumda, 10.000 pay
- Kontrat bu kişinin (yani kendisinin) payının 0 olduğunu düşünüyor
- Dışarı transfer etmek mi istiyorsunuz? `PermitAsset` `sh:` bakiyesini kontrol eder → 0 → 11 döndürür

**Zincir üstü elde tutma ile kontrat muhasebesi ilk kez, kapatılamaz biçimde birbirinden koptu.**

### Asıl neden: belgenin kendisi yanlıştı

Eğer bu sadece işlem sırasında bir el sürçmesi olsaydı, hikâye basit bir hata olarak kalırdı.

Gerçek kök neden burada. Projenin dağıtım parametre dosyası `发行参数-正式.md` (yayın parametreleri - nihai) içinde şöyle yazıyor:

```
| **Contract address (issuer)** | **T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH** |
```

Ve ayrıca:

> `AssetCreate.issuer` yeni kontrat adresi olmalıdır. Yanlış doldurulursa hacds, iptal edilmiş eski kontratın adına ihraç edilir.

Bu dosyanın kendini konumlandırdığı yer — **"dağıtım parametrelerinin tek dayanağı"**.

Yani: **belgeye uyun, hata yaparsınız.**

Belge `issuer`ı "bu varlık hangi kontrat tarafından yönetiliyor" diye anlamıştı; gerçek anlamı ise
"bu varlık partisi kimin adresine basılıyor".

Bu iki şey senaryoların büyük çoğunluğunda tesadüfen çakışır, bu yüzden bu yanlış anlama uzun süre ortaya çıkmadan saklı kalabilir.
Ta ki **varlıkların dışarı gönderilmesini ve sahibinin stake edip etmeyeceğine kendisinin karar vermesini gerektiren** bir senaryoyla karşılaşana kadar —
yani paylarla. İşte o zaman yolları ayrılır.

### Ders, tek cümleyle

> `issuer` şu soruyu yanıtlar: **"bu varlık partisi nerede doğdu"**,
> **"bu varlık partisi sonunda kim tarafından yönetiliyor"** değil.

Kontrata stake edilmesi gereken sertifika tipi varlıklar, **serbestçe transfer edilebilen sıradan bir adrese** ihraç edilmeli,
stake edip etmeyeceğine ise sahibi kendisi karar vermelidir.

**Bir vault kontratı kendi pay varlığını asla ihraç etmez ve asla elinde tutmaz.**

## 3. Tespit ve zararı sınırlama

Olay ortaya çıktıktan sonra önce bir gerçeği söylemek gerek: **serial yeniden ihraç edilemez.**

`state.asset(&serial)` mevcutsa istek reddedilir. 3000 / 3001 numaraları kalıcı olarak işgal edilmiştir;
o 10.000 varlık kilitlenmiş ve kullanılamaz durumda olsa bile numaralar geri alınamaz.

Yani "düzeltme" diye bir eylem baştan itibaren yoktu. Tek bir yol vardı:

### Yaklaşım: tüm numaralandırmayı değiştirip sıfırdan başlamak

| Kalem | Birinci tur (iptal) | İkinci tur (mevcut) |
|---|---|---|
| Varlık serial | 3000 / 3001 | **4000 / 4001** |
| Kontrat A nonce | 2 | **5** |
| Kontrat B nonce | 3 | **4** |
| Kontrat A adresi | `T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH` | `bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h` |
| Kontrat B adresi | — | `duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4` |

İki kontrat yeniden dağıtıldı, varlık yeniden ihraç edildi, `issuer` **dağıtıcı adresine** çevrildi
(`15fv6cNEapTNqYhigMPr38pC1XRKn3Wh5q`) — serbestçe transfer edilebilen sıradan bir adres.

Bu ihraçtan hemen sonra doğruladık: zincir üstünde 10.000 pay dağıtıcı adına, `get_shares` sıfıra döndü,
sahipler kontrata serbestçe transfer edip stake edebiliyor. **Durum doğru.**

### Bedel

- İki kontrat dağıtımının gas'ı
- İki varlık ihracının maliyeti
- Bir parti iptal olmuş belge ve ekran görüntüsü
- Ve kalıcı bir numara boşluğu: #3000 / #3001 artık tarih, bir daha kullanılmayacak

Bu parayı çekirdek geliştirici tek başına karşıladı.

## 4. Denetimler neden durdurmadı

Bu, üzerinde durmaya en değer bölüm.

Proje lansmandan önce 5 tur bağımsız denetim yaptırdı. İlk üç tur sırasıyla 4 bloklayıcı, 2 bloklayıcı ve düzeltme incelemesiydi.
5. tur (2026-11-15) **No-Go** kararı verdi, gerekçe üç bloklayıcıydı.

**Ama hiçbir denetim turu `issuer`ın sıradan bir adres olması gerektiğini bulamadı.**

Nedeni karmaşık değil:

1. **Denetimler koda bakar, parametre tablosuna bakmaz.** Kontrat mantığının kendisi yanlış değil — `PermitAsset`in
   yeterli `sh:` bakiyesi istemesi doğru bir tasarım. Yanlış olan, ona verilen girdiydi.
2. **`issuer`ın anlamına dair yanlış anlama kodda değil, belgede.** Kodda "issuer sıradan bir adres olmalıdır" yazan
   tek bir satır yok, bu yüzden statik okuma bunu yakalayamaz.
3. **Bu hata yalnızca belirli bir işlem dizisinde ortaya çıkar.** Dağıt → ihraç et → dışarı transfer etmeyi dene;
   ilk iki adım da başarılı olur, sadece üçüncüsü patlar. Denetim aşaması ise üçüncü adıma hiç ulaşmadı.

5. tur denetiminin değerlendirmesinde çok isabetli bir cümle var:

> Şu anda diskte bulunan dağıtım çıktılarının mevcut kaynak koddan geldiği kanıtlanamıyor ve bunu kanıtlamak için kullanılan öz-denetim betiği kritik dalda tüm doğrulama sonuçlarını atıyor.

Baktığı şey **doğrulama zinciri**ydi. Bu olayın ortaya çıkardığı ise başka bir kör nokta: **parametre anlamı**.

Koda güvenilebilir ≠ girdi doğru.
Doğrulama zinciri "bu kaynak kod gerçekten bu bytecode'a derlendi"yi garanti eder;
"bu bytecode'a verdiğiniz parametreler doğru"yu garanti edemez.

## 5. Bu olayın gerçekten değerli yanı

### 1. Değiştirilemezlik iki yönlüdür

"Kontratın yöneticisi yok, yükseltilemiyor" tanıtım dilinde bir avantajdır — kimse paranızı alamaz.

Ama olay bağlamında bu aynı şeydir: **kimse hayatınızı kurtaramaz.**

Bunlar "avantaj" ve "dezavantaj" değil, **aynı madalyonun iki yüzüdür**.
Madem "kimse değiştiremez"i temel satış argümanı yaptınız, "kendiniz dahil"i de kabul etmek zorundasınız.

Bu, bu olayın en derin dersi. Onu yazan kişi bile tek bir parametre hatası yüzünden bedel ödüyor —
bu tam da bu mekanizmanın ne kadar mutlak olduğunun kanıtı.

### 2. Belgedeki "tek dayanak" en yüksek risk noktasıdır

Kendini "tek dayanak" ilan eden bir parametre dosyası, eğer yanlışsa, hatasını **sistematik olarak,
ayırt etmeksizin, sürtünmesiz biçimde** her uygulamaya yayar.

Bu bir kod hatasından daha tehlikelidir — kod hatası en azından tetikleme koşulunu sağlamak zorundadır,
oysa "belgeye uymak" her seferinde yanlıştır.

**"Tek dayanak" ifadesi son derece yüksek bir taahhüttür ve onu desteklemek için son derece yüksek bir doğrulama maliyeti gerektirir.**
Bu taahhüdün altından kalkamıyorsanız, onu "referans"a düşürüp uygulamadan önce zincir üstü anlamla satır satır karşılaştırmayı zorunlu kılmak daha iyidir.

### 3. Dersler ürüne yazılmalı, sadece belgeye değil

Olaydan sonra yapılan şey "bir dahaki sefere dikkat ederim" değil, şunlar oldu:

- Beyaz kitap §5.2'de eksiksiz kayıt (tablo dahil, sonuçlar dahil, dersler dahil)
- §5.3 ayrıca bir paragraf ayırdı: *"issuer neden vault kontratı değildir"*
- Kullanım kılavuzunun 9. bölümü temettüden bahsederken açıkça belirtiyor: "stake etmek bir transferdir, yatırma değildir"
- Üç uçtaki cüzdanların onay kutuları da "bu, N payı vault kontratına aktaracak" uyarısını gösteriyor

**Dersleri kullanıcının gördüğü yere yazın, sadece geliştiricinin hafızasına değil.**

### 4. Sonradan açıklama, gizlemekten daha değerlidir

Proje ekibi bu olayı tamamen kamuya açmayı seçti — 10.000 varlığın kilitlenmesi, tüm gas'ın kendileri tarafından karşılanması,
numara sisteminin tamamen terk edilmesi dahil.

Kısa vadede bu olumsuz bir bilgidir. Ama:

- Zincir üstü kayıtların değiştirilemez olduğunu kanıtlar (siz söylemeseniz de başkaları bakıp görebilir)
- Ekibin olayı ele alma becerisini kanıtlar (numaraları değiştirip sıfırdan başladılar, bir hafta içinde toparlandılar)
- Tüm kullanıcılara bu varlık mekanizmasının gerçek sınırlarını öğretti

**"Kod yasadır" ilkesinin geçerli olduğu bir sistemde, olayı gizlemek başlı başına en büyük kredi riskidir.**

## 6. Zaman çizelgesi

| Tarih | Olay |
|---|---|
| 2026-11-18 | Birinci tur dağıtım (nonce 2/3), serial 3000/3001 |
| 2026-11-18 | Pay ihracı → 10.000 pay kontrat adresine düştü, `sh:` defteri 0, kilitlenme doğrulandı |
| 2026-11-18 | Telafisi imkânsız olduğu belirlendi: serial yeniden ihraç edilemez, kontratın yöneticisi yok |
| 2026-11-18 | Tüm numaralandırmayı değiştirme kararı: serial 4000/4001, kontrat nonce 5/4 |
| 2026-11-18 | İkinci tur dağıtım tamamlandı, varlık dağıtıcı adresine ihraç edildi, durum doğrulaması geçti |
| 2026-11-20 | Üç uçtaki istemci, 9 adet üç dilli belge ve resmi site tamamen #4000'e geçirildi |

Olayın yaşanmasından yeni sistemin uçtan uca çalışmasına kadar geçen süre, aynı iş günü içinde tamamlandı.

## 7. Kapanış

Bu olayın teknik açıdan çok yüksek bir yanı yoktu — karmaşık bir yarış durumu yok, gizli bir reentrancy yok,
ustalıklı bir ekonomik model açığı yok.

Sadece bir parametre yanlış doldurulmuştu.

Ama bize üç şeyi doğrulattı:

1. **Belgenin doğruluğu, kodun doğruluğu kadar önemlidir**, ve birincisini genellikle kimse denetlemez.
2. **Yükseltilemezlik iki ucu keskin bir kılıçtır**, "yönetici yok" kararını verirken tüm sonuçlarını da aynı anda kabul etmek gerekir.
3. **Zincir üstü olaylarda "geri alma" diye bir seçenek yoktur**, sadece "sıfırdan başlama" vardır ve sıfırdan başlamanın bedelini birinin ödemesi gerekir.

Madem tek cümleyle özetlemek gerekiyor:

> **Bir düzine küsur HAC ve bir numara sistemi harcayarak tek bir kelimenin kesin tanımını satın aldık: issuer.**

"Kimin yönettiği"ni yanıtlamaz, sadece "kimin doğduğu"nu yanıtlar.

---

*İlgili belgeler: beyaz kitap §5.2 (olay kaydı), §5.3 (pay varlıklarının tokenleştirilmesi ve issuer açıklaması),
`hacds_exchange/发行参数-正式.md` (yayın parametreleri - nihai) (dağıtım parametreleri; dikkat: buradaki issuer hakkındaki tarihsel ifade olay sonrasında düzeltilmiştir),
`安全审计/主网部署清单-2026-11-18.md` (mainnet dağıtım kontrol listesi 2026-11-18) (ikinci tur dağıtımın uygulama kaydı).*
