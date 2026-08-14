/**
 * Portföyüm - TEFAS Proxy
 * Cloudflare Workers için.
 *
 * Routes:
 *   GET /api/fund/TTE
 *   GET /api/stock/THYAO
 *
 * TEFAS 2026 API:
 *   POST https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir
 */

const TEFAS_URL = "https://www.tefas.gov.tr/api/funds/fonFiyatBilgiGetir";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "portfoyum-market-proxy", version: "1.15.1" });
    }

    const fonolojiTestMatch = url.pathname.match(/^\/api\/fonoloji-test\/([A-Za-z0-9._-]+)$/);
    if (fonolojiTestMatch) {
      const testCode = fonolojiTestMatch[1].trim().toUpperCase().replace(/\.IS$/, "");
      if (!/^[A-Z0-9]{2,12}$/.test(testCode)) {
        return json({ ok:false, error:"Geçersiz fon kodu." }, 400);
      }
      return await handleFonolojiTest(testCode, env);
    }

    const researchMatch = url.pathname.match(/^\/api\/research\/(fund|stock)\/([A-Za-z0-9._-]+)$/);
    if (researchMatch) {
      const type = researchMatch[1];
      const researchCode = researchMatch[2].trim().toUpperCase().replace(/\.IS$/, "");
      if (!/^[A-Z0-9]{2,12}$/.test(researchCode)) return json({ok:false,error:"Geçersiz varlık kodu."},400);
      return type === "fund" ? await handleFundResearch(researchCode) : await handleStockResearch(researchCode);
    }

    const stockMatch = url.pathname.match(/^\/api\/stock\/([A-Za-z0-9._-]+)$/);
    if (stockMatch) {
      const stockCode = stockMatch[1].trim().toUpperCase().replace(/\.IS$/, "");
      if (!/^[A-Z0-9]{2,12}$/.test(stockCode)) {
        return json({ ok:false, error:"Geçersiz hisse kodu." }, 400);
      }
      return await handleStock(stockCode, env);
    }

    const match = url.pathname.match(/^\/api\/fund\/([A-Za-z0-9_-]+)$/);
    if (!match) return json({ ok:false, error:"Endpoint bulunamadı." }, 404);

    const code = match[1].trim().toUpperCase();
    if (!/^[A-Z0-9]{2,12}$/.test(code)) {
      return json({ ok:false, error:"Geçersiz fon kodu." }, 400);
    }

    try {
      const tefasResult = await fetchTefasWithRetry("fonFiyatBilgiGetir", {
        fonKodu: code,
        dil: "TR",
        periyod: 13
      }, {
        attempts: 3,
        cacheTtl: 1800,
        staleMaxAge: 86400
      });

      const normalized = normalizeTefas(tefasResult.data, code);
      if (!normalized) {
        return json({ ok:false, error:"TEFAS yanıtında fiyat verisi bulunamadı.", rawShape: describeShape(tefasResult.data) }, 502);
      }

      return json({
        ok:true,
        ...normalized,
        stale: !!tefasResult.stale,
        staleAgeSeconds: tefasResult.staleAgeSeconds ?? null,
        attemptsUsed: tefasResult.attemptsUsed ?? 1
      });
    } catch (err) {
      return json({ ok:false, error:String(err?.message || err) }, 502);
    }
  }
};



function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function tefasCacheRequest(endpoint, payload) {
  const code = String(payload?.fonKodu || "GENEL").toUpperCase();
  const period = String(payload?.periyod ?? "");
  const start = String(payload?.basTarih ?? "");
  const end = String(payload?.bitTarih ?? "");
  const url = `https://cache.portfoyum.local/tefas/${encodeURIComponent(endpoint)}/${encodeURIComponent(code)}?p=${encodeURIComponent(period)}&s=${encodeURIComponent(start)}&e=${encodeURIComponent(end)}`;
  return new Request(url, { method: "GET" });
}

async function fetchTefasWithRetry(endpoint, payload, options = {}) {
  const {
    attempts = 3,
    cacheTtl = 3600,
    staleMaxAge = 86400
  } = options;

  const url = `https://www.tefas.gov.tr/api/funds/${endpoint}`;
  const cache = caches.default;
  const cacheRequest = tefasCacheRequest(endpoint, payload);

  let lastStatus = 0;
  let lastText = "";
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0",
          "Origin": "https://www.tefas.gov.tr",
          "Referer": "https://www.tefas.gov.tr/",
          "Cache-Control": "no-cache"
        },
        body: JSON.stringify(payload)
      });

      lastStatus = upstream.status;
      lastText = await upstream.text();

      if (upstream.ok) {
        let data;
        try {
          data = JSON.parse(lastText);
        } catch {
          throw new Error(`TEFAS ${endpoint} geçersiz JSON döndürdü.`);
        }

        if (data && typeof data === "object" && data.errorMessage) {
          throw new Error(`TEFAS ${endpoint}: ${data.errorMessage}`);
        }

        // Son başarılı yanıtı Cloudflare Cache API'de sakla.
        const cacheResponse = new Response(JSON.stringify({
          cachedAt: Date.now(),
          data
        }), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": `public, max-age=${cacheTtl}`
          }
        });

        // Cache yazımı ana yanıtı geciktirmesin.
        await cache.put(cacheRequest, cacheResponse.clone());

        return {
          data,
          stale: false,
          sourceStatus: upstream.status,
          attemptsUsed: attempt
        };
      }

      // 4xx çoğunlukla kalıcı isteğe bağlı hatadır; 429 ve 5xx tekrar denenir.
      const retryable = upstream.status === 429 || upstream.status >= 500;
      if (!retryable) break;

    } catch (err) {
      lastError = err;
    }

    if (attempt < attempts) {
      // 350ms, 800ms gibi kısa artan bekleme.
      await sleep(250 + attempt * 300);
    }
  }

  // TEFAS hâlâ yanıt vermiyorsa son başarılı cache'i kullan.
  try {
    const cached = await cache.match(cacheRequest);
    if (cached) {
      const wrapped = await cached.json();
      const ageSeconds = Math.max(0, (Date.now() - Number(wrapped?.cachedAt || 0)) / 1000);

      if (wrapped?.data && ageSeconds <= staleMaxAge) {
        return {
          data: wrapped.data,
          stale: true,
          staleAgeSeconds: Math.round(ageSeconds),
          sourceStatus: lastStatus || null,
          attemptsUsed: attempts
        };
      }
    }
  } catch {}

  const suffix = lastStatus ? ` HTTP ${lastStatus}` : "";
  throw new Error(
    lastError?.message ||
    `TEFAS ${endpoint}${suffix}${lastText ? `: ${lastText.slice(0,120)}` : ""}`
  );
}

