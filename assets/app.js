const APP_VERSION = "1.16.2";
const STORE_KEY = "portfoyum_v1";
const SETTINGS_KEY = "portfoyum_settings_v1";

const state = {
  assets: [],
  transactions: [],
  history: [],
  filter: "all",
  historyRange: "ALL",
  allocationChart: null,
  portfolioHistoryChart: null,
  pnlHistoryChart: null,
  totalPerformanceChart: null,
  dailyPerformanceChart: null,
  researchChart: null,
  fundPriceHistoryChart: null,
  fundDrawdownChart: null,
  fundVolatilityChart: null,
  fundAllocationDetailChart: null,
  fundBenchmarkChart: null,
  fundAumHistoryChart: null,
  fundInvestorHistoryChart: null,
  activeResearchFundCode: null
};

const $ = (id) => document.getElementById(id);
const money = (n) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 2 }).format(Number(n || 0));
const num = (n, digits = 6) => new Intl.NumberFormat("tr-TR", { maximumFractionDigits: digits }).format(Number(n || 0));
const pct = (n) => `%${new Intl.NumberFormat("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(n || 0))}`;

function todayISO() {
  const d = new Date();
  const offset = d.getTimezoneOffset();
  return new Date(d.getTime() - offset * 60000).toISOString().slice(0,10);
}

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORE_KEY) || "{}");
    state.assets = Array.isArray(data.assets) ? data.assets : [];
    state.transactions = Array.isArray(data.transactions) ? data.transactions : [];
    state.history = Array.isArray(data.history) ? data.history : [];
  } catch {
    state.assets = [];
    state.transactions = [];
    state.history = [];
  }

  const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  $("apiBaseInput").value = settings.apiBase || "";
  document.documentElement.dataset.theme = settings.theme || "light";
  if ($("dataStatus")) $("dataStatus").textContent = `Portföyüm v${APP_VERSION}`;
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    assets: state.assets,
    transactions: state.transactions,
    history: state.history
  }));
}

function saveSettings(patch = {}) {
  const old = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  const next = { ...old, ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function getAssetTx(assetId) {
  return state.transactions.filter(t => t.assetId === assetId);
}

function calcAsset(asset) {
  const txs = getAssetTx(asset.id)
    .map((t, i) => ({ ...t, _i: i, type: t.type || "buy" }))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)) || a._i - b._i);

  let qty = 0;
  let cost = 0;
  let realized = 0;

  for (const t of txs) {
    const tQty = Number(t.qty || 0);
    const tPrice = Number(t.price || 0);
    if (!(tQty > 0) || !(tPrice >= 0)) continue;

    if ((t.type || "buy") === "sell") {
      if (qty <= 0) continue;
      const sellQty = Math.min(tQty, qty);
      const avgBefore = cost / qty;
      realized += sellQty * (tPrice - avgBefore);
      qty -= sellQty;
      cost -= sellQty * avgBefore;
      if (qty < 0.000000001) { qty = 0; cost = 0; }
    } else {
      qty += tQty;
      cost += tQty * tPrice;
    }
  }

  const avg = qty > 0 ? cost / qty : 0;
  const currentPrice = Number(asset.currentPrice || 0);
  const prevPrice = Number(asset.previousPrice || currentPrice || 0);
  const value = qty * currentPrice;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const daily = qty * (currentPrice - prevPrice);
  const dailyPct = prevPrice > 0 ? ((currentPrice - prevPrice) / prevPrice) * 100 : 0;
  return { qty, cost, avg, currentPrice, prevPrice, value, pnl, pnlPct, daily, dailyPct, realized };
}

function totals() {
  return state.assets.reduce((acc, asset) => {
    const c = calcAsset(asset);
    acc.value += c.value;
    acc.cost += c.cost;
    acc.pnl += c.pnl;
    acc.daily += c.daily;
    acc.prevValue += c.qty * c.prevPrice;
    return acc;
  }, { value:0, cost:0, pnl:0, daily:0, prevValue:0 });
}

function render() {
  renderSummary();
  renderTables();
  renderDashboardCompactCards();
  renderCards();
  renderTransactions();
  renderTopPositions();
  renderCharts();
  fillTxAssets();
}

function renderSummary() {
  const t = totals();
  $("totalValue").textContent = money(t.value);
  $("totalCost").textContent = money(t.cost);
  $("totalPnL").textContent = money(t.pnl);
  $("totalPnL").className = t.pnl >= 0 ? "positive" : "negative";
  const pp = t.cost ? (t.pnl/t.cost)*100 : 0;
  $("totalPnLPct").textContent = pct(pp);
  $("totalPnLPct").className = pp >= 0 ? "positive" : "negative";
  $("dailyChange").textContent = money(t.daily);
  $("dailyChange").className = t.daily >= 0 ? "positive" : "negative";
  $("assetCount").textContent = `${state.assets.length} varlık`;

  const dailyPctTotal = t.prevValue > 0 ? (t.daily / t.prevValue) * 100 : 0;
  const dates = state.assets.map(a => a.lastUpdated).filter(Boolean).sort().reverse();
  const updateText = dates[0] ? ` · ${new Date(dates[0]).toLocaleDateString("tr-TR")}` : "";
  $("lastUpdated").textContent = `${pct(dailyPctTotal)}${updateText}`;
  $("lastUpdated").className = dailyPctTotal >= 0 ? "positive" : "negative";
}

function rowHtml(asset) {
  const c = calcAsset(asset);
  const type = asset.type === "fund" ? "Fon" : "Hisse";
  const cls = c.pnl >= 0 ? "positive" : "negative";
  const dailyCls = c.daily >= 0 ? "positive" : "negative";
  return `<tr>
    <td><span class="asset-symbol">${escapeHtml(asset.code)}</span><span class="asset-sub">${escapeHtml(asset.name || "")}</span></td>
    <td>${type}</td>
    <td>${num(c.qty)}</td>
    <td>${money(c.avg)}</td>
    <td>${money(c.currentPrice)}</td>
    <td class="${dailyCls}"><strong>${money(c.daily)}</strong><span class="asset-sub ${dailyCls}">${pct(c.dailyPct)}</span></td>
    <td><strong>${money(c.value)}</strong></td>
    <td class="${cls}"><strong>${money(c.pnl)}</strong><span class="asset-sub ${cls}">${pct(c.pnlPct)}</span></td>
  </tr>`;
}

function renderTables() {
  $("dashboardTable").innerHTML = state.assets.length
    ? state.assets.map(rowHtml).join("")
    : `<tr><td colspan="8" class="empty-state">Henüz portföyünüze varlık eklemediniz.</td></tr>`;
}

function renderDashboardCompactCards() {
  const container = $("dashboardCompactCards");
  if (!container) return;

  if (!state.assets.length) {
    container.innerHTML = `
      <div class="compact-summary-empty">
        <strong>Henüz varlık yok</strong>
        <span>Portföyüne fon veya hisse eklediğinde özet burada görünecek.</span>
      </div>`;
    return;
  }

  container.innerHTML = state.assets.map(asset => {
    const c = calcAsset(asset);
    const pnlCls = c.pnl >= 0 ? "positive" : "negative";
    const dailyCls = c.daily >= 0 ? "positive" : "negative";
    const typeLabel = asset.type === "fund" ? "Fon" : "Hisse";
    const typeLong = asset.type === "fund" ? "Yatırım Fonu" : "BIST Hissesi";

    return `
      <article class="compact-summary-card">
        <div class="compact-card-head">
          <div class="compact-identity">
            <div class="compact-symbol">${escapeHtml(asset.code.slice(0, 3))}</div>
            <div class="compact-title">
              <div class="compact-title-line">
                <strong>${escapeHtml(asset.code)}</strong>
                <span class="compact-type-badge">${typeLabel}</span>
              </div>
              <span>${escapeHtml(asset.name || typeLong)}</span>
            </div>
          </div>
          <div class="compact-value">
            <span>Portföy değeri</span>
            <strong>${money(c.value)}</strong>
          </div>
        </div>

        <div class="compact-performance-row">
          <div class="compact-performance">
            <span>Toplam K/Z</span>
            <strong class="${pnlCls}">${money(c.pnl)}</strong>
            <small class="${pnlCls}">${pct(c.pnlPct)}</small>
          </div>
          <div class="compact-divider"></div>
          <div class="compact-performance">
            <span>Günlük</span>
            <strong class="${dailyCls}">${money(c.daily)}</strong>
            <small class="${dailyCls}">${pct(c.dailyPct)}</small>
          </div>
        </div>

        <div class="compact-details">
          <div>
            <span>Adet</span>
            <strong>${num(c.qty)}</strong>
          </div>
          <div>
            <span>Ort. maliyet</span>
            <strong>${money(c.avg)}</strong>
          </div>
          <div>
            <span>Güncel fiyat</span>
            <strong>${money(c.currentPrice)}</strong>
          </div>
          <div>
            <span>Önceki fiyat</span>
            <strong>${money(c.prevPrice)}</strong>
          </div>
        </div>
      </article>`;
  }).join("");
}

