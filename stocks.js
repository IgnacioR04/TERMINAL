// stocks.js
// Logica del tab Acciones. Lazy load del indice y de cada ficha.

window.StocksTab = (function () {
  let loaded = false;
  let list = [];
  let filtered = [];
  let currentRegion = "all";
  let currentSearch = "";
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
    render();
  }

  function render() {
    const container = document.getElementById("stocks-content");
    if (!filtered.length) {
      container.innerHTML = "<div class='loading'>Sin resultados.</div>";
      return;
    }

    const rows = filtered.map(s => {
      const chgCls = (s.change_pct == null) ? "neutral" : (s.change_pct >= 0 ? "up" : "down");
      const chgTxt = s.change_pct == null ? "—" : (s.change_pct >= 0 ? "+" : "") + s.change_pct.toFixed(2) + "%";
      const priceStr = s.price == null ? "—" : Number(s.price).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const mcap = compactNum(s.market_cap);
      const pe = s.pe_ratio == null ? "—" : s.pe_ratio.toFixed(1);
      const dy = (s.dividend_yield == null) ? "—" : (s.dividend_yield * 100).toFixed(2) + "%";
      return `
        <tr data-ticker="${s.ticker}">
          <td class="ticker">${s.ticker}</td>
          <td class="name">${escapeHtml(s.name)}</td>
          <td><span style="background:var(--bg-3);padding:2px 8px;border-radius:3px;font-size:11px">${escapeHtml(s.sector || "—")}</span></td>
          <td><span style="font-size:11px;color:var(--txt-2);text-transform:uppercase;letter-spacing:0.1em">${s.region}</span></td>
          <td class="num">${priceStr}</td>
          <td class="num ${chgCls}">${chgTxt}</td>
          <td class="num">${mcap}</td>
          <td class="num">${pe}</td>
          <td class="num">${dy}</td>
        </tr>
      `;
    }).join("");

    container.innerHTML = `
      <table class="stocks-table">
        <thead>
          <tr>
            <th>Ticker</th><th>Empresa</th><th>Sector</th><th>Región</th>
            <th style="text-align:right">Precio</th>
            <th style="text-align:right">Cambio</th>
            <th style="text-align:right">Mkt Cap</th>
            <th style="text-align:right">P/E</th>
            <th style="text-align:right">Div Yield</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;

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
  };
})();
