/* TFG.terminal — preload: install mock-data fallback for /data/*.json
   This MUST run before the original inline script's init() fires. */
(function () {
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
    news: [
      { source:"Reuters",       title:"Fed signals one more rate cut before year-end as inflation cools toward 2% target", summary:"Powell, en su comparecencia, abrió la puerta a un recorte adicional de 25 puntos básicos en diciembre si la inflación subyacente sigue moderándose.", link:"#", published:new Date(Date.now()-1000*60*8).toISOString() },
      { source:"Bloomberg",     title:"BlackRock files for spot Solana ETF amid record crypto inflows",                       summary:"La gestora líder mundial registra ante la SEC un ETF al contado de SOL. El movimiento llega tras superar los $50.000M en ETFs de BTC.", link:"#", published:new Date(Date.now()-1000*60*22).toISOString() },
      { source:"FT Markets",    title:"ECB warns of fragmentation risks as French yield premium widens",                    summary:"Christine Lagarde alertó del aumento del diferencial de los bonos franceses frente al Bund alemán, mientras Francia negocia su presupuesto.", link:"#", published:new Date(Date.now()-1000*60*45).toISOString() },
      { source:"Cointelegraph", title:"Bitcoin slumps below $78,000 as long-term holders take profit",                       summary:"BTC pierde el soporte clave de $78k tras una sesión asiática negativa. Los datos on-chain muestran ventas por parte de holders mayores de 3 años.", link:"#", published:new Date(Date.now()-1000*60*65).toISOString() },
      { source:"WSJ",           title:"Nvidia tumbles 4% after report China restricts H100 chip imports",                    summary:"Pekín habría notificado a las grandes tecnológicas locales que dejen de comprar chips de IA de Nvidia. Las acciones del fabricante caen en pre-market.", link:"#", published:new Date(Date.now()-1000*60*90).toISOString() },
      { source:"Reuters",       title:"OPEC+ extends voluntary production cuts through Q1 2026",                             summary:"Arabia Saudí y Rusia confirman la extensión de los recortes voluntarios de 2,2 millones b/d. El petróleo sube un 4%.", link:"#", published:new Date(Date.now()-1000*60*120).toISOString() },
      { source:"Bloomberg",     title:"Coinbase reports record Q3 earnings, beats revenue estimates by 18%",                 summary:"El exchange más grande de EE.UU. publica unos ingresos de $2.4B frente a los $2.0B esperados, impulsado por el rally cripto del verano.", link:"#", published:new Date(Date.now()-1000*60*150).toISOString() },
      { source:"FT Markets",    title:"Japan's yen rebounds as BoJ Ueda hints at March rate hike",                           summary:"El gobernador del Banco de Japón dejó entrever en una comparecencia que la subida de marzo está sobre la mesa si los datos salariales siguen al alza.", link:"#", published:new Date(Date.now()-1000*60*180).toISOString() },
      { source:"Cointelegraph", title:"Ethereum upgrade 'Pectra' goes live, slashes L2 transaction costs by 80%",            summary:"La actualización Pectra activó el cambio EIP-7702 en mainnet. Las comisiones medias en L2 cayeron de 4¢ a menos de 1¢ en las primeras horas.", link:"#", published:new Date(Date.now()-1000*60*220).toISOString() },
      { source:"Reuters",       title:"German DAX hits 9-month low on auto sector weakness",                                 summary:"El índice alemán pierde un 2,07% arrastrado por BMW y Volkswagen tras revisar a la baja sus guías 2026 por la débil demanda china.", link:"#", published:new Date(Date.now()-1000*60*260).toISOString() },
      { source:"Bloomberg",     title:"Gold drops 2.6% as dollar rallies on hot retail sales data",                          summary:"Las ventas minoristas USA sorprenden al alza (+0.7% m/m) y el dólar repunta. El oro cae al nivel de $4.555/oz tras tocar máximos históricos la semana pasada.", link:"#", published:new Date(Date.now()-1000*60*300).toISOString() },
      { source:"WSJ",           title:"SEC sues 3 DeFi protocols for unregistered securities offerings",                     summary:"La agencia presenta cargos contra Uniswap Labs, Aave y Compound por operar como bolsas de valores no registradas. Los tokens caen entre un 8% y un 14%.", link:"#", published:new Date(Date.now()-1000*60*420).toISOString() },
      { source:"Reuters",       title:"Apple unveils AI-powered Vision Pro 2 starting at $2,499",                            summary:"Tim Cook presentó la segunda generación del visor Vision Pro con chip M5 y nueva integración nativa con Apple Intelligence.", link:"#", published:new Date(Date.now()-1000*60*540).toISOString() },
      { source:"FT Markets",    title:"UK inflation eases to 2.1%, opens door to BoE December cut",                          summary:"El IPC británico baja del 2,4% al 2,1% interanual, su nivel más bajo desde 2021. El mercado descuenta un recorte de 25pb por parte del BoE en diciembre.", link:"#", published:new Date(Date.now()-1000*60*600).toISOString() },
      { source:"Cointelegraph", title:"Stablecoin market cap surpasses $300B for the first time",                            summary:"La capitalización agregada de USDT, USDC, DAI y otras stablecoins supera los $300.000M, impulsada por la adopción institucional en cross-border payments.", link:"#", published:new Date(Date.now()-1000*60*720).toISOString() },
    ],
    calendar: [], btc_klines_daily: [],
  };
  const MOCK_HIST = { categories: {
    crypto: {
      BTC: { bars:_mkBars(75000, 0.025) }, ETH:{ bars:_mkBars(2200, 0.03) },
      SOL: { bars:_mkBars(85, 0.04) },     BNB:{ bars:_mkBars(660, 0.025) },
      XRP: { bars:_mkBars(1.42, 0.03) },   ADA:{ bars:_mkBars(0.26, 0.035) },
      AVAX:{ bars:_mkBars(9.5, 0.04) },    DOGE:{ bars:_mkBars(0.11, 0.04) },
      LINK:{ bars:_mkBars(10, 0.035) },    DOT:{ bars:_mkBars(1.30, 0.035) },
      ATOM:{ bars:_mkBars(2.0, 0.035) },
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
  window.__REDESIGN_MOCKS__ = { live: MOCK_LIVE, hist: MOCK_HIST };

  const _origFetch = window.fetch.bind(window);
  window.fetch = function (url, opts) {
    const u = typeof url === 'string' ? url : (url && url.url) || '';
    const mock = u.includes('live_data.json') ? MOCK_LIVE
               : u.includes('historical_data.json') ? MOCK_HIST
               : null;
    if (!mock) return _origFetch(url, opts);
    function asResp() {
      return new Response(JSON.stringify(mock), { status: 200, headers: { 'content-type':'application/json' }});
    }
    return _origFetch(url, opts)
      .then(r => r.ok ? r : asResp())
      .catch(() => asResp());
  };
})();
