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
      return json({ ok: true, service: "portfoyum-market-proxy", version: "1.5" });
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
      const upstream = await fetch(TEFAS_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json, text/plain, */*",
          "User-Agent": "Mozilla/5.0",
          "Origin": "https://www.tefas.gov.tr",
          "Referer": "https://www.tefas.gov.tr/"
        },
        body: JSON.stringify({
          fonKodu: code,
          dil: "TR",
          periyod: 13
        })
      });

      const text = await upstream.text();
      if (!upstream.ok) {
        return json({ ok:false, error:`TEFAS HTTP ${upstream.status}`, preview:text.slice(0,200) }, 502);
      }

      let payload;
      try { payload = JSON.parse(text); }
      catch {
        return json({ ok:false, error:"TEFAS JSON yerine farklı bir yanıt döndürdü.", preview:text.slice(0,200) }, 502);
      }

      const normalized = normalizeTefas(payload, code);
      if (!normalized) {
        return json({ ok:false, error:"TEFAS yanıtında fiyat verisi bulunamadı.", rawShape: describeShape(payload) }, 502);
      }

      return json({ ok:true, ...normalized });
    } catch (err) {
      return json({ ok:false, error:String(err?.message || err) }, 500);
    }
  }
};

async function handleStock(code, env) {
  // v1.5:
  // Ücretsiz ve API anahtarsız BIST takibi.
  //
  // Yahoo Finance'ın anlık/meta previousClose alanlarını KULLANMIYORUZ.
  // Sadece günlük tarihsel mumları kullanıyoruz ve bugünün tamamlanmamış
  // mumunu dışarıda bırakıyoruz. Böylece sonuç "son kesinleşmiş kapanış"
  // ve ondan önceki kesinleşmiş kapanıştan hesaplanıyor.
  //
  // Örn.:
  // latest completed close = 78.85
  // previous completed close = 77.40
  // change % = (78.85 - 77.40) / 77.40 * 100 = +1.87%

  const symbol = `${code}.IS`;

  // Bir aylık günlük veri, tatil/hafta sonlarına rağmen son iki tamamlanmış
  // seansı güvenle bulmak için yeterli tampon sağlar.
  const endpoint =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?range=1mo&interval=1d&includePrePost=false&events=div%2Csplits&corsDomain=finance.yahoo.com`;

  try {
    const upstream = await fetch(endpoint, {
      method: "GET",
      headers: {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; Portfoyum/1.5)"
      }
    });

    const text = await upstream.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return json({
        ok: false,
        error: `Hisse veri kaynağı geçersiz yanıt döndürdü (HTTP ${upstream.status}).`
      }, 502);
    }

    if (!upstream.ok) {
      return json({
        ok: false,
        error: `Hisse veri kaynağı HTTP ${upstream.status}`
      }, 502);
    }

    const result = payload?.chart?.result?.[0];
    if (!result) {
      const providerError = payload?.chart?.error?.description;
      return json({
        ok: false,
        error: providerError || `${code} için günlük fiyat verisi bulunamadı.`
      }, 404);
    }

    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const quote = result?.indicators?.quote?.[0] || {};
    const adjclose = result?.indicators?.adjclose?.[0]?.adjclose || [];
    const closes = quote.close || [];

    const rows = [];

    for (let i = 0; i < timestamps.length; i++) {
      const ts = Number(timestamps[i]);
      const rawClose = Number(closes[i]);
      const adjustedClose = Number(adjclose[i]);

      // Günlük portföy takibinde normal kapanışı tercih ediyoruz.
      const close = rawClose > 0 ? rawClose : adjustedClose;

      if (!(ts > 0) || !(close > 0)) continue;

      rows.push({
        ts,
        close,
        istanbulDate: dateInIstanbul(ts * 1000)
      });
    }

    if (rows.length < 2) {
      return json({
        ok: false,
        error: `${code} için yeterli tamamlanmış günlük kapanış bulunamadı.`
      }, 502);
    }

    // Bugünün İstanbul tarihine ait mum Yahoo tarafından seans sırasında
    // geçici olarak oluşturulabilir. Gecikme sorun olmadığı için bugünkü mumu
    // her durumda dışarıda bırakıyoruz. Yarın olduğunda otomatik kesinleşmiş
    // kapanış olarak kullanılacak.
    const todayTR = dateInIstanbul(Date.now());
    const completed = rows.filter(r => r.istanbulDate < todayTR);

    if (completed.length < 2) {
      return json({
        ok: false,
        error: `${code} için iki adet kesinleşmiş kapanış bulunamadı.`
      }, 502);
    }

    completed.sort((a, b) => a.ts - b.ts);

    const latest = completed.at(-1);
    const previous = completed.at(-2);

    const change = latest.close - previous.close;
    const changePercent = previous.close > 0
      ? (change / previous.close) * 100
      : null;

    const meta = result.meta || {};

    return json({
      ok: true,
      source: "Yahoo Finance EOD historical",
      mode: "last_completed_close",
      code,
      symbol,
      price: latest.close,
      previousPrice: previous.close,
      change,
      changePercent,
      date: new Date(latest.ts * 1000).toISOString(),
      priceDate: latest.istanbulDate,
      previousPriceDate: previous.istanbulDate,
      name: meta.longName || meta.shortName || code,
      currency: meta.currency || "TRY",
      exchange: meta.exchangeName || "Borsa Istanbul",
      delayed: true
    });
  } catch (err) {
    return json({ ok:false, error:String(err?.message || err) }, 500);
  }
}

function dateInIstanbul(ms) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date(ms));

  const map = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = p.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
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
