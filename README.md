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
