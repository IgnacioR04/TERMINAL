/* ╭───────────────────────────────────────────────────╮
   │  TFG.terminal — Extras patch                       │
   │  · Modelo TFG (paper + backtest) con velas 1h      │
   │  · Acciones: filtros + heatmap                     │
   ╰───────────────────────────────────────────────────╯
   Loads AFTER index.html's inline script. Overrides:
   - renderPaperTrading() / renderBacktest()
   - StocksTab.init() wrapping the original
*/

(function () {
  // ─────────────────────────────────────────────────────────
  //  Shared helpers
  // ─────────────────────────────────────────────────────────
  const _MONTHS = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  function fmtT(iso) {
    if (!iso) return '—';
    const dt = new Date(iso);
    if (isNaN(dt.getTime())) return iso.slice(5,16).replace('T',' ');
    return `${dt.getUTCDate()} ${_MONTHS[dt.getUTCMonth()]} ${String(dt.getUTCHours()).padStart(2,'0')}:${String(dt.getUTCMinutes()).padStart(2,'0')}`;
  }
  function fmtPx(v) { return '$' + Number(v||0).toLocaleString('en-US', {maximumFractionDigits:0}); }
  function fmtPct2(x) { if (x == null || isNaN(x)) return '—'; const v = Number(x); return (v>=0?'+':'') + v.toFixed(2) + '%'; }
  function fmtPct3(x) { if (x == null || isNaN(x)) return '—'; const v = Number(x); return (v>=0?'+':'') + v.toFixed(3) + '%'; }

  // Hourly candles: use data/btc_1h.csv (in user's repo) — fallback to Binance.
  const _hourlyCache = {
    bars: null,
    promise: null,
  };
  function parseCsv(text) {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const header = lines[0].toLowerCase().split(',').map(s => s.trim());
    const ti = header.findIndex(h => /(time|date|open_time|timestamp)/.test(h));
    const oi = header.indexOf('open');
    const hi = header.indexOf('high');
    const li = header.indexOf('low');
    const ci = header.indexOf('close');
    if (ti < 0 || ci < 0) return [];
    const out = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',');
      const raw = cols[ti]?.trim();
      if (!raw) continue;
      let t;
      // numeric (epoch ms or s) or ISO
      if (/^\d{12,}$/.test(raw)) t = Math.floor(Number(raw) / 1000);
      else if (/^\d{9,11}$/.test(raw)) t = Number(raw);
      else { const d = new Date(raw.replace(' ', 'T') + (raw.includes('Z') || raw.includes('+') ? '' : 'Z')); t = Math.floor(d.getTime() / 1000); }
      if (!isFinite(t) || t <= 0) continue;
      const o = parseFloat(cols[oi]), h = parseFloat(cols[hi]), l = parseFloat(cols[li]), c = parseFloat(cols[ci]);
      if (!isFinite(c) || c <= 0) continue;
      out.push({
        time: t,
        open: isFinite(o) && o > 0 ? o : c,
        high: isFinite(h) && h > 0 ? h : c,
        low:  isFinite(l) && l > 0 ? l : c,
        close: c,
      });
    }
    // Deduplicate & sort
    const map = {};
    out.forEach(b => { map[b.time] = b; });
    return Object.values(map).sort((a, b) => a.time - b.time);
  }
  async function fetchBtcHourly() {
    if (_hourlyCache.bars) return _hourlyCache.bars;
    if (_hourlyCache.promise) return _hourlyCache.promise;
    _hourlyCache.promise = (async () => {
      // 1. Try CSV in user's repo
      try {
        const r = await fetch('data/btc_1h.csv?ts=' + Date.now());
        if (r.ok) {
          const text = await r.text();
          const bars = parseCsv(text);
          if (bars.length > 100) {
            _hourlyCache.bars = bars;
            console.log('[TFG] loaded', bars.length, 'hourly bars from CSV');
            return bars;
          }
        }
      } catch (e) { console.warn('btc_1h.csv fetch failed', e); }
      // 2. Fallback: Binance public API (only works for the recent ~84 days)
      try {
        const now = Date.now();
        const oneCall = async (endTime) => {
          const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1000&endTime=${endTime}`;
          const r = await fetch(url);
          if (!r.ok) throw new Error('binance ' + r.status);
          const arr = await r.json();
          return arr.map(k => ({
            time: Math.floor(k[0] / 1000),
            open: parseFloat(k[1]),
            high: parseFloat(k[2]),
            low:  parseFloat(k[3]),
            close: parseFloat(k[4]),
          }));
        };
        const batch1 = await oneCall(now);
        const earliest = batch1[0]?.time;
        let batch2 = [];
        if (earliest) {
          try { batch2 = await oneCall((earliest - 3600) * 1000); } catch (_) {}
        }
        const merged = {};
        [...batch2, ...batch1].forEach(b => { merged[b.time] = b; });
        _hourlyCache.bars = Object.values(merged).sort((a,b) => a.time - b.time);
        console.log('[TFG] loaded', _hourlyCache.bars.length, 'hourly bars from Binance');
        return _hourlyCache.bars;
      } catch (e) {
        console.warn('fetchBtcHourly Binance failed', e);
        _hourlyCache.bars = [];
        return [];
      }
    })();
    return _hourlyCache.promise;
  }

  // Compute rolling volatility regime from hourly bars
  function hourlyRegime(bars) {
    if (!bars || bars.length < 50) return [];
    const W = 48; // 48h rolling
    const logrets = bars.map((b, i) => i === 0 ? 0 : Math.log(b.close / bars[i-1].close));
    const vols = logrets.map((_, i) => {
      if (i < W - 1) return null;
      const sl = logrets.slice(i - W + 1, i + 1);
      const m = sl.reduce((a, b) => a + b, 0) / W;
      return Math.sqrt(sl.reduce((a, b) => a + (b - m) ** 2, 0) / W);
    });
    const valid = vols.filter(v => v != null).slice().sort((a, b) => a - b);
    const threshold = valid[Math.floor(valid.length / 2)];
    return bars.map((b, i) => {
      if (vols[i] == null) return null;
      return { time: b.time, value: 1, color: vols[i] > threshold ? 'rgba(255,92,92,0.13)' : 'rgba(77,139,255,0.13)' };
    }).filter(Boolean);
  }

  // ─────────────────────────────────────────────────────────
  //  Replace TFG section markup
  // ─────────────────────────────────────────────────────────
  function setupTFG() {
    const view = document.getElementById('view-tfg');
    if (!view) return;
    view.innerHTML = `
      <div class="r-tfg-tabs">
        <button class="r-tfg-tab active" data-tfgtab="paper">
          <i class="ti ti-chart-line"></i>
          Paper Trading
          <span class="r-tfg-tab-status">live</span>
        </button>
        <button class="r-tfg-tab" data-tfgtab="backtest">
          <i class="ti ti-history"></i>
          Backtest Histórico
        </button>
      </div>
      <div class="r-tfg-pane active" id="r-tfg-paper"><div class="loading"><div class="spinner"></div>Cargando paper trading…</div></div>
      <div class="r-tfg-pane" id="r-tfg-backtest"><div class="loading"><div class="spinner"></div>Cargando backtest…</div></div>
    `;
    view.querySelectorAll('.r-tfg-tab').forEach(b => {
      b.addEventListener('click', () => {
        view.querySelectorAll('.r-tfg-tab').forEach(x => x.classList.remove('active'));
        view.querySelectorAll('.r-tfg-pane').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        document.getElementById('r-tfg-' + b.dataset.tfgtab).classList.add('active');
        // Trigger lazy re-render
        if (b.dataset.tfgtab === 'paper' && STATE.paperTrading) renderPaperPane();
        if (b.dataset.tfgtab === 'backtest' && STATE.backtest) renderBacktestPane();
      });
    });
  }
  setupTFG();

  // ─────────────────────────────────────────────────────────
  //  PAPER TRADING pane
  // ─────────────────────────────────────────────────────────
  function renderPaperPane() {
    const pane = document.getElementById('r-tfg-paper');
    if (!pane) return;
    const d = STATE.paperTrading;
    if (!d) {
      pane.innerHTML = `<div class="r-tfg-empty">
        <div class="r-tfg-empty-icon">⌛</div>
        <div class="r-tfg-empty-title">Esperando datos de paper trading</div>
        <div class="r-tfg-empty-text">El cron de GitHub Actions (<code>paper_trader.py</code>) ejecuta cada 10 min. Vuelve en unos minutos.</div>
      </div>`;
      return;
    }
    if (d.status === 'models_missing') {
      const missingList = d.missing && d.missing.length > 0
        ? ` Modelos faltantes: <code>${d.missing.join(', ')}</code>.`
        : '';
      pane.innerHTML = `<div class="r-tfg-banner">
        <i class="ti ti-alert-triangle"></i>
        ${missingList || (d.message || 'Los modelos no están disponibles todavía.')}
        Sube los <code>.pkl</code> a <code>models/</code> y ejecuta el workflow <em>Live data</em> en GitHub Actions.
      </div>`;
      return;
    }
    if (d.status !== 'ok') {
      pane.innerHTML = `<div class="r-tfg-banner"><i class="ti ti-alert-triangle"></i> Error: ${d.message || 'desconocido'}</div>`;
      return;
    }

    const st = d.stats || {};
    const pos = d.position;
    const sig = d.current_signal || {};
    const pip = d.pipeline || {};
    const capital = d.capital ?? d.start_capital ?? 1000;
    const capRet = d.start_capital ? (capital / d.start_capital - 1) * 100 : 0;

    const trades = (d.trades || []).slice();
    const hasTrades = trades.length > 0;

    const statsRow = `
      <div class="r-tfg-stats">
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Capital actual</div>
          <div class="r-tfg-stat-value" style="color:var(--r-${capRet>=0?'green':'red'})">$${capital.toFixed(2)}</div>
          <div class="r-tfg-stat-sub" style="color:var(--r-${capRet>=0?'green':'red'})">${capRet>=0?'+':''}${capRet.toFixed(2)}% desde inicio</div>
        </div>
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Trades cerrados</div>
          <div class="r-tfg-stat-value">${st.n_trades ?? 0}</div>
          <div class="r-tfg-stat-sub">${st.n_wins ?? 0} WIN · ${st.n_losses ?? 0} LOSS</div>
        </div>
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Win Rate</div>
          <div class="r-tfg-stat-value" style="color:var(--r-${(st.win_rate ?? 0) >= 0.5 ? 'green' : 'red'})">${st.win_rate != null ? (st.win_rate * 100).toFixed(1) + '%' : '—'}</div>
          <div class="r-tfg-stat-sub">${hasTrades ? 'sobre cerrados' : 'sin trades aún'}</div>
        </div>
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Sharpe</div>
          <div class="r-tfg-stat-value">${st.sharpe != null ? st.sharpe.toFixed(2) : '—'}</div>
          <div class="r-tfg-stat-sub">trades cerrados</div>
        </div>
      </div>`;

    // Position
    let posHtml = '';
    if (pos) {
      const upct = pos.unrealized_pct ?? 0;
      posHtml = `
        <div class="r-tfg-pos">
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">Entrada</div><div class="r-tfg-pos-val">${fmtPx(pos.entry_price)}</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">Take Profit</div><div class="r-tfg-pos-val" style="color:var(--r-green)">${fmtPx(pos.tp_price)}</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">Stop Loss</div><div class="r-tfg-pos-val" style="color:var(--r-red)">${fmtPx(pos.sl_price)}</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">Precio actual</div><div class="r-tfg-pos-val">${fmtPx(pos.current_price)}</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">P&amp;L no realizado</div><div class="r-tfg-pos-val" style="color:var(--r-${upct>=0?'green':'red'})">${upct>=0?'+':''}${upct.toFixed(3)}%</div></div>
          <div class="r-tfg-pos-badge">POSICIÓN ABIERTA · ${pos.rule||''}</div>
        </div>`;
    } else {
      posHtml = `
        <div class="r-tfg-pos none">
          <div class="r-tfg-pos-field" style="grid-column:span 5">
            <div class="r-tfg-pos-label">Estado</div>
            <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">Sin posición abierta. El modelo está evaluando cada hora si abre una nueva.</div>
          </div>
          <div class="r-tfg-pos-badge" style="background:rgba(255,255,255,0.06);color:var(--text-tertiary)">EN ESPERA</div>
        </div>`;
    }

    // Current signal
    const prob = pip.prob_sharpe != null ? pip.prob_sharpe : 0.5;
    const conf = Math.abs(prob - 0.5) * 200;
    const direction = prob >= 0.5 ? 'LONG' : 'SHORT';
    const dirColor = direction === 'LONG' ? 'var(--r-green)' : 'var(--r-red)';
    const sigBadge = sig.eligible === true
      ? `<span class="r-tfg-pos-badge">SEÑAL ACTIVA</span>`
      : sig.eligible === false
        ? `<span style="font-size:11.5px;color:var(--text-tertiary)">${sig.reason || 'No cumple filtros'}</span>`
        : `<span style="font-size:11.5px;color:var(--text-tertiary)">Evaluando…</span>`;
    const regColor = pip.regime_label === 'highvol' ? 'var(--r-amber)' : 'var(--r-green)';

    const sigHtml = `
      <div class="r-tfg-sig">
        <div class="r-tfg-sig-head">
          <div style="font-size:13px;font-weight:600">Señal actual <span style="font-weight:400;color:var(--text-tertiary);font-size:11.5px">· versión sharpe · solo LONG</span></div>
          ${sigBadge}
        </div>
        <div class="r-tfg-sig-grid">
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">Dirección</div><div class="r-tfg-pos-val" style="color:${dirColor}">${direction}</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">Prob. sharpe</div><div class="r-tfg-pos-val">${(prob*100).toFixed(1)}%</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">Régimen</div><div class="r-tfg-pos-val" style="color:${regColor}">${pip.regime_label || '—'}</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">GARCH vol</div><div class="r-tfg-pos-val">${pip.garch_vol_t1 != null ? (pip.garch_vol_t1*100).toFixed(3) + '%' : '—'}</div></div>
          <div class="r-tfg-pos-field"><div class="r-tfg-pos-label">P(deadzone)</div><div class="r-tfg-pos-val">${pip.p_deadzone != null ? (pip.p_deadzone*100).toFixed(1) + '%' : '—'}</div></div>
        </div>
        <div class="r-tfg-sig-bar"><div class="r-tfg-sig-bar-fill" style="width:${conf}%;background:${dirColor}"></div></div>
      </div>`;

    // Chart wrap
    const chartHtml = `
      <div class="r-tfg-chart-wrap">
        <div class="r-tfg-chart-head">
          <div class="r-tfg-chart-title"><b>BTC/USDT</b> · velas horarias · ${hasTrades ? trades.length + ' trades · ' : ''}régimen HMM al fondo</div>
          <div class="r-tfg-chart-legend">
            <span class="r-tfg-chart-legend-item"><span class="r-tfg-chart-legend-swatch" style="background:rgba(255,92,92,0.18)"></span>highvol</span>
            <span class="r-tfg-chart-legend-item"><span class="r-tfg-chart-legend-swatch" style="background:rgba(77,139,255,0.15)"></span>lowvol</span>
            <span class="r-tfg-chart-legend-item"><span style="color:#f9b023">▲</span>compra</span>
            <span class="r-tfg-chart-legend-item"><span style="color:var(--r-green)">▼TP</span></span>
            <span class="r-tfg-chart-legend-item"><span style="color:var(--r-red)">▼SL</span></span>
            <span class="r-tfg-chart-legend-item"><span style="color:var(--r-amber)">●</span>abierto</span>
          </div>
          <div class="r-tfg-zoom-row" id="r-tfg-paper-zoom">
            <button class="r-tfg-zoom-btn" data-days="7">7D</button>
            <button class="r-tfg-zoom-btn active" data-days="30">30D</button>
            <button class="r-tfg-zoom-btn" data-days="60">60D</button>
            <button class="r-tfg-zoom-btn" data-days="0">MAX</button>
          </div>
        </div>
        <div class="r-tfg-chart-body" id="r-tfg-paper-chart"></div>
      </div>`;

    pane.innerHTML = statsRow + posHtml + sigHtml + chartHtml + buildTradesTable('paper', trades);

    setTimeout(async () => {
      const chartObj = await renderTFGChart('r-tfg-paper-chart', { trades, includeOpen: pos, days: 30 });
      const zoom = document.getElementById('r-tfg-paper-zoom');
      if (zoom && chartObj) {
        zoom.querySelectorAll('.r-tfg-zoom-btn').forEach(b => b.addEventListener('click', () => {
          zoom.querySelectorAll('.r-tfg-zoom-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          chartObj.zoom(parseInt(b.dataset.days, 10));
        }));
      }
      attachTableSort('paper');
    }, 50);
  }

  // ─────────────────────────────────────────────────────────
  //  BACKTEST pane
  // ─────────────────────────────────────────────────────────
  function renderBacktestPane() {
    const pane = document.getElementById('r-tfg-backtest');
    if (!pane) return;
    const d = STATE.backtest;
    if (!d) {
      pane.innerHTML = `<div class="r-tfg-empty">
        <div class="r-tfg-empty-icon">📊</div>
        <div class="r-tfg-empty-title">Backtest no disponible</div>
        <div class="r-tfg-empty-text">Falta <code>data/backtest_history.json</code> en el repo.</div>
      </div>`;
      return;
    }
    const s = d.summary || {};
    const byRule = d.by_rule || {};
    const trades = (d.trades || []).slice();
    const cfg = d.config || {};

    const statsRow = `
      <div class="r-tfg-stats">
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Trades</div>
          <div class="r-tfg-stat-value">${s.n_trades || 0}</div>
          <div class="r-tfg-stat-sub">${s.n_wins||0} WIN · ${s.n_losses||0} LOSS</div>
        </div>
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Win Rate</div>
          <div class="r-tfg-stat-value" style="color:var(--r-${(s.win_rate||0)>=0.5?'green':'red'})">${s.win_rate!=null ? (s.win_rate*100).toFixed(1)+'%' : '—'}</div>
          <div class="r-tfg-stat-sub">${cfg.test_start || ''} → ${cfg.test_end || ''}</div>
        </div>
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Sharpe</div>
          <div class="r-tfg-stat-value">${s.sharpe_ratio != null ? s.sharpe_ratio.toFixed(2) : '—'}</div>
          <div class="r-tfg-stat-sub">anualizado</div>
        </div>
        <div class="r-tfg-stat">
          <div class="r-tfg-stat-label">Retorno total</div>
          <div class="r-tfg-stat-value" style="color:var(--r-${(s.total_return_pct||0)>=0?'green':'red'})">${(s.total_return_pct||0)>=0?'+':''}${(s.total_return_pct||0).toFixed(2)}%</div>
          <div class="r-tfg-stat-sub">$${s.start_capital||0} → $${s.end_capital||0}</div>
        </div>
      </div>`;

    const ruleHtml = Object.entries(byRule).map(([name, r]) => `
      <div class="r-tfg-rule">
        <div class="r-tfg-rule-head">
          <div class="r-tfg-rule-title">${name === 'moderada' ? 'Moderada (p40–p50)' : 'Media-alta (p60–p70)'}</div>
          <span class="${name === 'moderada' ? 'rule-mod' : 'rule-ma'}" style="${name==='moderada'?'background:var(--r-blue-dim);color:var(--r-blue)':'background:var(--r-amber-dim);color:var(--r-amber)'};padding:3px 10px;border-radius:6px;font-size:10px;font-weight:600">${name === 'moderada' ? 'MOD' : 'M-A'}</span>
        </div>
        <div class="r-tfg-rule-grid">
          <div class="r-tfg-rule-row"><span>Trades</span><span>${r.n_trades}</span></div>
          <div class="r-tfg-rule-row"><span>Win Rate</span><span style="color:var(--r-${r.win_rate>=0.5?'green':'red'})">${(r.win_rate*100).toFixed(1)}%</span></div>
          <div class="r-tfg-rule-row"><span>Take Profit</span><span style="color:var(--r-green)">${(r.tp*100).toFixed(2)}%</span></div>
          <div class="r-tfg-rule-row"><span>Stop Loss</span><span style="color:var(--r-red)">${(r.sl*100).toFixed(2)}%</span></div>
          <div class="r-tfg-rule-row" style="grid-column:span 2"><span>Net PnL</span><span style="color:var(--r-${(r.net_pnl_pct||0)>=0?'green':'red'})">${(r.net_pnl_pct||0)>=0?'+':''}${((r.net_pnl_pct||0)*100).toFixed(2)}%</span></div>
        </div>
      </div>`).join('');

    const chartHtml = `
      <div class="r-tfg-chart-wrap">
        <div class="r-tfg-chart-head">
          <div class="r-tfg-chart-title"><b>BTC/USDT</b> · velas horarias · ${trades.length} trades del test set · régimen HMM al fondo</div>
          <div class="r-tfg-chart-legend">
            <span class="r-tfg-chart-legend-item"><span class="r-tfg-chart-legend-swatch" style="background:rgba(255,92,92,0.18)"></span>highvol</span>
            <span class="r-tfg-chart-legend-item"><span class="r-tfg-chart-legend-swatch" style="background:rgba(77,139,255,0.15)"></span>lowvol</span>
            <span class="r-tfg-chart-legend-item"><span style="color:#f9b023">▲</span>entrada</span>
            <span class="r-tfg-chart-legend-item"><span style="color:var(--r-green)">▼</span>TP</span>
            <span class="r-tfg-chart-legend-item"><span style="color:var(--r-red)">▼</span>SL</span>
            <span class="r-tfg-chart-legend-item"><span style="color:#f9b023">▼</span>T/O</span>
          </div>
          <div class="r-tfg-zoom-row" id="r-tfg-bt-zoom">
            <button class="r-tfg-zoom-btn" data-days="7">7D</button>
            <button class="r-tfg-zoom-btn" data-days="30">30D</button>
            <button class="r-tfg-zoom-btn" data-days="90">90D</button>
            <button class="r-tfg-zoom-btn active" data-days="0">MAX</button>
          </div>
        </div>
        <div class="r-tfg-chart-body" id="r-tfg-bt-chart"></div>
      </div>`;

    pane.innerHTML =
      `<div style="margin-bottom:14px;font-size:12px;color:var(--text-tertiary);line-height:1.55">${d.description || 'Backtest offline sobre el test set 2025.'}</div>` +
      statsRow +
      `<div class="r-tfg-rules">${ruleHtml}</div>` +
      chartHtml +
      buildTradesTable('bt', trades);

    setTimeout(async () => {
      const chartObj = await renderTFGChart('r-tfg-bt-chart', { trades, days: 0, backtest: true });
      const zoom = document.getElementById('r-tfg-bt-zoom');
      if (zoom && chartObj) {
        zoom.querySelectorAll('.r-tfg-zoom-btn').forEach(b => b.addEventListener('click', () => {
          zoom.querySelectorAll('.r-tfg-zoom-btn').forEach(x => x.classList.remove('active'));
          b.classList.add('active');
          chartObj.zoom(parseInt(b.dataset.days, 10));
        }));
      }
      attachTableSort('bt');
    }, 50);
  }

  // ─────────────────────────────────────────────────────────
  //  Chart with hourly BTC candles + HMM regime + trade markers
  // ─────────────────────────────────────────────────────────
  async function renderTFGChart(containerId, opts) {
    const container = document.getElementById(containerId);
    if (!container) return null;
    const trades = opts.trades || [];

    // For backtest, we need to use the historical daily candles since the period is older than what Binance 1h API gives us.
    // Approach: try hourly first, if backtest period > 80 days ago, use daily candles instead.
    let bars = [];
    let candleType = 'hourly';

    if (opts.backtest) {
      // Backtest: try hourly CSV first (covers 2025 test set if user has full year)
      bars = await fetchBtcHourly();
      // If CSV doesn't cover the test period, fall back to daily
      const cfgStart = STATE.backtest?.config?.test_start;
      const earliestNeeded = cfgStart ? Math.floor(new Date(cfgStart).getTime() / 1000) : null;
      if (!bars.length || (earliestNeeded && bars[0].time > earliestNeeded + 86400 * 7)) {
        const dailyBars = STATE.historical?.categories?.crypto?.BTC?.bars || [];
        bars = dailyBars
          .filter(b => b.close != null && isFinite(b.close) && b.close > 0)
          .map(b => ({
            time: typeof b.time === 'number' ? b.time : Math.floor(new Date(b.date || b.time).getTime()/1000),
            open: parseFloat(b.open ?? b.close),
            high: parseFloat(b.high ?? b.close),
            low:  parseFloat(b.low  ?? b.close),
            close: parseFloat(b.close),
          }))
          .filter(b => isFinite(b.time) && b.time > 0);
        candleType = 'daily';
      }
    } else {
      bars = await fetchBtcHourly();
      if (!bars.length) {
        // fallback: daily
        const dailyBars = STATE.historical?.categories?.crypto?.BTC?.bars || [];
        bars = dailyBars
          .filter(b => b.close != null && isFinite(b.close) && b.close > 0)
          .map(b => ({
            time: typeof b.time === 'number' ? b.time : Math.floor(new Date(b.date || b.time).getTime()/1000),
            open: parseFloat(b.open ?? b.close),
            high: parseFloat(b.high ?? b.close),
            low:  parseFloat(b.low  ?? b.close),
            close: parseFloat(b.close),
          }));
        candleType = 'daily';
      }
    }

    if (!bars.length) {
      container.innerHTML = '<div style="padding:60px;text-align:center;color:var(--text-muted)">No hay datos de velas disponibles.</div>';
      return null;
    }

    container.innerHTML = '';
    const chart = LightweightCharts.createChart(container, {
      layout: { background: { color: 'transparent' }, textColor: '#b8bcc6' },
      grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
      timeScale: { borderColor: 'rgba(255,255,255,0.08)', timeVisible: candleType === 'hourly', secondsVisible: false, rightOffset: 6 },
      rightPriceScale: { borderColor: 'rgba(255,255,255,0.08)' },
      crosshair: { mode: 0 },
      height: 380,
      width: container.clientWidth,
    });

    // Regime histogram first (background)
    const regimeSeries = chart.addHistogramSeries({
      priceScaleId: 'regime',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('regime').applyOptions({ scaleMargins: { top: 0, bottom: 0 }, visible: false });

    // Compute regime
    let regimeData = [];
    if (candleType === 'hourly') {
      regimeData = hourlyRegime(bars);
    } else {
      // daily regime from historical
      regimeData = computeHistoricalVolRegime(STATE.historical?.categories?.crypto?.BTC?.bars || []);
    }
    if (regimeData.length) regimeSeries.setData(regimeData);

    // Candle series
    const candles = chart.addCandlestickSeries({
      upColor: '#00d09c', downColor: '#ff5c5c',
      borderUpColor: '#00d09c', borderDownColor: '#ff5c5c',
      wickUpColor: '#00d09c', wickDownColor: '#ff5c5c',
    });
    candles.setData(bars);

    // Trade markers
    const markers = [];
    trades.forEach(t => {
      const ot = Math.floor(new Date(t.open_time).getTime() / 1000);
      const ct = t.close_time ? Math.floor(new Date(t.close_time).getTime() / 1000) : null;
      if (isFinite(ot) && ot > 0) {
        markers.push({
          time: ot,
          position: 'belowBar',
          color: '#f9b023', // entry — amber
          shape: 'arrowUp',
          text: t.rule === 'media_alta' ? 'm-a' : (t.rule === 'moderada' ? 'mod' : ''),
          size: 1,
        });
      }
      if (ct && isFinite(ct) && ct > 0) {
        const win = t.result === 'WIN';
        const to  = t.result === 'TIMEOUT';
        markers.push({
          time: ct,
          position: 'aboveBar',
          color: win ? '#00d09c' : to ? '#f9b023' : '#ff5c5c',
          shape: 'arrowDown',
          text: win ? 'TP' : to ? 'T/O' : 'SL',
          size: 1.2,
        });
      }
    });
    // Open position marker
    if (opts.includeOpen) {
      const ot = Math.floor(new Date(opts.includeOpen.entry_time || opts.includeOpen.open_time || Date.now()/1000).getTime()/1000);
      if (isFinite(ot) && ot > 0) {
        markers.push({ time: ot, position: 'belowBar', color: '#f9b023', shape: 'circle', text: 'OPEN', size: 2 });
      }
    }
    // Sort & dedupe by time
    const byTime = {};
    markers.sort((a,b) => a.time - b.time).forEach(m => {
      const key = m.time + '|' + m.position;
      if (!byTime[key]) byTime[key] = m;
    });
    const finalMarkers = Object.values(byTime).sort((a,b) => a.time - b.time);
    if (finalMarkers.length) candles.setMarkers(finalMarkers);

    // Initial zoom
    function zoom(days) {
      if (days === 0) {
        chart.timeScale().fitContent();
      } else {
        const last = bars[bars.length - 1].time;
        const from = last - days * 86400;
        chart.timeScale().setVisibleRange({ from, to: last + (candleType === 'hourly' ? 3600 : 86400) });
      }
    }
    zoom(opts.days);

    // Resize handler
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: container.clientWidth });
    });
    ro.observe(container);

    return { chart, zoom };
  }

  // ─────────────────────────────────────────────────────────
  //  Trades table (sortable)
  // ─────────────────────────────────────────────────────────
  function buildTradesTable(prefix, trades) {
    if (!trades.length) {
      return `<div class="r-tfg-empty" style="margin-top:0">
        <div class="r-tfg-empty-icon">📭</div>
        <div class="r-tfg-empty-title">Sin trades aún</div>
        <div class="r-tfg-empty-text">Cuando el modelo abra y cierre el primer trade, aparecerá aquí con su PnL.</div>
      </div>`;
    }
    return `
      <div class="r-tfg-table-shell" id="r-tfg-${prefix}-tableshell">
        <div class="r-tfg-table-head">
          <div class="r-tfg-table-title">Historial de trades <b>${trades.length}</b></div>
          <div style="font-size:11px;color:var(--text-tertiary)">Click en las cabeceras para ordenar</div>
        </div>
        <div class="r-tfg-table-wrap">
          <table class="r-tfg-table" data-prefix="${prefix}">
            <thead><tr>
              <th data-sort="open_time" data-type="date">Apertura</th>
              <th data-sort="close_time" data-type="date">Cierre</th>
              <th data-sort="entry_price" data-type="num" class="ta-right">Entrada</th>
              <th data-sort="exit_price" data-type="num" class="ta-right">Salida</th>
              <th data-sort="rule" data-type="str">Regla</th>
              <th data-sort="result" data-type="str">Resultado</th>
              <th data-sort="pnl_pct" data-type="num" class="ta-right">PnL %</th>
              <th data-sort="capital_after" data-type="num" class="ta-right">Capital</th>
            </tr></thead>
            <tbody>${renderTradeRows(trades)}</tbody>
          </table>
        </div>
      </div>`;
  }

  function renderTradeRows(trades) {
    return trades.map(t => {
      const win = t.result === 'WIN';
      const to  = t.result === 'TIMEOUT';
      const resCls = win ? 'res-win' : (to ? 'res-to' : 'res-loss');
      const pnlPct = t.pnl_pct != null ? (t.pnl_pct >= 0 ? '+' : '') + (t.pnl_pct * 100).toFixed(3) + '%' : '—';
      const pnlCls = (t.pnl_pct || 0) >= 0 ? 'pnl-up' : 'pnl-down';
      const ruleTag = t.rule === 'media_alta' ? '<span class="rule-ma">m-a</span>' : (t.rule === 'moderada' ? '<span class="rule-mod">mod</span>' : '—');
      const exitPx = t.exit_price ?? t.entry;
      return `<tr>
        <td class="mono">${fmtT(t.open_time)}</td>
        <td class="mono" style="color:var(--text-tertiary)">${fmtT(t.close_time)}</td>
        <td class="mono ta-right">${fmtPx(t.entry_price ?? t.entry)}</td>
        <td class="mono ta-right" style="color:var(--text-tertiary)">${fmtPx(exitPx)}</td>
        <td>${ruleTag}</td>
        <td class="${resCls}">${t.result || '—'}</td>
        <td class="mono ta-right ${pnlCls}">${pnlPct}</td>
        <td class="mono ta-right">${t.capital_after != null ? '$'+t.capital_after.toFixed(2) : '—'}</td>
      </tr>`;
    }).join('');
  }

  const _sortState = {};
  function attachTableSort(prefix) {
    const table = document.querySelector(`.r-tfg-table[data-prefix="${prefix}"]`);
    if (!table) return;
    table.querySelectorAll('th[data-sort]').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.sort;
        const type = th.dataset.type;
        const cur = _sortState[prefix];
        const dir = cur && cur.key === key && cur.dir === 'asc' ? 'desc' : 'asc';
        _sortState[prefix] = { key, dir };

        // Update header classes
        table.querySelectorAll('th').forEach(x => { x.classList.remove('sort-asc','sort-desc'); });
        th.classList.add('sort-' + dir);

        // Get trades from STATE
        const trades = prefix === 'paper'
          ? (STATE.paperTrading?.trades || [])
          : (STATE.backtest?.trades || []);
        const sorted = trades.slice().sort((a, b) => {
          let av = a[key], bv = b[key];
          if (type === 'date') {
            av = av ? new Date(av).getTime() : 0;
            bv = bv ? new Date(bv).getTime() : 0;
          } else if (type === 'num') {
            av = av != null ? Number(av) : -Infinity;
            bv = bv != null ? Number(bv) : -Infinity;
          } else {
            av = String(av || '');
            bv = String(bv || '');
          }
          if (av < bv) return dir === 'asc' ? -1 : 1;
          if (av > bv) return dir === 'asc' ? 1 : -1;
          return 0;
        });
        table.querySelector('tbody').innerHTML = renderTradeRows(sorted);
      });
    });
    // Default sort: open_time desc (newest first)
    const defaultTh = table.querySelector('th[data-sort="open_time"]');
    if (defaultTh) {
      defaultTh.click(); defaultTh.click(); // asc then desc
    }
  }

  // ─────────────────────────────────────────────────────────
  //  Wire into STATE / rendering pipeline
  // ─────────────────────────────────────────────────────────
  // Override the original renderPaperTrading/renderBacktest
  const _origRenderPaperTrading = window.renderPaperTrading;
  const _origRenderBacktest = window.renderBacktest;
  window.renderPaperTrading = function () {
    renderPaperPane();
  };
  window.renderBacktest = function () {
    renderBacktestPane();
  };

  // If data was already loaded before patch, render now
  if (STATE?.paperTrading) renderPaperPane();
  if (STATE?.backtest) renderBacktestPane();

  // ─────────────────────────────────────────────────────────
  //  STOCKS — overlay filters + heatmap on top of original
  // ─────────────────────────────────────────────────────────
  // We don't replace stocks.js. We watch for #stocks-content to be filled,
  // then read the rendered rows to compute sector/region groupings and prepend our UI.

  const SECTOR_COLORS = {
    'Technology':'#58a6ff', 'Tech':'#58a6ff',
    'Financials':'#00d09c', 'Finance':'#00d09c',
    'Healthcare':'#b78bff', 'Health':'#b78bff',
    'Consumer Discretionary':'#f9b023', 'Consumer Staples':'#d4a76a', 'Consumer':'#f9b023',
    'Energy':'#ff7a7a',
    'Industrials':'#aab4be', 'Industrial':'#aab4be',
    'Materials':'#3ddbd9',
    'Utilities':'#7b9bce',
    'Real Estate':'#c08fde',
    'Communication Services':'#5dd3b3',
    'Auto':'#3ddbd9',
  };
  function sectorColor(s) { return SECTOR_COLORS[s] || '#888'; }

  let _stocksDataCache = null;
  let _stocksFilter = { region: 'all', sector: 'all', q: '' };

  function readStocksData() {
    // The original stocks.js renders rows with columns:
    //   0=Ticker · 1=Empresa · 2=Sector · 3=Región · 4=Precio · 5=Cambio · 6=MKT CAP · 7=P/E · 8=DIV YIELD
    const rows = document.querySelectorAll('#stocks-content tr[data-ticker], #stocks-content tbody tr');
    const out = [];
    rows.forEach(tr => {
      const cells = tr.children;
      if (!cells || cells.length < 6) return;
      const ticker = tr.dataset.ticker || cells[0]?.textContent?.trim();
      const name = cells[1]?.textContent?.trim() || '';
      const sector = cells[2]?.textContent?.trim() || tr.dataset.sector || '';
      const region = cells[3]?.textContent?.trim() || tr.dataset.region || '';
      // CAMBIO is always cell index 5 — only read that one
      const chgTxt = cells[5]?.textContent?.trim() || '';
      const chgMatch = chgTxt.match(/([+-]?\d+\.?\d*)%/);
      const chgPct = chgMatch ? parseFloat(chgMatch[1]) : 0;
      out.push({ ticker, name, sector, region, chg: chgPct });
    });
    return out;
  }

  function enhanceStocksTab() {
    const content = document.getElementById('stocks-content');
    if (!content) return;
    if (content.dataset.rEnhanced) return;
    // Wait for the original to render real rows
    const rows = content.querySelectorAll('tbody tr');
    if (rows.length < 5) return;  // not ready yet
    content.dataset.rEnhanced = '1';

    const data = readStocksData();
    if (!data.length) return;
    _stocksDataCache = data;

    // Compute sector aggregates (use full dataset, not filtered)
    const bySector = {};
    data.forEach(s => {
      if (!s.sector) return;
      (bySector[s.sector] = bySector[s.sector] || []).push(s);
    });
    const sectorRows = Object.entries(bySector).map(([sec, arr]) => ({
      sector: sec,
      avg: arr.reduce((a, b) => a + b.chg, 0) / arr.length,
      count: arr.length,
    })).sort((a, b) => b.avg - a.avg);

    // Compute overview stats + top movers
    const upN = data.filter(s => s.chg > 0).length;
    const downN = data.filter(s => s.chg < 0).length;
    const flatN = data.length - upN - downN;
    const avgChg = data.reduce((a, b) => a + b.chg, 0) / data.length;
    const winners = [...data].sort((a, b) => b.chg - a.chg).slice(0, 5);
    const losers  = [...data].sort((a, b) => a.chg - b.chg).slice(0, 5);
    const bestSector = sectorRows[0];
    const worstSector = sectorRows[sectorRows.length - 1];

    function moverPanel(title, items, isUp) {
      return `
        <div class="r-stocks-mover-panel">
          <div class="r-stocks-mover-head">
            <div class="r-stocks-heatmap-title">${title}</div>
            <span class="r-cat ${isUp ? 'green' : 'red'}">TOP 5 ${isUp ? '↑' : '↓'}</span>
          </div>
          ${items.map(s => `
            <div class="r-stocks-mover-row">
              <div class="r-stocks-mover-name">
                <span class="r-stocks-mover-ticker">${s.ticker}</span>
                <span class="r-stocks-mover-co">${s.name.slice(0, 22)}</span>
              </div>
              <div class="r-stocks-mover-pct" style="color:var(--r-${isUp?'green':'red'})">${s.chg>=0?'+':''}${s.chg.toFixed(2)}%</div>
            </div>
          `).join('')}
        </div>`;
    }

    // Build heatmap + filters + overview + movers
    const block = document.createElement('div');
    block.id = 'r-stocks-block';
    block.innerHTML = `
      <div class="r-stocks-overview">
        <div class="r-stocks-stat">
          <div class="r-stocks-stat-label">Subiendo vs bajando</div>
          <div class="r-stocks-stat-row">
            <span class="r-stocks-stat-val" style="color:var(--r-green)">${upN}</span>
            <span class="r-stocks-stat-sub">de ${data.length}</span>
            <span class="r-stocks-stat-val" style="color:var(--r-red);margin-left:10px">${downN}</span>
          </div>
          <div style="height:6px;border-radius:3px;background:rgba(255,255,255,0.04);overflow:hidden;margin-top:12px;display:flex">
            <div style="background:var(--r-green);width:${(upN/data.length)*100}%"></div>
            <div style="background:rgba(255,255,255,0.06);width:${(flatN/data.length)*100}%"></div>
            <div style="background:var(--r-red);width:${(downN/data.length)*100}%"></div>
          </div>
        </div>
        <div class="r-stocks-stat">
          <div class="r-stocks-stat-label">Cambio medio</div>
          <div class="r-stocks-stat-row">
            <span class="r-stocks-stat-val" style="color:var(--r-${avgChg>=0?'green':'red'})">${avgChg>=0?'+':''}${avgChg.toFixed(2)}%</span>
          </div>
          <div class="r-stocks-stat-sub" style="margin-top:8px">media ponderada de la sesión</div>
        </div>
        <div class="r-stocks-stat">
          <div class="r-stocks-stat-label">Sector líder · rezagado</div>
          <div class="r-stocks-stat-row" style="gap:18px;flex-wrap:wrap;margin-top:8px">
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);font-weight:500">${bestSector?.sector || '—'}</div>
              <div style="font-family:'DM Mono',monospace;font-size:16px;font-weight:700;color:var(--r-green);margin-top:2px">${bestSector ? '+' + bestSector.avg.toFixed(2) + '%' : '—'}</div>
            </div>
            <div>
              <div style="font-size:11px;color:var(--text-tertiary);font-weight:500">${worstSector?.sector || '—'}</div>
              <div style="font-family:'DM Mono',monospace;font-size:16px;font-weight:700;color:var(--r-red);margin-top:2px">${worstSector ? worstSector.avg.toFixed(2) + '%' : '—'}</div>
            </div>
          </div>
        </div>
      </div>
      <div class="r-stocks-heatmap">
        <div class="r-stocks-heatmap-head">
          <div class="r-stocks-heatmap-title">Sectores · rendimiento medio del día</div>
          <div style="font-size:11px;color:var(--text-tertiary)">Click para filtrar la tabla</div>
        </div>
        <div class="r-stocks-heatmap-grid" id="r-stocks-heatgrid">
          ${sectorRows.map(s => {
            const i = Math.min(0.55, Math.abs(s.avg) * 0.4);
            const bg = s.avg >= 0 ? `rgba(0,208,156,${i})` : `rgba(255,92,92,${i})`;
            return `<div class="r-stocks-heat-cell" data-sector="${s.sector}" style="background:${bg};border:0.5px solid transparent">
              <div class="r-stocks-heat-name">${s.sector}</div>
              <div class="r-stocks-heat-stats">
                <div class="r-stocks-heat-pct">${s.avg>=0?'+':''}${s.avg.toFixed(2)}%</div>
                <div class="r-stocks-heat-count">${s.count}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>
      <div class="r-stocks-movers-grid">
        ${moverPanel('Top ganadores del día', winners, true)}
        ${moverPanel('Top perdedores del día', losers, false)}
      </div>
      <div class="r-stocks-filters">
        <div class="r-stocks-filter-group">
          <span class="r-stocks-filter-label">Sector</span>
          <button class="r-stocks-chip active" data-sec="all">Todos <span class="r-stocks-chip-count">${data.length}</span></button>
          ${sectorRows.map(s => `
            <button class="r-stocks-chip" data-sec="${s.sector}">
              <span class="r-stocks-chip-dot" style="background:${sectorColor(s.sector)}"></span>${s.sector}
              <span class="r-stocks-chip-count">${s.count}</span>
            </button>
          `).join('')}
        </div>
      </div>
    `;

    // Find controls / table containers from the original render
    const controls = content.querySelector('.stocks-controls');
    // Insert block BEFORE controls (or at top of content if no controls)
    if (controls) {
      controls.parentNode.insertBefore(block, controls);
    } else {
      content.insertBefore(block, content.firstChild);
    }

    // Wire heatmap & chip clicks → trigger original search/region filter
    block.querySelectorAll('.r-stocks-heat-cell').forEach(cell => {
      cell.addEventListener('click', () => {
        filterBySector(cell.dataset.sector);
        block.querySelectorAll('.r-stocks-chip').forEach(c => c.classList.toggle('active', c.dataset.sec === cell.dataset.sector));
      });
    });
    block.querySelectorAll('.r-stocks-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        block.querySelectorAll('.r-stocks-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        filterBySector(chip.dataset.sec);
      });
    });
  }

  function filterBySector(sec) {
    // Directly show/hide rows on the original table
    const rows = document.querySelectorAll('#stocks-content tbody tr');
    let shown = 0;
    rows.forEach(tr => {
      const cells = tr.children;
      const rowSec = cells[2]?.textContent?.trim() || '';
      const match = sec === 'all' || rowSec === sec;
      tr.style.display = match ? '' : 'none';
      if (match) shown++;
    });
    // Update visible count somewhere if present
  }

  // Watch for stocks-content to be populated
  const stocksObserver = new MutationObserver(() => {
    enhanceStocksTab();
  });
  const stocksTarget = document.getElementById('stocks-content');
  if (stocksTarget) {
    stocksObserver.observe(stocksTarget, { childList: true, subtree: true });
  }
  // Also re-check whenever Acciones is clicked
  document.querySelectorAll('[data-tab="stocks"]').forEach(b => {
    b.addEventListener('click', () => {
      setTimeout(enhanceStocksTab, 600);
      setTimeout(enhanceStocksTab, 1800);
    });
  });
})();