async function fetchTefasEndpoint(endpoint, payload) {
  const result = await fetchTefasWithRetry(endpoint, payload, {
    attempts: 3,
    cacheTtl: endpoint === "fonFiyatBilgiGetir" ? 1800 : 3600,
    staleMaxAge: 86400
  });
  return result.data;
}

async function fetchTefasPayload(code, periyod = 13) {
  return fetchTefasEndpoint("fonFiyatBilgiGetir", {
    fonKodu: code,
    dil: "TR",
    periyod
  });
}

async function fetchTefasProfile(code) {
  try {
    return await fetchTefasEndpoint("fonProfilBilgiGetir", {
      fonKodu: code,
      dil: "TR"
    });
  } catch {
    // Profil endpoint'i geçici sorun yaşarsa araştırma ekranı tamamen kırılmasın.
    return null;
  }
}

function tefasHistory(payload) {
  const rows = collectRows(payload), map = new Map();

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const price = firstNumber(row, [
      "fiyat","Fiyat","price","Price","birimPayDegeri","birimPayDeğeri",
      "fonFiyati","fonFiyat","nav","close","value"
    ]);

    const date = parseDate(firstValue(row, [
      "tarih","Tarih","date","Date","islemTarihi","fiyatTarihi","priceDate"
    ]));

    if (!(price > 0) || !date) continue;

    const key = date.slice(0, 10);
    const name = firstValue(row, [
      "fonUnvan","fonUnvani","FonUnvan","fundName","name","FonAdi","fonAdi"
    ]);

    map.set(key, {
      date,
      price,
      name: typeof name === "string" ? name : ""
    });
  }

  return [...map.values()].sort((a,b) => new Date(a.date) - new Date(b.date));
}

function shiftCalendarMonths(isoDate, months) {
  const d = new Date(isoDate);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth() - months,
    1,
    12, 0, 0
  ));

  const lastDay = new Date(Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth() + 1,
    0,
    12, 0, 0
  )).getUTCDate();

  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

function priceOnOrBefore(hist, targetDate) {
  const target = targetDate.getTime();
  let candidate = null;

  for (const p of hist) {
    const t = new Date(p.date).getTime();
    if (t <= target) candidate = p;
    else break;
  }

  return candidate;
}

function returnFromMonths(hist, months) {
  if (hist.length < 2) return null;

  const last = hist.at(-1);
  const target = shiftCalendarMonths(last.date, months);
  const base = priceOnOrBefore(hist, target);

  if (!base || !(base.price > 0) || base.date === last.date) return null;
  return (last.price / base.price - 1) * 100;
}

function returnFromDaysStrict(hist, days) {
  if (hist.length < 2) return null;

  const last = hist.at(-1);
  const target = new Date(new Date(last.date).getTime() - days * 86400000);
  const base = priceOnOrBefore(hist, target);

  // İstenen dönem kadar geçmiş gerçekten yoksa yanlış bir sayı üretme.
  if (!base || !(base.price > 0) || base.date === last.date) return null;

  const actualDays = (new Date(last.date) - new Date(base.date)) / 86400000;
  if (actualDays < days * 0.70) return null;

  return (last.price / base.price - 1) * 100;
}

function stdev(arr) {
  if (arr.length < 2) return null;
  const m = arr.reduce((a,b) => a+b, 0) / arr.length;
  return Math.sqrt(arr.reduce((a,b) => a + (b-m)**2, 0) / (arr.length - 1));
}

function maxDrawdown(hist) {
  let peak = -Infinity, max = 0;
  for (const p of hist) {
    peak = Math.max(peak, p.price);
    if (peak > 0) max = Math.min(max, (p.price / peak - 1) * 100);
  }
  return max;
}

function deepFindValue(payload, keys) {
  let found = null;
  const lower = keys.map(k => k.toLocaleLowerCase("tr-TR"));

  function walk(v, d=0) {
    if (d > 8 || found !== null || v == null) return;

    if (Array.isArray(v)) {
      for (const x of v) walk(x, d+1);
      return;
    }

    if (typeof v !== "object") return;

    for (const [k,val] of Object.entries(v)) {
      if (lower.includes(k.toLocaleLowerCase("tr-TR")) && val !== null && val !== "") {
        found = val;
        return;
      }
    }

    for (const x of Object.values(v)) walk(x, d+1);
  }

  walk(payload);
  return found;
}

function validRiskValue(v) {
  const n = toNumber(v);
  return Number.isFinite(n) && n >= 1 && n <= 7 ? n : null;
}


function normalizeMetricKey(s) {
  return String(s ?? "")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]/g, "");
}

function deepFindNumberByKeyTokens(payload, tokenGroups) {
  let found = null;

  function walk(v, depth=0) {
    if (depth > 10 || found !== null || v == null) return;

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }

    if (typeof v !== "object") return;

    for (const [key, value] of Object.entries(v)) {
      const nk = normalizeMetricKey(key);

      const matched = tokenGroups.some(group =>
        group.every(token => nk.includes(normalizeMetricKey(token)))
      );

      if (matched) {
        const n = toNumber(value);
        if (Number.isFinite(n)) {
          found = n;
          return;
        }

        // Bazı TEFAS cevaplarında değer bir alt objenin içinde olabilir.
        if (value && typeof value === "object") {
          const nested = deepFirstNumber(value);
          if (Number.isFinite(nested)) {
            found = nested;
            return;
          }
        }
      }
    }

    for (const value of Object.values(v)) walk(value, depth + 1);
  }

  walk(payload);
  return found;
}

function deepFirstNumber(payload) {
  let found = null;

  function walk(v, depth=0) {
    if (depth > 6 || found !== null || v == null) return;

    const n = toNumber(v);
    if (Number.isFinite(n)) {
      found = n;
      return;
    }

    if (Array.isArray(v)) {
      for (const item of v) walk(item, depth + 1);
      return;
    }

    if (typeof v === "object") {
      for (const value of Object.values(v)) walk(value, depth + 1);
    }
  }

  walk(payload);
  return found;
}

