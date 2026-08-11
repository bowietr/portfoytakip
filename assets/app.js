const STORE_KEY = "portfoyum_v1";
const SETTINGS_KEY = "portfoyum_settings_v1";

const state = {
  assets: [],
  transactions: [],
  history: [],
  filter: "all",
  allocationChart: null,
  portfolioHistoryChart: null,
  dailyPerformanceChart: null
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
  document.documentElement.dataset.theme = settings.theme || "dark";
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

function renderCharts() {
  renderAllocationChart();
  renderPortfolioHistoryChart();
  renderDailyPerformanceChart();
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
          "#7f8c99","#9aa4ae","#66717c","#b1bac2","#565f68",
          "#8b959f","#747e88","#a4adb5","#626c75","#949ea7"
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

function renderPortfolioHistoryChart() {
  if (!window.Chart) return;
  const ctx = $("portfolioHistoryChart");
  if (!ctx) return;
  if (state.portfolioHistoryChart) state.portfolioHistoryChart.destroy();

  const points = [...state.history]
    .filter(x => x && x.date && Number.isFinite(Number(x.value)))
    .sort((a,b) => String(a.date).localeCompare(String(b.date)));

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
          borderColor: "#c5ccd3",
          backgroundColor: "rgba(197,204,211,.12)",
          fill: true,
          tension: .32,
          pointRadius: points.length > 20 ? 0 : 2,
          pointHoverRadius: 5,
          borderWidth: 2
        },
        {
          label: "Ana Para",
          data: points.map(x => Number(x.cost || 0)),
          borderColor: "#747f89",
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
      scales: {
        x: {
          grid: { display:false },
          ticks: { color:chartTextColor(), maxRotation:0, autoSkip:true, maxTicksLimit:8 }
        },
        y: {
          grid: { color:chartGridColor() },
          ticks: {
            color:chartTextColor(),
            callback: value => new Intl.NumberFormat("tr-TR", {notation:"compact", maximumFractionDigits:1}).format(value) + " ₺"
          }
        }
      },
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

function renderDailyPerformanceChart() {
  if (!window.Chart) return;
  const ctx = $("dailyPerformanceChart");
  if (!ctx) return;
  if (state.dailyPerformanceChart) state.dailyPerformanceChart.destroy();

  const rows = state.assets
    .map(a => ({ code:a.code, dailyPct:calcAsset(a).dailyPct }))
    .sort((a,b) => b.dailyPct - a.dailyPct);

  const positive = getComputedStyle(document.documentElement).getPropertyValue("--positive").trim() || "#8fa";
  const negative = getComputedStyle(document.documentElement).getPropertyValue("--negative").trim() || "#f88";
  const neutral = "#747f89";

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
      indexAxis: rows.length > 6 ? "y" : "x",
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
            label: ctx => `${Number(ctx.raw).toLocaleString("tr-TR", {minimumFractionDigits:2, maximumFractionDigits:2})}%`
          }
        }
      }
    }
  });
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

function setStatus(text, error=false) {
  const el = $("dataStatus");
  el.textContent = text;
  el.className = `status-pill ${error ? "negative" : ""}`;
}

function escapeHtml(s="") {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}

function setupNav() {
  const titles = { dashboard:"Genel Bakış", portfolio:"Portföy", transactions:"İşlemler", settings:"Ayarlar" };
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
load();
render();

window.refreshOne = refreshOne;
window.refreshStockOne = refreshStockOne;
window.openTransaction = openTransaction;
window.updateStockPrice = updateStockPrice;
window.deleteAsset = deleteAsset;
window.deleteTx = deleteTx;
