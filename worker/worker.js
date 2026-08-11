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
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return json({ ok: true, service: "portfoyum-tefas-proxy" });
    }

    const stockMatch = url.pathname.match(/^\/api\/stock\/([A-Za-z0-9._-]+)$/);
    if (stockMatch) {
      const stockCode = stockMatch[1].trim().toUpperCase().replace(/\.IS$/, "");
      if (!/^[A-Z0-9]{2,12}$/.test(stockCode)) {
        return json({ ok:false, error:"Geçersiz hisse kodu." }, 400);
      }
      return await handleStock(stockCode);
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

async function handleStock(code) {
  const symbol = `${code}.IS`;
  const yahooUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d&includePrePost=false&events=div%2Csplits`;

  try {
    const upstream = await fetch(yahooUrl, {
      headers: {
        "Accept": "application/json,text/plain,*/*",
        "User-Agent": "Mozilla/5.0 (compatible; Portfoyum/1.3)"
      }
    });

    const text = await upstream.text();
    if (!upstream.ok) {
      return json({ ok:false, error:`Hisse veri servisi HTTP ${upstream.status}` }, 502);
    }

    let payload;
    try { payload = JSON.parse(text); }
    catch { return json({ ok:false, error:"Hisse veri servisi geçersiz yanıt döndürdü." }, 502); }

    const result = payload?.chart?.result?.[0];
    if (!result) {
      const message = payload?.chart?.error?.description || "Hisse bulunamadı.";
      return json({ ok:false, error:message }, 404);
    }

    const meta = result.meta || {};
    const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const valid = [];

    for (let i = 0; i < closes.length; i++) {
      const close = Number(closes[i]);
      if (close > 0) valid.push({ price: close, ts: timestamps[i] || null });
    }

    const livePrice = Number(meta.regularMarketPrice);
    const latest = livePrice > 0 ? livePrice : valid.at(-1)?.price;

    // BIST günlük değişimi için gerçek önceki seans kapanışını
    // günlük mumlardan alıyoruz. Yahoo meta.previousClose alanı
    // bazı BIST hisselerinde zaman zaman eskimiş/farklı değer döndürebiliyor.
    let previous = null;
    if (valid.length > 1) {
      previous = Number(valid.at(-2).price);
    }

    // Günlük mum geçmişi gelmezse meta değeri sadece yedek olarak kullan.
    if (!(previous > 0)) {
      const metaPrevious = Number(meta.previousClose || meta.chartPreviousClose);
      previous = metaPrevious > 0 ? metaPrevious : null;
    }

    if (!(latest > 0)) return json({ ok:false, error:"Geçerli hisse fiyatı bulunamadı." }, 502);

    const ts = Number(meta.regularMarketTime) || valid.at(-1)?.ts || Math.floor(Date.now()/1000);
    const change = previous > 0 ? latest - previous : null;
    const changePercent = previous > 0 ? (change / previous) * 100 : null;

    return json({
      ok: true,
      source: "Yahoo Finance - delayed",
      code,
      symbol,
      price: latest,
      previousPrice: previous,
      change,
      changePercent,
      date: new Date(ts * 1000).toISOString(),
      name: meta.longName || meta.shortName || code,
      currency: meta.currency || "TRY",
      exchange: meta.exchangeName || "IST"
    });
  } catch (err) {
    return json({ ok:false, error:String(err?.message || err) }, 500);
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
