# Portföyüm v1.2

GitHub Pages üzerinde çalışan, yatırım fonları ve hisse senetlerini aynı portföyde takip etmek için hazırlanmış mobil uyumlu bir uygulama.

## Özellikler

- Yatırım fonu + hisse senedi portföyü
- Bir varlığa birden fazla alış ekleme
- Ağırlıklı ortalama maliyet
- Toplam portföy değeri
- Gerçekleşmemiş kâr / zarar
- Portföy dağılım grafiği
- TEFAS fon fiyatı güncelleme
- BIST hisse fiyatı güncelleme (gecikmeli veri)
- Koyu / açık tema
- JSON yedekleme / geri yükleme
- localStorage ile cihazda veri saklama
- Mobil uyumlu arayüz

> Not: BIST hisse fiyatları ücretsiz gecikmeli piyasa verisi üzerinden alınır; gerçek zamanlı lisanslı feed değildir.

---

## 1. GitHub Pages kurulumu

Repository'ye şu dosyaları yükleyin:

```text
index.html
assets/
  app.js
  style.css
```

GitHub'da:

1. Repository → **Settings**
2. **Pages**
3. Build and deployment → **Deploy from a branch**
4. Branch: `main`
5. Folder: `/ (root)`
6. Save

Birkaç dakika sonra siteniz GitHub Pages adresinden açılır.

---

## 2. TEFAS neden Worker üzerinden çekiliyor?

GitHub Pages statik bir hosting servisidir. Tarayıcıdan `tefas.gov.tr` alanına doğrudan yapılan istekler CORS / upstream güvenlik kurallarına takılabilir.

Bu projede küçük bir Cloudflare Worker TEFAS ile tarayıcı arasında proxy görevi görür.

TEFAS'ın 2026 yapısında kullanılan fiyat endpoint'i:

```text
POST https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir
```

Worker'ın kullanıcıdan API anahtarı istemesine gerek yoktur.

---

## 3. Cloudflare Worker kurulumu

Cloudflare hesabınızda:

1. **Workers & Pages**
2. **Create**
3. Worker oluşturun.
4. `worker/worker.js` dosyasının tamamını Worker editörüne yapıştırın.
5. Deploy edin.

Adresiniz yaklaşık şöyle olur:

```text
https://portfoyum-api.KULLANICI.workers.dev
```

Tarayıcıdan şu adresi test edin:

```text
https://portfoyum-api.KULLANICI.workers.dev/health
```

Şuna benzer cevap gelmeli:

```json
{"ok":true,"service":"portfoyum-tefas-proxy"}
```

Sonra:

```text
https://portfoyum-api.KULLANICI.workers.dev/api/fund/TTE
```

Başarılı olduğunda yaklaşık şu formda veri döner:

```json
{
  "ok": true,
  "code": "TTE",
  "price": 1.234567,
  "previousPrice": 1.229000,
  "date": "2026-08-10T...",
  "name": "..."
}
```

---

## 4. Worker adresini uygulamaya bağlama

Web sitesinde:

**Ayarlar → TEFAS Veri Bağlantısı → Worker URL**

alanına Worker adresinizi yapıştırın.

Örnek:

```text
https://portfoyum-api.KULLANICI.workers.dev
```

Sonra **Kaydet** ve **TTE ile Test Et** düğmelerini kullanın.

---

## Veri saklama

Şimdilik kullanıcı üyeliği olmadığı için portföy verileri tarayıcıdaki `localStorage` alanında saklanır.

Tarayıcı verileri silinirse portföy de silinebilir. Bu nedenle Ayarlar bölümündeki **JSON Dışa Aktar** ile yedek alınabilir.

İleride Supabase üyeliğine geçildiğinde aynı veri modeli buluta taşınabilir.

---

## Dosya yapısı

```text
portfoyum-v1/
├── index.html
├── assets/
│   ├── app.js
│   └── style.css
├── worker/
│   ├── worker.js
│   └── wrangler.toml
└── README.md
```

---

## V1.1 değişiklikleri