function decodeBasicHtmlEntities(s) {
  return String(s ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&ccedil;/gi, "ç")
    .replace(/&Ccedil;/g, "Ç")
    .replace(/&uuml;/gi, "ü")
    .replace(/&Uuml;/g, "Ü")
    .replace(/&ouml;/gi, "ö")
    .replace(/&Ouml;/g, "Ö")
    .replace(/&scedil;/gi, "ş")
    .replace(/&Scedil;/g, "Ş")
    .replace(/&gbreve;/gi, "ğ")
    .replace(/&Gbreve;/g, "Ğ")
    .replace(/&Idot;/g, "İ")
    .replace(/&#305;/g, "ı");
}

function parseTurkishMetricNumber(raw) {
  if (raw == null) return null;

  let s = String(raw)
    .replace(/\u00a0/g, " ")
    .replace(/[^\d.,-]/g, "")
    .trim();

  if (!s) return null;

  // 4.661.510.816,15 -> 4661510816.15
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    s = s.replace(",", ".");
  } else if ((s.match(/\./g) || []).length > 1) {
    s = s.replace(/\./g, "");
  }

  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

async function fetchTefasDetailMetrics(code) {
  try {
    const url = `https://www.tefas.gov.tr/tr/fon-detayli-analiz/${encodeURIComponent(code)}`;
    const response = await fetch(url, {
      headers: {
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0",
        "Referer": "https://www.tefas.gov.tr/"
      }
    });

    if (!response.ok) return {};

    const html = await response.text();

    // Önce görünür metne dönüştür.
    const text = decodeBasicHtmlEntities(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    ).replace(/\s+/g, " ").trim();

    const result = {};

    // TEFAS resmi detay sayfasındaki etiketler:
    // "Fon Toplam Değer (TL)" ve "Yatırımcı Sayısı"
    const totalPatterns = [
      /Fon\s+Toplam\s+Değer(?:i)?\s*\(TL\)\s*[:\-]?\s*([\d.\s,]+)/i,
      /Fon\s+Toplam\s+Değer(?:i)?\s*[:\-]?\s*([\d.\s,]+)/i
    ];

    const investorPatterns = [
      /Yatırımcı\s+Sayısı\s*[:\-]?\s*([\d.\s]+)/i,
      /Yatirimci\s+Sayisi\s*[:\-]?\s*([\d.\s]+)/i
    ];

    for (const p of totalPatterns) {
      const m = text.match(p);
      if (m) {
        const n = parseTurkishMetricNumber(m[1]);
        if (Number.isFinite(n)) {
          result.fundTotalValue = n;
          break;
        }
      }
    }

    for (const p of investorPatterns) {
      const m = text.match(p);
      if (m) {
        const n = parseTurkishMetricNumber(m[1]);
        if (Number.isFinite(n)) {
          result.investorCount = Math.round(n);
          break;
        }
      }
    }

    return result;
  } catch {
    return {};
  }
}


function ymdInIstanbul(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const m = {};
  for (const p of parts) if (p.type !== "literal") m[p.type] = p.value;
  return `${m.year}${m.month}${m.day}`;
}

async function fetchTefasGeneralMetrics(code) {
  // TEFAS 2026: kişi sayısı ve portföy büyüklüğü fonFiyatBilgiGetir'de yok.
  // Doğru kaynak fonGnlBlgSiraliGetir:
  //   kisiSayisi
  //   portfoyBuyukluk
  //
  // Son birkaç günü isteriz; hafta sonu/tatil durumunda son mevcut satırı seçeriz.
  const end = new Date();
  const start = new Date(end.getTime() - 12 * 86400000);

  const endApi = ymdInIstanbul(end);
  const startApi = ymdInIstanbul(start);

  const endpoint = "https://www.tefas.gov.tr/api/funds/fonGnlBlgSiraliGetir";
  const portal = `https://www.tefas.gov.tr/tr/fon-verileri?fundType=YAT&startDate=${startApi.slice(0,4)}-${startApi.slice(4,6)}-${startApi.slice(6,8)}&endDate=${endApi.slice(0,4)}-${endApi.slice(4,6)}-${endApi.slice(6,8)}`;

  const payload = {
    fonTipi: "YAT",
    fonKodu: code,
    aramaMetni: null,
    fonTurKod: null,
    fonGrubu: null,
    sfonTurKod: null,
    basTarih: startApi,
    bitTarih: endApi,
    basSira: 1,
    bitSira: 100,
    fonTurAciklama: null,
    dil: "TR",
    kurucuKod: null
  };

  const resilient = await fetchTefasWithRetry("fonGnlBlgSiraliGetir", payload, {
    attempts: 3,
    cacheTtl: 3600,
    staleMaxAge: 86400
  });
  const body = resilient.data;

  let rows = [];
  for (const key of ["resultList","data","Data","result","Result","rows","items"]) {
    if (Array.isArray(body?.[key])) {
      rows = body[key];
      break;
    }
  }
  if (!rows.length && Array.isArray(body)) rows = body;

  const normalizedCode = String(code).toUpperCase();
  rows = rows.filter(r => {
    const c = String(
      r?.fonKodu ?? r?.FONKODU ?? r?.fon_kodu ?? r?.fundCode ?? ""
    ).toUpperCase();
    return !c || c === normalizedCode;
  });

  if (!rows.length) return {};

  const getDate = r => {
    const raw = r?.tarih ?? r?.TARIH ?? r?.date ?? r?.Date;
    if (typeof raw === "number") return raw;
    const d = parseDate(raw);
    return d ? new Date(d).getTime() : 0;
  };

  rows.sort((a,b) => getDate(a) - getDate(b));
  const row = rows.at(-1);

  const fundTotalValue = nullablePositiveNumber(
    row?.portfoyBuyukluk ??
    row?.PORTFOYBUYUKLUK ??
    row?.portföyBuyukluk ??
    row?.portfolioSize
  );

  const investorCount = nullablePositiveNumber(
    row?.kisiSayisi ??
    row?.KISISAYISI ??
    row?.yatirimciSayisi ??
    row?.investorCount
  );

  const shareCount = nullablePositiveNumber(
    row?.tedPaySayisi ??
    row?.TEDPAYSAYISI ??
    row?.tedavuldekiPaySayisi
  );

  return { fundTotalValue, investorCount, shareCount };
}


function annualizedReturnPct(hist) {
  if (!Array.isArray(hist) || hist.length < 2) return null;
  const first = hist[0], last = hist.at(-1);
  if (!(first.price > 0) || !(last.price > 0)) return null;
  const days = Math.max(1, (new Date(last.date) - new Date(first.date)) / 86400000);
  const years = days / 365.25;
  if (!(years > 0)) return null;
  return (Math.pow(last.price / first.price, 1 / years) - 1) * 100;
}

function dailyReturns(hist) {
  const out = [];
  for (let i = 1; i < hist.length; i++) {
    const prev = Number(hist[i-1].price), cur = Number(hist[i].price);
    if (prev > 0 && cur > 0) {
      const r = cur / prev - 1;
      if (Number.isFinite(r)) out.push({ date: hist[i].date, value: r });
    }
  }
  return out;
}

function arithmeticMean(values) {
  const vals = values.filter(Number.isFinite);
  if (!vals.length) return null;
  return vals.reduce((a,b) => a+b, 0) / vals.length;
}

function downsideDeviationAnnualPct(returns, targetDaily = 0) {
  // Sortino downside deviation:
  // sqrt( mean( min(Rt - MAR, 0)^2 ) ) * sqrt(252)
  // Önemli: payda yalnızca negatif gün sayısı değil, TÜM dönem sayısıdır.
  const vals = returns.map(x => x.value).filter(Number.isFinite);
  if (!vals.length) return null;

  const downsideSquares = vals.map(r => {
    const diff = r - targetDaily;
    return diff < 0 ? diff * diff : 0;
  });

  const meanSq = downsideSquares.reduce((a,b) => a+b, 0) / downsideSquares.length;
  return Math.sqrt(meanSq) * Math.sqrt(252) * 100;
}

function sharpeRatioFromDailyReturns(returns, riskFreeAnnualPct = 0) {
  // Annualized Sharpe = mean(daily excess return) / sd(daily excess return) * sqrt(252)
  const vals = returns.map(x => x.value).filter(Number.isFinite);
  if (vals.length < 2) return null;

  const rfDaily = Math.pow(1 + riskFreeAnnualPct / 100, 1 / 252) - 1;
  const excess = vals.map(r => r - rfDaily);
  const avg = arithmeticMean(excess);
  const sd = stdev(excess);

  if (!Number.isFinite(avg) || !(sd > 0)) return null;
  return (avg / sd) * Math.sqrt(252);
}

function sortinoRatioFromDailyReturns(returns, targetAnnualPct = 0) {
  // Annualized arithmetic Sortino:
  // annualized average excess return / annualized downside deviation.
  const vals = returns.map(x => x.value).filter(Number.isFinite);
  if (!vals.length) return null;

  const targetDaily = Math.pow(1 + targetAnnualPct / 100, 1 / 252) - 1;
  const excess = vals.map(r => r - targetDaily);
  const avgExcess = arithmeticMean(excess);
  if (!Number.isFinite(avgExcess)) return null;

  const downsideSquares = excess.map(x => x < 0 ? x*x : 0);
  const downsideDaily = Math.sqrt(
    downsideSquares.reduce((a,b) => a+b, 0) / downsideSquares.length
  );

  if (!(downsideDaily > 0)) return null;

  const annualizedArithmeticExcess = avgExcess * 252;
  const annualizedDownside = downsideDaily * Math.sqrt(252);
  return annualizedArithmeticExcess / annualizedDownside;
}

function calmarRatioFromHistory(hist, maxDrawdownPct) {
  // Calmar = CAGR / |Maximum Drawdown|
  // Aynı fiyat geçmişi dönemi kullanılır.
  const cagrPct = annualizedReturnPct(hist);
  if (!Number.isFinite(cagrPct) || !Number.isFinite(maxDrawdownPct) || !(Math.abs(maxDrawdownPct) > 0)) {
    return null;
  }
  return cagrPct / Math.abs(maxDrawdownPct);
}

function rollingVolatilitySeries(hist, windowSize) {
  const rets = dailyReturns(hist);
  const out = [];
  for (let i = windowSize - 1; i < rets.length; i++) {
    const slice = rets.slice(i-windowSize+1, i+1).map(x => x.value);
    const sd = stdev(slice);
    if (Number.isFinite(sd)) {
      out.push({
        date: rets[i].date,
        value: sd * Math.sqrt(252) * 100
      });
    }
  }
  return out;
}

function drawdownSeries(hist) {
  let peak = -Infinity;
  return hist.map(p => {
    peak = Math.max(peak, p.price);
    return {
      date: p.date,
      value: peak > 0 ? (p.price / peak - 1) * 100 : 0
    };
  });
}

function bestWorstDay(returns) {
  if (!returns.length) return { best:null, worst:null };
  let best = returns[0], worst = returns[0];
  for (const r of returns) {
    if (r.value > best.value) best = r;
    if (r.value < worst.value) worst = r;
  }
  return {
    best: { date: best.date, value: best.value * 100 },
    worst: { date: worst.date, value: worst.value * 100 }
  };
}


function nullablePositiveNumber(v, { allowZero=false } = {}) {
  if (v === null || v === undefined || v === "") return null;
  const n = toNumber(v);
  if (!Number.isFinite(n)) return null;
  if (!allowZero && n === 0) return null;
  return n;
}

function riskLabel(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n <= 2) return "Düşük";
  if (n <= 4) return "Orta";
  if (n <= 6) return "Yüksek";
  return "Çok Yüksek";
}

