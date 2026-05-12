# TFG Terminal

Terminal financiera estilo Revolut desplegada en GitHub Pages. Muestra mercados en vivo (cripto, acciones, materias primas, FX, bonos), noticias, calendario macro y un panel del modelo del TFG (HMM + GARCH + XGBoost MoE) que predice la dirección de BTC/USDT cada hora siguiendo exactamente la pipeline del notebook `definitivo_2.py`.

## Estructura del repo

```
.
├── .github/workflows/
│   ├── live.yml             cada 2 min, live + señales TFG
│   ├── historical.yml       diario 22:00 UTC, histórico macro
│   └── stocks.yml           diario 22:30 UTC, 150 acciones
├── data/
│   ├── historical_data.json
│   ├── live_data.json
│   ├── tfg_signals.json
│   ├── stocks_list.json
│   └── stocks_detail/       un JSON por acción
├── models/                  aquí van los .pkl entrenados del TFG
│   ├── hmm_vol.pkl
│   ├── hmm_state_map.pkl
│   ├── garch_params.pkl
│   ├── deadzone_filter_xgb.pkl
│   ├── xgb_8_experts.pkl
│   ├── calibrators.pkl
│   ├── feature_cols.pkl
│   └── adaptive_rules.pkl   se genera con el notebook auxiliar
├── index.html               UI principal
├── stocks.js                lógica de la pestaña Acciones
├── tickers.json             lista editable de las 150 acciones
├── fetch_historical.py
├── fetch_live.py
├── fetch_stocks.py
├── tfg_signals.py
├── requirements.txt
├── .gitignore
└── README.md
```

## Pasos para desplegar en GitHub Pages

1. Crea el repo en GitHub y sube todos los ficheros.
2. Sube tus 8 archivos `.pkl` a `models/`. El JSON de señales se genera igual aunque falten los modelos. La pestaña TFG mostrará un banner amarillo indicando los que faltan.
3. Ve a Settings → Pages, fuente "Deploy from a branch", branch `main` y carpeta `/ (root)`. Guarda.
4. Ve a Actions y dale a Run workflow manualmente en este orden.
   1. Historical macro (~15 min) genera `historical_data.json`.
   2. Stocks daily (~5-10 min) genera `stocks_list.json` y `stocks_detail/`.
   3. Live data (~1 min) genera `live_data.json` y `tfg_signals.json`.
5. A partir de ahí los crones se disparan solos.

## Tres cosas importantes

1. Settings → Actions → General → Workflow permissions debe estar en "Read and write permissions" para que los workflows puedan hacer `git push` de los JSON. Si no, fallarán.
2. El cron cada 2 minutos del `live.yml` consume ~21600 min/mes. El plan gratuito de GitHub Actions da 2000 min/mes, el Pro da 3000. Con GitHub Student Pack tienes Pro gratis siendo de UFV pero igual no llega para cada minuto. Recomendado para cuenta gratis: cron `*/5` o `*/10`. Edítalo en `live.yml`.
3. Los `.gitkeep` son ficheros vacíos solo para que git suba las carpetas vacías. Cuando los workflows generen los JSON reales puedes borrarlos.

## El modelo del TFG (pestaña TFG)

`tfg_signals.py` replica exactamente la pipeline horaria del notebook `definitivo_2.py`. En cada ejecución hace lo siguiente.