- Arayüz füme / grafit tonlarına geçirildi.
- Her fon ve hisse için günlük TL ve yüzde değişim alanı eklendi.
- TEFAS fonlarında önceki fiyat üzerinden günlük değişim otomatik hesaplanır.
- Hisseler için önceki kapanış + güncel fiyat manuel güncelleme düğmesi eklendi.
- Aynı varlığı yeniden oluşturmaya gerek kalmadan sınırsız parçalı alış yapılabilir.
- Satış / portföyden çıkarma işlemi eklendi.
- Satışlarda kalan pozisyonun ağırlıklı ortalama maliyeti korunur.
- Eski kayıtlar otomatik olarak alış işlemi kabul edildiğinden mevcut localStorage verileriyle uyumludur.


## v1.3 düzeltmesi

- BIST hisselerinde günlük değişim, gerçek önceki seans kapanışından hesaplanır.
- Yahoo `previousClose` meta alanındaki tutarsızlıklara karşı günlük mum verisi esas alınır.
- Hisse bazındaki ve toplam portföy günlük getirisi aynı düzeltilmiş önceki kapanış değerini kullanır.


## v1.4 — BIST veri kaynağı düzeltmesi

Yahoo Finance BIST hisseleri için bazı günlerde önceki kapanış/seans bilgisini tutarsız döndürdüğü için hisse veri kaynağı kaldırıldı.

V1.4'te hisseler iTick `stock/quote` API'sinden çekilir:

- `region=TR`
- `ld`: son fiyat
- `p`: önceki kapanış
- `ch`: günlük fark
- `chp`: günlük yüzde değişim

### iTick token kurulumu

1. iTick hesabı oluşturup bir API token alın.
2. Cloudflare → **Workers & Pages** → `portfoyum-api`
3. **Settings** → **Variables and Secrets**
4. **Add** / **Add variable**
5. Name:
   `ITICK_TOKEN`
6. Value:
   iTick tokenınız
7. Türünü **Secret** olarak kaydedin.
8. Worker kodunu `worker/worker.js` ile değiştirip Deploy edin.

Token frontend'e veya GitHub'a yazılmaz. Cloudflare Worker Secret olarak kalır.

### Test

Worker adresiniz:

`https://portfoyum-api....workers.dev`

ise şunu açın:

`https://portfoyum-api....workers.dev/api/stock/FROTO`

Başarılı cevapta şu alanlar görünmelidir:

- `price`
- `previousPrice`
- `change`
- `changePercent`
- `source: "iTick"`

FROTO gibi hisselerde uygulamanın günlük yüzde hesabı:
`(price - previousPrice) / previousPrice * 100`

şeklinde yapılır.


## v1.5 — Ücretsiz BIST kapanış modu

iTick kaldırıldı. Artık API anahtarı gerekmez.

Hisse verisi için Yahoo Finance'ın **anlık fiyat / previousClose meta alanları kullanılmaz**.
Bunun yerine yalnızca tarihsel `1d` mumların tamamlanmış kapanışları kullanılır.

Mantık:

1. BIST kodu otomatik olarak `.IS` sembolüne çevrilir.
2. Son 1 aylık günlük kapanış verisi alınır.
3. İstanbul tarihine göre **bugünün mumu her zaman dışarıda bırakılır**.
4. Son iki tamamlanmış işlem gününün kapanışı seçilir.
5. Günlük getiri uygulama tarafından hesaplanır:

`(son kesinleşmiş kapanış - önceki kesinleşmiş kapanış) / önceki kesinleşmiş kapanış * 100`

Bu nedenle hisse verisi bir işlem günü gecikmeli olabilir; amaç anlık olmak değil,
**tutarlı ve kesinleşmiş kapanış verisi** göstermektir.

### Cloudflare

V1.5 ile `ITICK_TOKEN` gerekmez. Cloudflare'daki eski secret kalsa da kullanılmaz;
isterseniz silebilirsiniz.

Sadece `worker/worker.js` kodunu V1.5 ile değiştirip Deploy edin.

### Test

`/api/stock/FROTO`

cevabında şu alanları kontrol edin:

