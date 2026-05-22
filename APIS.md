# APIs y fuentes de datos utilizadas

Listado completo de todas las APIs, librerías de datos y feeds empleados en la terminal financiera. Organizado por módulo/script.

---

## 1. Precios e histórico financiero — `fetch_historical.py` · `fetch_live.py` · `fetch_stocks.py`

### Yahoo Finance (vía `yfinance`)
- **Web oficial**: https://finance.yahoo.com
- **Librería Python**: https://github.com/ranaroussi/yfinance
- **Qué aporta**: histórico diario de índices, criptos, materias primas, divisas y bonos; precios intradía (1h, 5m); datos de acciones (150 tickers).
- **Limitaciones**:
  - Histórico máximo disponible: ~5 años con `period="5y"` para la mayoría de activos; algunos índices tienen datos desde los 90.
  - Intradía 1h: máximo ~730 días hacia atrás.
  - Intradía 5m: máximo ~60 días.
  - Sin clave de API oficial; usa el endpoint público de Yahoo Finance (sujeto a cambios sin previo aviso y posibles bloqueos temporales por tasa de uso).
  - Precios de acciones pueden tener retraso de 15 min en mercado abierto (datos EOD son precisos).
- **Uso en el proyecto**:
  - `fetch_historical.py`: histórico 5y diario de SP500, NDX, DJI, RUT, STOXX, DAX, FTSE, IBEX, CAC, N225, HSI, VIX, BTC, ETH, SOL, BNB, XRP, ADA, AVAX, DOGE, LINK, DOT, GOLD, SILVER, OIL, BRENT, NATGAS, COPPER, PLATINUM, WHEAT, CORN, COFFEE, EUR/USD, GBP/USD, USD/JPY, USD/CHF, USD/CNY, DXY, US10Y, US2Y, US30Y.
  - `fetch_live.py`: cotizaciones del día actual (2d interval 1d), klines 1h BTC/ETH para actualizar CSV, klines 5m BTC para gráfica.
  - `fetch_stocks.py`: histórico 5y diario + fundamental snapshot de 150 acciones.

---

### CoinGecko (API pública)
- **Web oficial**: https://www.coingecko.com
- **Documentación API**: https://www.coingecko.com/api/documentations/v3
- **Endpoint usado**: `https://api.coingecko.com/api/v3/coins/markets`
- **Qué aporta**: precio actual, variación 24h, high/low 24h, volumen y market cap de 12 criptomonedas.
- **Limitaciones**:
  - Plan gratuito: 10–30 llamadas/minuto (puede variar). Sin clave de API para el plan Demo.
  - Solo datos de mercado en tiempo real (24h window), sin histórico por este endpoint.
  - Si se excede el límite de tasa se recibe HTTP 429; el script lo captura y continúa.
- **Uso en el proyecto**: `fetch_live.py` → campo `crypto` del `live_data.json`.

---

### Binance Vision (datos históricos CSV)
- **Web oficial**: https://data.binance.vision
- **Qué aporta**: datos OHLCV horarios de BTC/USDT desde agosto 2017.
- **Limitaciones**: datos estáticos descargados manualmente y almacenados en `data/btc_1h.csv`. No es una llamada API en tiempo real.
- **Uso en el proyecto**: fuente principal de `data/btc_1h.csv` (histórico desde 2017); el script `fetch_live.py` lo extiende con datos recientes de Yahoo Finance.

---

## 2. Índice de Miedo y Codicia — `fetch_historical.py` · `fetch_live.py`

### Alternative.me Fear & Greed Index
- **Web oficial**: https://alternative.me/crypto/fear-and-greed-index/
- **Documentación API**: https://alternative.me/crypto/fear-and-greed-index/#faq
- **Endpoint histórico**: `https://api.alternative.me/fng/?limit=0`
- **Endpoint actual**: `https://api.alternative.me/fng/?limit=1`
- **Qué aporta**: índice de sentimiento 0–100 (Extreme Fear → Extreme Greed) con histórico completo desde 2018.
- **Limitaciones**:
  - Sin autenticación requerida; API pública y gratuita.
  - Histórico disponible desde ~febrero 2018 (`limit=0` devuelve todo).
  - Actualización diaria (no intradía).
  - No es un indicador oficial de ninguna bolsa; es una métrica compuesta de CoinGecko, derivados, redes sociales, dominancia y tendencias de búsqueda.
