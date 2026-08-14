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
      return json({ ok: true, service: "portfoyum-market-proxy", version: "1.15.4" });
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
      return type === "fund" ? await handleFundResearch(researchCode, env) : await handleStockResearch(researchCode);
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
  const t = decodeBasicHtmlEntities(String(s ?? ""))
    .replace(/\s+/g," ")
    .trim();

  if (!t || t === "-" || t === "—") return null;

  // Hücrede yalnızca tek bir oran/sayı varsa kabul et.
  const matches = t.match(/-?\d+(?:[.,]\d+)?/g) || [];
  if (matches.length !== 1) return null;

  return parseTurkishMetricNumber(matches[0]);
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

function normalizeKapHeader(s) {
  return normalizeMetricKey(
    String(s ?? "")
      .replace(/\(.*?\)/g," ")
      .replace(/%/g," ")
  );
}

function findHeaderIndex(headers, groups) {
  const normalized = headers.map(normalizeKapHeader);
  return normalized.findIndex(h =>
    groups.some(group => group.every(token => h.includes(normalizeMetricKey(token))))
  );
}

function extractKapFeeRows(html) {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  const candidates = [];

  for (const table of tables) {
    const rows = table.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
    if (rows.length < 2) continue;

    // Header satırı ilk satır olmak zorunda değil.
    let headerRowIndex = -1;
    let headers = [];

    for (let i=0; i<Math.min(rows.length,5); i++) {
      const cells = stripHtmlToCells(rows[i]);
      const joined = cells.join(" ");
      if (/Yönetim Ücreti/i.test(joined) &&
          /Giriş Komisyonu/i.test(joined) &&
          /Çıkış Komisyonu/i.test(joined)) {
        headerRowIndex = i;
        headers = cells;
        break;
      }
    }

    if (headerRowIndex < 0) continue;

    const annualIdx = findHeaderIndex(headers, [
      ["yonetim","ucreti","orani","yillik"],
      ["yillik","yonetim","ucreti"]
    ]);
    const entryIdx = findHeaderIndex(headers, [["giris","komisyonu"]]);
    const exitIdx = findHeaderIndex(headers, [["cikis","komisyonu"]]);
    const perfIdx = findHeaderIndex(headers, [["performans","ucreti"]]);

    for (let i=headerRowIndex+1; i<rows.length; i++) {
      const cells = stripHtmlToCells(rows[i]);
      if (!cells.length) continue;

      const annual = annualIdx >= 0 ? parseKapNumberCell(cells[annualIdx]) : null;
      const entry = entryIdx >= 0 ? parseKapNumberCell(cells[entryIdx]) : null;
      const exit = exitIdx >= 0 ? parseKapNumberCell(cells[exitIdx]) : null;
      const perf = perfIdx >= 0 ? parseKapNumberCell(cells[perfIdx]) : null;

      if ([annual,entry,exit,perf].some(v => Number.isFinite(v))) {
        candidates.push({
          annualManagementFeePct: Number.isFinite(annual) ? annual : null,
          entryCommissionPct: Number.isFinite(entry) ? entry : null,
          exitCommissionPct: Number.isFinite(exit) ? exit : null,
          performanceFeePct: Number.isFinite(perf) ? perf : null
        });
      }
    }
  }

  return candidates;
}