- `source: "Yahoo Finance EOD historical"`
- `mode: "last_completed_close"`
- `price`
- `previousPrice`
- `changePercent`
- `priceDate`
- `previousPriceDate`

`priceDate` ve `previousPriceDate` sayesinde hangi iki kapanışın karşılaştırıldığını
artık açıkça görebilirsiniz.


## v1.6 — TradingView BIST delayed veri

V1.5'te kullanılan Yahoo Finance günlük geçmiş verisi, FROTO örneğinde 11 Ağustos
kapanışını 12 Ağustos 00:35 itibarıyla hâlâ sunmadığı için hisse tarafında kaldırıldı.

V1.6'da hisse verisi:

`POST https://scanner.tradingview.com/turkey/scan`

üzerinden `BIST:FROTO`, `BIST:THYAO`, `BIST:ASELS` gibi sembollerle alınır.

Kullanılan alanlar:

- `close` → son fiyat
- `change` → günlük yüzde değişim
- `change_abs` → günlük TL değişim
- `description` → şirket adı
- `currency`
- `update_mode`

Önceki kapanış:

`previousPrice = close - change_abs`

olarak hesaplanır. `change_abs` yoksa:

`previousPrice = close / (1 + change / 100)`

formülü kullanılır.

API anahtarı gerekmez.

### Cloudflare güncellemesi

Sadece V1.6 içindeki:

`worker/worker.js`

dosyasını Cloudflare Worker koduyla değiştirip Deploy edin.

### FROTO testi

`/api/stock/FROTO`

cevabında özellikle şunlara bakın:

- `source`: `TradingView delayed scanner`
- `price`
- `previousPrice`
- `changePercent`
- `providerChangePercent`

11 Ağustos 2026 kapanışı için beklenen referans yaklaşık:

- Son: `78.85`
- Önceki: `77.40`
- Günlük: `+1.87%`


## v1.7 — Grafikler ve portföy geçmişi

Bu sürümde dashboard analiz tarafı genişletildi.

### Yeni grafikler

- **Portföy Gelişimi:** toplam portföy değeri ile yatırılan ana parayı zaman içinde karşılaştırır.
- **Günlük Performans:** portföydeki her fon ve hissenin günlük yüzde değişimini karşılaştırır.
- Mevcut **Varlık Dağılımı** grafiği korunmuştur.

### Portföy geçmişi nasıl oluşur?

`Fiyatları Güncelle` butonuna her basıldığında, en az bir varlığın fiyatı başarıyla güncellenirse o gün için:

- toplam portföy değeri
- toplam maliyet / ana para
- gerçekleşmemiş kâr-zarar

localStorage'a günlük snapshot olarak kaydedilir.

Aynı gün tekrar güncelleme yapılırsa yeni satır oluşturmak yerine o günün kaydı güncellenir.

Eski v1.6 portföy verileri korunur. Grafik geçmişi v1.7'ye geçildiği andan itibaren oluşmaya başlar.

JSON dışa aktarma / içe aktarma işlemlerine grafik geçmişi de dahil edilmiştir.


## v1.8 — Gelişmiş grafik analizi

Dashboard grafik alanı genişletildi.

### Tarih aralığı filtreleri

Portföy Gelişimi ve Kâr/Zarar Gelişimi grafiklerinde:

- 1A
- 3A
- 6A
- 1Y
- Tümü

filtreleri kullanılabilir.

Filtreler portföy geçmişindeki mevcut günlük snapshot kayıtları üzerinde çalışır.

### Yeni grafik: Kâr / Zarar Gelişimi

Portföyün her günlük kaydında:

`portföy değeri - maliyet`

farkını zaman içinde gösterir.

Grafik pozitif bölgede yeşil, negatif bölgede kırmızı eğilim kullanır.

### Yeni grafik: Toplam Getiri Karşılaştırması

Portföydeki fon ve hisseleri mevcut ortalama maliyetlerine göre toplam getiri yüzdesiyle karşılaştırır.

Her varlık için:

`(güncel değer - kalan maliyet) / kalan maliyet * 100`

kullanılır.

### Günlük Performans

