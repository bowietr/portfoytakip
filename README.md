# 📊 Portföyüm

**Portföyüm**, yatırım fonları ve Borsa İstanbul hisselerini tek bir yerden takip etmek için geliştirilmiş, sade ve mobil uyumlu bir portföy takip uygulamasıdır.

Fon ağırlıklı yatırım yapan ancak aynı zamanda hisse senetlerini de portföyünde bulunduran yatırımcılar düşünülerek tasarlanmıştır.

Uygulama tamamen tarayıcı üzerinden çalışır ve üyelik gerektirmez.

---

## ✨ Özellikler

### 📈 Portföy Takibi

- Yatırım fonu ekleme
- BIST hisse senedi ekleme
- Aynı varlığa birden fazla alış yapabilme
- Parçalı satış / portföyden azaltma
- Otomatik ortalama maliyet hesaplama
- Güncel portföy değeri
- Toplam yatırılan ana para
- Toplam kâr / zarar
- Kâr / zarar yüzdesi

---

### 🏦 TEFAS Fon Entegrasyonu

Yatırım fonlarının fiyatları **TEFAS** üzerinden otomatik olarak alınır.

Fon kodunun girilmesi yeterlidir.

Örneğin:

- TTE
- AFT
- IPB
- BIO

Fon fiyatı güncellendiğinde uygulama otomatik olarak:

- Güncel fon fiyatını
- Önceki fiyatı
- Günlük TL değişimini
- Günlük yüzde değişimini
- Portföydeki güncel değerini
- Toplam kâr / zararını

hesaplar.

---

### 🇹🇷 Borsa İstanbul Hisseleri

BIST hisseleri de portföye eklenebilir.

Örneğin:

- THYAO
- FROTO
- ASELS
- TUPRS
- GARAN

Hisse koduna `.IS` veya `BIST:` gibi ekler yazmaya gerek yoktur.

Uygulama sembolü otomatik olarak işler.

Hisse verileri gecikmeli piyasa verisi üzerinden alınır.

> Bu proje bir işlem terminali değildir. Öncelik gerçek zamanlı fiyat yerine portföy takibinde kullanılabilecek doğru ve tutarlı fiyat verisidir.

---

## 📊 Günlük Performans

Her varlığın günlük performansı ayrı ayrı görüntülenebilir.

Örneğin:

**FROTO**

Son fiyat: `78,85 TL`

Önceki kapanış: `77,40 TL`

Günlük değişim:

`+1,45 TL / +%1,87`

Bunun yanında portföydeki bütün varlıkların günlük hareketleri birleştirilerek **toplam günlük portföy değişimi** hesaplanır.

---

## 💰 Parçalı Alım ve Satış

Bir fon veya hisse portföye yalnızca bir kez tanımlanır.

Sonrasında aynı varlığa istediğiniz kadar işlem ekleyebilirsiniz.

Örneğin:

| İşlem | Adet | Fiyat |
|---|---:|---:|
| Alış | 100 | 50 TL |
| Alış | 50 | 55 TL |
| Alış | 75 | 52 TL |
| Satış | 25 | 60 TL |

Uygulama kalan pozisyonu ve ortalama maliyeti otomatik olarak hesaplar.

Bu sayede düzenli yatırım yapan kullanıcıların her ay aynı fonu tekrar oluşturmasına gerek kalmaz.

---

## 📉 Portföy Dağılımı

Ana panel üzerinden portföyün hangi varlıklardan oluştuğu grafik olarak görüntülenebilir.

Böylece:

- Fon / hisse ağırlığı
- En büyük pozisyonlar
- Her varlığın portföy içerisindeki oranı

kolayca takip edilebilir.

---

## 🌑 Tasarım

Arayüz özellikle uzun süre kullanım düşünülerek sade tutulmuştur.

- Füme / grafit renk paleti
- Koyu tema
- Açık tema
- Mobil uyumlu tasarım
- Tablet desteği
- Masaüstü desteği
- Finans uygulaması tarzında dashboard

Telefon üzerinden de rahatlıkla kullanılabilir.

---

## 💾 Veriler Nerede Saklanıyor?

Bu sürümde üyelik sistemi bulunmamaktadır.

Portföy ve işlem bilgileri tarayıcının:

`localStorage`

alanında saklanır.

Bu nedenle veriler sunucuya gönderilmez.

### ⚠️ Önemli

Tarayıcı verilerinin temizlenmesi portföy kayıtlarının da silinmesine neden olabilir.

Bu nedenle uygulamada:

**JSON Dışa Aktar**

özelliği bulunmaktadır.

Portföy yedeği daha sonra:

**JSON İçe Aktar**

ile tekrar yüklenebilir.

---

## 🏗️ Proje Yapısı

```text
portfoyum/
│
├── index.html
│
├── assets/
│   ├── app.js
│   └── style.css
│
├── worker/
│   ├── worker.js
│   └── wrangler.toml
│
└── README.md