function extractTotalExpenseRatioFromHtml(html) {
  const tables = html.match(/<table\b[\s\S]*?<\/table>/gi) || [];
  for (const table of tables) {
    const plain = decodeBasicHtmlEntities(table.replace(/<[^>]+>/g," "))
      .replace(/\s+/g," ")
      .trim();

    if (!/Fon Toplam Gider Oranı/i.test(plain)) continue;

    // Aynı tablo içindeki açık yüzde oranını kabul et.
    const matches = plain.match(/Fon Toplam Gider Oranı[\s\S]{0,220}?(-?\d+(?:[.,]\d+)?)\s*%/i);
    if (matches) {
      const n = parseTurkishMetricNumber(matches[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}

async function fetchKapFundFees(code, fundName) {
  try {
    const slug = `${String(code).toLocaleLowerCase("tr-TR")}-${slugifyKapTr(fundName)}`;
    const url = `https://www.kap.org.tr/tr/fon-bilgileri/genel/${encodeURIComponent(slug)}`;

    const r = await fetch(url, {
      headers:{
        "Accept":"text/html,application/xhtml+xml",
        "User-Agent":"Mozilla/5.0",
        "Referer":"https://www.kap.org.tr/"
      }
    });

    if (!r.ok) {
      return {
        source:"KAP",
        verified:false,
        url:null,
        annualManagementFeePct:null,
        totalExpenseRatioPct:null,
        entryCommissionPct:null,
        exitCommissionPct:null,
        performanceFeePct:null
      };
    }

    const html = await r.text();
    const feeRows = extractKapFeeRows(html);

    // Birden fazla tablo/sınıf varsa birbirinden farklı oranları körlemesine seçme.
    // Tek doğrulanmış değer veya tüm adaylarda aynı değer varsa kabul et.
    const consensus = key => {
      const vals = feeRows
        .map(r => r[key])
        .filter(v => Number.isFinite(v));

      if (!vals.length) return null;

      const rounded = [...new Set(vals.map(v => Number(v.toFixed(8))))];
      return rounded.length === 1 ? rounded[0] : null;
    };

    const totalExpenseRatioPct = extractTotalExpenseRatioFromHtml(html);

    return {
      source:"KAP",
      verified:true,
      url,
      annualManagementFeePct:consensus("annualManagementFeePct"),
      totalExpenseRatioPct:Number.isFinite(totalExpenseRatioPct) ? totalExpenseRatioPct : null,
      entryCommissionPct:consensus("entryCommissionPct"),
      exitCommissionPct:consensus("exitCommissionPct"),
      performanceFeePct:consensus("performanceFeePct")
    };
  } catch {
    return {
      source:"KAP",
      verified:false,
      url:null,
      annualManagementFeePct:null,
      totalExpenseRatioPct:null,
      entryCommissionPct:null,
      exitCommissionPct:null,
      performanceFeePct:null
    };
  }
}


async function fonolojiGet(path, env) {
  const key = env?.FONOLOJI_KEY;
  if (!key) throw new Error("FONOLOJI_KEY tanımlı değil.");

  const url = `https://fonoloji.com/v1${path}`;
  const response = await fetch(url, {
    method: "GET",
    headers: {
      "X-API-Key": key,
      "Accept": "application/json",
      "User-Agent": "Portfoyum/1.15.4"
    }
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(
      `Fonoloji HTTP ${response.status}${text ? `: ${text.slice(0,180)}` : ""}`
    );
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Fonoloji geçersiz JSON döndürdü.");
  }
}

async function fetchFonolojiFund(code, env) {
  const normalized = String(code || "").trim().toUpperCase();
  const body = await fonolojiGet(`/funds/${encodeURIComponent(normalized)}`, env);

  const fund = body?.fund;
  if (!fund) {
    throw new Error("Fonoloji /funds/:code yanıtında fund objesi bulunamadı.");
  }

  if (String(fund.code || "").toUpperCase() !== normalized) {
    throw new Error(
      `Fonoloji farklı fon döndürdü: ${String(fund.code || "bilinmiyor")}`
    );
  }

  return {
    fund,
    portfolio: body?.portfolio ?? null,
    lifetime: body?.lifetime ?? null,
    flows: body?.flows ?? null
  };
}

async function fetchFonolojiTimeseries(code, env) {
  const normalized = String(code || "").trim().toUpperCase();
  return fonolojiGet(
    `/funds/${encodeURIComponent(normalized)}/timeseries?include=nav,drawdown,monthly,benchmark,allocation-history`,
    env
  );
}

async function fetchFonolojiPortfolio(code, env) {
  const normalized = String(code || "").trim().toUpperCase();
  return fonolojiGet(
    `/funds/${encodeURIComponent(normalized)}/portfolio?include=allocation,holdings,dates,fundamentals,analysts`,
    env
  );
}

async function fetchFonolojiAnalysis(code, env) {
  const normalized = String(code || "").trim().toUpperCase();
  return fonolojiGet(
    `/funds/${encodeURIComponent(normalized)}/analysis?include=summary,percentile,advanced`,
    env
  );
}

function fonolojiNavSeries(ts) {
  if (!ts || typeof ts !== "object") return [];

  const candidates = [
    ts?.nav,
    ts?.timeseries?.nav,
    ts?.data?.nav,
    ts?.points,
    ts?.timeseries?.points,
    ts?.data?.points
  ];

  const rows = candidates.find(Array.isArray) || [];

  return rows
    .map(row => ({
      date: row?.date ?? row?.tarih ?? row?.time ?? null,
      value: Number(
        row?.price ??
        row?.nav ??
        row?.value ??
        row?.current_price
      )
    }))
    .filter(row => row.date && Number.isFinite(row.value) && row.value > 0);
}

function fonolojiDrawdownSeries(ts) {
  if (!ts || typeof ts !== "object") return [];

  const candidates = [
    ts?.drawdown,
    ts?.timeseries?.drawdown,
    ts?.data?.drawdown
  ];

  const rows = candidates.find(Array.isArray) || [];

  return rows
    .map(row => ({
      date: row?.date ?? row?.tarih ?? null,
      value: Number(row?.value ?? row?.drawdown ?? row?.pct)
    }))
    .filter(row => row.date && Number.isFinite(row.value));
}

function fonolojiAllocation(portfolioRoot, fundRootPortfolio) {
  return (
    portfolioRoot?.allocation ??
    portfolioRoot?.portfolio?.allocation ??
    portfolioRoot?.data?.allocation ??
    fundRootPortfolio ??
    null
  );
}

function fonolojiPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n * 100 : null;
}

async function handleFundResearch(code, env) {
  try {
    // Fonoloji is the primary fund-research provider.
    // TEFAS remains the fallback for historical NAV and locally computed metrics.
    const fonolojiRootPromise = fetchFonolojiFund(code, env).catch(() => null);
    const fonolojiTsPromise = fetchFonolojiTimeseries(code, env).catch(() => null);
    const fonolojiPortfolioPromise = fetchFonolojiPortfolio(code, env).catch(() => null);
    const fonolojiAnalysisPromise = fetchFonolojiAnalysis(code, env).catch(() => null);

    const [historyPayload, profilePayload, detailMetrics, generalMetrics] = await Promise.all([
      fetchTefasPayload(code, 12),
      fetchTefasProfile(code),
      fetchTefasDetailMetrics(code),
      fetchTefasGeneralMetrics(code).catch(() => ({}))
    ]);

    const [fonolojiRoot, fonolojiTs, fonolojiPortfolioRoot, fonolojiAnalysis] = await Promise.all([
      fonolojiRootPromise,
      fonolojiTsPromise,
      fonolojiPortfolioPromise,
      fonolojiAnalysisPromise
    ]);

    const f = fonolojiRoot?.fund ?? null;

    const tefasHist = tefasHistory(historyPayload);
    const fonolojiNav = fonolojiNavSeries(fonolojiTs);
    const hist = fonolojiNav.length >= 2
      ? fonolojiNav.map(x => ({date:x.date, price:x.value, name:f?.name || ""}))
      : tefasHist;

    if (hist.length < 2 && !f) {
      return json({ok:false,error:`${code} için yeterli fon verisi bulunamadı.`},404);
    }

    const latest = hist.at(-1) || null;
    const prev = hist.at(-2) || null;

    const price = Number.isFinite(Number(f?.current_price))
      ? Number(f.current_price)
      : Number(latest?.price);

    const previousPrice = Number.isFinite(Number(f?.return_1d)) && price > 0
      ? price / (1 + Number(f.return_1d))
      : Number(prev?.price);

    const change = price > 0 && previousPrice > 0 ? price - previousPrice : null;
    const changePercent = Number.isFinite(Number(f?.return_1d))
      ? fonolojiPct(f.return_1d)
      : (previousPrice > 0 ? (price/previousPrice - 1)*100 : null);

    const oneYearAgo = latest
      ? new Date(new Date(latest.date).getTime() - 365*86400000)
      : null;
    const prices = oneYearAgo
      ? hist.filter(x => new Date(x.date) >= oneYearAgo)
      : hist;

    const returns = dailyReturns(prices);
    const returnValues = returns.map(x => x.value);
    const vol = stdev(returnValues);
    const annualVolPct = vol === null ? null : vol*Math.sqrt(252)*100;
    const positiveRatio = returns.length
      ? returns.filter(x => x.value > 0).length / returns.length * 100
      : null;
    const annualReturnPct = annualizedReturnPct(prices);
    const localMaxDdPct = maxDrawdown(prices);
    const downsideDevPct = downsideDeviationAnnualPct(returns,0);
    const localSharpe = sharpeRatioFromDailyReturns(returns,0);
    const localSortino = sortinoRatioFromDailyReturns(returns,0);
    const localCalmar = calmarRatioFromHistory(prices,localMaxDdPct);
    const bestWorst = bestWorstDay(returns);

    const rolling30 = rollingVolatilitySeries(prices,30);
    const rolling90 = rollingVolatilitySeries(prices,90);

    const providerDd = fonolojiDrawdownSeries(fonolojiTs);
    const ddSeries = providerDd.length ? providerDd : drawdownSeries(prices);

    const riskValue =
      validRiskValue(f?.risk_score) ??
      validRiskValue(deepFindValue(profilePayload,["riskDegeri","riskDeğeri","riskValue"]));

    const profileFundTotalValue =
      deepFindNumberByKeyTokens(profilePayload,[["fon","toplam","deger"],["port","buyukluk"]]);
    const profileInvestorCount =
      deepFindNumberByKeyTokens(profilePayload,[["yatirimci","sayi"]]);

    const fallbackFundTotalValue =
      nullablePositiveNumber(generalMetrics?.fundTotalValue) ??
      (Number.isFinite(profileFundTotalValue) && profileFundTotalValue > 0 ? profileFundTotalValue : null) ??
      nullablePositiveNumber(detailMetrics?.fundTotalValue);

    const fallbackInvestorCount =
      nullablePositiveNumber(generalMetrics?.investorCount) ??
      (Number.isFinite(profileInvestorCount) && profileInvestorCount > 0 ? profileInvestorCount : null) ??
      nullablePositiveNumber(detailMetrics?.investorCount);

    const fundTotalValue = nullablePositiveNumber(f?.aum) ?? fallbackFundTotalValue;
    const investorCount = nullablePositiveNumber(f?.investor_count) ?? fallbackInvestorCount;
    const shareCount = nullablePositiveNumber(generalMetrics?.shareCount);

    const high52w = prices.length ? Math.max(...prices.map(x=>x.price)) : null;
    const low52w = prices.length ? Math.min(...prices.map(x=>x.price)) : null;

    const fees = await fetchKapFundFees(code, f?.name || latest?.name || code);

    const allocation = fonolojiAllocation(fonolojiPortfolioRoot, fonolojiRoot?.portfolio);
    const holdings =
      arrayFromPossible(fonolojiPortfolioRoot,["holdings"]) ||
      arrayFromPossible(fonolojiPortfolioRoot?.portfolio,["holdings"]);

    return json({
      ok:true,
      data:{
        type:"fund",
        source:f ? "Fonoloji" : "TEFAS fallback",
        code,
        name:f?.name || latest?.name || code,
        category:f?.category ?? null,
        managementCompany:f?.management_company ?? null,
        isin:f?.isin ?? null,
        tradingStatus:f?.trading_status ?? null,
        tradingStart:f?.trading_start ?? null,
        tradingEnd:f?.trading_end ?? null,
        buyValor:Number.isFinite(Number(f?.buy_valor)) ? Number(f.buy_valor) : null,
        sellValor:Number.isFinite(Number(f?.sell_valor)) ? Number(f.sell_valor) : null,
        kapUrl:f?.kap_url ?? fees?.url ?? null,

        price,
        previousPrice,
        change,
        changePercent,
        date:f?.current_date ?? latest?.date ?? null,

        performance:{
          day1:Number.isFinite(Number(f?.return_1d)) ? fonolojiPct(f.return_1d) : changePercent,
          week:Number.isFinite(Number(f?.return_1w)) ? fonolojiPct(f.return_1w) : returnFromDaysStrict(hist,7),
          month1:Number.isFinite(Number(f?.return_1m)) ? fonolojiPct(f.return_1m) : returnFromMonths(hist,1),
          month3:Number.isFinite(Number(f?.return_3m)) ? fonolojiPct(f.return_3m) : returnFromMonths(hist,3),
          month6:Number.isFinite(Number(f?.return_6m)) ? fonolojiPct(f.return_6m) : returnFromMonths(hist,6),
          year1:Number.isFinite(Number(f?.return_1y)) ? fonolojiPct(f.return_1y) : returnFromMonths(hist,12),
          ytd:Number.isFinite(Number(f?.return_ytd)) ? fonolojiPct(f.return_ytd) : null,
          realReturn1yPct:Number.isFinite(Number(f?.real_return_1y)) ? fonolojiPct(f.real_return_1y) : null,
          annualizedReturnPct
        },

        stats:{
          high52w,
          low52w,
          distanceFromHighPct:high52w > 0 && price > 0 ? (price/high52w - 1)*100 : null,
          bestDayPct:bestWorst.best?.value ?? null,
          bestDayDate:bestWorst.best?.date ?? null,
          worstDayPct:bestWorst.worst?.value ?? null,
          worstDayDate:bestWorst.worst?.date ?? null,
          ma30:Number.isFinite(Number(f?.ma_30)) ? Number(f.ma_30) : null,
          ma90:Number.isFinite(Number(f?.ma_90)) ? Number(f.ma_90) : null,
          ma200:Number.isFinite(Number(f?.ma_200)) ? Number(f.ma_200) : null
        },

        risk:{
          source:f ? "Fonoloji" : "Calculated fallback",
          volatility90dPct:Number.isFinite(Number(f?.volatility_90)) ? fonolojiPct(f.volatility_90) : (rolling90.at(-1)?.value ?? null),
          annualizedVolatilityPct:annualVolPct,
          volatility30dPct:rolling30.at(-1)?.value ?? null,
          maxDrawdownPct:Number.isFinite(Number(f?.max_drawdown_1y)) ? fonolojiPct(f.max_drawdown_1y) : localMaxDdPct,
          positiveDayRatioPct:positiveRatio,
          downsideDeviationPct:downsideDevPct,
          sharpe:Number.isFinite(Number(f?.sharpe_90)) ? Number(f.sharpe_90) : localSharpe,
          sortino:Number.isFinite(Number(f?.sortino_90)) ? Number(f.sortino_90) : localSortino,
          calmar:Number.isFinite(Number(f?.calmar_1y)) ? Number(f.calmar_1y) : localCalmar,
          beta1y:Number.isFinite(Number(f?.beta_1y)) ? Number(f.beta_1y) : null
        },

        metadata:{
          fundTotalValue,
          investorCount,
          shareCount,
          riskValue,
          riskLabel:riskLabel(riskValue),
          firstSeen:f?.first_seen ?? null,
          lastSeen:f?.last_seen ?? null
        },

        fees,
        portfolio:{
          allocation,
          holdings:Array.isArray(holdings) ? holdings : [],
          rawAvailable:!!fonolojiPortfolioRoot
        },
        analysis:fonolojiAnalysis ?? null,
        series:{
          price:prices.map(x=>({date:x.date,value:x.price})),
          drawdown:ddSeries,
          volatility30:rolling30,
          volatility90:rolling90
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