Mevcut günlük performans grafiği korunmuştur ve tooltip içerisinde günlük TL etkisi de gösterilir.

### Geriye dönük uyumluluk

V1.7 ile oluşturulmuş:

- varlıklar
- işlemler
- fiyatlar
- portföy geçmişi

aynen kullanılmaya devam eder.

Cloudflare Worker tarafında değişiklik yoktur.


## v1.9 — iPad/Safari grafik filtre düzeltmesi

Bu sürümde grafik filtrelerinin bazı iPad/Safari oturumlarında görünmesine rağmen tepki vermemesi problemi için kalıcı iyileştirmeler yapıldı.

### Cache busting

Frontend dosyaları artık sürüm parametresiyle yüklenir:

- `style.css?v=1.9.0`
- `app.js?v=1.9.0`

Böylece GitHub Pages aynı dosya adını kullansa bile Safari eski JavaScript/CSS önbelleğini kullanmaz.

### Daha sağlam tarih filtresi

`1A / 3A / 6A / 1Y / Tümü` butonları artık:

- event delegation
- click
- touchend fallback
- `touch-action: manipulation`

ile çalışır.

Bu yapı iPhone ve iPadOS Safari davranış farklılıklarına karşı daha dayanıklıdır.

### Aktif dönem bilgisi

Grafik alanında artık açık şekilde:

`Gösterilen dönem: 3 Ay · 24 kayıt`

gibi bir bilgi görünür.

Böylece butonun gerçekten aktif olup olmadığı ve filtre sonrası kaç günlük veri gösterildiği anında anlaşılır.

Cloudflare Worker tarafında değişiklik yoktur.


## v1.10 — Responsive Portföy Özeti

Portföy Özeti bölümü tablet ve telefonlarda yeniden tasarlandı.

### Masaüstü

1100 px ve üzerindeki ekranlarda mevcut tablo görünümü korunur. Geniş ekranda çok sayıda metriği yan yana karşılaştırmak için tablo en verimli görünüm olmaya devam eder.

### Tablet ve telefon

1100 px altındaki ekranlarda yatay kaydırmalı tablo artık gösterilmez. Her varlık ayrı, kompakt bir özet kartına dönüşür.

Kartlarda öne çıkarılan bilgiler:

- Varlık kodu ve türü
- Portföy değeri
- Toplam kâr / zarar (TL + %)
- Günlük değişim (TL + %)
- Adet
- Ortalama maliyet
- Güncel fiyat
- Önceki fiyat

Tabletlerde uygun olduğunda iki sütun, daha dar ekranlarda tek sütun kullanılır.

Bu düzen sayesinde Portföy Özeti bölümünde yatay kaydırma ihtiyacı ortadan kaldırılmıştır.

### Cache

Frontend dosyaları V1.10 için:

- `style.css?v=1.10.0`
- `app.js?v=1.10.0`

olarak yüklenir.

Cloudflare Worker tarafında değişiklik yoktur.


## v1.11 — Premium Wealth Theme

V1.11 ile uygulamanın görsel dili tamamen yenilendi.

### Yeni tasarım yaklaşımı

Arayüz artık klasik koyu finans terminali yerine özel bankacılık / wealth management uygulamalarına daha yakın bir görsel dile sahiptir.

- Açık krem / taş zemin
- Beyaz ve sıcak yüzey kartları
- Adaçayı yeşili ana vurgu
- Yumuşak altın tonlu ikincil detaylar
- Daha düşük kontrastlı, göz yormayan çerçeveler
- Hafif ve kontrollü gölgeler
- Daha geniş boşluk kullanımı
- Premium kart yüzeyleri

### Tipografi

Arayüzde iki font ailesi kullanılır:

- **Manrope** — başlıklar, rakamlar ve önemli finansal değerler
- **DM Sans** — gövde metinleri, açıklamalar ve kontroller

Fontlar Google Fonts üzerinden yüklenir ve sistem fontları fallback olarak korunur.

### Tema

Açık tema artık varsayılandır.

Koyu tema kaldırılmamıştır; daha sıcak, yeşilimsi grafit tonlarla yeniden tasarlanmıştır.