function slugifyKapTr(value) {
  return String(value || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g,"i").replace(/ğ/g,"g").replace(/ü/g,"u")
    .replace(/ş/g,"s").replace(/ö/g,"o").replace(/ç/g,"c")
    .replace(/[^a-z0-9]+/g,"-")
    .replace(/^-+|-+$/g,"");
}

function parseKapNumberCell(s) {
  const t = String(s ?? "").replace(/\s+/g," ").trim();
  if (!t) return null;
  const m = t.match(/^-?\d+(?:[.,]\d+)?$/);
  if (!m) return null;
  return parseTurkishMetricNumber(m[0]);
}

function stripHtmlToCells(rowHtml) {
  const cells = [];
  const re = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
  let m;
  while ((m = re.exec(rowHtml))) {
    const text = decodeBasicHtmlEntities(
      m[1]
        .replace(/<br\s*\/?>/gi," ")
        .replace(/<[^>]+>/g," ")
    ).replace(/\s+/g," ").trim();
    cells.push(text);
  }
  return cells;
}

function findKapFeeTable(html) {
  // Yönetim ücreti tablosunu başlık metninden bulup ilk veri satırını döndürür.
  const tableMatches = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  for (const table of tableMatches) {
    const plain = decodeBasicHtmlEntities(table.replace(/<[^>]+>/g," ")).replace(/\s+/g," ");
    if (!/Yönetim Ücreti Oranı \(Yıllık\) \(%\)/i.test(plain)) continue;
    if (!/Giriş Komisyonu \(%\)/i.test(plain)) continue;
    if (!/Çıkış Komisyonu \(%\)/i.test(plain)) continue;

    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    if (rows.length < 2) continue;

    const headerCells = stripHtmlToCells(rows[0]);
    const headers = headerCells.map(normalizeMetricKey);

    const findHeaderIndex = tokenGroups => headers.findIndex(h =>
      tokenGroups.some(group => group.every(token => h.includes(normalizeMetricKey(token))))
    );

    const annualIdx = findHeaderIndex([
      ["yonetim","ucreti","orani","yillik"],
    ]);
    const entryIdx = findHeaderIndex([["giris","komisyonu"]]);
    const exitIdx = findHeaderIndex([["cikis","komisyonu"]]);
    const perfIdx = findHeaderIndex([["performans","ucreti","orani"]]);

    for (let i=1;i<rows.length;i++) {
      const cells=stripHtmlToCells(rows[i]);
      if (!cells.length) continue;

      const annual = annualIdx >= 0 ? parseKapNumberCell(cells[annualIdx]) : null;
      const entry = entryIdx >= 0 ? parseKapNumberCell(cells[entryIdx]) : null;
      const exit = exitIdx >= 0 ? parseKapNumberCell(cells[exitIdx]) : null;
      const perf = perfIdx >= 0 ? parseKapNumberCell(cells[perfIdx]) : null;

      // En az yıllık yönetim oranı veya komisyon alanlarından biri doğrulanmış olmalı.
      if ([annual,entry,exit,perf].some(v => Number.isFinite(v))) {
        return {
          annualManagementFeePct: Number.isFinite(annual) ? annual : null,
          entryCommissionPct: Number.isFinite(entry) ? entry : null,
          exitCommissionPct: Number.isFinite(exit) ? exit : null,
          performanceFeePct: Number.isFinite(perf) ? perf : null
        };
      }
    }
  }
  return {};
}

