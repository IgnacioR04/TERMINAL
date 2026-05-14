// stocks.js
// Logica del tab Acciones. Lazy load del indice y de cada ficha.

window.StocksTab = (function () {
  let loaded = false;
  let list = [];
  let filtered = [];
  let currentRegion = "all";
  let currentSearch = "";
  let sortCol = null;
  let sortAsc  = true;
  let detailChart = null;
  let detailSeries = null;

  async function init() {
    if (loaded) return;
    const container = document.getElementById("stocks-content");
    container.innerHTML = "<div class='loading'><div class='spinner'></div>Cargando 150 acciones...</div>";
    try {
      const r = await fetch("data/stocks_list.json?ts=" + Date.now());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const data = await r.json();
      list = data.stocks || [];
      filtered = list.slice();
      loaded = true;
      render();
      bindControls();
    } catch (e) {
      container.innerHTML = `<div class='loading'>No se encuentra data/stocks_list.json.<br>Ejecuta el workflow <code class='mono'>Stocks daily</code> en GitHub Actions.</div>`;
    }
  }

  function bindControls() {
    document.querySelectorAll(".region-btn").forEach(b => {
      b.addEventListener("click", () => {
        document.querySelectorAll(".region-btn").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        currentRegion = b.dataset.region;
        applyFilter();
      });
    });
    const search = document.getElementById("stock-search");
    if (search) {
      search.addEventListener("input", (e) => {
        currentSearch = e.target.value.trim().toLowerCase();
        applyFilter();
      });
    }
  }

  function applyFilter() {
    filtered = list.filter(s => {
      if (currentRegion !== "all" && s.region !== currentRegion) return false;
      if (currentSearch) {
        const hay = (s.ticker + " " + s.name + " " + s.sector).toLowerCase();
        if (!hay.includes(currentSearch)) return false;
      }
      return true;
    });
    sortCol = null; sortAsc = true; // reset sort on filter change
    render();
  }

  function applySort() {
    if (!sortCol) return;
    filtered.sort((a, b) => {
      let va = a[sortCol], vb = b[sortCol];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === "string") return sortAsc ? va.localeCompare(vb) : vb.localeCompare(va);
      return sortAsc ? va - vb : vb - va;
    });
  }

  function sortBy(col) {
    if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
    applySort();
    render();
  }

  function render() {
    const container = document.getElementById("stocks-content");
    if (!filtered.length) {
      container.innerHTML = "<div class='loading'>Sin resultados.</div>";
      return;
    }

    const SECTOR_MAP = {
      "Technology":             { color:"var(--accent-blue)",   bg:"var(--pill-blue-bg)" },
      "Communication Services": { color:"var(--accent-blue)",   bg:"var(--pill-blue-bg)" },
      "Health Care":            { color:"var(--accent-green)",  bg:"var(--pill-green-bg)" },
      "Healthcare":             { color:"var(--accent-green)",  bg:"var(--pill-green-bg)" },
      "Financials":             { color:"var(--accent-purple)", bg:"var(--pill-purple-bg)" },
      "Financial Services":     { color:"var(--accent-purple)", bg:"var(--pill-purple-bg)" },
      "Energy":                 { color:"var(--accent-orange)", bg:"var(--pill-orange-bg)" },
      "Consumer Discretionary": { color:"var(--accent-teal)",   bg:"var(--pill-teal-bg)" },
      "Consumer Staples":       { color:"var(--accent-teal)",   bg:"var(--pill-teal-bg)" },
      "Materials":              { color:"var(--accent-orange)", bg:"var(--pill-orange-bg)" },
      "Real Estate":            { color:"var(--accent-purple)", bg:"var(--pill-purple-bg)" },
    };
    function sStyle(sec) {
      return SECTOR_MAP[sec] || { color:"rgba(255,255,255,0.45)", bg:"rgba(255,255,255,0.04)" };
    }

    applySort();

    const rows = filtered.map(s => {
      // Price
      const priceHtml = (s.price == null)
        ? `<span style="color:var(--text-muted)">—</span>`
        : Number(s.price).toLocaleString("en-US", { minimumFractionDigits:2, maximumFractionDigits:2 });

      // Change pill / market-closed pill
      let chgHtml;
      if (s.change_pct == null) {
        chgHtml = `<span style="display:inline-flex;align-items:center;gap:4px;font-size:11px;padding:2px 8px;border-radius:12px;background:rgba(255,255,255,0.04);color:rgba(255,255,255,0.3)"><i class="ti ti-clock" style="font-size:10px"></i>Cerrado</span>`;
      } else {
        const cls  = s.change_pct >= 0 ? "up" : "down";
        const sign = s.change_pct >= 0 ? "+" : "";
        chgHtml = `<span class="change-pill ${cls}">${sign}${s.change_pct.toFixed(2)}%</span>`;
      }

      // Div yield: value stored as % (e.g. 0.83 → 0.83%). Flag >15% in orange.
      let dyHtml = "—";
      if (s.dividend_yield != null) {
        const dyVal = s.dividend_yield;
        const dyStr = dyVal.toFixed(2) + "%";
        dyHtml = dyVal > 15
          ? `<span style="color:var(--accent-orange)">${dyStr}</span>`
          : dyStr;
      }

      // Sector badge
      const ss = sStyle(s.sector);
      const sectorHtml = s.sector
        ? `<span class="sector-badge" style="background:${ss.bg};color:${ss.color}">${escapeHtml(s.sector)}</span>`
        : `<span style="color:var(--text-muted);font-size:11px">—</span>`;

      const mcap = compactNum(s.market_cap);
      const pe   = s.pe_ratio == null ? "—" : s.pe_ratio.toFixed(1);

      return `
        <tr data-ticker="${s.ticker}" style="cursor:pointer">
          <td class="ticker">${s.ticker}</td>
          <td class="name">${escapeHtml(s.name)}</td>
          <td>${sectorHtml}</td>
          <td><span style="font-size:11px;color:var(--text-tertiary);text-transform:uppercase;letter-spacing:0.1em">${s.region}</span></td>
          <td class="num">${priceHtml}</td>
          <td class="num">${chgHtml}</td>
          <td class="num">${mcap}</td>
          <td class="num">${pe}</td>
          <td class="num">${dyHtml}</td>
        </tr>`;
    }).join("");

    function thSort(col, label, rightAlign) {
      const active = sortCol === col;
      const icon   = active ? (sortAsc ? "arrow-up" : "arrow-down") : "arrows-sort";
      const style  = rightAlign ? "text-align:right" : "";
      return `<th class="th-sortable${active?" active":""}" style="${style}" onclick="window.StocksTab._sortBy('${col}')">${label} <i class="ti ti-${icon}"></i></th>`;
    }

    container.innerHTML = `
      <table class="stocks-table">
        <thead>
          <tr>
            ${thSort("ticker","Ticker",false)}
            ${thSort("name","Empresa",false)}
            <th>Sector</th><th>Región</th>
            ${thSort("price","Precio",true)}
            ${thSort("change_pct","Cambio",true)}
            ${thSort("market_cap","Mkt Cap",true)}
            ${thSort("pe_ratio","P/E",true)}
            ${thSort("dividend_yield","Div Yield",true)}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    container.querySelectorAll("tr[data-ticker]").forEach(tr => {
      tr.addEventListener("click", () => openDetail(tr.dataset.ticker));
    });
  }

  async function openDetail(ticker) {
    const modal = document.getElementById("stock-modal");
    const content = document.getElementById("modal-content");
    modal.classList.add("show");
    content.innerHTML = "<div class='loading'><div class='spinner'></div>Cargando " + ticker + "...</div>";

    const safe = ticker.replace(/[\/.^]/g, "_");
    try {
      const r = await fetch("data/stocks_detail/" + safe + ".json?ts=" + Date.now());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const d = await r.json();
      renderDetail(d);
    } catch (e) {
      content.innerHTML = "<div class='loading'>No se pudo cargar el detalle de " + ticker + ".</div>";
    }
  }

  function renderDetail(d) {
    const chgCls = (d.change_pct == null) ? "neutral" : (d.change_pct >= 0 ? "up" : "down");
    const content = document.getElementById("modal-content");

    const fmtMoney = v => v == null ? "—" : Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fmtPct   = v => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2) + "%";

    const divs = (d.dividends || []).slice(-5).reverse().map(x => `
      <tr><td class="mono">${x.date}</td><td class="num mono">${fmtMoney(x.amount)} ${d.currency}</td></tr>
    `).join("");

    content.innerHTML = `
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:10px">
        <div style="font-family:'Fraunces',serif;font-size:32px;font-weight:600">${d.ticker}</div>
        <span style="background:var(--bg-3);padding:4px 10px;border-radius:4px;font-size:11px">${escapeHtml(d.sector || "—")}</span>
        <span style="background:var(--bg-3);padding:4px 10px;border-radius:4px;font-size:11px">${d.region.toUpperCase()}</span>
      </div>
      <div style="color:var(--txt-1);font-size:15px;margin-bottom:8px">${escapeHtml(d.long_name || d.name)}</div>

      <div style="display:flex;align-items:baseline;gap:14px;margin:18px 0">
        <div style="font-family:'DM Mono',monospace;font-size:42px;font-weight:600">${fmtMoney(d.price)} <span style="color:var(--txt-2);font-size:18px">${d.currency}</span></div>
        <div class="mono ${chgCls}" style="font-size:16px">${fmtPct(d.change_pct)}</div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:18px">
        ${kvBlock("Market Cap", compactNum(d.market_cap))}
        ${kvBlock("P/E", d.pe_ratio == null ? "—" : d.pe_ratio.toFixed(2))}
        ${kvBlock("EPS", d.eps == null ? "—" : d.eps.toFixed(2))}
        ${kvBlock("Beta", d.beta == null ? "—" : d.beta.toFixed(2))}
        ${kvBlock("52w High", fmtMoney(d.fifty_two_week_high))}
        ${kvBlock("52w Low", fmtMoney(d.fifty_two_week_low))}
        ${kvBlock("Dividend Yield", d.dividend_yield == null ? "—" : (d.dividend_yield * 100).toFixed(2) + "%")}
        ${kvBlock("Empleados", d.employees == null ? "—" : compactNum(d.employees))}
      </div>

      <div id="stock-chart"></div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;margin-top:14px">
        <div>
          <div class="card-title">Descripción</div>
          <div style="font-size:13px;color:var(--txt-1);line-height:1.55">
            ${escapeHtml(d.description || "Sin descripción disponible.")}
          </div>
          <div style="margin-top:14px;font-size:12px;color:var(--txt-2)">
            ${d.industry ? "Industria: " + escapeHtml(d.industry) + "  ·  " : ""}
            ${d.country ? "País: " + escapeHtml(d.country) + "  ·  " : ""}
            ${d.website ? `<a href="${d.website}" target="_blank" style="color:var(--accent)">Web</a>` : ""}
          </div>
        </div>
        <div>
          <div class="card-title">Eventos corporativos</div>
          ${d.next_earnings ? `<div style="background:var(--bg-2);border:1px solid var(--line);padding:12px;border-radius:6px;margin-bottom:12px">
            <div style="font-size:10px;color:var(--txt-2);text-transform:uppercase;letter-spacing:0.12em">Próximos earnings</div>
            <div style="font-family:'DM Mono',monospace;font-size:15px;margin-top:4px">${d.next_earnings}</div>
          </div>` : ""}
          ${divs ? `<div style="font-size:10px;color:var(--txt-2);text-transform:uppercase;letter-spacing:0.12em;margin-bottom:8px">Últimos dividendos</div>
          <table style="width:100%;border-collapse:collapse;font-size:12px">${divs}</table>` : "<div style='color:var(--txt-2);font-size:12px'>Sin dividendos recientes.</div>"}
        </div>
      </div>
    `;

    // Chart de la accion. Diario.
    setTimeout(() => {
      const container = document.getElementById("stock-chart");
      if (!container) return;
      container.innerHTML = "";
      detailChart = LightweightCharts.createChart(container, {
        layout: { background: { color: "transparent" }, textColor: "#b8bcc6" },
        grid:   { vertLines: { color: "#1f232a" }, horzLines: { color: "#1f232a" } },
        timeScale: { borderColor: "#262a32", timeVisible: false },
        rightPriceScale: { borderColor: "#262a32" },
        crosshair: { mode: 0 },
        height: 360,
        width: container.clientWidth,
      });
      detailSeries = detailChart.addAreaSeries({
        topColor: "rgba(0,208,156,0.4)", bottomColor: "rgba(0,208,156,0.04)",
        lineColor: "#00d09c", lineWidth: 2,
      });
      const data = (d.bars_daily || []).map(b => ({ time: b.date, value: b.close })).filter(x => x.value != null);
      if (data.length) detailSeries.setData(data);
    }, 30);
  }

  function kvBlock(label, value) {
    return `<div style="background:var(--bg-2);border:1px solid var(--line);padding:14px;border-radius:6px">
      <div style="font-size:10px;color:var(--txt-2);text-transform:uppercase;letter-spacing:0.12em">${label}</div>
      <div style="font-family:'DM Mono',monospace;font-size:16px;margin-top:6px">${value}</div>
    </div>`;
  }

  function compactNum(x) {
    if (x == null || isNaN(x)) return "—";
    const abs = Math.abs(x);
    if (abs >= 1e12) return (x / 1e12).toFixed(2) + "T";
    if (abs >= 1e9)  return (x / 1e9).toFixed(2) + "B";
    if (abs >= 1e6)  return (x / 1e6).toFixed(2) + "M";
    if (abs >= 1e3)  return (x / 1e3).toFixed(2) + "K";
    return x.toFixed(2);
  }

  function escapeHtml(s) {
    if (!s) return "";
    return s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
  }

  // Close modal
  document.addEventListener("DOMContentLoaded", () => {
    const modal = document.getElementById("stock-modal");
    const close = document.getElementById("modal-close");
    if (close) close.addEventListener("click", () => modal.classList.remove("show"));
    if (modal) modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.classList.remove("show");
    });
  });

  return {
    get loaded() { return loaded; },
    init,
    _sortBy: sortBy,
  };
})();
