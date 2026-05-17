/* Noticias · redesign — agrupa por temática + colores de importancia.
   Loads after the page's own script and replaces the renderers. */
(function () {
  // ── Logomark injection ──
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
            <linearGradient id="tfg-logo-grad-2" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stop-color="#3fb950"/>
              <stop offset="100%" stop-color="#58a6ff"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="32" height="32" rx="9" fill="url(#tfg-logo-grad-2)"/>
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
  injectLogomark();

  // ── Replace markup ──
  const main = document.querySelector('main.main');
  if (main) {
    // keep topbar
    const topbar = main.querySelector('.topbar');
    main.innerHTML = '';
    if (topbar) main.appendChild(topbar);
    const shell = document.createElement('div');
    shell.className = 'r-news-shell';
    shell.innerHTML = `
      <div id="r-news-controls" class="r-news-controls"></div>
      <div id="r-news-hero" class="r-news-hero"></div>
      <div id="r-news-groups" class="r-news-groups"></div>
    `;
    main.appendChild(shell);
  }

  // ── Topic detection ──
  const TOPICS = {
    central_banks: {
      label: 'Bancos centrales',
      sub: 'Fed · BCE · BoJ · BoE · decisiones de tipos',
      color: '#b78bff',
      icon: 'B',
      keywords: ['fed','fomc','bce','ecb','boj','boe','bank of england','bank of japan','rate','tipos','lagarde','powell','ueda','bailey','rate hike','rate cut','recorte de tipos','subida de tipos'],
    },
    regulation: {
      label: 'Regulación · gobiernos',
      sub: 'SEC · sanciones · regulación cripto',
      color: '#ff7a7a',
      icon: 'R',
      keywords: ['sec','regulation','regulación','ban','sanction','sanción','arrest','lawsuit','sues','sued','crackdown','court','treasury','senate','parliament','government','gobierno','tax','impuesto','aml','kyc'],
    },
    crypto: {
      label: 'Cripto',
      sub: 'BTC · ETH · DeFi · exchanges · on-chain',
      color: '#f9b023',
      icon: '₿',
      keywords: ['bitcoin','btc','ethereum','eth','solana','sol','crypto','cripto','defi','stablecoin','blockchain','token','altcoin','wallet','exchange','onchain','on-chain','validator','staking','etf'],
    },
    companies: {
      label: 'Empresas',
      sub: 'Resultados · IPO · fusiones · productos',
      color: '#3ddbd9',
      icon: 'E',
      keywords: ['earnings','ipo','merger','acquisition','acquires','apple','google','microsoft','nvidia','tesla','meta','amazon','blackrock','jp morgan','goldman','coinbase','binance','partner','launch','unveil','product','revenue','quarterly','q1','q2','q3','q4'],
    },
    macro: {
      label: 'Macro',
      sub: 'Inflación · PIB · empleo · ventas',
      color: '#00d09c',
      icon: 'M',
      keywords: ['inflation','cpi','ipc','gdp','pib','retail sales','ventas minoristas','jobless','unemployment','desempleo','payrolls','nfp','consumer','manufacturing','pmi','ppi','ism','housing'],
    },
    geo: {
      label: 'Geopolítica · energía',
      sub: 'Conflictos · OPEC · materias primas',
      color: '#ff5c5c',
      icon: 'G',
      keywords: ['opec','war','guerra','conflict','sanctions','geopolit','iran','israel','ukraine','russia','china','tariff','arancel','trade','commerce','xi','putin','tensions'],
    },
  };

  function detectTopic(title, source) {
    const t = ((title || '') + ' ' + (source || '')).toLowerCase();
    for (const [key, topic] of Object.entries(TOPICS)) {
      if (topic.keywords.some(k => t.includes(k))) return key;
    }
    return 'macro';
  }

  function detectImportance(title) {
    const t = (title || '').toLowerCase();
    const HI = ['strike','war','guerra','regulation','sec','ban','crash','hack','sanction','arrest','fed','rate','inflation','gdp','crisis','tipos','crisis','urgent','breaking','record','surges','tumbles','plunges'];
    const MED = ['earning','partner','deploy','launch','acqui','merger','upgrade','downgrade','result','ipo','rally','beat','miss','warns','signals'];
    if (HI.some(w => t.includes(w))) return 'high';
    if (MED.some(w => t.includes(w))) return 'med';
    return 'low';
  }

  const SOURCE_STYLES = {
    cointelegraph: { color:'#58a6ff', bg:'rgba(88,166,255,0.12)'  },
    coindesk:      { color:'#b78bff', bg:'rgba(183,139,255,0.12)' },
    'ft markets':  { color:'#00d09c', bg:'rgba(0,208,156,0.12)'   },
    reuters:       { color:'#f9b023', bg:'rgba(249,176,35,0.12)'  },
    bloomberg:     { color:'#ff5c5c', bg:'rgba(255,92,92,0.12)'   },
    wsj:           { color:'#3ddbd9', bg:'rgba(61,219,217,0.12)'  },
  };
  function srcStyle(src) {
    const k = (src || '').toLowerCase();
    for (const [key, v] of Object.entries(SOURCE_STYLES)) if (k.includes(key)) return v;
    return { color:'rgba(255,255,255,0.6)', bg:'rgba(255,255,255,0.05)' };
  }

  function timeAgo(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `hace ${Math.floor(diff)}s`;
    if (diff < 3600) return `hace ${Math.floor(diff / 60)}min`;
    if (diff < 86400) return `hace ${Math.floor(diff / 3600)}h`;
    return d.toLocaleDateString('es-ES');
  }
  function esc(s) {
    if (!s) return '';
    return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' }[c]));
  }

  // ── State ──
  let allNews = [];
  let activeFilter = 'all';  // 'all' | topic key | 'high' | 'med' | 'low'

  // ── Override original loadData (use mock if fetch fails) ──
  async function loadData() {
    const sub = document.getElementById('tab-sub');
    try {
      const r = await fetch('data/live_data.json?ts=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const d = await r.json();
      allNews = d.news || [];
      if (sub) sub.textContent = allNews.length + ' noticias · ' + timeAgo(d.updated_at);
    } catch (e) {
      if (sub) sub.textContent = 'Error al cargar';
      console.error(e);
      return;
    }
    render();
  }
  window.loadData = loadData;

  function render() {
    renderControls();
    renderHero();
    renderGroups();
  }

  function renderControls() {
    const el = document.getElementById('r-news-controls');
    if (!el) return;
    const counts = { all: allNews.length, high: 0, med: 0, low: 0 };
    Object.keys(TOPICS).forEach(k => counts[k] = 0);
    allNews.forEach(n => {
      const t = detectTopic(n.title, n.source);
      counts[t] = (counts[t] || 0) + 1;
      const i = detectImportance(n.title);
      counts[i]++;
    });

    const pills = [
      `<button class="r-news-pill ${activeFilter==='all'?'active':''}" data-f="all">Todas <span style="opacity:0.6">${counts.all}</span></button>`,
      `<button class="r-news-pill ${activeFilter==='high'?'active':''}" data-f="high"><span class="r-news-pill-dot" style="background:var(--r-red)"></span>Importantes <span style="opacity:0.6">${counts.high}</span></button>`,
    ];
    Object.entries(TOPICS).forEach(([k, t]) => {
      pills.push(`<button class="r-news-pill ${activeFilter===k?'active':''}" data-f="${k}"><span class="r-news-pill-dot" style="background:${t.color}"></span>${t.label} <span style="opacity:0.6">${counts[k]||0}</span></button>`);
    });
    el.innerHTML = pills.join('');
    el.querySelectorAll('.r-news-pill').forEach(b => b.addEventListener('click', () => {
      activeFilter = b.dataset.f;
      render();
    }));
  }

  function filtered() {
    if (activeFilter === 'all') return allNews;
    if (['high','med','low'].includes(activeFilter)) {
      return allNews.filter(n => detectImportance(n.title) === activeFilter);
    }
    return allNews.filter(n => detectTopic(n.title, n.source) === activeFilter);
  }

  function renderHero() {
    const el = document.getElementById('r-news-hero');
    if (!el) return;
    const list = filtered();
    if (!list.length) { el.innerHTML = '<div style="grid-column:1/-1;padding:40px;text-align:center;color:var(--text-muted)">Sin noticias.</div>'; return; }
    const top3 = list.slice(0, 3);
    const [feat, side1, side2] = top3;
    el.innerHTML = `
      ${feat ? renderFeatured(feat) : ''}
      ${side1 ? renderSide(side1) : ''}
      ${side2 ? renderSide(side2) : ''}
    `;
  }

  function renderFeatured(n) {
    const imp = detectImportance(n.title);
    const tk = detectTopic(n.title, n.source);
    const topic = TOPICS[tk];
    const st = srcStyle(n.source);
    return `<a class="r-news-featured" href="${esc(n.link)}" target="_blank" rel="noopener">
      <div class="r-news-featured-eyebrow">
        <span class="r-news-imp-dot ${imp}"></span>
        <span class="r-news-srcpill" style="color:${st.color};background:${st.bg}">${esc(n.source || '')}</span>
        <span class="r-news-srcpill" style="color:${topic.color};background:rgba(255,255,255,0.04);border:0.5px solid ${topic.color}40">${topic.label}</span>
      </div>
      <div class="r-news-featured-title">${esc(n.title)}</div>
      ${n.summary ? `<div class="r-news-featured-sum">${esc(n.summary.slice(0, 240))}</div>` : ''}
      <div class="r-news-featured-foot">
        <span>${timeAgo(n.published)}</span>
      </div>
    </a>`;
  }

  function renderSide(n) {
    const imp = detectImportance(n.title);
    const tk = detectTopic(n.title, n.source);
    const topic = TOPICS[tk];
    const st = srcStyle(n.source);
    return `<a class="r-news-side" href="${esc(n.link)}" target="_blank" rel="noopener">
      <div class="r-news-featured-eyebrow">
        <span class="r-news-imp-dot ${imp}"></span>
        <span class="r-news-srcpill" style="color:${st.color};background:${st.bg}">${esc(n.source || '')}</span>
      </div>
      <div class="r-news-side-title">${esc(n.title)}</div>
      <div class="r-news-side-foot">
        <span style="color:${topic.color}">${topic.label}</span>
        <span>·</span>
        <span>${timeAgo(n.published)}</span>
      </div>
    </a>`;
  }

  function renderGroups() {
    const el = document.getElementById('r-news-groups');
    if (!el) return;
    const list = filtered();
    const rest = list.slice(3);

    // Group by topic
    const byTopic = {};
    Object.keys(TOPICS).forEach(k => byTopic[k] = []);
    rest.forEach(n => {
      const k = detectTopic(n.title, n.source);
      (byTopic[k] = byTopic[k] || []).push(n);
    });

    // Render only non-empty groups, sorted by count desc
    const groupsOrdered = Object.entries(byTopic)
      .filter(([k, l]) => l.length > 0)
      .sort((a, b) => b[1].length - a[1].length);

    if (!groupsOrdered.length) { el.innerHTML = ''; return; }

    el.innerHTML = groupsOrdered.map(([k, items]) => {
      const t = TOPICS[k];
      const rows = items.slice(0, 12).map(n => {
        const imp = detectImportance(n.title);
        const st = srcStyle(n.source);
        return `
          <a class="r-news-item" href="${esc(n.link)}" target="_blank" rel="noopener">
            <div class="r-news-item-head">
              <span class="r-news-imp-dot ${imp}"></span>
              <span class="r-news-srcpill" style="color:${st.color};background:${st.bg}">${esc(n.source || '')}</span>
            </div>
            <div class="r-news-item-title">${esc(n.title)}</div>
            <div class="r-news-item-time">${timeAgo(n.published)}</div>
          </a>`;
      }).join('');
      return `
        <div class="r-news-group">
          <div class="r-news-group-head">
            <div class="r-news-group-title">
              <span class="r-news-group-icon" style="background:${t.color}">${t.icon}</span>
              <div>
                <div>${t.label}</div>
                <div style="font-family:'DM Sans',sans-serif;font-size:11px;font-weight:400;color:var(--text-tertiary);letter-spacing:0;margin-top:2px">${t.sub}</div>
              </div>
            </div>
            <span class="r-news-group-count">${items.length} noticia${items.length !== 1 ? 's' : ''}</span>
          </div>
          <div class="r-news-list">${rows}</div>
        </div>`;
    }).join('');
  }

  // ── Init ──
  loadData();
})();