async function fetchKapFundFees(code, fundName) {
  try {
    const slug = `${String(code).toLocaleLowerCase("tr-TR")}-${slugifyKapTr(fundName)}`;
    const url = `https://www.kap.org.tr/tr/fon-bilgileri/genel/${encodeURIComponent(slug)}`;
    const r = await fetch(url, {
      headers: {
        "Accept":"text/html,application/xhtml+xml",
        "User-Agent":"Mozilla/5.0",
        "Referer":"https://www.kap.org.tr/"
      }
    });
    if (!r.ok) return { url:null };

    const html = await r.text();
    const parsed = findKapFeeTable(html);

    // "Fon Toplam Gider Oranı" bölümü ayrı detay ekranında/tabloda olabilir.
    // Güvenilir hücre bulunmadıkça yanlış oran göstermiyoruz.
    return {
      url,
      annualManagementFeePct: parsed.annualManagementFeePct ?? null,
      entryCommissionPct: parsed.entryCommissionPct ?? null,
      exitCommissionPct: parsed.exitCommissionPct ?? null,
      performanceFeePct: parsed.performanceFeePct ?? null,
      totalExpenseRatioPct: null
    };
  } catch {
    return { url:null };
  }
}



async function handleFonolojiTest(code, env) {
  const keyPresent = !!env?.FONOLOJI_KEY;

  if (!keyPresent) {
    return json({
      ok:false,
      status:"NO_KEY",
      keyPresent:false,
      code,
      message:"FONOLOJI_KEY Worker ortamında bulunamadı."
    }, 500);
  }

  const endpoint = `https://fonoloji.com/v1/funds/${encodeURIComponent(code)}`;

  try {
    const response = await fetch(endpoint, {
      method:"GET",
      headers:{
        "X-API-Key": env.FONOLOJI_KEY,
        "Accept":"application/json",
        "User-Agent":"Portfoyum/1.15.1"
      }
    });

    const text = await response.text();
    let parsed = null;
    try { parsed = JSON.parse(text); } catch {}

    const fund = parsed?.fund || parsed?.data || parsed || null;

    let status = "UNKNOWN";
    if (response.ok) status = "OK";
    else if (response.status === 401) status = "API_KEY_INVALID";
    else if (response.status === 403) status = "ACCOUNT_FORBIDDEN";
    else if (response.status === 404) status = "FUND_NOT_FOUND";
    else if (response.status === 429) status = "QUOTA_EXCEEDED";
    else if (response.status >= 500) status = "FONOLOJI_SERVER_ERROR";

    return json({
      ok: response.ok,
      status,
      keyPresent:true,
      keyMasked:true,
      httpStatus:response.status,
      code,
      endpoint,
      fundCode: fund?.code ?? null,
      fundName: fund?.name ?? fund?.title ?? null,
      sampleMetrics:{
        sharpe90: fund?.sharpe_90 ?? null,
        sortino90: fund?.sortino_90 ?? null,
        calmar1y: fund?.calmar_1y ?? null,
        beta1y: fund?.beta_1y ?? null,
        maxDrawdown1y: fund?.max_drawdown_1y ?? null,
        volatility90: fund?.volatility_90 ?? null,
        aum: fund?.aum ?? null,
        investorCount: fund?.investor_count ?? null
      },
      responseShape: parsed && typeof parsed === "object"
        ? Object.keys(parsed).slice(0,20)
        : null,
      preview: response.ok ? null : text.slice(0,300)
    }, response.ok ? 200 : response.status);

  } catch (err) {
    return json({
      ok:false,
      status:"NETWORK_ERROR",
      keyPresent:true,
      keyMasked:true,
      code,
      message:String(err?.message || err)
    }, 502);
  }
}