### Grafik paleti

Grafik renkleri yeni temaya uyacak şekilde:

- sage / adaçayı
- sıcak gri
- yumuşak altın
- mavi-gri
- doğal bej

tonlarına taşındı.

### Cache

Frontend:

- `style.css?v=1.11.0`
- `app.js?v=1.11.0`

olarak yüklenir.

Cloudflare Worker değişikliği yoktur.


## v1.12 — Sabit Sol Menü

Masaüstü ve tablet görünümünde sol navigasyon viewport'a sabitlenmiştir.

- Sayfa aşağı veya yukarı kaydırıldığında sidebar yerinde kalır.
- Yalnızca ana içerik bölümü kayar.
- Ana içerik sidebar genişliği kadar sağa offset alır.
- iPadOS / Safari için fixed-position stabilizasyonu eklenmiştir.
- Mobil görünümde mevcut alt sabit navigasyon korunur.

Frontend cache sürümü:

- `style.css?v=1.12.0`
- `app.js?v=1.12.0`

Cloudflare Worker tarafında değişiklik yoktur.


## v1.13 — Varlık Araştır

Portföye ekleme zorunluluğu olmadan fon ve BIST hisselerini incelemek için yeni **Varlık Araştır** ekranı eklendi.

Sol menüdeki **Varlık Araştır** bölümünden varlık türü ve kod seçilir.

### Fon araştırma

TEFAS fiyat geçmişinden hesaplanan metrikler:

- Son fiyat ve günlük değişim
- 1 hafta / 1 ay / 3 ay / 6 ay / 1 yıl getiri
- 52 haftalık en yüksek / düşük
- Zirveye uzaklık
- Yıllıklandırılmış oynaklık
- Maksimum düşüş (drawdown)
- Pozitif gün oranı
- Gözlem sayısı
- TEFAS cevabında mevcutsa fon büyüklüğü, yatırımcı sayısı ve risk değeri

### Hisse araştırma

TradingView BIST tarayıcı verisinden mevcut olduğu ölçüde:

- Son fiyat ve günlük değişim
- Hacim ve piyasa değeri
- F/K, PD/DD, EPS TTM
- Temettü verimi ve beta
- 1 hafta / 1 ay / 3 ay / 6 ay / 1 yıl performansı
- 52 haftalık yüksek / düşük
- RSI, SMA50 ve SMA200
- Teknik skor
- Sektör ve endüstri

Bir veri alanı sağlayıcı tarafından sunulmazsa arayüz `—` gösterir; araştırma ekranının geri kalanı çalışmaya devam eder.

### Yeni Worker endpoint'leri

- `/api/research/fund/TTE`
- `/api/research/stock/FROTO`

Bu sürümde **Cloudflare Worker kodunun da güncellenmesi gerekir.**


## v1.13.1 — Fon araştırma metrik düzeltmesi

Fon araştırma ekranındaki dönemsel getiri ve risk verileri düzeltildi.

### Sorunun nedeni

V1.13 araştırma endpoint'i `fonFiyatBilgiGetir` çağrısında `periyod: 13`
kullanıyordu. TEFAS 2026 API'sinde bu değer yaklaşık bir haftalık veri paketidir.
Bu nedenle 1 aylık ve 3 aylık getiriler yeterli tarihsel veri olmadan hesaplanıyordu.

### Düzeltme

Araştırma ekranı artık:

- `periyod: 12` ile yaklaşık 1 yıllık günlük fiyat geçmişi alır.
- 1A / 3A / 6A / 1Y getirilerini takvim ayı bazında hesaplar.
- Hedef tarih tatil veya hafta sonuna denk gelirse o tarihten önceki son işlem gününü kullanır.
- İstenen dönem kadar veri gerçekten yoksa yanlış sayı göstermek yerine `—` gösterir.

### Risk Değeri

Resmi TEFAS `1–7` Risk Değeri artık ayrıca:

`fonProfilBilgiGetir`

endpoint'inden `riskDegeri` alanıyla alınır.

