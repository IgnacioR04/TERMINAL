/* ╭───────────────────────────────────────────────────╮
   │  TFG.terminal — Redesign patch (Macro/Cripto/Mat) │
   ╰───────────────────────────────────────────────────╯
   Runs AFTER the original inline script. It:
   1. Provides mock-data fallback so preview works without /data/*.json.
   2. Replaces the section markup with new containers.
   3. Overrides the renderers for Cripto, Materias primas, Macro.
   4. Adds didactic tooltips and traffic-light semaphores. */

(function () {
  // ─────────────────────────────────────────────────────────
  // 1. MOCK DATA (only used if /data/*.json don't exist)
  // ─────────────────────────────────────────────────────────
  const _today = new Date();
  function _mkBars(start, vol, n = 120) {
    const bars = []; let v = start;
    let seed = start * 17;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = n; i > 0; i--) {
      const d = new Date(_today); d.setDate(d.getDate() - i);
      const date = d.toISOString().slice(0, 10);
      const o = v;
      v *= 1 + (rnd() - 0.5) * vol * 2;
      const c = v;
      const h = Math.max(o, c) * (1 + rnd() * vol * 0.5);
      const l = Math.min(o, c) * (1 - rnd() * vol * 0.5);
      bars.push({ date, open: o, high: h, low: l, close: c });
    }
    return bars;
  }
  function _live(price, chg) {
    return {
      price,
      change_pct: chg,
      change: price * chg / 100,
      high: price * (1 + Math.abs(chg) / 100 * 1.2),
      low: price * (1 - Math.abs(chg) / 100 * 1.2),
      quote_vol: price * 1e6 * (5 + Math.random() * 20),
    };
  }
  const MOCK_LIVE = {
    updated_at: new Date().toISOString(),
    crypto: {
      BTCUSDT: _live(78143, -1.16),  ETHUSDT: _live(2179.04, -1.93),
      SOLUSDT: _live(86.50, -3.15),  BNBUSDT: _live(656.28, -2.47),
      XRPUSDT: _live(1.41, -1.42),   ADAUSDT: _live(0.2546, -2.62),
      AVAXUSDT:_live(9.29, -2.73),   DOGEUSDT:_live(0.1093, -3.78),
      LINKUSDT:_live(9.71, -3.63),   DOTUSDT: _live(1.27, -3.59),
      ATOMUSDT:_live(2.04, 5.62),
    },
    commodities: {
      GOLD:     _live(4555.80, -2.61),
      SILVER:   _live(77.16, -9.13),
      PLATINUM: _live(1102.5, -1.42),
      OIL:      _live(105.42, 4.20),
      BRENT:    _live(109.26, 3.35),
      NATGAS:   _live(2.96, 2.28),
      COPPER:   _live(6.25, -4.81),
      WHEAT:    _live(620.5, 0.82),
      CORN:     _live(450.2, -0.51),
      COFFEE:   _live(235.4, 1.18),
    },
    forex: {
      DXY: _live(99.27, 0.39),
      EURUSD: _live(1.0815, -0.32), GBPUSD: _live(1.2625, -0.18),
      USDJPY: _live(154.32, 0.45),  USDCHF: _live(0.892, 0.22),
      USDCNY: _live(7.245, 0.15),
    },
    indices: {
      SP500:_live(7408.50,-1.24),  NDX:_live(29125.20,-1.54),
      DJI:_live(49526.17,-1.07),   RUT:_live(2793.30,-2.44),
      STOXX:_live(5827.76,-0.57),  DAX:_live(23950.57,-2.07),
      FTSE:_live(10195.40,-1.71),  IBEX:_live(17622.70,-1.05),
      CAC:_live(7952.55,-1.60),
      N225:_live(38520,-1.99),     HSI:_live(19420,-1.62),
      VIX:_live(22.4, 8.5),
    },
    bonds: {
      US10Y: _live(4.32, 1.2),
      US2Y:  _live(4.62, 0.8),
      US30Y: _live(4.51, 1.5),
    },
    fear_greed: { value: 32, class: "Fear" },
    news: [], calendar: [], btc_klines_daily: [],
  };
  const MOCK_HIST = { categories: {
    crypto: {
      BTC: { bars:_mkBars(75000, 0.025) }, ETH:{ bars:_mkBars(2200, 0.03) },
      SOL: { bars:_mkBars(85, 0.04) },     BNB:{ bars:_mkBars(660, 0.025) },
      XRP: { bars:_mkBars(1.42, 0.03) },   ADA:{ bars:_mkBars(0.26, 0.035) },
      AVAX:{ bars:_mkBars(9.5, 0.04) },    DOGE:{ bars:_mkBars(0.11, 0.04) },
      LINK:{ bars:_mkBars(10, 0.035) },    DOT:{ bars:_mkBars(1.30, 0.035) },
    },
    commodities: {
      GOLD:    { bars:_mkBars(4520, 0.012) }, SILVER:  { bars:_mkBars(80, 0.028) },
      PLATINUM:{ bars:_mkBars(1110, 0.018) }, OIL:     { bars:_mkBars(101, 0.022) },
      BRENT:   { bars:_mkBars(106, 0.022) },  NATGAS:  { bars:_mkBars(2.9, 0.04) },
      COPPER:  { bars:_mkBars(6.4, 0.02) },   WHEAT:   { bars:_mkBars(615, 0.018) },
      CORN:    { bars:_mkBars(453, 0.018) },  COFFEE:  { bars:_mkBars(232, 0.022) },
    },
    indices: {
      SP500:{ bars:_mkBars(7450, 0.011) }, NDX:{ bars:_mkBars(29200, 0.014) },
      DJI:  { bars:_mkBars(49700, 0.01) }, RUT:{ bars:_mkBars(2830, 0.015) },
      STOXX:{ bars:_mkBars(5840, 0.011) }, DAX:{ bars:_mkBars(24050, 0.013) },
      FTSE: { bars:_mkBars(10250, 0.011) },IBEX:{ bars:_mkBars(17680, 0.012) },
      CAC:  { bars:_mkBars(7980, 0.011) }, N225:{ bars:_mkBars(38600, 0.013) },
      HSI:  { bars:_mkBars(19500, 0.014) },VIX: { bars:_mkBars(20, 0.06) },
    },
    forex: {
      DXY:{ bars:_mkBars(99.05, 0.005) },     EURUSD:{ bars:_mkBars(1.083, 0.004) },
      GBPUSD:{ bars:_mkBars(1.264, 0.004) },  USDJPY:{ bars:_mkBars(153.8, 0.005) },
      USDCHF:{ bars:_mkBars(0.89, 0.004) },   USDCNY:{ bars:_mkBars(7.24, 0.003) },
    },
    bonds: {
      US10Y:{ bars:_mkBars(4.25, 0.018) }, US2Y:{ bars:_mkBars(4.55, 0.018) },
      US30Y:{ bars:_mkBars(4.45, 0.018) },
    },
  }};

  // ─────────────────────────────────────────────────────────
  // 2. FETCH INTERCEPTOR (mock fallback for missing JSON)
  // ─────────────────────────────────────────────────────────
  const _origFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const mock = u.includes('live_data.json') ? MOCK_LIVE
               : u.includes('historical_data.json') ? MOCK_HIST
               : null;
    return _origFetch(url, opts)
      .then(r => r.ok ? r : (mock ? new Response(JSON.stringify(mock), { status: 200, headers: { 'content-type':'application/json' }}) : r))
      .catch(e => mock ? new Response(JSON.stringify(mock), { status: 200, headers: { 'content-type':'application/json' }}) : Promise.reject(e));
  };

  // ─────────────────────────────────────────────────────────
  // 3. GLOSSARY (didactic tooltips)
  // ─────────────────────────────────────────────────────────
  const TIPS = {
    DXY:        "Dollar Index: mide la fuerza del dólar frente a 6 divisas (euro, yen, libra…). Si sube → bajan oro, BTC y materias primas. Inverso al apetito por riesgo.",
    GOLD:       "Oro: refugio clásico ante incertidumbre, inflación o crisis. Compite con el dólar y, cada vez más, con Bitcoin.",
    SILVER:     "Plata: mitad refugio, mitad industrial. Más volátil que el oro y muy sensible a la demanda manufacturera.",
    PLATINUM:   "Platino: muy usado en automoción y catalizadores. Sensible al ciclo industrial global.",
    OIL:        "Petróleo WTI: barril de referencia en EE.UU. Termómetro de la demanda mundial. Subidas fuertes anticipan inflación.",
    BRENT:      "Petróleo Brent: barril de referencia europeo, marca el precio en gran parte del mundo.",
    NATGAS:     "Gas natural: muy estacional y dependiente del clima. Picos invernales típicos.",
    COPPER:     "Cobre — 'Dr. Copper': anticipa el ciclo económico. Si sube, hay crecimiento; si cae, viene desaceleración.",
    WHEAT:      "Trigo: alimento básico mundial. Sube con sequías, guerras o disrupciones logísticas.",
    CORN:       "Maíz: insumo clave para alimentación animal y biocombustibles.",
    COFFEE:     "Café: depende del clima en Brasil y Vietnam. Muy sensible a heladas y sequías.",
    VIX:        "Índice del miedo en la bolsa USA. Por debajo de 20 = calma · 20-30 = alerta · por encima de 30 = pánico.",
    US10Y:      "Rendimiento del bono USA a 10 años. Si sube, encarece el crédito y suele presionar a la baja a la bolsa y a cripto.",
    US2Y:       "Rendimiento del bono USA a 2 años. Refleja expectativas de tipos a corto plazo.",
    US30Y:      "Rendimiento del bono USA a 30 años. Refleja expectativas de inflación a largo plazo.",
    SP500:      "S&P 500: las 500 mayores empresas cotizadas de EE.UU. La referencia global de bolsa.",
    NDX:        "Nasdaq 100: las 100 mayores tecnológicas de EE.UU. Más volátil que el S&P 500.",
    DJI:        "Dow Jones: 30 grandes empresas industriales USA. Más antiguo y conservador.",
    RUT:        "Russell 2000: 2.000 pequeñas empresas USA. Termómetro de la economía doméstica.",
    STOXX:      "Euro Stoxx 50: las 50 mayores empresas de la zona euro.",
    DAX:        "DAX: 40 grandes empresas alemanas. Motor industrial de Europa.",
    FTSE:       "FTSE 100: 100 mayores empresas británicas.",
    IBEX:       "IBEX 35: 35 mayores empresas españolas.",
    CAC:        "CAC 40: 40 mayores empresas francesas.",
    N225:       "Nikkei 225: bolsa japonesa, sensible al yen.",
    HSI:        "Hang Seng: bolsa de Hong Kong, referencia para China.",
    BTC:        "Bitcoin: la cripto original. 'Oro digital' para muchos. Reserva de valor descentralizada.",
    ETH:        "Ethereum: plataforma para contratos inteligentes y la mayoría de aplicaciones cripto.",
    FEAR_GREED: "Índice Fear & Greed del mercado cripto. 0 = miedo extremo (oportunidad histórica), 100 = codicia extrema (cuidado, suele preceder correcciones).",
    CVI:        "Crypto Volatility Index: cuánto se mueve BTC y ETH a corto plazo. Alto = sesiones agitadas, mayor riesgo y oportunidad.",
    SPREAD:     "Spread 2Y-10Y: diferencia entre el bono a 10 años y el de 2. Si es negativo, la curva está 'invertida' — históricamente, una de las señales más fiables de recesión a 12-18 meses.",
    GROWTH:     "Crecimiento: cuántos índices bursátiles principales suben hoy. Verde si la mayoría sube.",
    RATES:      "Tipos de interés: estado de la curva 2-10Y. Verde = curva normal y sana. Rojo = invertida = alerta de recesión.",
    VOLATILITY: "Volatilidad: nivel del VIX. Verde si <20 (calma), ámbar 20-30, rojo >30 (pánico).",
    DOLLAR:     "Dólar: dirección del DXY. Verde si baja (favorece a riesgo y materias primas). Rojo si sube fuerte.",
    BONDS:      "Renta fija: dirección de los yields a 10Y. Verde si bajan (alivio para riesgo).",
  };

  // ─────────────────────────────────────────────────────────
  // 4. METADATA for cards (categories, symbols, colors)
  // ─────────────────────────────────────────────────────────
  const COMMOD_META = {
    GOLD:     { sym:"Au",  name:"Oro",          cat:"Refugio",   tone:"amber",  bg:"linear-gradient(135deg,#d4af37,#8a6f17)" },
    SILVER:   { sym:"Ag",  name:"Plata",        cat:"Refugio",   tone:"amber",  bg:"linear-gradient(135deg,#bfc5cc,#6f757c)" },
    PLATINUM: { sym:"Pt",  name:"Platino",      cat:"Refugio",   tone:"amber",  bg:"linear-gradient(135deg,#e5e4e2,#8f9095)" },
    OIL:      { sym:"WTI", name:"Petróleo WTI", cat:"Energía",   tone:"blue",   bg:"linear-gradient(135deg,#2d3a4a,#0e1620)" },
    BRENT:    { sym:"Br",  name:"Brent",        cat:"Energía",   tone:"blue",   bg:"linear-gradient(135deg,#3a4a5c,#1a2230)" },
    NATGAS:   { sym:"NG",  name:"Gas natural",  cat:"Energía",   tone:"blue",   bg:"linear-gradient(135deg,#4a90e2,#1f5996)" },
    COPPER:   { sym:"Cu",  name:"Cobre",        cat:"Industrial",tone:"green",  bg:"linear-gradient(135deg,#b87333,#7a4715)" },
    WHEAT:    { sym:"Wh",  name:"Trigo",        cat:"Agrícola",  tone:"green",  bg:"linear-gradient(135deg,#d4a76a,#8a6a30)" },
    CORN:     { sym:"Cn",  name:"Maíz",         cat:"Agrícola",  tone:"green",  bg:"linear-gradient(135deg,#f3c95e,#a07c20)" },
    COFFEE:   { sym:"Cf",  name:"Café",         cat:"Agrícola",  tone:"green",  bg:"linear-gradient(135deg,#6f4e37,#3a2916)" },
  };
  const CRYPTO_META = {
    BTC:  { sym:"₿",  name:"Bitcoin",  cat:"Layer 1",      bg:"linear-gradient(135deg,#f7931a,#a55c00)" },
    ETH:  { sym:"Ξ",  name:"Ethereum", cat:"Smart Contracts", bg:"linear-gradient(135deg,#627eea,#384da8)" },
    SOL:  { sym:"S",  name:"Solana",   cat:"Layer 1",      bg:"linear-gradient(135deg,#9945ff,#5a1da8)" },
    BNB:  { sym:"B",  name:"BNB",      cat:"Exchange",     bg:"linear-gradient(135deg,#f3ba2f,#a07c14)" },
    XRP:  { sym:"X",  name:"XRP",      cat:"Pagos",        bg:"linear-gradient(135deg,#444a52,#1a1d22)" },
    ADA:  { sym:"A",  name:"Cardano",  cat:"Layer 1",      bg:"linear-gradient(135deg,#0033ad,#001a5c)" },
    AVAX: { sym:"V",  name:"Avalanche",cat:"Layer 1",      bg:"linear-gradient(135deg,#e84142,#9c1a1c)" },
    DOGE: { sym:"D",  name:"Dogecoin", cat:"Meme",         bg:"linear-gradient(135deg,#c2a633,#7d6a17)" },
    LINK: { sym:"L",  name:"Chainlink",cat:"Oracle",       bg:"linear-gradient(135deg,#2a5ada,#163994)" },
    DOT:  { sym:"P",  name:"Polkadot", cat:"Layer 1",      bg:"linear-gradient(135deg,#e6007a,#8c004a)" },
    ATOM: { sym:"C",  name:"Cosmos",   cat:"Layer 1",      bg:"linear-gradient(135deg,#2e3148,#15182a)" },
    MATIC:{ sym:"M",  name:"Polygon",  cat:"Layer 2",      bg:"linear-gradient(135deg,#8247e5,#4d2b8c)" },
  };
  const PAIR_TO_HIST = {
    BTCUSDT:"BTC", ETHUSDT:"ETH", SOLUSDT:"SOL", BNBUSDT:"BNB",
    XRPUSDT:"XRP", ADAUSDT:"ADA", AVAXUSDT:"AVAX", DOGEUSDT:"DOGE",
    LINKUSDT:"LINK", DOTUSDT:"DOT", ATOMUSDT:"ATOM", MATICUSDT:"MATIC",
  };

  // ─────────────────────────────────────────────────────────
  // 5. UTILS
  // ─────────────────────────────────────────────────────────
  function getCloses(category, code, n = 30) {
    const bars = STATE?.historical?.categories?.[category]?.[code]?.bars;
    if (!bars) return [];
    return bars.slice(-n).map(b => parseFloat(b.close)).filter(v => isFinite(v) && v > 0);
  }
  function rArea(closes, opts = {}) {
    if (!closes || closes.length < 2) return '';
    const W = opts.width ?? 240, H = opts.height ?? 56;
    const min = Math.min(...closes), max = Math.max(...closes);
    const range = max - min || closes[0] * 0.01 || 1;
    const isUp = opts.up !== undefined ? opts.up : (closes[closes.length-1] >= closes[0]);
    const stroke = isUp ? '#00d09c' : '#ff5c5c';
    const fillStart = isUp ? 'rgba(0,208,156,0.32)' : 'rgba(255,92,92,0.22)';
    const fillEnd   = isUp ? 'rgba(0,208,156,0.0)'  : 'rgba(255,92,92,0.0)';
    const padY = 4;
    const pts = closes.map((v, i) => {
      const x = (i / (closes.length - 1)) * W;
      const y = H - padY - ((v - min) / range) * (H - padY * 2);
      return [x, y];
    });
    const gid = 'g' + Math.random().toString(36).slice(2, 8);
    const lineD = 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' L ');
    const areaD = `M${pts[0][0].toFixed(1)},${H} L${pts.map(p => p[0].toFixed(1)+','+p[1].toFixed(1)).join(' L ')} L${pts[pts.length-1][0].toFixed(1)},${H} Z`;
    return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="overflow:visible">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${fillStart}"/>
        <stop offset="100%" stop-color="${fillEnd}"/>
      </linearGradient></defs>
      <path d="${areaD}" fill="url(#${gid})"/>
      <path d="${lineD}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
    </svg>`;
  }
  function infoIcon(key) {
    const tip = TIPS[key];
    if (!tip) return '';
    return `<span class="r-info" data-tip="${tip.replace(/"/g, '&quot;')}"></span>`;
  }
  function tipAttr(key) {
    const tip = TIPS[key];
    return tip ? ` data-tip="${tip.replace(/"/g, '&quot;')}"` : '';
  }
  function cls(x) { return (x ?? 0) >= 0 ? 'up' : 'down'; }
  function pct(x) {
    if (x == null || isNaN(x)) return '—';
    const v = Number(x); return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }
  function price(x, d = 2) {
    if (x == null || isNaN(x)) return '—';
    return Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function compact(x) {
    if (x == null || isNaN(x)) return '—';
    const a = Math.abs(x);
    if (a >= 1e12) return (x/1e12).toFixed(2) + 'T';
    if (a >= 1e9)  return (x/1e9 ).toFixed(2) + 'B';
    if (a >= 1e6)  return (x/1e6 ).toFixed(2) + 'M';
    if (a >= 1e3)  return (x/1e3 ).toFixed(2) + 'K';
    return Number(x).toFixed(2);
  }
  function openModal(category, code, name) {
    if (typeof openAssetModal === 'function') openAssetModal(category, code, name);
  }

  // ─────────────────────────────────────────────────────────
  // 6. REPLACE SECTION MARKUP
  // ─────────────────────────────────────────────────────────
  function injectLogomark() {
    document.querySelectorAll('.sidebar').forEach(sb => {
      const brand = sb.querySelector('.brand');
      if (!brand || sb.querySelector('.brand-mark')) return;
      const sub = sb.querySelector('.brand-sub');
      const row = document.createElement('div');
      row.className = 'brand-row';
      row.innerHTML = `
        <svg class="brand-mark" viewBox="0 0 36 36" aria-hidden="true">
          <defs>
            <linearGradient id="tfg-logo-grad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#3fb950"/>
              <stop offset="100%" stop-color="#58a6ff"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="32" height="32" rx="9" fill="url(#tfg-logo-grad)"/>
          <path d="M 10 13 L 26 13 M 18 13 L 18 25" stroke="#0d1117" stroke-width="3.2" stroke-linecap="round" fill="none"/>
          <circle cx="26.5" cy="25.5" r="2.2" fill="#0d1117"/>
        </svg>
        <div class="brand-text"></div>
      `;
      brand.parentNode.insertBefore(row, brand);
      row.querySelector('.brand-text').appendChild(brand);
      if (sub) row.querySelector('.brand-text').appendChild(sub);
    });
  }

  function setupSections() {
    injectLogomark();
    const crypto = document.getElementById('view-crypto');
    if (crypto) crypto.innerHTML = `
      <div id="r-crypto-mood"></div>
      <div id="r-crypto-heroes"></div>
      <div id="r-crypto-compare"></div>
      <div id="r-crypto-alts"></div>
    `;
    const commod = document.getElementById('view-commodities');
    if (commod) commod.innerHTML = `
      <div id="r-commod-hero"></div>
      <div id="r-commod-rank"></div>
      <div id="r-commod-regions"></div>
      <div id="r-commod-fx"></div>
    `;
    const macro = document.getElementById('view-macro');
    if (macro) macro.innerHTML = `
      <div id="r-macro-pulse"></div>
      <div id="r-macro-mid"></div>
      <div id="r-macro-extras"></div>
      <div id="r-macro-heatmap"></div>
      <div id="r-macro-regions"></div>
      <div id="r-macro-bonds"></div>
    `;
    const cal = document.getElementById('view-calendar');
    if (cal) cal.innerHTML = `
      <div class="r-cal-shell">
        <div class="r-cal-nav">
          <button class="r-cal-nav-btn" id="cal-prev"><i class="ti ti-chevron-left"></i></button>
          <div class="r-cal-label" id="cal-month-label">—</div>
          <button class="r-cal-nav-btn" id="cal-next"><i class="ti ti-chevron-right"></i></button>
          <button class="r-cal-today-btn" id="cal-today">Hoy</button>
          <div class="r-cal-legend">
            <span><span class="r-cal-legend-dot" style="background:var(--r-red)"></span>Alto impacto</span>
            <span><span class="r-cal-legend-dot" style="background:var(--r-amber)"></span>Medio</span>
            <span><span class="r-cal-legend-dot" style="background:rgba(255,255,255,0.25)"></span>Bajo</span>
          </div>
        </div>
        <div id="cal-grid-container"></div>
      </div>
      <div class="r-cal-events">
        <div id="cal-detail-bar"></div>
        <div class="r-cal-evt-cols-head">
          <div>Hora</div><div></div><div>País</div><div>Evento</div>
          <div style="text-align:right">Ant.</div>
          <div style="text-align:right">Prev.</div>
          <div style="text-align:right">Act.</div>
        </div>
        <div id="cal-list"></div>
      </div>
    `;
  }
  setupSections();

  // ─────────────────────────────────────────────────────────
  // 7a. DASHBOARD overrides (mini-cards + macro strip + FG)
  // ─────────────────────────────────────────────────────────
  const _PAIR_NAMES = { BTCUSDT:'Bitcoin', ETHUSDT:'Ethereum', SOLUSDT:'Solana',
    BNBUSDT:'BNB', XRPUSDT:'XRP', ADAUSDT:'Cardano', AVAXUSDT:'Avalanche',
    DOGEUSDT:'Dogecoin', LINKUSDT:'Chainlink', DOTUSDT:'Polkadot',
    MATICUSDT:'Polygon', ATOMUSDT:'Cosmos' };
  window.renderCryptoGrid = function (crypto, containerId, limit) {
    const el = document.getElementById(containerId); if (!el) return;
    const entries = Object.entries(crypto || {});
    const slice = limit ? entries.slice(0, limit) : entries;
    el.innerHTML = slice.map(([pair, c]) => {
      const hist = PAIR_TO_HIST[pair];
      const meta = CRYPTO_META[hist] || { sym: pair.slice(0,2), name: _PAIR_NAMES[pair]||pair, cat:'Crypto', bg:'rgba(255,255,255,0.06)' };
      const closes = getCloses('crypto', hist, 30);
      const isUp = (c?.change_pct ?? 0) >= 0;
      const priceStr = c?.price > 0 ? `$${price(c.price, c.price < 1 ? 4 : 2)}` : '—';
      const volStr = c?.quote_vol > 0 ? compact(c.quote_vol) : '—';
      return `
        <div class="r-card" onclick="openAssetModal('crypto','${hist || ''}','${meta.name}')">
          <div class="r-card-head">
            <div class="r-card-name">
              <div class="r-card-sym" style="background:${meta.bg};border:none">${meta.sym}</div>
              <div><b>${meta.name}</b><br/><span style="font-size:10px;color:var(--text-tertiary);font-family:'DM Mono',monospace">${pair}</span></div>
            </div>
            <span class="r-cat">${meta.cat}</span>
          </div>
          <div class="r-card-price">${priceStr}</div>
          <div class="r-card-change ${cls(c?.change_pct)}">${isUp?'▲':'▼'} ${pct(c?.change_pct)}</div>
          <div class="r-card-meta"><span>Vol 24h: ${volStr}</span></div>
          <div class="r-card-chart">${rArea(closes, {width:240,height:58,up:isUp})}</div>
        </div>`;
    }).join('');
  };

  window.renderMacroBar = function (d) {
    const el = document.getElementById('macro-bar'); if (!el) return;
    const items = [
      { code:'SP500',  label:'S&P 500', val:d.indices?.SP500?.price,    chg:d.indices?.SP500?.change_pct, cat:'indices' },
      { code:'NDX',    label:'Nasdaq',  val:d.indices?.NDX?.price,      chg:d.indices?.NDX?.change_pct, cat:'indices' },
      { code:'VIX',    label:'VIX',     val:d.indices?.VIX?.price,      chg:d.indices?.VIX?.change_pct, cat:'indices' },
      { code:'DXY',    label:'DXY',     val:d.forex?.DXY?.price,        chg:d.forex?.DXY?.change_pct, cat:'forex' },
      { code:'US10Y',  label:'US 10Y',  val:d.bonds?.US10Y?.price,      chg:d.bonds?.US10Y?.change_pct, cat:'bonds' },
      { code:'GOLD',   label:'Oro',     val:d.commodities?.GOLD?.price, chg:d.commodities?.GOLD?.change_pct, cat:'commodities' },
      { code:'EURUSD', label:'EUR/USD', val:d.forex?.EURUSD?.price,     chg:d.forex?.EURUSD?.change_pct, cat:'forex' },
    ].filter(i => i.val != null);
    el.className = 'r-macrostrip';
    el.style.padding = '0';
    el.innerHTML = items.map(i => {
      const isUp = (i.chg ?? 0) >= 0;
      return `
        <div class="r-macrostrip-item" onclick="openAssetModal('${i.cat}','${i.code}','${i.label}')"${tipAttr(i.code)}>
          <div class="r-ms-label">${i.label}</div>
          <div class="r-ms-price">${price(i.val, i.val < 10 ? 3 : 2)}</div>
          <div class="r-ms-chg ${isUp?'up':'down'}">${isUp?'▲':'▼'} ${pct(i.chg)}</div>
        </div>`;
    }).join('');
  };

  // Restyle Fear & Greed card on dashboard (#fg-value sits inside a .card; we replace its parent .card)
  function restyleDashboardSentiment() {
    const fgValEl = document.getElementById('fg-value');
    if (!fgValEl) return;
    const card = fgValEl.closest('.card');
    if (!card) return;
    const fg = STATE?.live?.fear_greed; if (!fg) return;
    const v = fg.value ?? 50;
    if (card.dataset.rRestyled) {
      // Just update values (keep markup, but re-sync)
      const valEl = card.querySelector('.r-sentiment-value');
      const stateEl = card.querySelector('.r-gauge-state');
      const ptrEl = card.querySelector('.r-gauge-ptr');
      if (valEl) valEl.textContent = v;
      if (stateEl) stateEl.textContent = fg.class || '—';
      if (ptrEl) ptrEl.style.left = v + '%';
      return;
    }
    card.dataset.rRestyled = '1';
    const tone = v < 25 ? 'red' : v < 45 ? 'amber' : v < 75 ? 'green' : 'amber';
    const explain =
      v < 25 ? 'Miedo extremo · suele coincidir con suelos de mercado.' :
      v < 45 ? 'Miedo · nerviosismo pero sin pánico.' :
      v < 55 ? 'Mercado neutral.' :
      v < 75 ? 'Codicia · revisa coberturas.' :
      'Codicia extrema · cuidado con correcciones.';
    card.className = 'r-sentiment';
    card.style.cssText = '';
    card.innerHTML = `
      <div class="r-sentiment-head">
        <div class="r-gauge-title">Fear &amp; Greed Index ${infoIcon('FEAR_GREED')}</div>
        <div class="r-gauge-state" style="background:var(--r-${tone}-dim);color:var(--r-${tone})">${fg.class || '—'}</div>
      </div>
      <div class="r-sentiment-row">
        <div class="r-sentiment-value">${v}</div>
        <div class="r-sentiment-label">de 100 · sentimiento cripto</div>
      </div>
      <div class="r-gauge-bar fg"><div class="r-gauge-ptr" style="left:${v}%"></div></div>
      <div class="r-gauge-scale"><span>Miedo extremo</span><span>Neutral</span><span>Codicia extrema</span></div>
      <div class="r-sentiment-explain">${explain}</div>
      <!-- Hidden helpers so original renderLive() doesn't crash -->
      <span id="fg-value" style="display:none"></span>
      <span id="fg-label" style="display:none"></span>
      <span id="fg-pointer" style="display:none"></span>
    `;
  }

  // Override the "Pares cripto" title on dashboard
  function restyleDashboardCryptoTitle() {
    document.querySelectorAll('#view-dashboard .card-title').forEach(t => {
      if (t.textContent.trim() === 'Pares cripto' || t.textContent.includes('Pares cripto')) {
        t.outerHTML = `<div class="r-region-head" style="margin-bottom:14px"><span>Pares cripto principales</span><span class="r-region-summary">Top 6 por capitalización · 24h en vivo</span></div>`;
      }
      if (t.textContent.trim() === 'Sentiment') {
        t.outerHTML = `<div class="r-region-head" style="margin-bottom:14px"><span>Sentimiento</span><span class="r-region-summary">Cripto</span></div>`;
      }
    });
  }

  // ─────────────────────────────────────────────────────────
  // 7b. MACRO extras (breadth, top movers, regional perf)
  // ─────────────────────────────────────────────────────────
  function renderMacroExtras(d) {
    const el = document.getElementById('r-macro-extras');
    if (!el) return;
    const indices = d.indices || {};

    // Breadth: % de índices al alza
    const allIdx = ['SP500','NDX','DJI','RUT','STOXX','DAX','FTSE','IBEX','CAC','N225','HSI'];
    const data = allIdx.map(c => indices[c]?.change_pct).filter(v => v != null);
    const upN = data.filter(v => v > 0.05).length;
    const downN = data.filter(v => v < -0.05).length;
    const flatN = data.length - upN - downN;
    const upPct = (upN / data.length) * 100;
    const flatPct = (flatN / data.length) * 100;
    const downPct = (downN / data.length) * 100;
    const breadth = upPct - downPct;
    const breadthMsg = breadth > 40
      ? `<strong style="color:var(--r-green)">Amplitud muy positiva</strong>: la subida es generalizada (no depende de unos pocos índices). Señal saludable.`
      : breadth > 10
      ? `Amplitud positiva: más índices suben que bajan, pero con matices.`
      : breadth > -10
      ? `Amplitud neutra: el mercado está dividido. No hay tendencia global clara.`
      : breadth > -40
      ? `Amplitud negativa: predominan las caídas. Cuidado con activos de riesgo.`
      : `<strong style="color:var(--r-red)">Amplitud muy negativa</strong>: caída global sincronizada — situación de aversión al riesgo.`;

    // Top movers (índices + crypto + commodities)
    const allMovers = [];
    Object.entries(indices).forEach(([c, x]) => x?.change_pct != null && allMovers.push({ code:c, name:fullIndexName(c), cat:'indices', chg:x.change_pct, price:x.price }));
    Object.entries(d.commodities || {}).forEach(([c, x]) => x?.change_pct != null && COMMOD_META[c] && allMovers.push({ code:c, name:COMMOD_META[c].name, cat:'commodities', chg:x.change_pct, price:x.price }));
    Object.entries(d.crypto || {}).forEach(([c, x]) => {
      const hist = PAIR_TO_HIST[c];
      if (x?.change_pct != null && hist) allMovers.push({ code:hist, name:CRYPTO_META[hist]?.name || c, cat:'crypto', chg:x.change_pct, price:x.price });
    });
    const winners = [...allMovers].sort((a, b) => b.chg - a.chg).slice(0, 5);
    const losers  = [...allMovers].sort((a, b) => a.chg - b.chg).slice(0, 5);

    // Regional perf
    const regionGroups = {
      'EE.UU.':   ['SP500','NDX','DJI','RUT'],
      'Europa':   ['STOXX','DAX','FTSE','IBEX','CAC'],
      'Asia':     ['N225','HSI'],
    };
    const regionalPerf = Object.entries(regionGroups).map(([label, codes]) => {
      const chgs = codes.map(c => indices[c]?.change_pct).filter(v => v != null);
      if (!chgs.length) return null;
      const avg = chgs.reduce((a,b)=>a+b,0) / chgs.length;
      return { label, avg, n: chgs.length };
    }).filter(Boolean);

    el.innerHTML = `
      <div class="r-macro-2col">
        <div class="r-breadth">
          <div class="r-breadth-head">
            <div class="r-gauge-title">Amplitud del mercado global ${infoIcon('VOLATILITY')||''}</div>
            <div class="r-gauge-state" style="background:rgba(255,255,255,0.04);color:var(--text-secondary)">${data.length} índices</div>
          </div>
          <div class="r-breadth-bar">
            <div class="r-breadth-up" style="width:${upPct}%" title="${upN} suben"></div>
            <div class="r-breadth-flat" style="width:${flatPct}%" title="${flatN} planos"></div>
            <div class="r-breadth-down" style="width:${downPct}%" title="${downN} bajan"></div>
          </div>
          <div class="r-breadth-legend">
            <span style="color:var(--r-green)">↑ ${upN} suben</span>
            <span>↔ ${flatN} planos</span>
            <span style="color:var(--r-red)">↓ ${downN} bajan</span>
          </div>
          <div class="r-breadth-explain">${breadthMsg}</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:16px">
            ${regionalPerf.map(r => `
              <div class="r-stat">
                <div class="r-stat-label">${r.label}</div>
                <div class="r-stat-value ${r.avg>=0?'up':'down'}" style="color:var(--r-${r.avg>=0?'green':'red'})">${r.avg>=0?'+':''}${r.avg.toFixed(2)}%</div>
                <div style="font-size:10px;color:var(--text-muted);margin-top:2px">media · ${r.n} índices</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="r-movers">
          <div class="r-breadth-head">
            <div class="r-gauge-title">Top movers del día</div>
            <div id="r-movers-tabs">
              <div class="r-movers-tabs">
                <button class="r-movers-tab active" data-side="up">Ganadores</button>
                <button class="r-movers-tab" data-side="down">Perdedores</button>
              </div>
            </div>
          </div>
          <div id="r-movers-body"></div>
        </div>
      </div>
    `;

    function renderMovers(side) {
      const list = side === 'up' ? winners : losers;
      const body = document.getElementById('r-movers-body');
      if (!body) return;
      body.innerHTML = list.map(m => {
        const closes = getCloses(m.cat, m.code, 20);
        return `
          <div class="r-mover-row" onclick="openAssetModal('${m.cat}','${m.code}','${m.name}')">
            <div class="r-mover-name"><b>${m.name}</b> <span style="font-size:10px;color:var(--text-muted)">${labelCat(m.cat)}</span></div>
            <div class="r-mover-spark">${rArea(closes, {width:80,height:24,up:m.chg>=0})}</div>
            <div class="r-mover-pct" style="color:var(--r-${m.chg>=0?'green':'red'})">${m.chg>=0?'+':''}${m.chg.toFixed(2)}%</div>
          </div>`;
      }).join('');
    }
    renderMovers('up');
    el.querySelectorAll('.r-movers-tab').forEach(b => {
      b.addEventListener('click', () => {
        el.querySelectorAll('.r-movers-tab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        renderMovers(b.dataset.side);
      });
    });
  }
  function fullIndexName(c) {
    return ({ SP500:'S&P 500', NDX:'Nasdaq 100', DJI:'Dow Jones', RUT:'Russell 2000',
      STOXX:'Euro Stoxx 50', DAX:'DAX', FTSE:'FTSE 100', IBEX:'IBEX 35', CAC:'CAC 40',
      N225:'Nikkei 225', HSI:'Hang Seng', VIX:'VIX' })[c] || c;
  }
  function labelCat(c) {
    return c === 'crypto' ? '· Cripto' : c === 'commodities' ? '· Materia prima' : '· Índice';
  }

  // ─────────────────────────────────────────────────────────
  // 7. RENDER — CRIPTO
  // ─────────────────────────────────────────────────────────
  window.renderCryptoView = function (d) {
    const crypto = d.crypto || {};
    const fg = d.fear_greed || { value: 50, class: '—' };

    // CVI
    const btcChg = Math.abs(crypto.BTCUSDT?.change_pct ?? 0);
    const ethChg = Math.abs(crypto.ETHUSDT?.change_pct ?? 0);
    const rawVol = (btcChg * 0.6 + ethChg * 0.4) * 10;
    const cvi = Math.min(100, Math.max(0, Math.round(rawVol + 20)));
    const cviLabel = cvi < 25 ? 'Baja' : cvi < 45 ? 'Moderada' : cvi < 65 ? 'Elevada' : 'Extrema';
    const cviTone  = cvi < 25 ? 'green' : cvi < 45 ? 'green' : cvi < 65 ? 'amber' : 'red';

    // FG tone
    const fgVal = fg.value ?? 50;
    const fgTone = fgVal < 25 ? 'red' : fgVal < 45 ? 'amber' : fgVal < 75 ? 'green' : 'amber';
    const fgExplain =
      fgVal < 25 ? 'Miedo extremo. Históricamente, suele coincidir con suelos de mercado — momentos de potencial oportunidad para inversores pacientes.' :
      fgVal < 45 ? 'Miedo. Hay nerviosismo en el mercado pero todavía sin pánico.' :
      fgVal < 55 ? 'Mercado neutral. Sin emoción dominante.' :
      fgVal < 75 ? 'Codicia. Los precios suben con apetito por riesgo. Buen momento para revisar coberturas.' :
      'Codicia extrema. El mercado está sobrecomprado — suele preceder correcciones.';
    const cviExplain =
      cvi < 25 ? 'Mercado tranquilo. Los movimientos son contenidos: bajo riesgo de sustos pero también pocas oportunidades de trading rápido.' :
      cvi < 45 ? 'Volatilidad moderada. Movimientos típicos del cripto. Riesgo manejable.' :
      cvi < 65 ? 'Volatilidad elevada. Sesiones agitadas. Cuidado con el tamaño de las posiciones.' :
      'Volatilidad extrema. Movimientos del 5-10% diarios son posibles. Conviene reducir exposición.';

    // ── MOOD section ──
    const moodEl = document.getElementById('r-crypto-mood');
    if (moodEl) {
      moodEl.innerHTML = `
        <div class="r-section-head">
          <div>
            <div class="r-section-title">El estado de ánimo del mercado</div>
            <div class="r-section-sub">Dos termómetros que resumen cómo se siente el cripto hoy: cuánto miedo o codicia hay (Fear &amp; Greed) y cuánto se mueven los precios (CVI).</div>
          </div>
          <div class="r-section-action"><span class="r-ribbon">en vivo</span></div>
        </div>
        <div class="r-grid r-grid-2" style="margin-bottom:20px">
          <div class="r-gauge">
            <div class="r-gauge-head">
              <div class="r-gauge-title">Fear &amp; Greed Index ${infoIcon('FEAR_GREED')}</div>
              <div class="r-gauge-state" style="background:var(--r-${fgTone}-dim);color:var(--r-${fgTone})">${fg.class || '—'}</div>
            </div>
            <div class="r-gauge-row">
              <div class="r-gauge-value">${fgVal}</div>
              <div class="r-gauge-label">de 100</div>
            </div>
            <div class="r-gauge-bar fg"><div class="r-gauge-ptr" style="left:${fgVal}%"></div></div>
            <div class="r-gauge-scale"><span>Miedo extremo</span><span>Neutral</span><span>Codicia extrema</span></div>
            <div class="r-gauge-explain">${fgExplain}</div>
          </div>
          <div class="r-gauge">
            <div class="r-gauge-head">
              <div class="r-gauge-title">Volatilidad cripto (CVI) ${infoIcon('CVI')}</div>
              <div class="r-gauge-state" style="background:var(--r-${cviTone}-dim);color:var(--r-${cviTone})">${cviLabel}</div>
            </div>
            <div class="r-gauge-row">
              <div class="r-gauge-value">${cvi}</div>
              <div class="r-gauge-label">de 100</div>
            </div>
            <div class="r-gauge-bar cvi"><div class="r-gauge-ptr" style="left:${cvi}%"></div></div>
            <div class="r-gauge-scale"><span>Tranquilo</span><span>Normal</span><span>Tormenta</span></div>
            <div class="r-gauge-explain">${cviExplain}</div>
          </div>
        </div>
      `;
    }

    // ── HERO cards BTC + ETH ──
    const heroEl = document.getElementById('r-crypto-heroes');
    if (heroEl) {
      const HEROES = [
        { pair:'BTCUSDT', hist:'BTC' },
        { pair:'ETHUSDT', hist:'ETH' },
      ];
      heroEl.innerHTML = `<div class="r-grid r-grid-2" style="margin-bottom:20px">` + HEROES.map(h => {
        const c = crypto[h.pair];
        if (!c) return '';
        const meta = CRYPTO_META[h.hist];
        const closes = getCloses('crypto', h.hist, 30);
        const isUp = c.change_pct >= 0;
        return `
          <div class="r-crypto-hero" onclick="openAssetModal('crypto','${h.hist}','${meta.name}')">
            <div class="r-crypto-hero-head">
              <div class="r-crypto-hero-name">
                <div class="r-card-sym" style="background:${meta.bg};border:none">${meta.sym}</div>
                <div><b>${meta.name}</b> <span>${h.pair}</span></div>
              </div>
              <span class="r-cat blue">${meta.cat}</span>
            </div>
            <div class="r-crypto-hero-price">$${price(c.price, c.price < 1 ? 4 : 2)}</div>
            <div class="r-card-change ${cls(c.change_pct)}">${isUp?'▲':'▼'} ${pct(c.change_pct)}</div>
            <div class="r-crypto-hero-meta">
              <span>Vol 24h: <b>${compact(c.quote_vol)} USDT</b></span>
              <span>Alto: <b>$${price(c.high, c.price < 1 ? 4 : 2)}</b></span>
              <span>Bajo: <b>$${price(c.low, c.price < 1 ? 4 : 2)}</b></span>
            </div>
            <div class="r-crypto-hero-chart">${rArea(closes, {width:480,height:80,up:isUp})}</div>
          </div>`;
      }).join('') + `</div>`;
    }

    // ── COMPARE BTC vs ORO ──
    const cmpEl = document.getElementById('r-crypto-compare');
    if (cmpEl) {
      const btcCloses = getCloses('crypto', 'BTC', 30);
      const goldCloses = getCloses('commodities', 'GOLD', 30);
      const btcPct = btcCloses.length >= 2 ? ((btcCloses[btcCloses.length-1] - btcCloses[0]) / btcCloses[0]) * 100 : null;
      const goldPct = goldCloses.length >= 2 ? ((goldCloses[goldCloses.length-1] - goldCloses[0]) / goldCloses[0]) * 100 : null;
      let verdict = 'Datos insuficientes para comparar.';
      if (btcPct != null && goldPct != null) {
        const diff = btcPct - goldPct;
        if (diff > 5) verdict = `<strong>Bitcoin gana al oro</strong> en los últimos 30 días por ${diff.toFixed(1)} puntos. El relato de "oro digital" tiene momento — los inversores eligen el activo de riesgo frente al refugio clásico.`;
        else if (diff < -5) verdict = `<strong>El oro vence a Bitcoin</strong> en los últimos 30 días por ${Math.abs(diff).toFixed(1)} puntos. Cuando el refugio físico supera al digital, suele ser por aversión al riesgo o tensiones geopolíticas.`;
        else verdict = `BTC y oro se mueven en paralelo (diferencia de solo ${Math.abs(diff).toFixed(1)} pts). No hay rotación clara entre refugio digital y físico — el mercado está indeciso.`;
      }
      cmpEl.innerHTML = `
        <div class="r-compare">
          <div class="r-compare-head">
            <div>
              <div class="r-section-title" style="font-size:18px">Bitcoin vs Oro · últimos 30 días</div>
              <div class="r-section-sub" style="margin-top:2px;font-size:11.5px">¿Quién gana el duelo entre el refugio digital y el clásico?</div>
            </div>
            <span class="r-cat violet">Comparativa</span>
          </div>
          <div class="r-compare-grid">
            <div class="r-compare-side">
              <div class="r-compare-name">${CRYPTO_META.BTC.sym} Bitcoin</div>
              <div class="r-compare-value">$${price(crypto.BTCUSDT?.price ?? 0, 0)}</div>
              <div><span class="r-compare-chg ${cls(btcPct)}">${pct(btcPct)} 30D</span></div>
              <div class="r-compare-chart">${rArea(btcCloses, {width:320,height:56,up:(btcPct??0)>=0})}</div>
            </div>
            <div class="r-compare-vs">vs.</div>
            <div class="r-compare-side right">
              <div class="r-compare-name">${COMMOD_META.GOLD.sym} Oro</div>
              <div class="r-compare-value">$${price(MOCK_LIVE.commodities?.GOLD?.price ?? 0, 0)}</div>
              <div><span class="r-compare-chg ${cls(goldPct)}">${pct(goldPct)} 30D</span></div>
              <div class="r-compare-chart">${rArea(goldCloses, {width:320,height:56,up:(goldPct??0)>=0})}</div>
            </div>
          </div>
          <div class="r-compare-verdict">${verdict}</div>
        </div>
      `;
      // Replace gold price with live data if available
      const gold = d.commodities?.GOLD;
      if (gold?.price) {
        cmpEl.querySelectorAll('.r-compare-side.right .r-compare-value')[0].textContent = '$' + price(gold.price, 0);
      }
    }

    // ── ALTCOINS ──
    const altsEl = document.getElementById('r-crypto-alts');
    if (altsEl) {
      const SKIP = new Set(['BTCUSDT','ETHUSDT']);
      const alts = Object.entries(crypto).filter(([p, c]) => !SKIP.has(p) && c?.price > 0);
      const cards = alts.map(([pair, c]) => {
        const hist = PAIR_TO_HIST[pair];
        const meta = CRYPTO_META[hist] || { sym: pair.replace('USDT','').slice(0,2), name: pair.replace('USDT',''), cat:'Crypto', bg:'rgba(255,255,255,0.05)' };
        const closes = getCloses('crypto', hist, 30);
        const isUp = c.change_pct >= 0;
        return `
          <div class="r-card" onclick="openAssetModal('crypto','${hist || ''}','${meta.name}')">
            <div class="r-card-head">
              <div class="r-card-name">
                <div class="r-card-sym" style="background:${meta.bg};border:none">${meta.sym}</div>
                <div><b>${meta.name}</b><br/><span style="font-size:10.5px;color:var(--text-tertiary);font-family:'DM Mono',monospace">${pair}</span></div>
              </div>
              <span class="r-cat">${meta.cat}</span>
            </div>
            <div class="r-card-price">$${price(c.price, c.price < 1 ? 4 : 2)}</div>
            <div class="r-card-change ${cls(c.change_pct)}">${isUp?'▲':'▼'} ${pct(c.change_pct)}</div>
            <div class="r-card-meta"><span>Vol 24h: ${compact(c.quote_vol)}</span></div>
            <div class="r-card-chart">${rArea(closes, {width:280,height:58,up:isUp})}</div>
          </div>`;
      }).join('');
      altsEl.innerHTML = `
        <div class="r-region">
          <div class="r-region-head"><span>Altcoins</span><span class="r-region-summary">${alts.length} activos · 24h</span></div>
          <div class="r-grid r-grid-4">${cards || '<div class="loading" style="grid-column:1/-1">Sin datos de altcoins.</div>'}</div>
        </div>
      `;
    }
  };

  // ─────────────────────────────────────────────────────────
  // 8. RENDER — MATERIAS PRIMAS
  // ─────────────────────────────────────────────────────────
  window.renderCommoditiesBarChart = function () { /* no-op: integrated below */ };
  window.renderDXYHero = function () { /* no-op */ };
  window.renderCommoditiesRegions = function () { /* no-op */ };

  function renderCommoditiesFull(d) {
    const commod = d.commodities || {};
    const forex = d.forex || {};
    const dxy = forex.DXY;
    const gold = commod.GOLD;
    const btc = d.crypto?.BTCUSDT;

    // HERO with DXY + key insight
    const heroEl = document.getElementById('r-commod-hero');
    if (heroEl && dxy?.price) {
      const ratio = (gold?.price && btc?.price > 0) ? (gold.price / btc.price).toFixed(5) : null;
      const dxyTone = dxy.change_pct > 0.2 ? 'red' : dxy.change_pct < -0.2 ? 'green' : 'amber';
      const dxyMsg =
        dxy.change_pct > 0.2 ? 'El dólar se fortalece — viento en contra para materias primas, oro y cripto.' :
        dxy.change_pct < -0.2 ? 'El dólar se debilita — viento a favor para activos de riesgo y materias primas.' :
        'El dólar se mantiene estable hoy.';
      heroEl.innerHTML = `
        <div class="r-section-head">
          <div>
            <div class="r-section-title">Materias primas</div>
            <div class="r-section-sub">Lo que se compra y se vende en el mundo físico — metales, energía, alimentos. El dólar manda en todas ellas, por eso empezamos por ahí.</div>
          </div>
          <div class="r-section-action"><span class="r-ribbon">en vivo</span></div>
        </div>
        <div class="r-hero">
          <div class="r-hero-row">
            <div class="r-hero-headline">
              <div class="r-hero-eyebrow">Dollar Index · DXY ${infoIcon('DXY')}</div>
              <div class="r-hero-title">${dxyMsg}</div>
              <div class="r-hero-body">Cuando el dólar sube, todo lo que cotiza en dólares (oro, petróleo, BTC) tiende a bajar. Es la regla más importante del mercado global.</div>
            </div>
            <div class="r-hero-metric">
              <div class="r-hero-metric-label">DXY ahora</div>
              <div class="r-hero-metric-value">${price(dxy.price, 3)}</div>
              <div><span class="r-card-change ${cls(dxy.change_pct)}">${(dxy.change_pct>=0?'▲':'▼')} ${pct(dxy.change_pct)}</span></div>
              <div class="r-hero-metric-foot">Frente a 6 divisas principales</div>
            </div>
            <div class="r-hero-metric">
              <div class="r-hero-metric-label">Ratio Oro / BTC ${infoIcon('GOLD')}</div>
              <div class="r-hero-metric-value">${ratio ?? '—'}</div>
              <div class="r-hero-metric-foot">Cuántos BTC compra una onza de oro</div>
            </div>
          </div>
        </div>
      `;
    } else if (heroEl) {
      heroEl.innerHTML = '';
    }

    // RANKING by % change
    const rankEl = document.getElementById('r-commod-rank');
    if (rankEl) {
      const items = Object.entries(commod)
        .filter(([code, x]) => x?.change_pct != null && COMMOD_META[code])
        .map(([code, x]) => ({ code, ...x, meta: COMMOD_META[code] }))
        .sort((a, b) => b.change_pct - a.change_pct);
      const maxAbs = Math.max(...items.map(i => Math.abs(i.change_pct)), 0.5);
      const half = 50; // % of track width for each side
      const rows = items.map(it => {
        const isUp = it.change_pct >= 0;
        const w = (Math.abs(it.change_pct) / maxAbs) * half;
        const style = isUp ? `left:50%;width:${w}%` : `right:50%;width:${w}%;left:auto`;
        return `
          <div class="r-rank-row" onclick="openAssetModal('commodities','${it.code}','${it.meta.name}')">
            <div class="r-rank-name">
              <div class="r-card-sym" style="background:${it.meta.bg};border:none;width:22px;height:22px;font-size:9px">${it.meta.sym}</div>
              <div><b>${it.meta.name}</b> <span class="r-cat ${it.meta.tone}" style="margin-left:4px">${it.meta.cat}</span></div>
            </div>
            <div class="r-rank-track">
              <div class="r-rank-fill ${isUp?'up':'down'}" style="${style}"></div>
              <div class="r-rank-zero" style="left:50%"></div>
            </div>
            <div class="r-rank-pct ${isUp?'up':'down'}">${(isUp?'+':'')}${it.change_pct.toFixed(2)}%</div>
          </div>`;
      }).join('');
      rankEl.innerHTML = `
        <div class="r-region" style="margin-bottom:22px">
          <div class="r-region-head"><span>Rendimiento diario · ranking</span><span class="r-region-summary">Mejor arriba, peor abajo</span></div>
          <div class="r-rank">
            <div class="r-rank-rows">${rows}</div>
          </div>
        </div>
      `;
    }

    // REGIONS — cards by category
    const regEl = document.getElementById('r-commod-regions');
    if (regEl) {
      const regions = [
        { label: 'Metales preciosos · refugio',    codes:['GOLD','SILVER','PLATINUM'], sum:'Lo que se compra cuando hay miedo o inflación.' },
        { label: 'Energía',                        codes:['OIL','BRENT','NATGAS'],     sum:'Mueve la economía global. Subidas → inflación.' },
        { label: 'Metales industriales',           codes:['COPPER'],                   sum:'Anticipan el ciclo económico.' },
        { label: 'Materias agrícolas',             codes:['WHEAT','CORN','COFFEE'],    sum:'Sensibles al clima y a la geopolítica.' },
      ];
      regEl.innerHTML = regions.map(r => {
        const avail = r.codes.filter(c => commod[c]);
        if (!avail.length) return '';
        const cards = avail.map(code => commodCard(commod[code], code)).join('');
        return `
          <div class="r-region">
            <div class="r-region-head">
              <span>${r.label}</span>
              <span class="r-region-summary">${r.sum}</span>
            </div>
            <div class="r-grid r-grid-4">${cards}</div>
          </div>`;
      }).join('');
    }

    // FX
    const fxEl = document.getElementById('r-commod-fx');
    if (fxEl) {
      const FOREX_NAMES = { EURUSD:'EUR/USD', GBPUSD:'GBP/USD', USDJPY:'USD/JPY', USDCHF:'USD/CHF', USDCNY:'USD/CNY', DXY:'DXY' };
      const cards = Object.entries(forex).filter(([c]) => c !== 'DXY').map(([code, c]) => {
        const closes = getCloses('forex', code, 30);
        const isUp = (c?.change_pct ?? 0) >= 0;
        return `
          <div class="r-card" onclick="openAssetModal('forex','${code}','${FOREX_NAMES[code]||code}')">
            <div class="r-card-head">
              <div class="r-card-name">
                <div class="r-card-sym" style="background:linear-gradient(135deg,#3a4a5c,#1a2230);border:none">${code.slice(0,2)}</div>
                <div><b>${FOREX_NAMES[code]||code}</b></div>
              </div>
              <span class="r-cat">FX</span>
            </div>
            <div class="r-card-price">${price(c?.price, 4)}</div>
            <div class="r-card-change ${cls(c?.change_pct)}">${isUp?'▲':'▼'} ${pct(c?.change_pct)}</div>
            <div class="r-card-chart">${rArea(closes, {width:280,height:58,up:isUp})}</div>
          </div>`;
      }).join('');
      fxEl.innerHTML = cards ? `
        <div class="r-region">
          <div class="r-region-head"><span>Divisas principales</span><span class="r-region-summary">Cómo se mueve el dólar frente a las grandes</span></div>
          <div class="r-grid r-grid-4">${cards}</div>
        </div>` : '';
    }
  }

  function commodCard(item, code) {
    const meta = COMMOD_META[code]; if (!meta) return '';
    const closes = getCloses('commodities', code, 30);
    const isUp = (item?.change_pct ?? 0) >= 0;
    return `
      <div class="r-card" onclick="openAssetModal('commodities','${code}','${meta.name}')"${tipAttr(code)}>
        <div class="r-card-head">
          <div class="r-card-name">
            <div class="r-card-sym" style="background:${meta.bg};border:none">${meta.sym}</div>
            <div><b>${meta.name}</b></div>
          </div>
          <span class="r-cat ${meta.tone}">${meta.cat}</span>
        </div>
        <div class="r-card-price">${price(item?.price, 2)}</div>
        <div class="r-card-change ${cls(item?.change_pct)}">${isUp?'▲':'▼'} ${pct(item?.change_pct)}</div>
        <div class="r-card-chart">${rArea(closes, {width:280,height:58,up:isUp})}</div>
      </div>`;
  }

  // ─────────────────────────────────────────────────────────
  // 9. RENDER — MACRO
  // ─────────────────────────────────────────────────────────
  function renderMacroFull(d) {
    const indices = d.indices || {};
    const bonds = d.bonds || {};
    const forex = d.forex || {};

    // ── PULSE (scorecard reimagined) ──
    const sc = computeScorecard(indices, bonds, forex);
    const pulseEl = document.getElementById('r-macro-pulse');
    if (pulseEl) {
      pulseEl.innerHTML = `
        <div class="r-section-head">
          <div>
            <div class="r-section-title">Macro · cómo respira la economía global</div>
            <div class="r-section-sub">5 termómetros que resumen el entorno macro. Cuantos más verdes, mejor para los activos de riesgo (bolsa, cripto).</div>
          </div>
          <div class="r-section-action"><span class="r-ribbon">en vivo</span></div>
        </div>
        <div class="r-hero">
          <div class="r-pulse-head">
            <div>
              <div class="r-hero-eyebrow">Pulso macro</div>
              <div class="r-pulse-summary">${sc.summary}</div>
            </div>
          </div>
          <div class="r-pulse-grid">${sc.indicators.map(i => `
            <div class="r-pulse-item" data-tip="${TIPS[i.tipKey] || i.detail}">
              <div><span class="r-pulse-dot ${i.color}"></span><span class="r-pulse-label">${i.label}</span></div>
              <div class="r-pulse-detail">${i.detail}</div>
            </div>`).join('')}
          </div>
        </div>
      `;
    }

    // ── MID GRID: yield curve + VIX gauge ──
    const midEl = document.getElementById('r-macro-mid');
    if (midEl) {
      const us10y = bonds.US10Y?.price, us2y = bonds.US2Y?.price;
      const spread = (us10y != null && us2y != null) ? us10y - us2y : null;
      const inverted = spread != null && spread < 0;
      const flat = spread != null && spread >= 0 && spread < 0.5;
      const ycState = inverted ? 'inv' : flat ? 'flat' : 'normal';
      const ycLabel = inverted ? 'Invertida' : flat ? 'Aplanada' : 'Normal';
      const ycExplain = inverted
        ? `La curva está <strong style="color:var(--r-red)">invertida</strong> (${spread.toFixed(2)}pp). Históricamente, una de las señales más fiables de recesión a 12-18 meses vista. Cuidado.`
        : flat
        ? `La curva está <strong style="color:var(--r-amber)">aplanada</strong> (spread de solo ${spread.toFixed(2)}pp). Indica desaceleración o expectativas de bajadas de tipos.`
        : `Curva <strong style="color:var(--r-green)">normal</strong> (spread +${spread?.toFixed(2)}pp). Los plazos largos pagan más que los cortos — situación sana.`;

      // build SVG curve
      const pts = [
        { label:'2Y', v:bonds.US2Y?.price },
        { label:'10Y', v:bonds.US10Y?.price },
        { label:'30Y', v:bonds.US30Y?.price },
      ].filter(p => p.v != null);
      const ycSvg = pts.length >= 2 ? buildYieldCurveSVG(pts, inverted, flat) : '<div class="loading">Sin datos</div>';

      // VIX
      const vix = indices.VIX?.price;
      let vixGauge = '';
      if (vix != null) {
        const vixPct = Math.min(100, (vix / 50) * 100);
        const vixTone = vix < 20 ? 'green' : vix < 30 ? 'amber' : 'red';
        const vixLabel = vix < 20 ? 'Calmado' : vix < 30 ? 'Alerta' : 'Pánico';
        const vixExpl = vix < 20
          ? 'El mercado está calmado. Las opciones implican poca volatilidad esperada.'
          : vix < 30
          ? 'Hay tensión. Los inversores se cubren — algo huele a riesgo.'
          : 'Pánico. Históricamente, niveles altos del VIX coinciden con suelos de mercado.';
        vixGauge = `
          <div class="r-gauge">
            <div class="r-gauge-head">
              <div class="r-gauge-title">VIX · miedo en bolsa ${infoIcon('VIX')}</div>
              <div class="r-gauge-state" style="background:var(--r-${vixTone}-dim);color:var(--r-${vixTone})">${vixLabel}</div>
            </div>
            <div class="r-gauge-row">
              <div class="r-gauge-value">${vix.toFixed(1)}</div>
              <div class="r-gauge-label">índice S&amp;P 500</div>
            </div>
            <div class="r-gauge-bar vix"><div class="r-gauge-ptr" style="left:${vixPct}%"></div></div>
            <div class="r-gauge-scale"><span>0</span><span>20</span><span>30</span><span>50+</span></div>
            <div class="r-gauge-explain">${vixExpl}</div>
          </div>`;
      }

      midEl.innerHTML = `
        <div class="r-spread">
          <div class="r-spread-main">
            <div class="r-spread-main-label">Spread 2Y → 10Y ${infoIcon('SPREAD')}</div>
            <div class="r-spread-main-val ${spread != null ? cls(spread) : ''}">${spread != null ? (spread>=0?'+':'')+spread.toFixed(2)+'pp' : '—'}</div>
          </div>
          <div class="r-spread-right">
            <div class="r-stat"${tipAttr('US2Y')}>
              <div class="r-stat-label">US 2Y</div>
              <div class="r-stat-value">${us2y != null ? us2y.toFixed(3)+'%' : '—'}</div>
            </div>
            <div class="r-stat"${tipAttr('US10Y')}>
              <div class="r-stat-label">US 10Y</div>
              <div class="r-stat-value">${us10y != null ? us10y.toFixed(3)+'%' : '—'}</div>
            </div>
            <div class="r-stat"${tipAttr('US30Y')}>
              <div class="r-stat-label">US 30Y</div>
              <div class="r-stat-value">${bonds.US30Y?.price != null ? bonds.US30Y.price.toFixed(3)+'%' : '—'}</div>
            </div>
          </div>
        </div>
        <div class="r-mid-grid">
          <div class="r-yc">
            <div class="r-yc-head">
              <div class="r-yc-title">Curva de tipos USA ${infoIcon('CURVE') || ''}</div>
              <div class="r-yc-state ${ycState}">${ycLabel}</div>
            </div>
            ${ycSvg}
            <div class="r-yc-explain">${ycExplain}</div>
          </div>
          ${vixGauge}
        </div>
      `;
    }

    // ── EXTRAS (breadth, movers, regional perf) ──
    renderMacroExtras(d);

    // ── HEATMAP ──
    const hmEl = document.getElementById('r-macro-heatmap');
    if (hmEl) {
      hmEl.innerHTML = `
        <div class="r-heatmap" style="margin-bottom:20px">
          <div class="r-region-head" style="border-bottom:none;padding-bottom:0;margin-bottom:14px">
            <span>Bolsas mundiales · hoy</span>
            <span class="r-region-summary">Verde = sube · rojo = cae · cuanto más intenso, mayor movimiento</span>
          </div>
          ${heatmapRegion('Estados Unidos', ['SP500','NDX','DJI','RUT'], indices, 'us')}
          ${heatmapRegion('Europa',         ['STOXX','DAX','FTSE','IBEX','CAC'], indices, 'eu')}
          ${heatmapRegion('Asia-Pacífico',  ['N225','HSI'], indices, 'asia')}
        </div>
      `;
    }

    // ── REGION CARDS ──
    const regEl = document.getElementById('r-macro-regions');
    if (regEl) {
      const NAMES = { SP500:'S&P 500', NDX:'Nasdaq 100', DJI:'Dow Jones', RUT:'Russell 2000',
        STOXX:'Euro Stoxx 50', DAX:'DAX', FTSE:'FTSE 100', IBEX:'IBEX 35', CAC:'CAC 40',
        N225:'Nikkei 225', HSI:'Hang Seng', VIX:'VIX' };
      const regions = [
        { label:'Estados Unidos', codes:['SP500','NDX','DJI','RUT'], sum:'Las bolsas más grandes y líquidas del mundo.' },
        { label:'Europa',         codes:['STOXX','DAX','FTSE','IBEX','CAC'], sum:'Mercados europeos por país.' },
        { label:'Asia-Pacífico',  codes:['N225','HSI'], sum:'Bolsas asiáticas — Japón y Hong Kong.' },
      ];
      regEl.innerHTML = regions.map(r => {
        const avail = r.codes.filter(c => indices[c]);
        if (!avail.length) return '';
        const cards = avail.map(code => indexCard(indices[code], code, NAMES[code])).join('');
        return `
          <div class="r-region">
            <div class="r-region-head"><span>${r.label}</span><span class="r-region-summary">${r.sum}</span></div>
            <div class="r-grid r-grid-4">${cards}</div>
          </div>`;
      }).join('');
    }

    // ── BONDS ──
    const bondsEl = document.getElementById('r-macro-bonds');
    if (bondsEl) {
      const NAMES = { US10Y:'US 10Y · referencia', US2Y:'US 2Y · corto plazo', US30Y:'US 30Y · largo plazo' };
      const cards = Object.entries(bonds).map(([code, c]) => {
        const closes = getCloses('bonds', code, 30);
        const isUp = (c?.change_pct ?? 0) >= 0;
        return `
          <div class="r-card" onclick="openAssetModal('bonds','${code}','${NAMES[code]||code}')"${tipAttr(code)}>
            <div class="r-card-head">
              <div class="r-card-name">
                <div class="r-card-sym" style="background:linear-gradient(135deg,#3a4a5c,#1a2230);border:none">${code.replace('US','').replace('Y','y')}</div>
                <div><b>${NAMES[code]||code}</b></div>
              </div>
              <span class="r-cat">Bono USA</span>
            </div>
            <div class="r-card-price">${c?.price != null ? c.price.toFixed(3)+'%' : '—'}</div>
            <div class="r-card-change ${cls(c?.change_pct)}">${isUp?'▲':'▼'} ${pct(c?.change_pct)}</div>
            <div class="r-card-chart">${rArea(closes, {width:280,height:58,up:isUp})}</div>
          </div>`;
      }).join('');
      bondsEl.innerHTML = cards ? `
        <div class="r-region">
          <div class="r-region-head"><span>Renta fija · bonos del tesoro USA</span><span class="r-region-summary">Yields al alza = crédito más caro = malo para bolsa y cripto</span></div>
          <div class="r-grid r-grid-3">${cards}</div>
        </div>` : '';
    }
  }

  function indexCard(item, code, name) {
    const closes = getCloses('indices', code, 30);
    const isUp = (item?.change_pct ?? 0) >= 0;
    return `
      <div class="r-card" onclick="openAssetModal('indices','${code}','${name}')"${tipAttr(code)}>
        <div class="r-card-head">
          <div class="r-card-name">
            <div class="r-card-sym" style="background:linear-gradient(135deg,#3a4a5c,#1a2230);border:none">${code.slice(0,2)}</div>
            <div><b>${name}</b></div>
          </div>
          <span class="r-cat">Índice</span>
        </div>
        <div class="r-card-price">${price(item?.price, 2)}</div>
        <div class="r-card-change ${cls(item?.change_pct)}">${isUp?'▲':'▼'} ${pct(item?.change_pct)}</div>
        <div class="r-card-chart">${rArea(closes, {width:280,height:58,up:isUp})}</div>
      </div>`;
  }

  function heatmapRegion(label, codes, indices, key) {
    const NAMES = { SP500:'S&P 500', NDX:'Nasdaq', DJI:'Dow Jones', RUT:'Russell 2000',
      STOXX:'Stoxx 50', DAX:'DAX', FTSE:'FTSE', IBEX:'IBEX', CAC:'CAC 40',
      N225:'Nikkei', HSI:'Hang Seng' };
    const cells = codes.map(c => {
      const d = indices[c]; const chg = d?.change_pct;
      const i = chg != null ? Math.min(0.55, Math.abs(chg) * 0.3) : 0;
      const bg = chg == null ? 'rgba(255,255,255,0.03)' : (chg > 0 ? `rgba(0,208,156,${i})` : `rgba(255,92,92,${i})`);
      return `<div class="r-heatmap-cell" style="background:${bg};border:0.5px solid ${chg == null ? 'var(--r-border)' : 'transparent'}" onclick="openAssetModal('indices','${c}','${NAMES[c]||c}')">
        <span class="r-heatmap-ticker">${NAMES[c]||c}</span>
        <span class="r-heatmap-change">${chg != null ? (chg>=0?'+':'')+chg.toFixed(2)+'%' : '—'}</span>
      </div>`;
    }).join('');
    return `
      <div class="r-heatmap-region">
        <div class="r-heatmap-label">${label}</div>
        <div class="r-heatmap-grid r-heatmap-${key}">${cells}</div>
      </div>`;
  }

  function buildYieldCurveSVG(pts, inverted, flat) {
    const W = 460, H = 130;
    const padL = 40, padR = 16, padT = 22, padB = 26;
    const inner = { w: W - padL - padR, h: H - padT - padB };
    const vals = pts.map(p => p.v);
    const minV = Math.min(...vals), maxV = Math.max(...vals);
    const range = maxV - minV || 0.1;
    const coords = pts.map((p, i) => ({
      ...p,
      x: padL + (i / (pts.length - 1)) * inner.w,
      y: padT + (1 - (p.v - minV) / range) * inner.h,
    }));
    let pathD = `M ${coords[0].x},${coords[0].y}`;
    for (let i = 1; i < coords.length; i++) {
      const prev = coords[i - 1], cur = coords[i];
      const cx = (prev.x + cur.x) / 2;
      pathD += ` C ${cx},${prev.y} ${cx},${cur.y} ${cur.x},${cur.y}`;
    }
    const stroke = inverted ? '#ff5c5c' : flat ? '#f9b023' : '#00d09c';
    const fillTop = inverted ? 'rgba(255,92,92,0.20)' : flat ? 'rgba(249,176,35,0.18)' : 'rgba(0,208,156,0.20)';
    const fillBot = inverted ? 'rgba(255,92,92,0.0)' : flat ? 'rgba(249,176,35,0.0)' : 'rgba(0,208,156,0.0)';
    const gid = 'yc' + Math.random().toString(36).slice(2,7);
    const areaD = pathD + ` L ${coords[coords.length-1].x},${H-padB} L ${coords[0].x},${H-padB} Z`;
    const dots = coords.map(p => `
      <circle cx="${p.x}" cy="${p.y}" r="4.5" fill="${stroke}"/>
      <circle cx="${p.x}" cy="${p.y}" r="2" fill="#0d1117"/>
      <text x="${p.x}" y="${H - 8}" text-anchor="middle" font-size="10" fill="rgba(255,255,255,0.45)" font-family="DM Mono,monospace">${p.label}</text>
      <text x="${p.x}" y="${p.y - 11}" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.85)" font-family="DM Mono,monospace" font-weight="600">${p.v.toFixed(2)}%</text>
    `).join('');
    // baseline gridlines
    let grids = '';
    for (let g = 0; g <= 3; g++) {
      const y = padT + (g/3) * inner.h;
      grids += `<line x1="${padL}" x2="${W-padR}" y1="${y}" y2="${y}" stroke="rgba(255,255,255,0.04)"/>`;
    }
    return `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block">
      <defs><linearGradient id="${gid}" x1="0" x2="0" y1="0" y2="1">
        <stop offset="0%" stop-color="${fillTop}"/>
        <stop offset="100%" stop-color="${fillBot}"/>
      </linearGradient></defs>
      ${grids}
      <path d="${areaD}" fill="url(#${gid})"/>
      <path d="${pathD}" fill="none" stroke="${stroke}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}
    </svg>`;
  }

  function computeScorecard(indices, bonds, forex) {
    const inds = [];
    // Growth
    const gc = ['SP500','NDX','DJI','STOXX','DAX'];
    const gcv = gc.map(c => indices[c]?.change_pct).filter(v => v != null);
    if (gcv.length) {
      const pos = gcv.filter(v => v > 0).length;
      const color = pos > gcv.length / 2 ? 'green' : pos < gcv.length / 2 ? 'red' : 'orange';
      inds.push({ label:'Crecimiento', tipKey:'GROWTH', color, detail: color==='green' ? `${pos}/${gcv.length} índices al alza` : color==='red' ? `Solo ${pos}/${gcv.length} suben` : 'Mercado mixto' });
    }
    // Rates
    const us10y = bonds.US10Y?.price, us2y = bonds.US2Y?.price;
    if (us10y != null && us2y != null) {
      const sp = us10y - us2y;
      const color = sp > 0.5 ? 'green' : sp >= 0 ? 'orange' : 'red';
      inds.push({ label:'Tipos', tipKey:'RATES', color, detail: sp>0.5?'Curva normal · sana':sp>=0?'Curva aplanada · alerta':'Curva invertida · cuidado' });
    }
    // Volatility
    const vix = indices.VIX?.price;
    if (vix != null) {
      const color = vix < 20 ? 'green' : vix < 30 ? 'orange' : 'red';
      inds.push({ label:'Volatilidad', tipKey:'VOLATILITY', color, detail: `VIX ${vix.toFixed(1)} · ${color==='green'?'calma':color==='orange'?'tensión':'pánico'}` });
    }
    // Dollar
    const dxyChg = forex.DXY?.change_pct;
    if (dxyChg != null) {
      const color = dxyChg < -0.1 ? 'green' : dxyChg <= 0.1 ? 'orange' : 'red';
      inds.push({ label:'Dólar', tipKey:'DOLLAR', color, detail: color==='green'?'DXY baja · alivio':color==='orange'?'DXY plano':'DXY sube · presión' });
    }
    // Bonds
    const r10Chg = bonds.US10Y?.change_pct;
    if (r10Chg != null) {
      const color = r10Chg < -0.05 ? 'green' : r10Chg <= 0.05 ? 'orange' : 'red';
      inds.push({ label:'Renta fija', tipKey:'BONDS', color, detail: color==='green'?'Yields bajan · alivio':color==='orange'?'Yields estables':'Yields suben · presión' });
    }
    const greens = inds.filter(i => i.color === 'green').length;
    const reds   = inds.filter(i => i.color === 'red').length;
    let summary;
    if      (greens >= 4) summary = `Entorno macro <strong style="color:var(--r-green)">muy favorable</strong> para activos de riesgo. ${greens} de ${inds.length} indicadores en verde.`;
    else if (greens >= 3) summary = `Entorno macro <strong style="color:var(--r-green)">favorable</strong>. ${greens} indicadores positivos frente a ${reds} negativos.`;
    else if (reds   >= 3) summary = `Entorno macro <strong style="color:var(--r-red)">desfavorable</strong>. ${reds} indicadores en rojo — precaución con activos de riesgo.`;
    else                  summary = `Entorno macro <strong style="color:var(--r-amber)">mixto</strong>. ${greens} verde · ${inds.length-greens-reds} ámbar · ${reds} rojo. No hay dirección clara.`;
    return { indicators: inds, summary };
  }

  // Override the original macro renderer so renderLive() calls our version
  window.renderMacroIndices = function (indices, bonds, forex) {
    // We delegate to renderMacroFull which reads from STATE.live
    if (STATE?.live) renderMacroFull(STATE.live);
  };
  // No-op the yield curve container that no longer exists
  window.renderYieldCurve = function () { /* integrated in renderMacroFull */ };

  // ─────────────────────────────────────────────────────────
  // CALENDAR overrides — new visual grid + detail list
  // ─────────────────────────────────────────────────────────
  window.renderCalendarGrid = function () {
    const cs = (typeof CAL_STATE !== 'undefined') ? CAL_STATE : null; if (!cs) return;
    const { year, month, selectedDay, events } = cs;
    const container = document.getElementById('cal-grid-container'); if (!container) return;
    const byDate = {};
    (events || []).forEach(e => {
      let dk = '';
      try { const d = new Date(e.date); if (!isNaN(d)) dk = d.toISOString().slice(0, 10); } catch (_) {}
      if (!dk) dk = (e.date || '').slice(0, 10);
      if (dk) { (byDate[dk] = byDate[dk] || []).push(e); }
    });
    const monthName = new Date(year, month, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
    const lbl = document.getElementById('cal-month-label');
    if (lbl) lbl.textContent = monthName.charAt(0).toUpperCase() + monthName.slice(1);

    const atMin = year < cs.minDate.year || (year === cs.minDate.year && month <= cs.minDate.month);
    const atMax = year > cs.maxDate.year || (year === cs.maxDate.year && month >= cs.maxDate.month);
    const prevBtn = document.getElementById('cal-prev');
    const nextBtn = document.getElementById('cal-next');
    if (prevBtn) { prevBtn.style.opacity = atMin ? '0.3' : '1'; prevBtn.style.pointerEvents = atMin ? 'none' : ''; }
    if (nextBtn) { nextBtn.style.opacity = atMax ? '0.3' : '1'; nextBtn.style.pointerEvents = atMax ? 'none' : ''; }

    const today = new Date().toISOString().slice(0, 10);
    const firstDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
    const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const dayNames = ['Lun','Mar','Mié','Jue','Vie','Sáb','Dom'];

    let html = '<div class="r-cal-grid">';
    dayNames.forEach(d => { html += `<div class="r-cal-day-name">${d}</div>`; });
    for (let i = 0; i < firstDow; i++) html += '<div class="r-cal-cell empty"></div>';
    for (let day = 1; day <= daysInMonth; day++) {
      const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      const evs = byDate[ds] || [];
      const classes = ['r-cal-cell', ds === today ? 'today' : '', ds === selectedDay ? 'selected' : ''].filter(Boolean).join(' ');
      const mini = evs.slice(0, 2).map(e => {
        const imp = (e.impact || '').toLowerCase();
        const dc = imp.includes('high') ? 'high' : imp.includes('med') ? 'med' : 'low';
        return `<div class="r-cal-evt"><span class="r-cal-evt-dot ${dc}"></span><span class="r-cal-evt-text">${escHtml((e.title||'').slice(0,16))}</span></div>`;
      }).join('');
      const more = evs.length > 2 ? `<div class="r-cal-more">+${evs.length-2} más</div>` : '';
      html += `<div class="${classes}" onclick="calSelectDay('${ds}')"><div class="r-cal-day-num">${day}</div>${mini}${more}</div>`;
    }
    html += '</div>';
    container.innerHTML = html;
  };

  window.renderCalendarDetail = function () {
    const cs = (typeof CAL_STATE !== 'undefined') ? CAL_STATE : null; if (!cs) return;
    const { events, selectedDay, year, month } = cs;
    const el = document.getElementById('cal-list');
    const barEl = document.getElementById('cal-detail-bar');
    if (!el) return;

    let filtered = events || [];
    if (selectedDay) {
      filtered = filtered.filter(e => {
        try { return new Date(e.date).toISOString().slice(0,10) === selectedDay; } catch (_) { return false; }
      });
    } else {
      const ms = `${year}-${String(month+1).padStart(2,'0')}`;
      filtered = filtered.filter(e => (e.date || '').startsWith(ms));
    }

    if (barEl) {
      const label = selectedDay
        ? new Date(selectedDay+'T12:00:00Z').toLocaleDateString('es-ES',{weekday:'long',day:'numeric',month:'long',year:'numeric'})
        : new Date(year,month,1).toLocaleDateString('es-ES',{month:'long',year:'numeric'});
      barEl.innerHTML = `<div class="r-cal-events-head"><span class="r-cal-events-date">${label}</span><span class="r-cal-events-count">${filtered.length} evento${filtered.length!==1?'s':''}</span></div>`;
    }
    if (!filtered.length) { el.innerHTML = '<div class="loading" style="padding:30px;color:var(--text-muted)">Sin eventos para este día.</div>'; return; }

    const now = Date.now();
    const CC = {
      USD:{ color:'var(--r-blue)',  bg:'var(--r-blue-dim)' },
      EUR:{ color:'#3ddbd9',         bg:'rgba(61,219,217,0.12)' },
      GBP:{ color:'var(--r-violet)', bg:'var(--r-violet-dim)' },
      JPY:{ color:'var(--r-amber)',  bg:'var(--r-amber-dim)' },
      US: { color:'var(--r-blue)',   bg:'var(--r-blue-dim)' },
      EU: { color:'#3ddbd9',         bg:'rgba(61,219,217,0.12)' },
      GB: { color:'var(--r-violet)', bg:'var(--r-violet-dim)' },
      JP: { color:'var(--r-amber)',  bg:'var(--r-amber-dim)' },
    };

    el.innerHTML = filtered.map(e => {
      const imp = (e.impact || '').toLowerCase();
      const impColor = imp.includes('high') ? 'var(--r-red)' : imp.includes('med') ? 'var(--r-amber)' : 'rgba(255,255,255,0.2)';
      const isPast = e.date && new Date(e.date).getTime() < now;
      let timeStr = '';
      try { const d = new Date(e.date); if (!isNaN(d)) timeStr = d.toISOString().slice(11,16); } catch (_) {}
      const country = (e.country || '').toUpperCase();
      const cc = CC[country] || { color:'rgba(255,255,255,0.5)', bg:'rgba(255,255,255,0.04)' };
      let actualHtml = '<span class="r-cal-evt-num">—</span>';
      if (e.actual != null && e.actual !== '') {
        const better = e.forecast != null ? parseFloat(e.actual) >= parseFloat(e.forecast) : true;
        actualHtml = `<span class="r-cal-evt-num" style="color:${better?'var(--r-green)':'var(--r-red)'};font-weight:600">${e.actual}</span>`;
      }
      return `<div class="r-cal-event-row${isPast?' past':''}">
        <span class="r-cal-evt-time">${timeStr}</span>
        <span class="r-cal-evt-impact-dot" style="background:${impColor};${imp.includes('high')?'box-shadow:0 0 6px '+impColor:''}"></span>
        ${country ? `<span class="r-cal-evt-country" style="background:${cc.bg};color:${cc.color}">${country}</span>` : '<span></span>'}
        <span class="r-cal-evt-title">${escHtml(e.title || '')}</span>
        <span class="r-cal-evt-num prev">${e.previous || '—'}</span>
        <span class="r-cal-evt-num fc">${e.forecast || '—'}</span>
        ${actualHtml}
      </div>`;
    }).join('');
  };

  // helper (escHtml) — local copy
  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  // Hook commodities: original calls 3 functions; we override them as no-ops
  // and trigger renderCommoditiesFull from renderLive via our wrapper.

  // Wrap renderLive to also call our commodities full render
  const _origRenderLive = window.renderLive;
  if (typeof _origRenderLive === 'function') {
    window.renderLive = function () {
      _origRenderLive.apply(this, arguments);
      try {
        if (STATE?.live) {
          renderCommoditiesFull(STATE.live);
          restyleDashboardSentiment();
          restyleDashboardCryptoTitle();
        }
      } catch (e) { console.error('redesign render err', e); }
    };
    // Trigger initial re-render if data already loaded
    if (STATE?.live) setTimeout(() => window.renderLive(), 0);
  }

  // ─────────────────────────────────────────────────────────
  // 10. Re-render on demand (in case initial render happened before patch)
  // ─────────────────────────────────────────────────────────
  function maybeRender() {
    if (STATE?.live && window.renderLive) window.renderLive();
  }
  // Try a few times in case STATE.live arrives slightly after our patch
  let tries = 0;
  const interval = setInterval(() => {
    tries++;
    if (STATE?.live) {
      maybeRender();
      clearInterval(interval);
    } else if (tries > 20) {
      clearInterval(interval);
    }
  }, 200);
})();