async function fetchFonolojiFund(code, env) {
  const key = env?.FONOLOJI_KEY;
  if (!key) throw new Error("FONOLOJI_KEY tanımlı değil.");

  const url = `https://fonoloji.com/v1/funds/${encodeURIComponent(String(code).toUpperCase())}`;
  const res = await fetch(url, {
    method:"GET",
    headers:{
      "X-API-Key": key,
      "Accept":"application/json",
      "User-Agent":"Portfoyum/1.15.1"
    }
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Fonoloji HTTP ${res.status}${text ? `: ${text.slice(0,120)}` : ""}`);
  }

  let body;
  try { body=JSON.parse(text); }
  catch { throw new Error("Fonoloji geçersiz JSON döndürdü."); }

  const fund=body?.fund || body?.data || body;
  if (!fund || String(fund.code||"").toUpperCase() !== String(code).toUpperCase()) {
    throw new Error("Fonoloji fon verisi bulunamadı.");
  }
  return fund;
}

function fonolojiPct(v) {
  const n=Number(v);
  return Number.isFinite(n) ? n*100 : null;
}

async function handleFundResearch(code, env) {
  try {
    const fonolojiPromise = fetchFonolojiFund(code, env).catch(() => null);

    const [historyPayload, profilePayload, detailMetrics, generalMetrics] = await Promise.all([
      fetchTefasPayload(code, 12),
      fetchTefasProfile(code),
      fetchTefasDetailMetrics(code),
      fetchTefasGeneralMetrics(code).catch(() => ({}))
    ]);
    const fonoloji = await fonolojiPromise;

    const hist = tefasHistory(historyPayload);
    if (hist.length < 2) {
      return json({ok:false,error:`${code} için yeterli TEFAS fiyat geçmişi bulunamadı.`},404);
    }

    const latest = hist.at(-1);
    const prev = hist.at(-2);
    const change = latest.price - prev.price;
    const changePercent = change / prev.price * 100;

    const oneYearAgo = new Date(new Date(latest.date).getTime() - 365 * 86400000);
    const year = hist.filter(x => new Date(x.date) >= oneYearAgo);
    const prices = year.length >= 2 ? year : hist;

    const returns = dailyReturns(prices);
    const returnValues = returns.map(x => x.value);
    const vol = stdev(returnValues);
    const annualVolPct = vol === null ? null : vol * Math.sqrt(252) * 100;
    const positiveRatio = returns.length
      ? returns.filter(x => x.value > 0).length / returns.length * 100
      : null;
    const annualReturnPct = annualizedReturnPct(prices);
    const maxDdPct = maxDrawdown(prices);

    // Risk-free / minimum acceptable return currently 0%.
    // Oranlar aynı günlük TEFAS return serisinden hesaplanır.
    const riskFreeAnnualPct = 0;
    const targetAnnualPct = 0;
    const downsideDevPct = downsideDeviationAnnualPct(returns, 0);
    const sharpe = sharpeRatioFromDailyReturns(returns, riskFreeAnnualPct);
    const sortino = sortinoRatioFromDailyReturns(returns, targetAnnualPct);
    const calmar = calmarRatioFromHistory(prices, maxDdPct);

    const bestWorst = bestWorstDay(returns);

    const rolling30 = rollingVolatilitySeries(prices, 30);
    const rolling90 = rollingVolatilitySeries(prices, 90);
    const ddSeries = drawdownSeries(prices);

    const last30Vol = rolling30.at(-1)?.value ?? null;
    const last90Vol = rolling90.at(-1)?.value ?? null;

    const name =
      [...hist].reverse().find(x => x.name)?.name ||
      String(deepFindValue(profilePayload, ["fonUnvan","fonUnvani"]) || code);

    const riskValue =
      validRiskValue(deepFindValue(profilePayload, ["riskDegeri","riskDeğeri","riskValue"])) ??
      validRiskValue(deepFindValue(historyPayload, ["riskDegeri","riskDeğeri","riskValue"]));

    const profileFundTotalValue =
      deepFindNumberByKeyTokens(profilePayload, [
        ["fon","toplam","deger"],["port","buyukluk"],["fund","total","value"]
      ]) ??
      deepFindNumberByKeyTokens(historyPayload, [
        ["fon","toplam","deger"],["port","buyukluk"]
      ]);

    const profileInvestorCount =
      deepFindNumberByKeyTokens(profilePayload, [
        ["yatirimci","sayi"],["investor","count"]
      ]) ??
      deepFindNumberByKeyTokens(historyPayload, [["yatirimci","sayi"]]);

    const generalFundTotalValue = nullablePositiveNumber(generalMetrics?.fundTotalValue);
    const detailFundTotalValue = nullablePositiveNumber(detailMetrics?.fundTotalValue);
    const generalInvestorCount = nullablePositiveNumber(generalMetrics?.investorCount);
    const detailInvestorCount = nullablePositiveNumber(detailMetrics?.investorCount);
    const generalShareCount = nullablePositiveNumber(generalMetrics?.shareCount);

    const fundTotalValue =
      generalFundTotalValue ??
      (Number.isFinite(profileFundTotalValue) && profileFundTotalValue > 0 ? profileFundTotalValue : null) ??
      detailFundTotalValue;

    const investorCount =
      generalInvestorCount ??
      (Number.isFinite(profileInvestorCount) && profileInvestorCount > 0 ? profileInvestorCount : null) ??
      detailInvestorCount;

    const shareCount = generalShareCount;

    const high52w = Math.max(...prices.map(x => x.price));
    const low52w = Math.min(...prices.map(x => x.price));

    const fees = await fetchKapFundFees(code, name);

    return json({
      ok:true,
      data:{
        type:"fund",
        source:"TEFAS",
        code,
        name,
        price:latest.price,
        previousPrice:prev.price,
        change,
        changePercent,
        date:latest.date,

        performance:{
          week:Number.isFinite(Number(fonoloji?.return_1w)) ? fonolojiPct(fonoloji.return_1w) : returnFromDaysStrict(hist,7),
          month1:Number.isFinite(Number(fonoloji?.return_1m)) ? fonolojiPct(fonoloji.return_1m) : returnFromMonths(hist,1),
          month3:Number.isFinite(Number(fonoloji?.return_3m)) ? fonolojiPct(fonoloji.return_3m) : returnFromMonths(hist,3),
          month6:Number.isFinite(Number(fonoloji?.return_6m)) ? fonolojiPct(fonoloji.return_6m) : returnFromMonths(hist,6),
          year1:Number.isFinite(Number(fonoloji?.return_1y)) ? fonolojiPct(fonoloji.return_1y) : returnFromMonths(hist,12),
          ytd:Number.isFinite(Number(fonoloji?.return_ytd)) ? fonolojiPct(fonoloji.return_ytd) : null,
          realReturn1yPct:Number.isFinite(Number(fonoloji?.real_return_1y)) ? fonolojiPct(fonoloji.real_return_1y) : null,
          annualizedReturnPct
        },

        stats:{
          high52w,
          low52w,
          distanceFromHighPct:(latest.price/high52w - 1) * 100,
          bestDayPct:bestWorst.best?.value ?? null,
          bestDayDate:bestWorst.best?.date ?? null,
          worstDayPct:bestWorst.worst?.value ?? null,
          worstDayDate:bestWorst.worst?.date ?? null,
          historyPeriod:"1Y"
        },

        risk:{
          annualizedVolatilityPct:annualVolPct,
          volatility30dPct:last30Vol,
          volatility90dPct:Number.isFinite(Number(fonoloji?.volatility_90)) ? fonolojiPct(fonoloji.volatility_90) : last90Vol,
          maxDrawdownPct:Number.isFinite(Number(fonoloji?.max_drawdown_1y)) ? fonolojiPct(fonoloji.max_drawdown_1y) : maxDdPct,
          positiveDayRatioPct:positiveRatio,
          downsideDeviationPct:downsideDevPct,
          sharpe:Number.isFinite(Number(fonoloji?.sharpe_90)) ? Number(fonoloji.sharpe_90) : sharpe,
          sortino:Number.isFinite(Number(fonoloji?.sortino_90)) ? Number(fonoloji.sortino_90) : sortino,
          calmar:Number.isFinite(Number(fonoloji?.calmar_1y)) ? Number(fonoloji.calmar_1y) : calmar,
          beta1y:Number.isFinite(Number(fonoloji?.beta_1y)) ? Number(fonoloji.beta_1y) : null,
          riskFreeAnnualPct,
          targetAnnualPct,
          source:fonoloji ? "Fonoloji" : "Calculated",
          calculatedFallback:{sharpe,sortino,calmar,maxDrawdownPct:maxDdPct,volatility90dPct:last90Vol}
        },

        metadata:{
          fundTotalValue:Number.isFinite(Number(fonoloji?.aum)) ? Number(fonoloji.aum) : (Number.isFinite(fundTotalValue) ? fundTotalValue : null),
          investorCount:Number.isFinite(Number(fonoloji?.investor_count)) ? Number(fonoloji.investor_count) : (Number.isFinite(investorCount) ? investorCount : null),
          shareCount:Number.isFinite(shareCount) ? shareCount : null,
          riskValue:Number.isFinite(Number(fonoloji?.risk_score)) ? Number(fonoloji.risk_score) : riskValue,
          riskLabel:riskLabel(Number.isFinite(Number(fonoloji?.risk_score)) ? Number(fonoloji.risk_score) : riskValue),
          category:fonoloji?.category ?? null,
          managementCompany:fonoloji?.management_company ?? null,
          isin:fonoloji?.isin ?? null,
          buyValor:Number.isFinite(Number(fonoloji?.buy_valor)) ? Number(fonoloji.buy_valor) : null,
          sellValor:Number.isFinite(Number(fonoloji?.sell_valor)) ? Number(fonoloji.sell_valor) : null,
          tradingStatus:fonoloji?.trading_status ?? null
        },

        fees,

        series:{
          price:prices.map(x => ({date:x.date, value:x.price})),
          drawdown:ddSeries,
          volatility30:rolling30,
          volatility90:rolling90
        },

        calculationMeta:{
          startDate:prices[0]?.date ?? null,
          endDate:prices.at(-1)?.date ?? null,
          pricePoints:prices.length,
          returnObservations:returns.length,
          annualizationFactor:252,
          riskFreeAnnualPct,
          targetAnnualPct
        }
      }
    });

  } catch(err) {
    return json({ok:false,error:String(err?.message||err)},500);
  }
}

async function tvScan(symbol,columns){
  const endpoint="https://scanner.tradingview.com/turkey/scan";
  const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json","Accept":"application/json,text/plain,*/*","Origin":"https://www.tradingview.com","Referer":"https://www.tradingview.com/","User-Agent":"Mozilla/5.0 (compatible; Portfoyum/1.13)"},body:JSON.stringify({symbols:{tickers:[symbol],query:{types:[]}},columns})});
  if(!r.ok)return null; let p; try{p=await r.json();}catch{return null;} const row=p?.data?.[0]; if(!row||!Array.isArray(row.d))return null; const out={}; columns.forEach((c,i)=>out[c]=row.d[i]); return out;
}
async function handleStockResearch(code){
  try{
    const symbol=`BIST:${code}`;
    const base=await tvScan(symbol,["name","description","close","change","change_abs","volume","currency","update_mode"]);
    if(!base||!(Number(base.close)>0))return json({ok:false,error:`${code} için BIST verisi bulunamadı.`},404);
    const [fund,perf,tech]=await Promise.all([
      tvScan(symbol,["market_cap_basic","price_earnings_ttm","price_book_ratio","earnings_per_share_diluted_ttm","dividends_yield","beta_1_year","sector","industry"]),
      tvScan(symbol,["Perf.W","Perf.1M","Perf.3M","Perf.6M","Perf.Y","price_52_week_high","price_52_week_low"]),
      tvScan(symbol,["RSI","SMA50","SMA200","Recommend.All"])
    ]);
    const price=Number(base.close), providerAbs=Number(base.change_abs), providerPct=Number(base.change); let previous=null;
    if(Number.isFinite(providerAbs)&&price-providerAbs>0)previous=price-providerAbs; else if(Number.isFinite(providerPct)&&providerPct>-100)previous=price/(1+providerPct/100);
    const change=previous>0?price-previous:(Number.isFinite(providerAbs)?providerAbs:null), changePercent=previous>0?change/previous*100:(Number.isFinite(providerPct)?providerPct:null);
    const n=v=>Number.isFinite(Number(v))?Number(v):null;
    return json({ok:true,data:{type:"stock",source:"TradingView delayed scanner",code,symbol,name:base.description||base.name||code,price,previousPrice:previous,change,changePercent,volume:n(base.volume),currency:base.currency||"TRY",sector:fund?.sector||null,industry:fund?.industry||null,
      fundamentals:{marketCap:n(fund?.market_cap_basic),pe:n(fund?.price_earnings_ttm),priceToBook:n(fund?.price_book_ratio),epsTtm:n(fund?.earnings_per_share_diluted_ttm),dividendYield:n(fund?.dividends_yield),beta1y:n(fund?.beta_1_year)},
      performance:{week:n(perf?.["Perf.W"]),month1:n(perf?.["Perf.1M"]),month3:n(perf?.["Perf.3M"]),month6:n(perf?.["Perf.6M"]),year1:n(perf?.["Perf.Y"])},
      stats:{high52w:n(perf?.price_52_week_high),low52w:n(perf?.price_52_week_low)},technicals:{rsi:n(tech?.RSI),sma50:n(tech?.SMA50),sma200:n(tech?.SMA200),recommendation:n(tech?.["Recommend.All"])},delayed:true,date:new Date().toISOString()}});
  }catch(err){return json({ok:false,error:String(err?.message||err)},500);}
}

async function handleStock(code, env) {
  // v1.6 — BIST hisseleri için TradingView delayed scanner.
  //
  // Yahoo Finance BIST verisi bazı günlerde bir işlem günü geriden geldiği için
  // hisse tarafında tamamen kaldırıldı.
  //
  // TradingView scanner ücretsiz/gecikmeli piyasa verisini döndürür.
  // close      = son fiyat
  // change     = günlük yüzde değişim
  // change_abs = günlük TL değişim
  //
  // Önceki kapanışı da bu iki değerden bağımsız olarak yeniden hesaplıyoruz.

  const symbol = `BIST:${code}`;
  const endpoint = "https://scanner.tradingview.com/turkey/scan";

  const body = {
    symbols: {
      tickers: [symbol],
      query: { types: [] }
    },
    columns: [
      "name",
      "description",
      "close",
      "change",
      "change_abs",
      "currency",
      "update_mode"
    ]
  };

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json,text/plain,*/*",
        "Origin": "https://www.tradingview.com",
        "Referer": "https://www.tradingview.com/",
        "User-Agent": "Mozilla/5.0 (compatible; Portfoyum/1.6)"
      },
      body: JSON.stringify(body)
    });

    const text = await upstream.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return json({
        ok: false,
        error: `TradingView geçersiz yanıt döndürdü (HTTP ${upstream.status}).`
      }, 502);
    }

    if (!upstream.ok) {
      return json({
        ok: false,
        error: `TradingView HTTP ${upstream.status}`
      }, 502);
    }

    const row = payload?.data?.[0];
    if (!row || !Array.isArray(row.d)) {
      return json({
        ok: false,
        error: `${code} için TradingView BIST verisi bulunamadı.`
      }, 404);
    }

    // columns sırası ile birebir eşleşir.
    const [
      tvName,
      description,
      closeRaw,
      changePctRaw,
      changeAbsRaw,
      currencyRaw,
      updateMode
    ] = row.d;

    const price = Number(closeRaw);
    const providerChangePct = Number(changePctRaw);
    const providerChangeAbs = Number(changeAbsRaw);

    if (!(price > 0)) {
      return json({
        ok: false,
        error: `${code} için geçerli son fiyat bulunamadı.`
      }, 502);
    }

    let previousPrice = null;

    // change_abs varsa önce bunu kullan.
    if (Number.isFinite(providerChangeAbs)) {
      const p = price - providerChangeAbs;
      if (p > 0) previousPrice = p;
    }

    // change_abs gelmezse yüzde değişimden önceki kapanışı ters hesapla.
    if (!(previousPrice > 0) && Number.isFinite(providerChangePct) && providerChangePct > -100) {
      const p = price / (1 + providerChangePct / 100);
      if (p > 0) previousPrice = p;
    }

    const change = previousPrice > 0 ? price - previousPrice
      : Number.isFinite(providerChangeAbs) ? providerChangeAbs
      : null;

    const calculatedChangePct = previousPrice > 0
      ? ((price - previousPrice) / previousPrice) * 100
      : null;

    // TradingView'ın yüzde alanı ile kendi hesabımız küçük yuvarlama farkı dışında
    // aynı olmalı. Önceki kapanış hesaplanabildiyse bizim hesap tercih edilir.
    const changePercent = Number.isFinite(calculatedChangePct)
      ? calculatedChangePct
      : Number.isFinite(providerChangePct) ? providerChangePct : null;

    return json({
      ok: true,
      source: "TradingView delayed scanner",
      mode: "delayed_market_quote",
      code,
      symbol,
      price,
      previousPrice,
      change,
      changePercent,
      providerChangePercent: Number.isFinite(providerChangePct) ? providerChangePct : null,
      name: description || tvName || code,
      currency: currencyRaw || "TRY",
      exchange: "Borsa Istanbul",
      updateMode: updateMode || null,
      delayed: true,
      date: new Date().toISOString()
    });
  } catch (err) {
    return json({
      ok: false,
      error: String(err?.message || err)
    }, 500);
  }
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Cache-Control": "public, max-age=300"
  };
}

function json(data, status=200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type":"application/json; charset=utf-8", ...corsHeaders() }
  });
}

function normalizeTefas(payload, code) {
  const rows = collectRows(payload);
  const candidates = [];

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;

    const price = firstNumber(row, [
      "fiyat","Fiyat","price","Price","birimPayDegeri","birimPayDeğeri",
      "fonFiyati","fonFiyat","nav","close","value"
    ]);

    if (!(price > 0)) continue;

    const dateRaw = firstValue(row, [
      "tarih","Tarih","date","Date","islemTarihi","fiyatTarihi","priceDate"
    ]);

    const name = firstValue(row, [
      "fonUnvan","fonUnvani","FonUnvan","fundName","name","FonAdi","fonAdi"
    ]);

    candidates.push({
      price,
      date: parseDate(dateRaw),
      dateRaw,
      name: typeof name === "string" ? name : ""
    });
  }

  if (!candidates.length) {
    // Bazı API cevapları tek obje içinde olabilir.
    const price = deepFindNumber(payload, ["fiyat","price","birimPayDegeri","fonFiyat"]);
    if (price > 0) {
      return {
        code,
        price,
        previousPrice: null,
        date: new Date().toISOString(),
        name: ""
      };
    }
    return null;
  }

  candidates.sort((a,b) => {
    const ta = a.date ? new Date(a.date).getTime() : 0;
    const tb = b.date ? new Date(b.date).getTime() : 0;
    return tb - ta;
  });

  const latest = candidates[0];
  const previous = candidates.find((x,i) => i > 0 && x.price > 0);

  return {
    code,
    price: latest.price,
    previousPrice: previous?.price ?? null,
    date: latest.date || new Date().toISOString(),
    name: latest.name || ""
  };
}

function collectRows(payload) {
  const rows = [];
  const seen = new Set();

  function walk(v, depth=0) {
    if (depth > 7 || v == null) return;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (item && typeof item === "object" && !Array.isArray(item)) rows.push(item);
        walk(item, depth+1);
      }
      return;
    }
    if (typeof v === "object") {
      if (seen.has(v)) return;
      seen.add(v);
      for (const val of Object.values(v)) walk(val, depth+1);
    }
  }
  walk(payload);
  return rows;
}

function firstValue(obj, keys) {
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null) return obj[k];
  // case-insensitive fallback
  const map = Object.fromEntries(Object.keys(obj).map(k => [k.toLocaleLowerCase("tr-TR"), k]));
  for (const k of keys) {
    const hit = map[k.toLocaleLowerCase("tr-TR")];
    if (hit) return obj[hit];
  }
  return null;
}

function firstNumber(obj, keys) {
  const v = firstValue(obj, keys);
  return toNumber(v);
}

function toNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v !== "string") return NaN;
  const s = v.trim().replace(/\s/g,"");
  if (!s) return NaN;

  // 1.234,567890 -> 1234.567890
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) return Number(s.replace(/\./g,"").replace(",","."));
    return Number(s.replace(/,/g,""));
  }
  if (s.includes(",")) return Number(s.replace(",","."));
  return Number(s);
}

function deepFindNumber(payload, keys) {
  let found = NaN;
  function walk(v, depth=0) {
    if (depth > 7 || Number.isFinite(found) || v == null) return;
    if (Array.isArray(v)) return v.forEach(x => walk(x, depth+1));
    if (typeof v !== "object") return;
    const n = firstNumber(v, keys);
    if (n > 0) { found = n; return; }
    Object.values(v).forEach(x => walk(x, depth+1));
  }
  walk(payload);
  return found;
}

function parseDate(v) {
  if (v == null) return null;
  if (typeof v === "number") {
    const d = new Date(v > 1e12 ? v : v * 1000);
    return isNaN(d) ? null : d.toISOString();
  }
  const s = String(v).trim();
  if (!s) return null;

  const tr = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (tr) {
    const d = new Date(`${tr[3]}-${tr[2].padStart(2,"0")}-${tr[1].padStart(2,"0")}T12:00:00+03:00`);
    return isNaN(d) ? null : d.toISOString();
  }

  const d = new Date(s);
  return isNaN(d) ? null : d.toISOString();
}

function describeShape(payload) {
  if (Array.isArray(payload)) return `array(${payload.length})`;
  if (payload && typeof payload === "object") return `object:${Object.keys(payload).slice(0,12).join(",")}`;
  return typeof payload;
}