Yıllıklandırılmış oynaklık, maksimum düşüş ve pozitif gün oranı da daha geniş
1 yıllık fiyat geçmişi üzerinden hesaplandığı için daha anlamlı hale gelmiştir.

Cloudflare Worker'ın güncellenmesi gerekir.


## v1.13.2 — Fon Büyüklüğü ve Yatırımcı Sayısı

Fon araştırma ekranındaki **Fon Büyüklüğü** bölümü tamamlandı.

Yeni yapı şu sırayla veri arar:

1. `fonProfilBilgiGetir` cevabındaki alanları esnek anahtar eşleştirmesiyle tarar.
2. Gerekirse fiyat/geçmiş cevabındaki aynı metrikleri kontrol eder.
3. API cevabında bulunamazsa resmi TEFAS fon detay sayfasındaki:
   - `Fon Toplam Değer (TL)`
   - `Yatırımcı Sayısı`
   alanlarını fallback olarak kullanır.

Bu yöntem TEFAS'ın alan isimlerinde küçük değişiklikler olsa bile kartların boş kalma
ihtimalini azaltır.

Cloudflare Worker'ın V1.13.2 ile güncellenmesi gerekir.


## Sürüm Senkronizasyonu — V1.13.3

Bu sürümden itibaren uygulamanın tüm parçaları aynı sürüm numarasını kullanır:

- Frontend: `V1.13.3`
- `app.js`: `APP_VERSION = "1.13.3"`
- CSS cache: `style.css?v=1.13.3`
- JS cache: `app.js?v=1.13.3`
- Cloudflare Worker `/health`: `version: "1.13.3"`

Bundan sonraki her sürümde frontend, Worker ve README birlikte aynı sürüme yükseltilecektir.


## V1.13.4 — Araştırma Kod Alanı

Varlık Araştır ekranındaki **Kod** giriş alanı (`#researchCode`) artık kullanıcı yazarken
otomatik olarak büyük harfe dönüştürülür.

Örnekler:

- `tte` → `TTE`
- `froto` → `FROTO`
- `thyao` → `THYAO`

Önceki yanlış V1.13.4 denemesindeki sonuç başlığı büyük harf değişikliği bu pakette yoktur.
Bu sürüm V1.13.3 tabanı üzerinden hazırlanmıştır.


## V1.13.5 — Araştırma Kod Kutusu Düzeltmesi

Varlık Araştır ekranındaki `Kod` alanı iPad/iPhone Safari dahil daha sağlam şekilde
büyük harfe dönüştürülür.

Üç katman kullanılır:

- HTML `oninput` ile gerçek input değeri anında büyük harfe çevrilir.
- JavaScript `input/change/paste` fallback'i aynı davranışı doğrular.
- CSS `text-transform: uppercase` görsel fallback sağlar.

Örnek:

`tte` → `TTE`
`froto` → `FROTO`
`thyao` → `THYAO`

Frontend, Worker ve README sürümleri `1.13.5` olarak senkronlanmıştır.


## V1.13.6 — TEFAS 520 Dayanıklılığı

TEFAS'ın zaman zaman döndürdüğü `HTTP 520` ve diğer geçici `5xx` hataları için
Cloudflare Worker veri katmanı güçlendirildi.

Yeni davranış:

- TEFAS isteği başarısız olursa otomatik olarak en fazla 3 kez tekrar denenir.
- Denemeler arasında kısa artan bekleme uygulanır.
- Başarılı TEFAS yanıtları Cloudflare Cache API'de saklanır.
- Üç deneme de başarısız olursa son başarılı veri 24 saate kadar fallback olarak kullanılabilir.
- `429` ve `5xx` durumları tekrar denenir.
- Kalıcı `4xx` hataları gereksiz yere tekrar denenmez.

Normal `/api/fund/...`, fon araştırma fiyat geçmişi ve genel fon metrikleri aynı
dayanıklı TEFAS erişim katmanını kullanır.

Frontend, Worker ve README sürümü `1.13.6` olarak senkronlanmıştır.


## V1.14 — Premium Fon Analizi

Varlık Araştır > Yatırım Fonu ekranı kapsamlı bir analiz terminaline dönüştürüldü.