- **Uso en el proyecto**: `fetch_historical.py` → `fear_greed` en `historical_data.json`; `fetch_live.py` → `fear_greed` en `live_data.json`.

---

## 3. Calendario económico — `fetch_live.py`

### ForexFactory / FairEconomy Calendar
- **Fuente**: `https://nfs.faireconomy.media/ff_calendar_thisweek.json`
- **Qué aporta**: eventos macroeconómicos de la semana actual con impacto (high/medium/low), forecast, previo y actual.
- **Limitaciones**:
  - Solo la semana actual; sin histórico de semanas anteriores por este endpoint.
  - Datos no oficiales (scrapeados de ForexFactory); puede fallar si cambia la estructura.
  - Sin autenticación requerida.
- **Uso en el proyecto**: `fetch_live.py` → `calendar` en `live_data.json`.

---

## 4. Noticias financieras — `fetch_live.py`

### RSS Feeds (sin clave de API)
Los siguientes feeds RSS se agregan en tiempo real:

| Fuente | URL del feed |
|--------|-------------|
| CoinDesk | https://www.coindesk.com/arc/outboundfeeds/rss/ |
| Cointelegraph | https://cointelegraph.com/rss |
| Reuters Business | https://feeds.reuters.com/reuters/businessNews |
| CNBC Markets | https://www.cnbc.com/id/15839069/device/rss/rss.html |
| Yahoo Finance | https://finance.yahoo.com/news/rssindex |
| Financial Times Markets | https://www.ft.com/markets?format=rss |

