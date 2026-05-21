# TFG Terminal

Terminal financiera estilo Bloomberg/Revolut desplegada en GitHub Pages. Muestra mercados en vivo (cripto, acciones, materias primas, FX, bonos), noticias, calendario macro, un mapa de indicadores globales, flujos globales y un panel completo del modelo del TFG (HMM + GARCH + XGBoost MoE) con paper trading en vivo y backtest histórico.

## Estructura del repo

```
.
├── .github/workflows/
│   ├── live.yml             cada 10 min — live data + paper trader
│   ├── historical.yml       diario 22:00 UTC — histórico macro
│   └── stocks.yml           diario 22:30 UTC — 150 acciones
├── data/
│   ├── historical_data.json
│   ├── live_data.json
│   ├── paper_trading.json      generado por paper_trader.py
│   ├── paper_state.json        estado persistido del paper trader
│   ├── backtest_history.json   resultado offline del backtest 2025
│   ├── stocks_list.json
│   └── stocks_detail/          un JSON por acción
├── models/
│   ├── hmm_vol.pkl
│   ├── hmm_state_map.pkl
│   ├── garch_params.pkl
│   ├── deadzone_filter_xgb.pkl
│   ├── xgb_8_experts.pkl
│   ├── calibrators.pkl
│   ├── feature_cols.pkl
│   ├── adaptive_rules.pkl
│   └── tp_sl_rules.json        reglas TP/SL y percentiles GARCH
├── index.html               UI principal
├── mapa-global.html         Mapa de indicadores mundiales (D3.js)
├── noticias.html            Agregador de noticias
├── flujos-globales.html     Mapa de flujos marítimos/aéreos (D3.js)
├── stocks.js                lógica de la pestaña Acciones
├── redesign.css / redesign.js / redesign-pre.js / redesign-noticias.js
├── tickers.json             lista editable de las 150 acciones
├── paper_trader.py          paper trading en vivo (reemplaza tfg_signals.py)
├── tfg_signals.py           señales originales del TFG (obsoleto)
├── fetch_historical.py
├── fetch_live.py
├── fetch_stocks.py
├── requirements.txt
└── README.md
```

## Pasos para desplegar en GitHub Pages

1. Crea el repo en GitHub y sube todos los ficheros.
2. Sube tus 8 archivos `.pkl` a `models/`. La UI muestra un banner amarillo indicando los que faltan.
3. Ve a Settings → Pages, fuente "Deploy from a branch", branch `main` y carpeta `/ (root)`. Guarda.
4. Ve a Actions y dale a Run workflow manualmente en este orden:
   1. Historical macro (~15 min) genera `historical_data.json`.
   2. Stocks daily (~5-10 min) genera `stocks_list.json` y `stocks_detail/`.
   3. Live data (~1 min) genera `live_data.json` y `paper_trading.json`.
5. A partir de ahí los crones se disparan solos.

## Permisos de GitHub Actions

Settings → Actions → General → Workflow permissions debe estar en **"Read and write permissions"** para que los workflows puedan hacer `git push` de los JSON.

## Pestaña Modelo TFG — Paper Trading en vivo

La pestaña "Modelo TFG" tiene dos sub-pestañas:

### Paper Trading

`paper_trader.py` corre cada 10 min en GitHub Actions. En cada ejecución:

1. Carga el estado persistido de `data/paper_state.json` (posición abierta, capital, historial de trades).
2. Ejecuta la pipeline completa: features causales → HMM → GARCH → deadzone filter → XGBoost MoE versión **sharpe** → probabilidad calibrada.
3. Si hay una posición abierta: comprueba si el precio actual ha alcanzado el TP, SL o si ha expirado el trade (máx. 48h). Si sí, cierra el trade y actualiza el capital.
4. Si no hay posición y la vela ha cambiado: evalúa si la señal pasa todos los filtros:
   - Dirección: solo **LONG** (`prob_cal ≥ 0.5`)
   - Confianza: `≥ 60%`
   - P(deadzone): `≤ 38%`
   - GARCH vol: debe caer en un bin de regla activa (por debajo del percentil 80)
5. Si pasa los filtros, abre una posición con el TP y SL de la regla correspondiente.
6. Guarda `data/paper_state.json` y genera `data/paper_trading.json` para la UI.

**Parámetros validados en el TFG (no modificar):**

| Parámetro | Valor |
|-----------|-------|
| `CONF_THR` | 0.60 |
| `DZ_THR` | 0.38 |
| `COST_RT` | 0.0012 (0.12% round-trip) |
| `VERSION` | sharpe |
| `SIDE` | LONG |
| `MAX_TRADE_H` | 48h |

**Reglas TP/SL (`models/tp_sl_rules.json`):**

| Bin | GARCH rango | TP | SL |
|-----|-------------|----|----|
| moderada | p40 ≤ garch < p50 | 0.30% | 0.15% |
| media_alta | p60 ≤ garch < p70 | 0.40% | 0.20% |