### Yeni risk/getiri metrikleri
- Sharpe Oranı (risksiz faiz %0 varsayımı)
- Sortino Oranı
- Calmar Oranı
- Yıllıklandırılmış getiri
- Yıllıklandırılmış volatilite
- 30 günlük rolling volatilite
- 90 günlük rolling volatilite
- Maksimum drawdown
- Aşağı yönlü sapma
- Pozitif gün oranı
- En iyi gün / en kötü gün
- 52 hafta yüksek / düşük
- Zirveye uzaklık
- TEFAS Risk Değeri ve risk profili

### Yeni grafikler
- 1 yıllık birim pay fiyat gelişimi
- Drawdown grafiği
- 30 / 90 günlük rolling volatilite grafiği
- Dönemsel getiri bar grafiği korunmuştur

### Fon büyüklüğü
- Fon toplam değeri
- Yatırımcı sayısı
- Tedavüldeki pay sayısı
- Risk profili

Fon büyüklüğü metrikleri tarayıcıda son başarılı değer olarak ayrıca saklanır.
TEFAS geçici olarak boş döndürürse son başarılı değer gösterilmeye devam eder.

### KAP ücret/gider bilgileri
Bulunabildiğinde:
- Yıllık yönetim ücreti
- Fon toplam gider oranı
- Giriş komisyonu
- Çıkış komisyonu
- Performans ücreti

KAP sayfasında açık biçimde bulunamayan alanlar `—` gösterilir.

`Gözlem Sayısı` kartı kaldırılmıştır.


## V1.14.1 — Fon Büyüklüğü ve KAP Ücret Düzeltmesi

### Fon büyüklüğü
JavaScript'teki `Number(null) === 0` davranışı nedeniyle boş TEFAS metrikleri yanlışlıkla
`0` olarak gösterilebiliyordu.

Artık:
- `null`
- `undefined`
- boş string
- geçersiz sayı
- yanlışlıkla gelen 0

gerçek fon büyüklüğü/yatırımcı/pay verisi olarak kabul edilmez.

Son başarılı gerçek değer varsa localStorage fallback'i kullanılır; yoksa `—` gösterilir.

### KAP ücret/giderleri
Eski regex parser KAP sayfasındaki günlük yönetim oranı gibi ilk küçük sayıları yanlış sütunlara
eşleyebiliyordu.

Yeni parser:
- ilgili KAP yönetim ücreti tablosunu bulur,
- sütun başlıklarını tek tek eşler,
- yıllık yönetim ücreti,
- giriş komisyonu,
- çıkış komisyonu,
- performans ücreti
değerlerini kendi hücresinden okur.

Kesin eşleşmeyen alanlarda yanlış değer göstermek yerine `—` gösterilir.


## V1.14.2 — Daylight Wealth Theme

Gündüz kullanımı için açık tema belirgin şekilde aydınlatıldı.

Değişiklikler:

- Arka plan daha açık krem/beyaz tona taşındı.
- Kart yüzeyleri gerçek beyaza yaklaştırıldı.
- Sınırlar daha ince ve daha açık hale getirildi.
- Gölgeler hafifletildi.
- Input ve select alanları beyaz yüzeye taşındı.
- Araştırma kartları ve grafik panelleri daha ferah hale getirildi.
- Adaçayı yeşili ve altın premium vurgu renkleri korundu.
- Koyu tema değiştirilmeden ayrı seçenek olarak korunur.

Frontend, Worker ve README sürümü `1.14.2` olarak senkronlanmıştır.


## V1.14.3 — Sharpe / Sortino / Calmar Formül Düzeltmesi

Risk ayarlı getiri oranları standart dönemsel getiri yaklaşımına göre yeniden hesaplanmıştır.

### Sharpe
Eski sürümde kullanılan `CAGR / yıllık volatilite` yaklaşımı kaldırıldı.

Yeni formül:

`Sharpe = Ortalama Günlük Excess Getiri / Günlük Excess Getiri Standart Sapması × √252`

Risksiz faiz şu an `%0` varsayılır.

### Sortino
Downside deviation artık yalnızca negatif gün sayısına bölünmez.

