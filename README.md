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
