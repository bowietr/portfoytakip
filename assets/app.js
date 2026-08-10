const STORE_KEY = "portfoyum_v1";
const SETTINGS_KEY = "portfoyum_settings_v1";

const state = {
  assets: [],
  transactions: [],
  filter: "all",
  allocationChart: null
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
  } catch {
    state.assets = [];
    state.transactions = [];
  }

  const settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  $("apiBaseInput").value = settings.apiBase || "";
  document.documentElement.dataset.theme = settings.theme || "dark";
}

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify({
    assets: state.assets,
    transactions: state.transactions
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
  const txs = getAssetTx(asset.id);
  const qty = txs.reduce((s,t) => s + Number(t.qty), 0);
  const cost = txs.reduce((s,t) => s + Number(t.qty) * Number(t.price), 0);
  const avg = qty > 0 ? cost / qty : 0;
  const currentPrice = Number(asset.currentPrice || 0);
  const value = qty * currentPrice;
  const pnl = value - cost;
  const pnlPct = cost > 0 ? (pnl / cost) * 100 : 0;
  const prevPrice = Number(asset.previousPrice || currentPrice);
  const daily = qty * (currentPrice - prevPrice);
  return { qty, cost, avg, currentPrice, value, pnl, pnlPct, daily };
}

function totals() {
  return state.assets.reduce((acc, asset) => {
    const c = calcAsset(asset);
    acc.value += c.value;
    acc.cost += c.cost;
    acc.pnl += c.pnl;
    acc.daily += c.daily;
    return acc;
  }, { value:0, cost:0, pnl:0, daily:0 });
}

function render() {
  renderSummary();
  renderTables();
  renderCards();
  renderTransactions();
  renderTopPositions();
  renderChart();
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

  const dates = state.assets.map(a => a.lastUpdated).filter(Boolean).sort().reverse();
  $("lastUpdated").textContent = dates[0] ? `Son veri: ${new Date(dates[0]).toLocaleString("tr-TR")}` : "Henüz güncellenmedi";
}

function rowHtml(asset) {
  const c = calcAsset(asset);
  const type = asset.type === "fund" ? "Fon" : "Hisse";
  const cls = c.pnl >= 0 ? "positive" : "negative";
  return `<tr>
    <td><span class="asset-symbol">${escapeHtml(asset.code)}</span><span class="asset-sub">${escapeHtml(asset.name || "")}</span></td>
    <td>${type}</td>
    <td>${num(c.qty)}</td>
    <td>${money(c.avg)}</td>
    <td>${money(c.currentPrice)}</td>
    <td><strong>${money(c.value)}</strong></td>
    <td class="${cls}"><strong>${money(c.pnl)}</strong><span class="asset-sub ${cls}">${pct(c.pnlPct)}</span></td>
  </tr>`;
}

function renderTables() {
  $("dashboardTable").innerHTML = state.assets.length
    ? state.assets.map(rowHtml).join("")
    : `<tr><td colspan="7" class="empty-state">Henüz portföyünüze varlık eklemediniz.</td></tr>`;
}

function renderCards() {
  const filtered = state.assets.filter(a => state.filter === "all" || a.type === state.filter);
  $("assetCards").innerHTML = filtered.length ? filtered.map(asset => {
    const c = calcAsset(asset);
    const cls = c.pnl >= 0 ? "positive" : "negative";
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
      <div class="asset-stats">
        <div class="asset-stat"><span>ADET</span><strong>${num(c.qty)}</strong></div>
        <div class="asset-stat"><span>ORT. MALİYET</span><strong>${money(c.avg)}</strong></div>
        <div class="asset-stat"><span>GÜNCEL FİYAT</span><strong>${money(c.currentPrice)}</strong></div>
        <div class="asset-stat"><span>SON GÜNCELLEME</span><strong>${asset.lastUpdated ? new Date(asset.lastUpdated).toLocaleDateString("tr-TR") : "-"}</strong></div>
      </div>
      <div class="card-actions">
        ${asset.type === "fund" ? `<button class="secondary-btn" onclick="refreshOne('${asset.id}')">↻ TEFAS</button>` : ""}
        <button class="text-btn" onclick="deleteAsset('${asset.id}')">Sil</button>
      </div>
    </article>`;
  }).join("") : `<div class="empty-state">Bu kategoride varlık yok.</div>`;
}

function renderTransactions() {
  const list = [...state.transactions].sort((a,b) => String(b.date).localeCompare(String(a.date)));
  $("transactionTable").innerHTML = list.length ? list.map(t => {
    const a = state.assets.find(x => x.id === t.assetId);
    return `<tr>
      <td>${new Date(t.date + "T12:00:00").toLocaleDateString("tr-TR")}</td>
      <td><strong>${escapeHtml(a?.code || "Silinmiş varlık")}</strong></td>
      <td>${num(t.qty)}</td>
      <td>${money(t.price)}</td>
      <td>${money(Number(t.qty)*Number(t.price))}</td>
      <td><button class="text-btn" onclick="deleteTx('${t.id}')">Sil</button></td>
    </tr>`;
  }).join("") : `<tr><td colspan="6" class="empty-state">Henüz işlem eklenmedi.</td></tr>`;
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

function renderChart() {
  if (!window.Chart) return;
  const labels = state.assets.map(a => a.code);
  const data = state.assets.map(a => calcAsset(a).value);
  const ctx = $("allocationChart");
  if (state.allocationChart) state.allocationChart.destroy();

  state.allocationChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [{
        data,
        borderWidth: 0,
        backgroundColor: [
          "#4f8cff","#7d6bff","#34c799","#ffb648","#ff6b82",
          "#31b7c9","#a27aef","#f57c52","#73b35b","#c69b43"
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
          labels: { usePointStyle:true, boxWidth:8, color:getComputedStyle(document.documentElement).getPropertyValue("--muted") }
        }
      }
    }
  });
}

function fillTxAssets() {
  $("txAsset").innerHTML = state.assets.map(a => `<option value="${a.id}">${escapeHtml(a.code)} - ${escapeHtml(a.name || "")}</option>`).join("");
}

function addAssetFromForm(e) {
  e.preventDefault();
  const type = $("assetType").value;
  const code = $("assetCode").value.trim().toUpperCase();
  if (!code) return;
  if (state.assets.some(a => a.code === code && a.type === type)) {
    alert("Bu varlık zaten portföyde.");
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
}

function addTransaction(e) {
  e.preventDefault();
  if (!state.assets.length) return;
  state.transactions.push({
    id: crypto.randomUUID(),
    assetId: $("txAsset").value,
    qty: Number($("txQty").value),
    price: Number($("txPrice").value),
    date: $("txDate").value
  });
  save();
  $("transactionModal").close();
  e.target.reset();
  $("txDate").value = todayISO();
  render();
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
  const funds = state.assets.filter(a => a.type === "fund");
  if (!funds.length) {
    setStatus("Güncellenecek fon yok");
    return;
  }
  let success = 0;
  for (const asset of funds) {
    try {
      const data = await fetchFundPrice(asset.code);
      asset.previousPrice = Number(data.previousPrice || asset.currentPrice || data.price);
      asset.currentPrice = Number(data.price);
      asset.lastUpdated = data.date || new Date().toISOString();
      if (!asset.name && data.name) asset.name = data.name;
      success++;
    } catch (e) {
      console.warn(asset.code, e);
    }
  }
  save(); render();
  setStatus(`${success}/${funds.length} fon güncellendi`, success !== funds.length);
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
    renderChart();
  });

  $("exportBtn").addEventListener("click", () => {
    const blob = new Blob([JSON.stringify({assets:state.assets, transactions:state.transactions}, null, 2)], {type:"application/json"});
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
window.deleteAsset = deleteAsset;
window.deleteTx = deleteTx;