Yeni yaklaşım:

`Downside = sqrt( mean( min(R - MAR, 0)^2 ) )`

Buradaki ortalama tüm gözlem dönemlerini kapsar.

Annualized Sortino:

`(Ortalama günlük excess getiri × 252) / (Günlük downside deviation × √252)`

MAR (minimum kabul edilebilir getiri) `%0` varsayılır.

### Calmar
Aynı 1 yıllık TEFAS fiyat serisi için:

`Calmar = CAGR / |Maximum Drawdown|`

kullanılır.

Kartların alt açıklamaları da kullanılan yöntemi gösterecek şekilde güncellenmiştir.


## V1.14.4 — Bağımsız Hesaplama Doğrulama Katmanı

Fon analizinde risk ayarlı getiri metrikleri artık iki ayrı implementasyonla doğrulanır.

Worker'ın hesapladığı:
- Sharpe
- Sortino
- Calmar
- CAGR
- Yıllık volatilite
- Maksimum drawdown

değerleri, Worker'dan gelen aynı TEFAS 1 yıllık fiyat serisi kullanılarak tarayıcıda
bağımsız JavaScript koduyla yeniden hesaplanır.

### Doğrulama ekranı

Varlık Araştır bölümüne `Hesaplama Doğrulama` paneli eklendi.

Her metrik için:
- Worker sonucu
- Tarayıcı sonucu
- Doğrulama durumu

yan yana gösterilir.

Tolerans:
- Sharpe / Sortino / Calmar: `0.005`
- Yüzde metrikleri: `0.02 yüzde puan`

Tüm sonuçlar tolerans içindeyse `Tüm hesaplamalar doğrulandı` gösterilir.

Panel ayrıca:
- başlangıç/bitiş tarihi
- fiyat noktası sayısı
- günlük getiri gözlemi sayısı
- yıllıklandırma faktörü
- risksiz faiz varsayımı
- Sortino MAR varsayımı

bilgilerini gösterir.

Bu yapı backend formül hatalarının frontend tarafından otomatik fark edilmesini sağlar.


## V1.15.0 — Fonoloji API Entegrasyonu

Cloudflare Worker artık `FONOLOJI_KEY` secret'ını kullanarak resmi Fonoloji REST API'sindeki
`GET /v1/funds/:code` endpoint'ine bağlanır.

Ana kaynak olarak Fonoloji'den:
- Sharpe 90G
- Sortino 90G
- Calmar 1Y
- Beta 1Y
- Max Drawdown 1Y
- 90G volatilite
- 1Y reel getiri
- AUM / fon toplam değeri
- yatırımcı sayısı
- risk skoru
- kategori, yönetim şirketi, ISIN ve valör bilgileri

alınır.

TEFAS fiyat geçmişi ve grafik altyapısı korunur. Fonoloji erişilemezse mevcut yerel hesaplama
motoru Sharpe / Sortino / Calmar / drawdown / volatilite için fallback olarak çalışır.

Fonoloji oranları kendi dönem/metodolojisine sahip olduğundan eski doğrulama paneli artık
sağlayıcı değerini yerel referansla kıyaslayan bir kontrol ekranı olarak değerlendirilir.


## V1.15.1 — Fonoloji Tanı Endpoint'i

Fonoloji entegrasyonu için güvenli teşhis endpoint'i eklendi:

`GET /api/fonoloji-test/{FON_KODU}`

Örnek:

`/api/fonoloji-test/TTE`

API anahtarı hiçbir zaman döndürülmez. Endpoint yalnızca anahtarın Worker ortamında bulunup
bulunmadığını, HTTP durumunu, entegrasyon statüsünü, fon bilgisini, örnek metrikleri ve hata
durumunda kısa bir preview gösterir.

Olası statüler:
- `OK`
- `NO_KEY`
- `API_KEY_INVALID`
- `ACCOUNT_FORBIDDEN`
- `FUND_NOT_FOUND`
- `QUOTA_EXCEEDED`
- `FONOLOJI_SERVER_ERROR`
- `NETWORK_ERROR`