1. Descarga las últimas 1000 velas de BTC/USDT y ETH/USDT de Binance a resolución 1h y elimina la última vela en curso para mantener la causalidad.
2. Descarga el histórico diario del índice Fear and Greed y lo reindexa a horario con forward fill.
3. Construye las features causales idénticas al TFG. Logret + lags 1, 3, 6, 12, 24. RSI 14. MACD diff. Bollinger band width. ATR 14. Volumen normalizado. Volatilidad realizada 24h y 168h. Momentums 12, 24, 168h. EMA cross 12 vs 48 normalizado por volatilidad. Ratio BTC/ETH. Correlación 168h. Diff de volatilidad cross. Features de calendario sin/cos hora y día. Fear and Greed bruto, zscore 30d, change 7d, indicadores categóricos extreme fear/greed.
4. Aplica el HMM forward filter univariante sobre `btc_volreal24` con los parámetros entrenados y obtiene `hmm_p_lowvol` y `hmm_p_highvol`.
5. Aplica el GARCH(1,1) one-step-ahead con los parámetros entrenados sobre `btc_logret * 100` y obtiene `garch_vol_t1`.
6. Aplica el filtro deadzone XGBoost + calibración isotónica para obtener `p_deadzone`.
7. Llama al ensemble MoE de los 4 expertos calibrados (logloss, error, brier, sharpe). Cada experto es la combinación ponderada por las probabilidades del HMM de un modelo lowvol y otro highvol. Las probabilidades pasan por la calibración isotónica entrenada en validation.
8. Para la vela actual evalúa las reglas adaptativas (version, side) con los multipliers calibrados a hit rate ≥ 80% en train. Para cada regla comprueba `confidence ≥ conf_thr + 0.06` y `p_deadzone ≤ 0.50`. Si pasa, genera una señal con TP dinámico `max(garch_vol × multiplier, MIN_TP_ABS)`. Sin stop loss.
9. Escribe `data/tfg_signals.json` con la vela actual, la próxima vela target (t+1h), el régimen, GARCH, p_deadzone, las 4 predicciones, las señales evaluadas y un histórico de 200 velas para la gráfica.

Configuración validada en el TFG. `conf_boost = 0.06`, `dz_thr = 0.50`, sin SL. Resultado en test 2025. $1021 partiendo de $1000, 62 trades, win rate 67.7%.

## Cómo generar el `adaptive_rules.pkl` (importante)

Tu notebook genera 7 archivos en `models/` pero no guarda explícitamente las reglas adaptativas como pkl. `tfg_signals.py` necesita un archivo `adaptive_rules.pkl` con un dict `{(version, side): {multiplier, conf_thr, dz_thr}}`. Hay un notebook auxiliar (`generar_adaptive_rules.ipynb`) que pegas en Colab al final de tu pipeline y crea el archivo. Mira la sección "Notebook auxiliar para Colab" más abajo.

## Local (test)

```bash
pip install -r requirements.txt
python fetch_historical.py
python fetch_live.py
python fetch_stocks.py       # ~5-10 min
python tfg_signals.py         # necesita models/*.pkl
python -m http.server 8000
```

Y abre `http://localhost:8000`.

## Notas sobre las 150 acciones

- Lista editable en `tickers.json`. 50 USA + 50 Europa + 50 Asia.
- `stocks_list.json` se carga solo cuando entras a la pestaña Acciones (lazy load).
- Cada ficha individual descarga su JSON propio (`stocks_detail/{ticker}.json`) al hacer click.
- Tamaño total estimado tras la primera descarga. ~25-30 MB. Cabe en GitHub Pages.
- Información por acción. Histórico diario 5 años, intradía 5m últimos 5 días, descripción, sector, industria, P/E, EPS, dividend yield, beta, market cap, 52w high/low, dividendos últimos 2 años, splits, próximos earnings.
- Si `fetch_stocks.py` falla en algún ticker concreto, lo loggea y continúa con los demás.

## Personalización

- Para añadir o quitar acciones, edita `tickers.json` y vuelve a ejecutar el workflow `Stocks daily`.
- Para cambiar el cron del live, edita la línea `cron` en `.github/workflows/live.yml`. Sintaxis estándar `*/5 * * * *`.
- Para cambiar tickers macro, edita el dict `TICKERS` al inicio de `fetch_historical.py` y `fetch_live.py`.
- Para cambiar las fuentes de noticias, edita `RSS_FEEDS` en `fetch_live.py`.

## Stack

- Frontend. HTML + CSS vanilla + Lightweight Charts (TradingView).
- Backend. Scripts Python que escriben JSON estáticos en `data/`.
- Datos en vivo. Binance public API (cripto) + Yahoo Finance (resto).
- Modelos. hmmlearn, arch, xgboost, scikit-learn.
- Hosting. GitHub Pages + GitHub Actions con git push automático.