- **Librería Python**: `feedparser` (https://feedparser.readthedocs.io)
- **Limitaciones**:
  - Algunos feeds (FT, CNBC) pueden requerir suscripción para el contenido completo; el título y resumen suelen ser libres.
  - Sin autenticación; sujetos a cambios de URL por parte de los proveedores.
  - Se limita a 10 artículos por fuente y 80 en total por ejecución.
- **Uso en el proyecto**: `fetch_live.py` → `news` en `live_data.json`.

---

## 5. Mapa de indicadores globales — `mapa-global.html`

### World Bank Open Data API
- **Web oficial**: https://data.worldbank.org
- **Documentación API**: https://datahelpdesk.worldbank.org/knowledgebase/articles/889392-about-the-indicators-api-documentation
- **Endpoint usado**: `https://api.worldbank.org/v2/country/all/indicator/{INDICADOR}?format=json&mrv=10&per_page=3000&gapfill=Y`
- **Qué aporta**: datos macroeconómicos por país (PIB, inflación, desempleo, deuda, comercio exterior, energía, indicadores sociales).
- **Limitaciones**:
  - Datos anuales con retraso de 1–2 años (el World Bank publica datos oficiales con rezago).
  - `gapfill=Y` rellena huecos con el valor más reciente disponible, lo que puede dar la apariencia de que los datos son más recientes de lo que son.
  - Sin autenticación requerida; API completamente pública.
  - Llamada directa desde el navegador (CORS habilitado por el World Bank).
  - Peticiones frecuentes pueden ser limitadas; el mapa hace ~15 peticiones al cargar.
- **Indicadores usados**:

| Código WB | Nombre |
|-----------|--------|
| `NY.GDP.MKTP.KD.ZG` | Crecimiento del PIB (%) |
| `NY.GDP.MKTP.CD` | PIB total (USD corrientes) |
| `NY.GDP.PCAP.CD` | PIB per cápita (USD) |
| `FP.CPI.TOTL.ZG` | Inflación IPC (%) |
| `SL.UEM.TOTL.ZS` | Tasa de desempleo (%) |
| `NE.EXP.GNFS.CD` | Exportaciones (USD) |
| `NE.IMP.GNFS.CD` | Importaciones (USD) |
| `BN.CAB.XOKA.CD` | Cuenta corriente (USD) |
| `BX.KLT.DINV.CD.WD` | Inversión extranjera directa (USD) |
| `GC.DOD.TOTL.GD.ZS` | Deuda pública (% PIB) |
| `FI.RES.TOTL.CD` | Reservas internacionales (USD) |
| `NY.GNS.ICTR.ZS` | Ahorro bruto (% PIB) |
| `NE.GDI.TOTL.ZS` | Formación bruta de capital fijo (% PIB) |
| `SP.POP.TOTL` | Población total |
| `SP.DYN.LE00.IN` | Esperanza de vida (años) |
| `IT.NET.USER.ZS` | Usuarios de internet (% población) |
| `EG.USE.ELEC.KH.PC` | Consumo eléctrico (kWh per cápita) |
| `EN.ATM.CO2E.PC` | Emisiones CO₂ per cápita (t) |
| `EG.ELC.RNEW.ZS` | Electricidad renovable (% total) |
| `EP.PMP.SGAS.CD` | Producción de petróleo (indicativo) |
| `MS.MIL.XPND.GD.ZS` | Gasto militar (% PIB) |

- **Tensiones geopolíticas**: datos estáticos codificados en el HTML, basados en fuentes ACLED (https://acleddata.com) y UCDP (https://ucdp.uu.se). No se actualizan automáticamente.

---

## 6. Flujos globales — `flujos-globales.html`

Los datos de rutas marítimas, puertos, zonas de riesgo y animaciones de barcos son **completamente estáticos** y están codificados en el propio HTML. No hay llamadas a APIs externas en tiempo real.

- Fuentes de referencia utilizadas para construir los datos estáticos: UNCTAD Review of Maritime Transport, IMO Global Integrated Shipping Information System (GISIS), MarineTraffic (datos públicos de puertos), Lloyd's List.
- No se realizan llamadas a MarineTraffic API ni AIS en tiempo real; requieren suscripción de pago.

---

## 7. Modelo ML — `paper_trader.py`

El paper trader no llama a ninguna API externa propia. Usa:
- **Binance REST API (pública)**: `https://api.binance.com/api/v3/klines` para obtener las últimas velas de BTC/USDT en tiempo real.
  - Documentación: https://binance-docs.github.io/apidocs/spot/en/#kline-candlestick-data
  - Sin autenticación requerida para datos de mercado público.
  - Rate limit: 1200 peticiones/minuto (peso 1 por klines call).
- Modelos locales `.pkl` en `models/` (no hay llamada a API de ML externa).

---

## 8. Librerías de visualización (frontend, no APIs de datos)

| Librería | Versión | URL |
|----------|---------|-----|
| Lightweight Charts (TradingView) | 4.1.3 | https://tradingview.github.io/lightweight-charts/ |
| D3.js | 7.8.5 | https://d3js.org |
| TopoJSON | 3.0.2 | https://github.com/topojson/topojson |
| Tabler Icons | latest | https://tabler.io/icons |
| DM Sans / DM Mono / Fraunces | — | https://fonts.google.com |

---

## Resumen de limitaciones clave

| API | Limitación principal |
|-----|---------------------|
| Yahoo Finance | Intradía 1h: max 730 días; 5m: max 60 días. Sin clave oficial. |
| CoinGecko (free) | ~30 req/min; solo precios actuales (no histórico por este endpoint). |
| Alternative.me FGI | Histórico desde feb 2018; actualización diaria. |
| ForexFactory calendar | Solo semana actual; sin histórico. |
| World Bank | Datos anuales con retraso de 1–2 años; gapfill puede enmascarar huecos. |
| Binance (paper trader) | 1200 req/min; sin key para datos públicos. |
| RSS feeds | Sin histórico; solo artículos actuales del feed. |
| Flujos globales | Datos estáticos; no hay tracking AIS en tiempo real. |