function renderCards() {
  const filtered = state.assets.filter(a => state.filter === "all" || a.type === state.filter);
  $("assetCards").innerHTML = filtered.length ? filtered.map(asset => {
    const c = calcAsset(asset);
    const cls = c.pnl >= 0 ? "positive" : "negative";
    const dailyCls = c.daily >= 0 ? "positive" : "negative";
    return `<article class="asset-card">
      <div class="asset-card-top">
        <div>
          <h3>${escapeHtml(asset.code)}</h3>
          <span class="asset-sub">${escapeHtml(asset.name || "")}</span>
        </div>
        <span class="type-badge">${asset.type === "fund" ? "YATIRIM FONU" : "HİSSE"}</span>
      </div>
      <div class="asset-value">${money(c.value)}</div>
      <div class="${cls}">${money(c.pnl)} · ${pct(c.pnlPct)}</div>
      <div class="daily-strip ${dailyCls}">
        <span>Günlük</span>
        <strong>${money(c.daily)} · ${pct(c.dailyPct)}</strong>
      </div>
      <div class="asset-stats">
        <div class="asset-stat"><span>ADET</span><strong>${num(c.qty)}</strong></div>
        <div class="asset-stat"><span>ORT. MALİYET</span><strong>${money(c.avg)}</strong></div>
        <div class="asset-stat"><span>GÜNCEL FİYAT</span><strong>${money(c.currentPrice)}</strong></div>
        <div class="asset-stat"><span>DÜN / ÖNCEKİ</span><strong>${money(c.prevPrice)}</strong></div>
      </div>
      <div class="card-actions">
        <button class="secondary-btn" onclick="openTransaction('${asset.id}')">+ Al / Sat</button>
        ${asset.type === "fund" ? `<button class="secondary-btn" onclick="refreshOne('${asset.id}')">↻ TEFAS</button>` : `<button class="secondary-btn" onclick="refreshStockOne('${asset.id}')">↻ BIST</button>`}
        <button class="text-btn" onclick="deleteAsset('${asset.id}')">Sil</button>
      </div>
    </article>`;
  }).join("") : `<div class="empty-state">Bu kategoride varlık yok.</div>`;
}

function renderTransactions() {
  const list = [...state.transactions].sort((a,b) => String(b.date).localeCompare(String(a.date)));
  $("transactionTable").innerHTML = list.length ? list.map(t => {
    const a = state.assets.find(x => x.id === t.assetId);
    const type = t.type || "buy";
    const typeLabel = type === "sell" ? "Satış" : "Alış";
    const typeCls = type === "sell" ? "negative" : "positive";
    return `<tr>
      <td>${new Date(t.date + "T12:00:00").toLocaleDateString("tr-TR")}</td>
      <td><strong>${escapeHtml(a?.code || "Silinmiş varlık")}</strong></td>
      <td class="${typeCls}"><strong>${typeLabel}</strong></td>
      <td>${num(t.qty)}</td>
      <td>${money(t.price)}</td>
      <td>${money(Number(t.qty)*Number(t.price))}</td>
      <td><button class="text-btn" onclick="deleteTx('${t.id}')">Sil</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="7" class="empty-state">Henüz işlem eklenmedi.</td></tr>`;
}

function renderTopPositions() {
  const total = totals().value;
  const list = state.assets
    .map(a => ({ a, c: calcAsset(a) }))
    .sort((x,y) => y.c.value - x.c.value)
    .slice(0,5);

  $("topPositions").innerHTML = list.length ? list.map(({a,c}) => {
    const weight = total ? c.value/total*100 : 0;
    return `<div class="position-row">
      <div class="position-logo">${escapeHtml(a.code.slice(0,2))}</div>
      <div class="position-name"><strong>${escapeHtml(a.code)}</strong><small>${escapeHtml(a.name || (a.type==="fund"?"Yatırım Fonu":"Hisse"))}</small></div>
      <div class="position-weight"><strong>${pct(weight)}</strong><small>${money(c.value)}</small></div>
    </div>`;
  }).join("") : "Henüz varlık eklenmedi.";
}

function chartTextColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--muted").trim() || "#9aa1ad";
}

function chartGridColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--border").trim() || "#30343a";
}

function semanticColors() {
  return {
    positive: getComputedStyle(document.documentElement).getPropertyValue("--positive").trim() || "#8fa",
    negative: getComputedStyle(document.documentElement).getPropertyValue("--negative").trim() || "#f88",
    neutral: "#9AA39D"
  };
}

function renderCharts() {
  renderAllocationChart();
  renderPortfolioHistoryChart();
  renderPnlHistoryChart();
  renderTotalPerformanceChart();
  renderDailyPerformanceChart();
}

function historyRangeLabel(range) {
  return ({ "1M":"1 Ay", "3M":"3 Ay", "6M":"6 Ay", "1Y":"1 Yıl", "ALL":"Tümü" })[range] || "Tümü";
}

function updateHistoryRangeSummary(points = getFilteredHistory()) {
  const el = $("historyRangeSummary");
  if (!el) return;
  el.textContent = `Gösterilen dönem: ${historyRangeLabel(state.historyRange)} · ${points.length} kayıt`;
}

function getFilteredHistory() {
  const points = [...state.history]
    .filter(x => x && x.date && Number.isFinite(Number(x.value)))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));

  if (state.historyRange === "ALL" || !points.length) return points;

  const latestDate = new Date(points.at(-1).date + "T12:00:00");
  const from = new Date(latestDate);
  const months = { "1M":1, "3M":3, "6M":6, "1Y":12 }[state.historyRange] || 0;
  from.setMonth(from.getMonth() - months);

  return points.filter(x => new Date(x.date + "T12:00:00") >= from);
}