Los percentiles GARCH (`p40, p50, p60, p70, p80`) están en `models/tp_sl_rules.json` y deben actualizarse con los valores reales del conjunto de entrenamiento:
```python
import numpy as np, joblib
garch_train = ...  # garch_vol_t1 sobre el train set
pcts = np.percentile(garch_train, [40, 50, 60, 70, 80])
# Edita models/tp_sl_rules.json con estos valores
```

### Backtest Histórico

Datos estáticos en `data/backtest_history.json` generados offline desde el notebook. Muestra la curva de equity, estadísticas de resumen y log de trades del test set 2025.

**Resultados validados:**
- 67 trades · Win Rate 62.7% · Sharpe 11.54 · Retorno +2.12%
- Solo versión sharpe, solo LONG
- Start capital: $1000 → End: $1021.20

## Mapa Global (`mapa-global.html`)

Mapa interactivo D3.js con `geoNaturalEarth1`. Indicadores agrupados en 6 categorías:

- **Economía**: PIB growth, PIB total, PIB per cápita, IPC, Desempleo
- **Comercio exterior**: Exportaciones, Importaciones, Balanza comercial, FDI, Cuenta corriente
- **Finanzas**: Deuda pública, Reservas internacionales, Ahorro bruto, FBCF
- **Social**: Población, Esperanza de vida, Usuarios de internet
- **Energía**: Consumo eléctrico, CO₂ per cápita, Electricidad renovable, Producción de petróleo
- **Geopolítica**: Gasto militar, Tensiones/conflictos

Datos: World Bank API con `mrv=10&per_page=3000&gapfill=Y`. Tensiones: datos estáticos ACLED/UCDP codificados en 6 niveles (verde=paz → rojo oscuro=guerra).

Funcionalidades: zoom con doble click, botón reset, paleta divergente, ranking de países por indicador seleccionado.

## Flujos Globales (`flujos-globales.html`)

Mapa D3.js que muestra rutas marítimas y aéreas, puertos principales y zonas de riesgo geopolítico.

- Filtros por tipo (marítimo/aéreo), por producto (petróleo, LNG, contenedores, etc.)
- Barcos en tránsito con animaciones y tooltips
- Zonas de riesgo por nivel (naranja=moderado → rojo=crítico)
- Paleta de colores consistente con mapa-global.html

## Noticias (`noticias.html`)

Agregador de noticias financieras. Lee `data/live_data.json` (misma fuente que el dashboard). Filtrado por fuente, diseño de lista limpio con tiempo relativo y etiquetas de fuente.

## Stack técnico

- **Frontend**: HTML + CSS vanilla + Lightweight Charts (TradingView) + D3.js v7 + TopoJSON
- **Backend**: Scripts Python que escriben JSON estáticos en `data/`
- **Datos en vivo**: Binance public API (cripto) + Yahoo Finance (resto) + World Bank API (macro)
- **Modelo ML**: hmmlearn, arch (GARCH), xgboost, scikit-learn
- **Paper Trading**: Estado persistido en git entre ejecuciones de GitHub Actions
- **Hosting**: GitHub Pages + GitHub Actions con git push automático cada 10 min

## Local (test)

```bash
pip install -r requirements.txt
python fetch_historical.py
python fetch_live.py
python fetch_stocks.py       # ~5-10 min
python paper_trader.py       # necesita models/*.pkl
python -m http.server 8000
```

Y abre `http://localhost:8000`.

## Cómo generar `adaptive_rules.pkl` y actualizar percentiles GARCH

El notebook genera los 8 `.pkl` en `models/`. Además:

1. **`adaptive_rules.pkl`**: genera con el notebook auxiliar `generar_adaptive_rules.ipynb`.
2. **Percentiles GARCH**: después de correr la pipeline, ejecuta:
   ```python
   import numpy as np, json
   pcts = np.percentile(df_train['garch_vol_t1'].dropna(), [40, 50, 60, 70, 80])
   # Actualiza models/tp_sl_rules.json con los valores reales
   ```

## Notas sobre las 150 acciones

- Lista editable en `tickers.json`. 50 USA + 50 Europa + 50 Asia.
- `stocks_list.json` se carga solo cuando entras a la pestaña Acciones (lazy load).
- Cada ficha individual descarga su JSON propio (`stocks_detail/{ticker}.json`) al hacer click.

## Personalización

- Para añadir/quitar acciones: edita `tickers.json` y re-ejecuta el workflow `Stocks daily`.
- Para cambiar el cron del live: edita la línea `cron` en `.github/workflows/live.yml`.
- Para cambiar los percentiles GARCH o las reglas TP/SL: edita `models/tp_sl_rules.json`.
- Para resetear el paper trader a capital inicial: borra `data/paper_state.json` del repo.
