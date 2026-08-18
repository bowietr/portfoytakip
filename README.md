# Portföyüm Terminal

Portföyüm Terminal; yatırım fonlarını araştırmak, portföyü takip etmek ve yatırım verilerini tek ekranda incelemek için geliştirilmiş kişisel yatırım terminalidir.

## Yayın mimarisi

Son kullanıcı Worker adresi veya Fonoloji API anahtarı girmez.

`Uygulama → Portföyüm Worker → Fonoloji / TEFAS`

Uygulama sahibi yalnızca bir kez `config.js` içindeki `apiBase` değerini kendi Cloudflare Worker adresiyle değiştirir. `FONOLOJI_KEY` frontend'e yazılmaz; Cloudflare Secret olarak kalır.

Worker tarafında response cache, Fonoloji cache + stale fallback, rate limiting ve opsiyonel origin allowlist bulunur.

> Bu uygulamadaki bilgiler yatırım tavsiyesi değildir.
