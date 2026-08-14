const APP_VERSION = "1.13.5";
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
  researchChart: null
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

function renderFundResearch(data) {
  const d = data.data || data;
  const daily = Number(d.changePercent);
  const dailyCls = daily >= 0 ? "positive" : "negative";
  $("researchLogo").textContent = d.code?.slice(0,3) || "FON";
  $("researchName").textContent = d.name || d.code;
  $("researchBadge").textContent = "YATIRIM FONU";
  $("researchMeta").textContent = `${d.code} · TEFAS · ${d.date ? new Date(d.date).toLocaleDateString("tr-TR") : "Son veri"}`;
  $("researchPrice").textContent = money(d.price);
  $("researchDaily").className = `research-daily ${dailyCls}`;
  $("researchDaily").textContent = Number.isFinite(daily) ? `${daily >= 0 ? "+" : ""}${pct(daily)} · ${money(d.change)}` : "Günlük veri yok";

  const perf=d.performance||{}, risk=d.risk||{}, stats=d.stats||{}, meta=d.metadata||{};
  $("researchPrimaryMetrics").innerHTML = [
    researchMetricCard("1 Aylık", perf.month1, "percent", Number(perf.month1)>=0?"gain":"loss"),
    researchMetricCard("3 Aylık", perf.month3, "percent", Number(perf.month3)>=0?"gain":"loss"),
    researchMetricCard("6 Aylık", perf.month6, "percent", Number(perf.month6)>=0?"gain":"loss"),
    researchMetricCard("1 Yıllık", perf.year1, "percent", Number(perf.year1)>=0?"gain":"loss")
  ].join("");

  $("researchDetailTitle").textContent = "Risk ve Fiyat İstatistikleri";
  $("researchDetailMetrics").innerHTML = [
    researchDetailItem("52H En Yüksek", stats.high52w, "money"),
    researchDetailItem("52H En Düşük", stats.low52w, "money"),
    researchDetailItem("Zirveye Uzaklık", stats.distanceFromHighPct, "percent"),
    researchDetailItem("Yıllıklandırılmış Oynaklık", risk.annualizedVolatilityPct, "percent"),
    researchDetailItem("Maks. Düşüş", risk.maxDrawdownPct, "percent"),
    researchDetailItem("Pozitif Gün Oranı", risk.positiveDayRatioPct, "percent"),
    researchDetailItem("Gözlem Sayısı", stats.observations, "number"),
    researchDetailItem("Risk Değeri", meta.riskValue, "number")
  ].join("");

  const extras=[];
  if (Number.isFinite(Number(meta.fundTotalValue)) || Number.isFinite(Number(meta.investorCount))) {
    extras.push(`<article class="panel research-mini-panel"><h3>Fon Büyüklüğü</h3><div class="research-detail-grid">${researchDetailItem("Fon Toplam Değeri",meta.fundTotalValue,"compactMoney")}${researchDetailItem("Yatırımcı Sayısı",meta.investorCount,"compact")}</div></article>`);
  }
  $("researchSecondarySections").innerHTML=extras.join("");
  $("researchDisclaimer").textContent = "Performans ve risk metrikleri TEFAS fiyat geçmişinden hesaplanır. Geçmiş getiri gelecekteki performansı garanti etmez.";
  renderResearchPerformanceChart(d,"fund");
}

function renderStockResearch(data) {
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