function renderAllocationChart() {
  if (!window.Chart) return;
  const labels = state.assets.map(a => a.code);
  const data = state.assets.map(a => calcAsset(a).value);
  const ctx = $("allocationChart");
  if (!ctx) return;
  if (state.allocationChart) state.allocationChart.destroy();

  state.allocationChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        borderWidth: 0,
        backgroundColor: [
          "#6F8877","#A7B29E","#C9B88B","#8FA6A1","#D5C9B2",
          "#78909C","#B49A7E","#91A689","#C2A98E","#9EA6B0"
        ]
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "72%",
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle:true, boxWidth:8, color: chartTextColor() }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.label}: ${money(ctx.raw)}`
          }
        }
      }
    }
  });
}

function historyChartScales(currency=true) {
  return {
    x: {
      grid: { display:false },
      ticks: { color:chartTextColor(), maxRotation:0, autoSkip:true, maxTicksLimit:8 }
    },
    y: {
      grid: { color:chartGridColor() },
      ticks: {
        color:chartTextColor(),
        callback: value => currency
          ? new Intl.NumberFormat("tr-TR", {notation:"compact", maximumFractionDigits:1}).format(value) + " ₺"
          : `${Number(value).toFixed(1)}%`
      }
    }
  };
}

function renderPortfolioHistoryChart() {
  if (!window.Chart) return;
  const ctx = $("portfolioHistoryChart");
  if (!ctx) return;
  if (state.portfolioHistoryChart) state.portfolioHistoryChart.destroy();

  const points = getFilteredHistory();
  updateHistoryRangeSummary(points);

  $("historyPointCount").textContent = `${points.length} kayıt`;
  $("historyEmpty").style.display = points.length < 2 ? "block" : "none";
  ctx.style.opacity = points.length ? "1" : ".25";

  state.portfolioHistoryChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map(x => new Date(x.date + "T12:00:00").toLocaleDateString("tr-TR", {day:"2-digit", month:"short"})),
      datasets: [
        {
          label: "Portföy Değeri",
          data: points.map(x => Number(x.value || 0)),
          borderColor: "#6F8877",
          backgroundColor: "rgba(111,136,119,.10)",
          fill: true,
          tension: .32,
          pointRadius: points.length > 20 ? 0 : 2,
          pointHoverRadius: 5,
          borderWidth: 2
        },
        {
          label: "Ana Para",
          data: points.map(x => Number(x.cost || 0)),
          borderColor: "#B59A6A",
          backgroundColor: "transparent",
          fill: false,
          tension: .25,
          pointRadius: 0,
          borderDash: [6,5],
          borderWidth: 1.5
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:"index", intersect:false },
      scales: historyChartScales(true),
      plugins: {
        legend: {
          labels: { usePointStyle:true, boxWidth:8, color:chartTextColor() }
        },
        tooltip: {
          callbacks: {
            label: ctx => `${ctx.dataset.label}: ${money(ctx.raw)}`
          }
        }
      }
    }
  });
}

function renderPnlHistoryChart() {
  if (!window.Chart) return;
  const ctx = $("pnlHistoryChart");
  if (!ctx) return;
  if (state.pnlHistoryChart) state.pnlHistoryChart.destroy();

  const points = getFilteredHistory();
  const { positive, negative } = semanticColors();
  const pnlValues = points.map(x => {
    const explicit = Number(x.pnl);
    return Number.isFinite(explicit) ? explicit : Number(x.value || 0) - Number(x.cost || 0);
  });
  const lastPnl = pnlValues.at(-1) || 0;

  $("pnlRangeBadge").textContent = historyRangeLabel(state.historyRange);
  $("pnlHistoryEmpty").style.display = points.length < 2 ? "block" : "none";
  ctx.style.opacity = points.length ? "1" : ".25";

  state.pnlHistoryChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: points.map(x => new Date(x.date + "T12:00:00").toLocaleDateString("tr-TR", {day:"2-digit", month:"short"})),
      datasets: [{
        label: "Kâr / Zarar",
        data: pnlValues,
        borderColor: lastPnl >= 0 ? positive : negative,
        backgroundColor: lastPnl >= 0 ? "rgba(83,184,142,.10)" : "rgba(222,92,112,.10)",
        fill: true,
        tension: .32,
        pointRadius: points.length > 20 ? 0 : 2,
        pointHoverRadius: 5,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode:"index", intersect:false },
      scales: historyChartScales(true),
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            label: ctx => `K/Z: ${money(ctx.raw)}`
          }
        }
      }
    }
  });
}

function renderTotalPerformanceChart() {
  if (!window.Chart) return;
  const ctx = $("totalPerformanceChart");
  if (!ctx) return;
  if (state.totalPerformanceChart) state.totalPerformanceChart.destroy();

  const rows = state.assets
    .map(a => {
      const c = calcAsset(a);
      return { code:a.code, type:a.type, pnlPct:c.pnlPct, pnl:c.pnl, value:c.value };
    })
    .filter(x => x.value > 0 || x.pnl !== 0)
    .sort((a,b) => b.pnlPct - a.pnlPct);

  const { positive, negative, neutral } = semanticColors();

  state.totalPerformanceChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map(x => x.code),
      datasets: [{
        label: "Toplam Getiri %",
        data: rows.map(x => x.pnlPct),
        backgroundColor: rows.map(x => x.pnlPct > 0 ? positive : x.pnlPct < 0 ? negative : neutral),
        borderRadius: 7,
        borderSkipped: false,
        maxBarThickness: 34
      }]
    },
    options: {
      indexAxis: rows.length > 5 ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color:chartGridColor() },
          ticks: {
            color:chartTextColor(),
            callback: value => `${Number(value).toFixed(1)}%`
          }
        },
        y: {
          grid: { display:false },
          ticks: { color:chartTextColor() }
        }
      },
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const row = rows[ctx.dataIndex];
              return [
                `Getiri: ${Number(ctx.raw).toLocaleString("tr-TR", {minimumFractionDigits:2, maximumFractionDigits:2})}%`,
                `K/Z: ${money(row.pnl)}`
              ];
            }
          }
        }
      }
    }
  });
}

function renderDailyPerformanceChart() {
  if (!window.Chart) return;
  const ctx = $("dailyPerformanceChart");
  if (!ctx) return;
  if (state.dailyPerformanceChart) state.dailyPerformanceChart.destroy();

  const rows = state.assets
    .map(a => ({ code:a.code, dailyPct:calcAsset(a).dailyPct, daily:calcAsset(a).daily }))
    .sort((a,b) => b.dailyPct - a.dailyPct);

  const { positive, negative, neutral } = semanticColors();

  state.dailyPerformanceChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: rows.map(x => x.code),
      datasets: [{
        label: "Günlük %",
        data: rows.map(x => x.dailyPct),
        backgroundColor: rows.map(x => x.dailyPct > 0 ? positive : x.dailyPct < 0 ? negative : neutral),
        borderRadius: 7,
        borderSkipped: false,
        maxBarThickness: 34
      }]
    },
    options: {
      indexAxis: rows.length > 5 ? "y" : "x",
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color:chartGridColor() },
          ticks: {
            color:chartTextColor(),
            callback: value => `${Number(value).toFixed(1)}%`
          }
        },
        y: {
          grid: { display:false },
          ticks: { color:chartTextColor() }
        }
      },
      plugins: {
        legend: { display:false },
        tooltip: {
          callbacks: {
            label: ctx => {
              const row = rows[ctx.dataIndex];
              return [
                `Günlük: ${Number(ctx.raw).toLocaleString("tr-TR", {minimumFractionDigits:2, maximumFractionDigits:2})}%`,
                `TL etkisi: ${money(row.daily)}`
              ];
            }
          }
        }
      }
    }
  });
}

function setupHistoryRangeFilters() {
  const container = $("historyRangeTabs");
  if (!container) return;

  const activateRange = (btn) => {
    if (!btn || !btn.dataset.range) return;
    state.historyRange = btn.dataset.range || "ALL";

    container.querySelectorAll("[data-range]").forEach(x => {
      x.classList.toggle("active", x === btn);
      x.setAttribute("aria-pressed", x === btn ? "true" : "false");
    });

    renderPortfolioHistoryChart();
    renderPnlHistoryChart();
  };

  // Event delegation: iOS/iPadOS Safari'de dinamik/önbellek kaynaklı
  // bireysel listener sorunlarına karşı daha dayanıklı.
  container.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn || !container.contains(btn)) return;
    e.preventDefault();
    activateRange(btn);
  });

  // Touch fallback: bazı iPadOS sürümlerinde click gecikebilir/kaçabilir.
  container.addEventListener("touchend", (e) => {
    const btn = e.target.closest("[data-range]");
    if (!btn || !container.contains(btn)) return;
    e.preventDefault();
    activateRange(btn);
  }, { passive: false });

  const active = container.querySelector("[data-range].active") || container.querySelector("[data-range='ALL']");
  if (active) {
    container.querySelectorAll("[data-range]").forEach(x => {
      x.setAttribute("aria-pressed", x === active ? "true" : "false");
    });
  }

  updateHistoryRangeSummary();
}

function recordPortfolioSnapshot() {
  const t = totals();
  if (!(t.value > 0 || t.cost > 0)) return;

  const date = todayISO();
  const snapshot = {
    date,
    value: Number(t.value.toFixed(6)),
    cost: Number(t.cost.toFixed(6)),
    pnl: Number(t.pnl.toFixed(6))
  };

  const existingIndex = state.history.findIndex(x => x.date === date);
  if (existingIndex >= 0) {
    state.history[existingIndex] = snapshot;
  } else {
    state.history.push(snapshot);
  }

  // localStorage'ın gereksiz büyümemesi için yaklaşık 5 yıllık günlük kayıt yeterli.
  state.history = state.history
    .sort((a,b) => String(a.date).localeCompare(String(b.date)))
    .slice(-1850);
}

function fillTxAssets() {
  $("txAsset").innerHTML = state.assets.map(a => `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name || "")}</option>`).join("");
}

function addAssetFromForm(e) {
  e.preventDefault();
  const type = $("assetType").value;
  const code = $("assetCode").value.trim().toUpperCase();
  if (!code) return;

  const existing = state.assets.find(a => a.code === code && a.type === type);
  if (existing) {
    $("assetModal").close();
    e.target.reset();
    $("assetDate").value = todayISO();
    openTransaction(existing.id);
    return;
  }

  const id = crypto.randomUUID();
  const asset = {
    id, type, code,
    name: $("assetName").value.trim(),
    currentPrice: Number($("assetCurrentPrice").value || 0),
    previousPrice: Number($("assetCurrentPrice").value || 0),
    lastUpdated: null
  };
  state.assets.push(asset);

  const qty = Number($("assetQty").value || 0);
  const price = Number($("assetBuyPrice").value || 0);
  if (qty > 0 && price > 0) {
    state.transactions.push({
      id: crypto.randomUUID(),
      assetId: id,
      type: "buy",
      qty, price,
      date: $("assetDate").value || todayISO()
    });
  }
  save();
  $("assetModal").close();
  e.target.reset();
  $("assetDate").value = todayISO();
  render();

  if (type === "fund") refreshOne(id);
  if (type === "stock") refreshStockOne(id);
}

function addTransaction(e) {
  e.preventDefault();
  if (!state.assets.length) return;

  const assetId = $("txAsset").value;
  const type = $("txType").value;
  const qty = Number($("txQty").value);
  const price = Number($("txPrice").value);
  const asset = state.assets.find(a => a.id === assetId);
  if (!asset || !(qty > 0) || !(price > 0)) return;

  if (type === "sell") {
    const current = calcAsset(asset).qty;
    if (qty > current + 0.000000001) {
      alert(`Satış adedi mevcut adetten fazla olamaz. Mevcut: ${num(current)}`);
      return;
    }
  }

  state.transactions.push({
    id: crypto.randomUUID(),
    assetId,
    type,
    qty,
    price,
    date: $("txDate").value
  });
  save();
  $("transactionModal").close();
  e.target.reset();
  $("txDate").value = todayISO();
  render();
}



async function fetchStockPrice(code) {
  const base = getApiBase();
  if (!base) throw new Error("Önce Ayarlar bölümünden Worker URL adresini kaydedin.");

  const cleanCode = String(code || "").trim().toUpperCase().replace(/\.IS$/, "");
  const r = await fetch(`${base}/api/stock/${encodeURIComponent(cleanCode)}`, {
    headers: { "Accept": "application/json" }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || `API hatası (${r.status})`);

  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Geçerli hisse fiyatı bulunamadı.");
  return data;
}

async function refreshStockOne(id) {
  const asset = state.assets.find(a => a.id === id);
  if (!asset || asset.type !== "stock") return;

  setStatus(`${asset.code} güncelleniyor…`);
  try {
    const data = await fetchStockPrice(asset.code);
    asset.previousPrice = Number(data.previousPrice) > 0
      ? Number(data.previousPrice)
      : Number(asset.currentPrice || data.price);
    asset.currentPrice = Number(data.price);
    asset.lastUpdated = data.date || new Date().toISOString();
    if ((!asset.name || asset.name === asset.code) && data.name) asset.name = data.name;
    save(); render();
    setStatus(`${asset.code}: ${money(asset.currentPrice)}`);
  } catch (err) {
    setStatus(`Hata: ${err.message}`, true);
    alert(`${asset.code}: ${err.message}`);
  }
}

function openTransaction(assetId) {
  if (!state.assets.length) return;
  fillTxAssets();
  if (assetId) $("txAsset").value = assetId;
  $("txType").value = "buy";
  $("txDate").value = todayISO();
  $("transactionModal").showModal();
}

function deleteAsset(id) {
  if (!confirm("Varlık ve ona bağlı tüm alış işlemleri silinsin mi?")) return;
  state.assets = state.assets.filter(a => a.id !== id);
  state.transactions = state.transactions.filter(t => t.assetId !== id);
  save(); render();
}

function deleteTx(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
  save(); render();
}

function getApiBase() {
  return $("apiBaseInput").value.trim().replace(/\/+$/, "");
}

async function fetchFundPrice(code) {
  const base = getApiBase();
  if (!base) throw new Error("Önce Ayarlar bölümünden Worker URL adresini kaydedin.");

  const r = await fetch(`${base}/api/fund/${encodeURIComponent(code)}`, {
    headers: { "Accept": "application/json" }
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || `API hatası (${r.status})`);

  const price = Number(data.price);
  if (!Number.isFinite(price) || price <= 0) throw new Error("Geçerli fon fiyatı bulunamadı.");
  return data;
}

async function refreshOne(id) {
  const asset = state.assets.find(a => a.id === id);
  if (!asset || asset.type !== "fund") return;

  setStatus(`${asset.code} güncelleniyor…`);
  try {
    const data = await fetchFundPrice(asset.code);
    asset.previousPrice = Number(asset.currentPrice || data.previousPrice || data.price);
    if (Number(data.previousPrice) > 0) asset.previousPrice = Number(data.previousPrice);
    asset.currentPrice = Number(data.price);
    asset.lastUpdated = data.date || new Date().toISOString();
    if (!asset.name && data.name) asset.name = data.name;
    save(); render();
    setStatus(`${asset.code}: ${money(asset.currentPrice)}`);
  } catch (err) {
    setStatus(`Hata: ${err.message}`, true);
    alert(`${asset.code}: ${err.message}`);
  }
}

async function refreshAll() {
  const assets = state.assets.filter(a => a.type === "fund" || a.type === "stock");
  if (!assets.length) {
    setStatus("Güncellenecek varlık yok");
    return;
  }

  let success = 0;
  for (const asset of assets) {
    try {
      const data = asset.type === "fund"
        ? await fetchFundPrice(asset.code)
        : await fetchStockPrice(asset.code);

      asset.previousPrice = Number(data.previousPrice) > 0
        ? Number(data.previousPrice)
        : Number(asset.currentPrice || data.price);
      asset.currentPrice = Number(data.price);
      asset.lastUpdated = data.date || new Date().toISOString();
      if ((!asset.name || asset.name === asset.code) && data.name) asset.name = data.name;
      success++;
    } catch (e) {
      console.warn(asset.code, e);
    }
  }
  if (success > 0) recordPortfolioSnapshot();
  save(); render();
  setStatus(`${success}/${assets.length} varlık güncellendi`, success !== assets.length);
}


function compactNumber(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat("tr-TR", { notation:"compact", maximumFractionDigits:2 }).format(v);
}

function metricValue(value, format="number") {
  if (format === "text") return value ? escapeHtml(String(value)) : "—";
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  const n = Number(value);
  if (format === "money") return money(n);
  if (format === "percent") return pct(n);
  if (format === "compactMoney") return `${compactNumber(n)} ₺`;
  if (format === "compact") return compactNumber(n);
  if (format === "ratio") return new Intl.NumberFormat("tr-TR", {maximumFractionDigits:2}).format(n);
  return num(n, 2);
}

function researchMetricCard(label, value, format="number", tone="") {
  return `<article class="research-metric-card ${tone}"><span>${escapeHtml(label)}</span><strong>${metricValue(value, format)}</strong></article>`;
}

function researchDetailItem(label, value, format="number", helper="") {
  return `<div class="research-detail-item"><span>${escapeHtml(label)}</span><strong>${metricValue(value, format)}</strong>${helper ? `<small>${escapeHtml(helper)}</small>` : ""}</div>`;
}

async function fetchResearch(type, code) {
  const base = getApiBase();
  if (!base) throw new Error("Önce Ayarlar bölümünden Worker URL adresini kaydedin.");
  const cleanCode = String(code || "").trim().toUpperCase().replace(/\.IS$/, "");
  const r = await fetch(`${base}/api/research/${type}/${encodeURIComponent(cleanCode)}`, { headers:{"Accept":"application/json"} });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.ok === false) throw new Error(data.error || `API hatası (${r.status})`);
  return data;
}

function renderResearchPerformanceChart(data, type) {
  if (!window.Chart) return;
  const ctx = $("researchChart");
  if (!ctx) return;
  if (state.researchChart) state.researchChart.destroy();

  const p = data.performance || {};
  const rows = [
    ["1H", p.week], ["1A", p.month1], ["3A", p.month3], ["6A", p.month6], ["1Y", p.year1]
  ].filter(([,v]) => Number.isFinite(Number(v)));
  const colors = semanticColors();

  $("researchChartTitle").textContent = type === "fund" ? "Fon Performansı" : "Hisse Performansı";
  $("researchChartSubtitle").textContent = rows.length ? "Seçili dönemlerde yüzde getiri" : "Dönemsel veri bulunamadı";

  state.researchChart = new Chart(ctx, {
    type:"bar",
    data:{
      labels:rows.map(x => x[0]),
      datasets:[{
        data:rows.map(x => Number(x[1])),
        backgroundColor:rows.map(x => Number(x[1]) >= 0 ? colors.positive : colors.negative),
        borderRadius:8,
        borderSkipped:false,
        maxBarThickness:44
      }]
    },
    options:{
      responsive:true,
      maintainAspectRatio:false,
      scales:{
        x:{grid:{display:false},ticks:{color:chartTextColor()}},
        y:{grid:{color:chartGridColor()},ticks:{color:chartTextColor(),callback:v => `${Number(v).toFixed(0)}%`}}
      },
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx => `${Number(ctx.raw).toLocaleString("tr-TR",{minimumFractionDigits:2,maximumFractionDigits:2})}%`}}}
    }
  });
}


const FUND_META_CACHE_KEY = "portfoyum_fund_research_meta_v1";

function getFundResearchMetaCache() {
  try { return JSON.parse(localStorage.getItem(FUND_META_CACHE_KEY) || "{}"); }
  catch { return {}; }
}

function validResearchNumber(v, { allowZero=false } = {}) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  if (!allowZero && n === 0) return null;
  return n;
}

function mergeFundResearchMeta(code, meta={}) {
  const cache = getFundResearchMetaCache();
  const old = cache[code] || {};

  const fundTotalValue = validResearchNumber(meta.fundTotalValue);
  const investorCount = validResearchNumber(meta.investorCount);
  const shareCount = validResearchNumber(meta.shareCount);
  const riskValue = validResearchNumber(meta.riskValue, {allowZero:false});

  const merged = {
    fundTotalValue: fundTotalValue ?? old.fundTotalValue ?? null,
    investorCount: investorCount ?? old.investorCount ?? null,
    shareCount: shareCount ?? old.shareCount ?? null,
    riskValue: riskValue ?? old.riskValue ?? null,
    riskLabel: meta.riskLabel || old.riskLabel || null,
    savedAt: Date.now()
  };

  cache[code] = merged;
  try { localStorage.setItem(FUND_META_CACHE_KEY, JSON.stringify(cache)); } catch {}
  return merged;
}

function researchScoreCard(label, value, subtitle="") {
  const shown = value === null || value === undefined || !Number.isFinite(Number(value))
    ? "—"
    : Number(value).toLocaleString("tr-TR",{minimumFractionDigits:2,maximumFractionDigits:2});
  return `<div class="research-score-card"><span>${escapeHtml(label)}</span><strong>${shown}</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ""}</div>`;
}

function destroyFundResearchCharts() {
  ["fundPriceHistoryChart","fundDrawdownChart","fundVolatilityChart","fundAllocationDetailChart","fundBenchmarkChart","fundAumHistoryChart","fundInvestorHistoryChart"].forEach(k => {
    if (state[k]) { state[k].destroy(); state[k]=null; }
  });
}

function fundSeriesLabels(rows) {
  return rows.map(x => new Date(x.date).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"}));
}

function renderFundAdvancedCharts(d) {
  const host = $("fundAdvancedAnalysis");
  if (!host) return;
  host.hidden = false;
  destroyFundResearchCharts();

  const series=d.series||{};
  const price=Array.isArray(series.price)?series.price:[];
  const dd=Array.isArray(series.drawdown)?series.drawdown:[];
  const v30=Array.isArray(series.volatility30)?series.volatility30:[];
  const v90=Array.isArray(series.volatility90)?series.volatility90:[];

  const commonOptions = {
    responsive:true,
    maintainAspectRatio:false,
    interaction:{mode:"index",intersect:false},
    plugins:{legend:{labels:{color:chartTextColor(),usePointStyle:true,boxWidth:8}}},
    scales:{
      x:{grid:{display:false},ticks:{color:chartTextColor(),autoSkip:true,maxTicksLimit:8,maxRotation:0}},
      y:{grid:{color:chartGridColor()},ticks:{color:chartTextColor()}}
    }
  };

  const priceCtx=$("fundPriceHistoryChart");
  if (priceCtx && price.length) {
    state.fundPriceHistoryChart=new Chart(priceCtx,{
      type:"line",
      data:{
        labels:fundSeriesLabels(price),
        datasets:[{
          label:"Birim Pay Fiyatı",
          data:price.map(x=>Number(x.value)),
          borderColor:"#6F8877",
          backgroundColor:"rgba(111,136,119,.10)",
          fill:true,tension:.28,pointRadius:0,borderWidth:2
        }]
      },
      options:{
        ...commonOptions,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>money(ctx.raw)}}},
        scales:{
          ...commonOptions.scales,
          y:{grid:{color:chartGridColor()},ticks:{color:chartTextColor(),callback:v=>money(v)}}
        }
      }
    });
  }

  const ddCtx=$("fundDrawdownChart");
  if (ddCtx && dd.length) {
    state.fundDrawdownChart=new Chart(ddCtx,{
      type:"line",
      data:{
        labels:fundSeriesLabels(dd),
        datasets:[{
          label:"Drawdown",
          data:dd.map(x=>Number(x.value)),
          borderColor:getComputedStyle(document.documentElement).getPropertyValue("--negative").trim()||"#c45f67",
          backgroundColor:"rgba(196,95,103,.08)",
          fill:true,tension:.2,pointRadius:0,borderWidth:1.8
        }]
      },
      options:{
        ...commonOptions,
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>pct(ctx.raw)}}},
        scales:{
          ...commonOptions.scales,
          y:{max:0,grid:{color:chartGridColor()},ticks:{color:chartTextColor(),callback:v=>`${Number(v).toFixed(0)}%`}}
        }
      }
    });
  }

  const volCtx=$("fundVolatilityChart");
  if (volCtx && (v30.length||v90.length)) {
    const base=v30.length?v30:v90;
    const map90=new Map(v90.map(x=>[String(x.date).slice(0,10),Number(x.value)]));
    state.fundVolatilityChart=new Chart(volCtx,{
      type:"line",
      data:{
        labels:fundSeriesLabels(base),
        datasets:[
          {
            label:"30 Gün",
            data:base.map(x=>Number(x.value)),
            borderColor:"#6F8877",pointRadius:0,tension:.25,borderWidth:1.8
          },
          {
            label:"90 Gün",
            data:base.map(x=>map90.get(String(x.date).slice(0,10))??null),
            borderColor:"#B59A6A",pointRadius:0,tension:.25,borderWidth:1.8
          }
        ]
      },
      options:{
        ...commonOptions,
        scales:{
          ...commonOptions.scales,
          y:{grid:{color:chartGridColor()},ticks:{color:chartTextColor(),callback:v=>`${Number(v).toFixed(0)}%`}}
        },
        plugins:{legend:{labels:{color:chartTextColor(),usePointStyle:true,boxWidth:8}},tooltip:{callbacks:{label:ctx=>`${ctx.dataset.label}: ${pct(ctx.raw)}`}}}
      }
    });
  }
}

function formatDateShort(v) {
  if (!v) return "";
  try { return new Date(v).toLocaleDateString("tr-TR",{day:"2-digit",month:"short",year:"numeric"}); }
  catch { return ""; }
}




function normalizeMonthlyDisplayValue(v, unit="") {
  const n=Number(v);
  if (!Number.isFinite(n)) return null;
  if (unit === "percent") return n;
  // Fonoloji return fields are generally decimal ratios; derived NAV values are percentage points.
  return Math.abs(n) <= 3 ? n*100 : n;
}

function renderMonthlyHeatmap(rows=[]) {
  if (!Array.isArray(rows) || !rows.length) {
    return `<div class="provider-empty">Aylık getiri verisi bulunamadı.</div>`;
  }

  const normalized=rows
    .map(x=>({date:x.date,value:normalizeMonthlyDisplayValue(x.value,x.unit)}))
    .filter(x=>x.date && Number.isFinite(x.value))
    .slice(-18);

  return `<div class="monthly-heatmap">${normalized.map(x=>{
    const d=new Date(String(x.date).length===7 ? `${x.date}-01T12:00:00` : x.date);
    const label=Number.isNaN(d.getTime()) ? String(x.date) : d.toLocaleDateString("tr-TR",{month:"short",year:"2-digit"});
    const tone=x.value>=0?"heat-positive":"heat-negative";
    const intensity=Math.min(1,Math.abs(x.value)/15);
    return `<div class="heat-cell ${tone}" style="--heat:${intensity.toFixed(2)}">
      <span>${escapeHtml(label)}</span>
      <strong>${x.value>=0?"+":""}${pct(x.value)}</strong>
    </div>`;
  }).join("")}</div>`;
}

function renderAllocationList(rows=[]) {
  if (!Array.isArray(rows) || !rows.length) return `<div class="provider-empty">Portföy dağılımı bulunamadı.</div>`;
  return `<div class="allocation-list">${rows.slice(0,10).map(x=>`
    <div class="allocation-row">
      <span>${escapeHtml(x.label||x.key||"Varlık")}</span>
      <strong>${pct(x.value)}</strong>
      <i><b style="width:${Math.max(0,Math.min(100,Number(x.value)||0))}%"></b></i>
    </div>`).join("")}</div>`;
}

function renderHoldings(rows=[]) {
  if (!Array.isArray(rows) || !rows.length) return `<div class="provider-empty">Detaylı pozisyon verisi bulunamadı.</div>`;
  return `<div class="holdings-table">
    <div class="holdings-row holdings-head"><span>Varlık</span><span>Tür</span><strong>Ağırlık</strong></div>
    ${rows.slice(0,15).map(x=>`<div class="holdings-row">
      <span><b>${escapeHtml(x.code||"")}</b><small>${escapeHtml(x.name||"")}</small></span>
      <span>${escapeHtml(x.type||"—")}</span>
      <strong>${Number.isFinite(Number(x.weight)) ? pct(Number(x.weight)) : "—"}</strong>
    </div>`).join("")}
  </div>`;
}

function quotaNumbers(q) {
  const data=q?.data ?? q ?? {};
  const monthlyLimit=Number(
    data.monthly_limit ?? data.limit_monthly ?? data.monthly?.limit ??
    data.limits?.monthly ?? data.limitMonthly
  );
  const monthlyRemaining=Number(
    data.monthly_remaining ?? data.remaining_monthly ?? data.monthly?.remaining ??
    data.remaining?.monthly ?? data.remainingMonthly
  );
  const monthlyUsed=Number(
    data.monthly_used ?? data.used_monthly ?? data.monthly?.used ??
    (Number.isFinite(monthlyLimit)&&Number.isFinite(monthlyRemaining) ? monthlyLimit-monthlyRemaining : NaN)
  );
  return {
    limit:Number.isFinite(monthlyLimit)?monthlyLimit:null,
    remaining:Number.isFinite(monthlyRemaining)?monthlyRemaining:null,
    used:Number.isFinite(monthlyUsed)?monthlyUsed:null
  };
}

function renderQuotaBadge(q) {
  const n=quotaNumbers(q);
  if (!Number.isFinite(n.limit) || !Number.isFinite(n.remaining)) {
    return `<span class="quota-pill">API kota bilgisi bekleniyor</span>`;
  }
  const used=Math.max(0,n.limit-n.remaining);
  const ratio=n.limit>0?used/n.limit:0;
  const cls=ratio>=.9?"quota-danger":ratio>=.7?"quota-warn":"quota-ok";
  return `<span class="quota-pill ${cls}">Fonoloji · ${compactNumber(n.remaining)} / ${compactNumber(n.limit)} kaldı</span>`;
}

function renderFundProviderInsights(d) {
  const host=$("fundProviderInsights");
  if (!host) return;

  const allocation=Array.isArray(d.portfolio?.allocation)?d.portfolio.allocation:[];
  const monthly=Array.isArray(d.providerInsights?.monthly)?d.providerInsights.monthly:[];
  const benchmark=Array.isArray(d.providerInsights?.benchmark)?d.providerInsights.benchmark:[];

  // Lazy details (holdings/history) may still arrive later, so keep the host visible.
  host.hidden=false;

  const topCards=[];

  if (allocation.length) {
    topCards.push(`
      <article class="panel provider-allocation-panel">
        <div class="panel-head source-panel-head">
          <div><h2>Portföy Dağılımı</h2><p>Son Fonoloji portföy snapshot'ı</p></div>
          <span class="source-badge source-fonoloji">FONOLOJİ</span>
        </div>
        <div class="allocation-layout">
          <div class="provider-chart-square"><canvas id="fundAllocationDetailChart"></canvas></div>
          ${renderAllocationList(allocation)}
        </div>
      </article>`);
  }

  if (monthly.length) {
    topCards.push(`
      <article class="panel provider-monthly-panel">
        <div class="panel-head source-panel-head">
          <div><h2>Aylık Getiri Haritası</h2><p>Son dönemlerin aylık performansı</p></div>
          <span class="source-badge source-fonoloji">FONOLOJİ</span>
        </div>
        ${renderMonthlyHeatmap(monthly)}
      </article>`);
  }

  const benchmarkPanel=benchmark.length ? `
    <article class="panel provider-benchmark-panel">
      <div class="panel-head source-panel-head">
        <div><h2>Benchmark Karşılaştırması</h2><p>Fon performansı ile karşılaştırma serisi</p></div>
        <span class="source-badge source-fonoloji">FONOLOJİ</span>
      </div>
      <div class="chart-wrap provider-benchmark-chart"><canvas id="fundBenchmarkChart"></canvas></div>
    </article>` : "";

  host.innerHTML=`
    <div class="provider-insight-header">
      <div><p class="eyebrow">FONOLOJİ DETAYLARI</p><h2>Fonun İçini Gör</h2></div>
      <div id="fonolojiQuotaBadge">${renderQuotaBadge(null)}</div>
    </div>

    ${topCards.length ? `<div class="provider-grid provider-grid-${topCards.length}">${topCards.join("")}</div>` : ""}
    ${benchmarkPanel}

    <div id="fundLazyExtras" class="fund-lazy-extras">
      <article class="panel provider-loading-panel">
        <div class="provider-spinner"></div>
        <div><strong>Detaylı veriler kontrol ediliyor</strong><span>Veri yoksa bölüm otomatik gizlenir.</span></div>
      </article>
    </div>
  `;

  renderProviderMainCharts(d);
}

function renderProviderMainCharts(d) {
  if (!window.Chart) return;
  const allocation=Array.isArray(d.portfolio?.allocation)?d.portfolio.allocation:[];
  const benchmark=Array.isArray(d.providerInsights?.benchmark)?d.providerInsights.benchmark:[];
  const price=Array.isArray(d.series?.price)?d.series.price:[];

  const allocCtx=$("fundAllocationDetailChart");
  if (allocCtx && allocation.length) {
    if (state.fundAllocationDetailChart) state.fundAllocationDetailChart.destroy();
    state.fundAllocationDetailChart=new Chart(allocCtx,{
      type:"doughnut",
      data:{
        labels:allocation.map(x=>x.label||x.key),
        datasets:[{data:allocation.map(x=>Number(x.value)),borderWidth:0}]
      },
      options:{
        responsive:true,maintainAspectRatio:false,cutout:"68%",
        plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>`${ctx.label}: ${pct(ctx.raw)}`}}}
      }
    });
  }

  const benchCtx=$("fundBenchmarkChart");
  if (benchCtx && benchmark.length && price.length) {
    if (state.fundBenchmarkChart) state.fundBenchmarkChart.destroy();

    // Normalize both series to 100 at their first available point to compare shape.
    const priceMap=new Map(price.map(x=>[String(x.date).slice(0,10),Number(x.value)]));
    const benchClean=benchmark.filter(x=>x.date&&Number.isFinite(Number(x.value)));
    const common=benchClean.filter(x=>priceMap.has(String(x.date).slice(0,10)));
    if (common.length>=2) {
      const p0=priceMap.get(String(common[0].date).slice(0,10));
      const b0=Number(common[0].value);
      const benchmarkLooksLikeReturn=Math.abs(b0)<5 && common.some(x=>Math.abs(Number(x.value))<5);

      const labels=common.map(x=>new Date(x.date).toLocaleDateString("tr-TR",{day:"2-digit",month:"short"}));
      const fundValues=common.map(x=>priceMap.get(String(x.date).slice(0,10))/p0*100);
      const benchmarkValues=benchmarkLooksLikeReturn
        ? common.map(x=>100*(1+Number(x.value)))
        : common.map(x=>Number(x.value)/b0*100);

      state.fundBenchmarkChart=new Chart(benchCtx,{
        type:"line",
        data:{labels,datasets:[
          {label:d.code||"Fon",data:fundValues,borderWidth:2,pointRadius:0,tension:.2},
          {label:"Benchmark",data:benchmarkValues,borderWidth:1.8,pointRadius:0,tension:.2}
        ]},
        options:{
          responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},
          plugins:{legend:{labels:{color:chartTextColor(),usePointStyle:true,boxWidth:8}}},
          scales:{
            x:{grid:{display:false},ticks:{color:chartTextColor(),autoSkip:true,maxTicksLimit:9,maxRotation:0}},
            y:{grid:{color:chartGridColor()},ticks:{color:chartTextColor(),callback:v=>`${Number(v).toFixed(0)}`}}
          }
        }
      });
    }
  }
}

async function fetchFundExtras(code) {
  const base=getApiBase();
  const r=await fetch(`${base}/api/research/fund/${encodeURIComponent(code)}/extras`,{headers:{"Accept":"application/json"}});
  const data=await r.json().catch(()=>({}));
  if (!r.ok || data.ok===false) throw new Error(data.error||`API hatası (${r.status})`);
  return data.data||data;
}

function renderFundHistoryChart(canvasId,stateKey,rows,label,valueFormatter) {
  const ctx=$(canvasId);
  if (!ctx || !window.Chart || !Array.isArray(rows) || rows.length<2) return;
  if (state[stateKey]) state[stateKey].destroy();
  state[stateKey]=new Chart(ctx,{
    type:"line",
    data:{
      labels:fundSeriesLabels(rows),
      datasets:[{label,data:rows.map(x=>Number(x.value)),pointRadius:0,borderWidth:2,tension:.22,fill:false}]
    },
    options:{
      responsive:true,maintainAspectRatio:false,interaction:{mode:"index",intersect:false},
      plugins:{legend:{display:false},tooltip:{callbacks:{label:ctx=>valueFormatter(ctx.raw)}}},
      scales:{
        x:{grid:{display:false},ticks:{color:chartTextColor(),autoSkip:true,maxTicksLimit:7,maxRotation:0}},
        y:{grid:{color:chartGridColor()},ticks:{color:chartTextColor(),callback:valueFormatter}}
      }
    }
  });
}

async function loadFundExtras(code) {
  const host=$("fundLazyExtras");
  if (!host) return;

  try {
    const extra=await fetchFundExtras(code);
    if (state.activeResearchFundCode!==code) return;

    const holdings=Array.isArray(extra.holdings)?extra.holdings:[];
    const aum=Array.isArray(extra.history?.aum)?extra.history.aum:[];
    const investors=Array.isArray(extra.history?.investors)?extra.history.investors:[];

    const quotaEl=$("fonolojiQuotaBadge");
    if (quotaEl) quotaEl.innerHTML=renderQuotaBadge(extra.quota);

    const cards=[];

    if (holdings.length) {
      cards.push(`
        <article class="panel provider-holdings-panel">
          <div class="panel-head source-panel-head">
            <div><h2>En Büyük Pozisyonlar</h2><p>${extra.portfolioDate ? formatDateShort(extra.portfolioDate)+" portföyü" : "Fonoloji portföy detayı"}</p></div>
            <span class="source-badge source-fonoloji">FONOLOJİ</span>
          </div>
          ${renderHoldings(holdings)}
        </article>`);
    }

    const historyCards=[];
    if (aum.length>=2) {
      historyCards.push(`
        <article class="panel">
          <div class="panel-head"><div><h2>Fon Büyüklüğü Geçmişi</h2><p>1 yıllık yönetilen varlık değişimi</p></div></div>
          <div class="chart-wrap provider-history-chart"><canvas id="fundAumHistoryChart"></canvas></div>
        </article>`);
    }
    if (investors.length>=2) {
      historyCards.push(`
        <article class="panel">
          <div class="panel-head"><div><h2>Yatırımcı Sayısı Geçmişi</h2><p>1 yıllık yatırımcı değişimi</p></div></div>
          <div class="chart-wrap provider-history-chart"><canvas id="fundInvestorHistoryChart"></canvas></div>
        </article>`);
    }

    if (historyCards.length) {
      cards.push(`<div class="provider-grid history-grid provider-grid-${historyCards.length}">${historyCards.join("")}</div>`);
    }

    if (!cards.length) {
      host.remove();
      return;
    }

    host.innerHTML=cards.join("");

    if (aum.length>=2) renderFundHistoryChart("fundAumHistoryChart","fundAumHistoryChart",aum,"Fon Büyüklüğü",v=>`${compactNumber(v)} ₺`);
    if (investors.length>=2) renderFundHistoryChart("fundInvestorHistoryChart","fundInvestorHistoryChart",investors,"Yatırımcı",v=>compactNumber(v));
  } catch(err) {
    host.innerHTML=`<article class="panel provider-loading-panel provider-error">
      <div><strong>Detay verileri yüklenemedi</strong><span>${escapeHtml(err.message)}</span></div>
    </article>`;
  }
}

function renderFundResearch(data) {
  const d = data.data || data;
  state.activeResearchFundCode = d.code || null;
  const daily = Number(d.changePercent);
  const dailyCls = daily >= 0 ? "positive" : "negative";
  $("researchLogo").textContent = d.code?.slice(0,3) || "FON";
  $("researchName").textContent = d.name || d.code;
  $("researchBadge").textContent = "YATIRIM FONU";
  $("researchMeta").textContent = `${d.code} · ${d.source || "Fonoloji"} · ${d.date ? new Date(d.date).toLocaleDateString("tr-TR") : "Son veri"}`;
  $("researchPrice").textContent = money(d.price);
  $("researchDaily").className = `research-daily ${dailyCls}`;
  $("researchDaily").textContent = Number.isFinite(daily) ? `${daily >= 0 ? "+" : ""}${pct(daily)} · ${money(d.change)}` : "Günlük veri yok";

  const perf=d.performance||{}, risk=d.risk||{}, stats=d.stats||{};
  const meta=mergeFundResearchMeta(d.code,d.metadata||{});
  const fees=d.fees||{};

  $("researchPrimaryMetrics").innerHTML = [
    researchMetricCard("1 Aylık", perf.month1, "percent", Number(perf.month1)>=0?"gain":"loss"),
    researchMetricCard("3 Aylık", perf.month3, "percent", Number(perf.month3)>=0?"gain":"loss"),
    researchMetricCard("6 Aylık", perf.month6, "percent", Number(perf.month6)>=0?"gain":"loss"),
    researchMetricCard("1 Yıllık", perf.year1, "percent", Number(perf.year1)>=0?"gain":"loss")
  ].join("");

  $("researchDetailTitle").textContent = "Risk ve Fiyat İstatistikleri";
  $("researchDetailMetrics").innerHTML = [
    researchDetailItem("Sharpe Oranı", risk.sharpe, "ratio", risk.source==="Fonoloji" ? "Fonoloji · 90G" : "Yerel fallback"),
    researchDetailItem("Sortino Oranı", risk.sortino, "ratio", risk.source==="Fonoloji" ? "Fonoloji · 90G" : "Yerel fallback"),
    researchDetailItem("Calmar Oranı", risk.calmar, "ratio", risk.source==="Fonoloji" ? "Fonoloji · 1Y" : "Yerel fallback"),
    researchDetailItem("Yıllıklandırılmış Getiri", perf.annualizedReturnPct, "percent"),
    researchDetailItem("Yıllıklandırılmış Oynaklık", risk.annualizedVolatilityPct, "percent"),
    researchDetailItem("30G Oynaklık", risk.volatility30dPct, "percent"),
    researchDetailItem("90G Oynaklık", risk.volatility90dPct, "percent"),
    researchDetailItem("Maks. Düşüş", risk.maxDrawdownPct, "percent"),
    researchDetailItem("Pozitif Gün Oranı", risk.positiveDayRatioPct, "percent"),
    researchDetailItem("52H En Yüksek", stats.high52w, "money"),
    researchDetailItem("52H En Düşük", stats.low52w, "money"),
    researchDetailItem("Zirveye Uzaklık", stats.distanceFromHighPct, "percent"),
    researchDetailItem("En İyi Gün", stats.bestDayPct, "percent", formatDateShort(stats.bestDayDate)),
    researchDetailItem("En Kötü Gün", stats.worstDayPct, "percent", formatDateShort(stats.worstDayDate)),
    researchDetailItem("Beta (1Y)", risk.beta1y, "ratio", "Fonoloji"),
    researchDetailItem("MA 30", stats.ma30, "money", "Fonoloji"),
    researchDetailItem("MA 90", stats.ma90, "money", "Fonoloji"),
    researchDetailItem("MA 200", stats.ma200, "money", "Fonoloji"),
    researchDetailItem("Reel Getiri (1Y)", perf.realReturn1yPct, "percent", "Fonoloji"),
    researchDetailItem("Risk Değeri", meta.riskValue, "number", meta.riskLabel || "1–7"),
    researchDetailItem("Aşağı Yönlü Sapma", risk.downsideDeviationPct, "percent")
  ].join("");

  const sizePanel = `<article class="panel research-mini-panel">
    <div class="panel-head source-panel-head">
      <div><h2>Fon Büyüklüğü</h2><p>Fonoloji ana kaynak · son başarılı değer korunur</p></div>
      <span class="source-badge source-fonoloji">FONOLOJİ</span>
    </div>
    <div class="research-detail-grid">
      ${researchDetailItem("Fon Toplam Değeri",meta.fundTotalValue,"compactMoney")}
      ${researchDetailItem("Yatırımcı Sayısı",meta.investorCount,"compact")}
      ${researchDetailItem("Tedavüldeki Pay",meta.shareCount,"compact")}
      ${researchDetailItem("Risk Profili",meta.riskValue,"number",meta.riskLabel||"—")}
    </div>
  </article>`;

  const profilePanel = `<article class="panel research-mini-panel">
    <div class="panel-head"><div><h2>Fon Profili</h2><p>Fonoloji fon kimliği ve işlem bilgileri</p></div></div>
    <div class="research-detail-grid">
      ${researchDetailItem("Kategori",d.category,"text")}
      ${researchDetailItem("Yönetim Şirketi",d.managementCompany,"text")}
      ${researchDetailItem("ISIN",d.isin,"text")}
      ${researchDetailItem("İşlem Durumu",d.tradingStatus,"text")}
      ${researchDetailItem("Alış Valörü",d.buyValor,"number")}
      ${researchDetailItem("Satış Valörü",d.sellValor,"number")}
    </div>
  </article>`;

  const feePanel = `<article class="panel research-mini-panel">
    <div class="panel-head source-panel-head">
      <div><h2>Ücret ve Giderler</h2><p>KAP'ta doğrulanabilen güncel oranlar</p></div>
      <span class="source-badge source-kap">KAP</span>
    </div>
    <div class="research-detail-grid">
      ${researchDetailItem("Yıllık Yönetim Ücreti",fees.annualManagementFeePct,"percent")}
      ${researchDetailItem("Toplam Gider Oranı",fees.totalExpenseRatioPct,"percent")}
      ${researchDetailItem("Giriş Komisyonu",fees.entryCommissionPct,"percent")}
      ${researchDetailItem("Çıkış Komisyonu",fees.exitCommissionPct,"percent")}
      ${researchDetailItem("Performans Ücreti",fees.performanceFeePct,"percent")}
    </div>
  </article>`;

  $("researchSecondarySections").innerHTML = sizePanel + profilePanel + feePanel;
  $("researchDisclaimer").textContent = "Fon ana metrikleri Fonoloji API’den; ücret bilgileri bulunabildiğinde KAP’tan alınır. Fiyat/geçmiş tarafında Fonoloji timeseries önceliklidir, TEFAS fallback olarak korunur. Geçmiş performans gelecekteki getiriyi garanti etmez.";

  renderResearchPerformanceChart(d,"fund");
  renderFundAdvancedCharts(d);
  renderFundProviderInsights(d);
  loadFundExtras(d.code);
}

function renderStockResearch(data) {
  state.activeResearchFundCode=null;
  const provider=$("fundProviderInsights"); if (provider) provider.hidden=true;
  const adv=$("fundAdvancedAnalysis"); if (adv) adv.hidden=true; destroyFundResearchCharts();
  const d=data.data||data;
  const daily=Number(d.changePercent), dailyCls=daily>=0?"positive":"negative";
  $("researchLogo").textContent=d.code?.slice(0,3)||"BIST";
  $("researchName").textContent=d.name||d.code;
  $("researchBadge").textContent="BIST HİSSESİ";
  const sector=[d.sector,d.industry].filter(Boolean).join(" · ");
  $("researchMeta").textContent=`${d.code} · Borsa İstanbul${sector ? " · "+sector : ""}`;
  $("researchPrice").textContent=money(d.price);
  $("researchDaily").className=`research-daily ${dailyCls}`;
  $("researchDaily").textContent=Number.isFinite(daily)?`${daily>=0?"+":""}${pct(daily)} · ${money(d.change)}`:"Günlük veri yok";

  const f=d.fundamentals||{}, t=d.technicals||{}, s=d.stats||{};
  $("researchPrimaryMetrics").innerHTML=[
    researchMetricCard("Piyasa Değeri",f.marketCap,"compactMoney"),
    researchMetricCard("F/K",f.pe,"ratio"),
    researchMetricCard("PD/DD",f.priceToBook,"ratio"),
    researchMetricCard("Temettü Verimi",f.dividendYield,"percent")
  ].join("");

  $("researchDetailTitle").textContent="Finansal ve Teknik Metrikler";
  $("researchDetailMetrics").innerHTML=[
    researchDetailItem("Hacim",d.volume,"compact"),
    researchDetailItem("Hisse Başına Kâr (TTM)",f.epsTtm,"money"),
    researchDetailItem("Beta (1Y)",f.beta1y,"ratio"),
    researchDetailItem("52H En Yüksek",s.high52w,"money"),
    researchDetailItem("52H En Düşük",s.low52w,"money"),
    researchDetailItem("RSI",t.rsi,"ratio"),
    researchDetailItem("SMA50",t.sma50,"money"),
    researchDetailItem("SMA200",t.sma200,"money")
  ].join("");

  const perf=d.performance||{};
  $("researchSecondarySections").innerHTML=`<article class="panel research-mini-panel"><div class="panel-head"><div><h2>Performans Özeti</h2><p>Farklı dönemlerde fiyat değişimi</p></div></div><div class="research-detail-grid">${researchDetailItem("1 Hafta",perf.week,"percent")}${researchDetailItem("1 Ay",perf.month1,"percent")}${researchDetailItem("3 Ay",perf.month3,"percent")}${researchDetailItem("6 Ay",perf.month6,"percent")}${researchDetailItem("1 Yıl",perf.year1,"percent")}${researchDetailItem("Teknik Skor",t.recommendation,"ratio","-1 güçlü sat / +1 güçlü al")}</div></article>`;
  $("researchDisclaimer").textContent="BIST metrikleri gecikmeli piyasa/veri tarayıcı verisinden gelir. Gösterilen değerler yatırım tavsiyesi değildir.";
  renderResearchPerformanceChart(d,"stock");
}

function setupResearch() {
  const form=$("researchForm");
  if (!form) return;

  const codeInput=$("researchCode");
  if (codeInput) {
    const forceUppercase = () => {
      const start = codeInput.selectionStart;
      const end = codeInput.selectionEnd;
      const upper = codeInput.value.toLocaleUpperCase("tr-TR");
      if (codeInput.value !== upper) {
        codeInput.value = upper;
        try {
          if (start !== null && end !== null) codeInput.setSelectionRange(start, end);
        } catch {}
      }
    };

    codeInput.addEventListener("input", forceUppercase);
    codeInput.addEventListener("change", forceUppercase);
    codeInput.addEventListener("paste", () => setTimeout(forceUppercase, 0));
  }
  form.addEventListener("submit", async e => {
    e.preventDefault();
    const type=$("researchType").value;
    const code=$("researchCode").value.trim().toUpperCase().replace(/\.IS$/,"");
    if (!code) return;
    $("researchStatus").textContent=`${code} verileri getiriliyor…`;
    $("researchResult").hidden=true;
    try {
      const data=await fetchResearch(type,code);
      $("researchResult").hidden=false;
      type==="fund"?renderFundResearch(data):renderStockResearch(data);
      $("researchStatus").textContent=`${code} başarıyla yüklendi.`;
    } catch(err) {
      $("researchStatus").textContent=`Hata: ${err.message}`;
    }
  });
}

function setStatus(text, error=false) {
  const el = $("dataStatus");
  el.textContent = text;
  el.className = `status-pill ${error ? "negative" : ""}`;
}

function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function setupNav() {
  const titles = { dashboard:"Genel Bakış", portfolio:"Portföy", transactions:"İşlemler", research:"Varlık Araştır", settings:"Ayarlar" };
  document.querySelectorAll(".nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".view").forEach(v => v.classList.remove("active"));
      $(`${btn.dataset.view}View`).classList.add("active");
      $("pageTitle").textContent = titles[btn.dataset.view];
      if (btn.dataset.view === "settings") $("apiBaseInput").value = (JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}")).apiBase || "";
    });
  });
}

function setupModals() {
  document.querySelectorAll("[data-open-modal]").forEach(btn => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.openModal;
      if (which === "transaction" && !state.assets.length) {
        alert("Önce portföye bir varlık ekleyin.");
        return;
      }
      $(which === "asset" ? "assetModal" : "transactionModal").showModal();
    });
  });
  document.querySelectorAll("[data-close-modal]").forEach(btn => {
    btn.addEventListener("click", () => btn.closest("dialog").close());
  });
}

function setupFilters() {
  document.querySelectorAll(".filter").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter").forEach(x => x.classList.remove("active"));
      btn.classList.add("active");
      state.filter = btn.dataset.filter;
      renderCards();
    });
  });
}

function setupSettings() {
  $("saveApiBtn").addEventListener("click", () => {
    saveSettings({ apiBase: getApiBase() });
    $("apiTestResult").textContent = "Worker adresi kaydedildi.";
  });

  $("testApiBtn").addEventListener("click", async () => {
    $("apiTestResult").textContent = "Test ediliyor…";
    try {
      const d = await fetchFundPrice("TTE");
      $("apiTestResult").textContent = `Bağlantı başarılı. TTE fiyatı: ${money(d.price)}${d.date ? " · " + new Date(d.date).toLocaleDateString("tr-TR") : ""}`;
    } catch (e) {
      $("apiTestResult").textContent = `Bağlantı hatası: ${e.message}`;
    }
  });

  $("themeToggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    saveSettings({ theme: next });
    renderCharts();
  });

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({assets:state.assets, transactions:state.transactions, history:state.history}, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `portfoyum-${todayISO()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  $("importInput").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.assets) || !Array.isArray(data.transactions)) throw new Error("Geçersiz dosya");
      state.assets = data.assets;
      state.transactions = data.transactions;
      state.history = Array.isArray(data.history) ? data.history : [];
      save(); render();
      alert("Portföy içe aktarıldı.");
    } catch {
      alert("Dosya okunamadı.");
    }
  });

  $("clearBtn").addEventListener("click", () => {
    if (!confirm("Tüm portföy ve işlem verileri silinsin mi?")) return;
    state.assets = [];
    state.transactions = [];
    state.history = [];
    save(); render();
  });
}

$("assetForm").addEventListener("submit", addAssetFromForm);
$("transactionForm").addEventListener("submit", addTransaction);
$("refreshBtn").addEventListener("click", refreshAll);
$("assetDate").value = todayISO();
$("txDate").value = todayISO();

setupNav();
setupModals();
setupFilters();
setupSettings();
setupHistoryRangeFilters();
setupResearch();
load();
render();

window.refreshOne = refreshOne;
window.refreshStockOne = refreshStockOne;
window.openTransaction = openTransaction;
window.updateStockPrice = updateStockPrice;
window.deleteAsset = deleteAsset;
window.deleteTx = deleteTx;

