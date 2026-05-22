# generate_backtest.py
# Regenera data/backtest_history.json corriendo el pipeline real TFG sobre el
# set de test 2025.  Usa los mismos modelos y parametros que paper_trader.py
# pero en modo offline: carga todos los datos historicos, aplica la logica
# del notebook (TP priority sobre SL, excursion 1 barra hacia adelante).
#
# Ejecutar localmente una vez y commitear el resultado:
#   pip install -r requirements.txt
#   python generate_backtest.py
#
# DIFERENCIAS vs paper_trader.py:
#   - Carga TODOS los datos (sin limit) para warm-up correcto del HMM/GARCH
#   - No usa MAX_TRADE_H ni posicion abierta; cada senal es independiente
#   - TP tiene prioridad sobre SL (logica notebook, academicamente correcta)
#   - Solo evalua barras cuyo exit_time (index + 1h) cae dentro de TEST_END

import os
import json
import warnings
from datetime import datetime, timezone

import numpy as np
import pandas as pd

warnings.filterwarnings("ignore")

# ─── Constantes TFG (no modificar) ───────────────────────────────────────────
CONF_THR   = 0.60
DZ_THR     = 0.38
COST_RT    = 0.0012
VERSION    = "sharpe"
SIDE       = "LONG"

TEST_START = "2025-01-01"
TEST_END   = "2025-12-31"

START_CAP  = 1000.0

MODELS_DIR = "models"
RULES_PATH = "models/tp_sl_rules.json"
OUT_PATH   = "data/backtest_history.json"


# ─── Pipeline (copiado de paper_trader.py) ────────────────────────────────────

def load_csv_ohlcv_full(csv_path):
    """Carga el CSV completo sin limite de filas. No descarta la ultima barra."""
    df = pd.read_csv(csv_path)
    date_col = "datetime_utc" if "datetime_utc" in df.columns else df.columns[0]
    df["date"] = pd.to_datetime(df[date_col], utc=True)
    df = df.set_index("date").sort_index()
    df = df[["open", "high", "low", "close", "volume"]].astype(float)
    return df


def build_features(d):
    import ta
    d = d.copy()
    for asset in ["btc", "eth"]:
        c = f"{asset}_close"
        h = f"{asset}_high"
        l = f"{asset}_low"
        v = f"{asset}_volume"
        d[f"{asset}_logret"] = np.log(d[c] / d[c].shift(1))
        for lag in [1, 3, 6, 12, 24]:
            d[f"{asset}_logret_lag{lag}"] = d[f"{asset}_logret"].shift(lag)
        d[f"{asset}_logret_24h"] = np.log(d[c] / d[c].shift(24))
        d[f"{asset}_rsi14"] = ta.momentum.RSIIndicator(d[c], window=14).rsi()
        macd = ta.trend.MACD(d[c], window_slow=26, window_fast=12, window_sign=9)
        d[f"{asset}_macd_diff"] = macd.macd_diff()
        bb = ta.volatility.BollingerBands(d[c], window=20)
        d[f"{asset}_bb_width"] = (bb.bollinger_hband() - bb.bollinger_lband()) / bb.bollinger_mavg()
        atr = ta.volatility.AverageTrueRange(d[h], d[l], d[c], window=14)
        d[f"{asset}_atr14"] = atr.average_true_range()
        d[f"{asset}_vol_norm"] = d[v] / d[v].rolling(168).mean()
        d[f"{asset}_volreal24"] = d[f"{asset}_logret"].rolling(24).std()
        d[f"{asset}_volreal168"] = d[f"{asset}_logret"].rolling(168).std()
        d[f"{asset}_mom12"] = d[c] / d[c].shift(12) - 1
        d[f"{asset}_mom24"] = d[c] / d[c].shift(24) - 1
        d[f"{asset}_mom168"] = d[c] / d[c].shift(168) - 1
        ema12 = d[c].ewm(span=12, adjust=False).mean()
        ema48 = d[c].ewm(span=48, adjust=False).mean()
        d[f"{asset}_ema_cross"] = (ema12 - ema48) / d[f"{asset}_volreal24"].replace(0, np.nan)
    d["ratio_btc_eth"] = d["btc_close"] / d["eth_close"]
    d["corr_168"] = d["btc_logret"].rolling(168).corr(d["eth_logret"])
    d["diff_vol24_cross"] = d["btc_volreal24"] - d["eth_volreal24"]
    hour = d.index.hour
    dow = d.index.dayofweek
    d["sin_hour"] = np.sin(2 * np.pi * hour / 24)
    d["cos_hour"] = np.cos(2 * np.pi * hour / 24)
    d["sin_dow"] = np.sin(2 * np.pi * dow / 7)
    d["cos_dow"] = np.cos(2 * np.pi * dow / 7)
    d["is_weekend"] = (dow >= 5).astype(int)
    return d


def add_fg_features(df, fg):
    df = df.copy()
    fg_reidx = fg.reindex(df.index, method="ffill")
    df["fg"] = fg_reidx["fg"].ffill()
    df["fg_zscore_30d"] = (
        (df["fg"] - df["fg"].rolling(720, min_periods=24).mean())
        / df["fg"].rolling(720, min_periods=24).std()
    )
    df["fg_change_7d"] = df["fg"] - df["fg"].shift(168)
    df["fg_extreme_fear"] = (df["fg"] <= 25).astype(int)
    df["fg_extreme_greed"] = (df["fg"] >= 75).astype(int)
    df["fg_fear"] = ((df["fg"] > 25) & (df["fg"] <= 45)).astype(int)
    df["fg_greed"] = ((df["fg"] >= 55) & (df["fg"] < 75)).astype(int)
    return df


def normal_pdf_1d(x, mean, std):
    std = max(float(std), 1e-12)
    z = (x - mean) / std
    return np.exp(-0.5 * z * z) / (std * np.sqrt(2 * np.pi))


def hmm_univariate_stds(hmm_model):
    covars = hmm_model.covars_
    stds = []
    for s in range(hmm_model.n_components):
        c = np.asarray(covars[s]).reshape(-1)[0]
        stds.append(np.sqrt(max(float(c), 1e-12)))
    return np.array(stds)


def hmm_forward_filter_univariate(hmm_model, obs_1d):
    x = np.asarray(obs_1d, dtype=float)
    n = len(x)
    n_states = hmm_model.n_components
    means = hmm_model.means_.reshape(-1)
    stds = hmm_univariate_stds(hmm_model)
    probs = np.zeros((n, n_states))
    alpha = None
    for t in range(n):
        emit = np.array([normal_pdf_1d(x[t], means[s], stds[s]) for s in range(n_states)])
        if alpha is None:
            alpha = hmm_model.startprob_ * emit
        else:
            alpha = (alpha @ hmm_model.transmat_) * emit
        total = alpha.sum()
        if (not np.isfinite(total)) or total <= 1e-300:
            alpha = np.ones(n_states) / n_states
        else:
            alpha = alpha / total
        probs[t] = alpha
    return probs


def garch_one_step_ahead(returns_scaled, omega, alpha, beta, mu, sigma2_init):
    r = np.asarray(returns_scaled, dtype=float)
    n = len(r)
    sigma_pred = np.zeros(n)
    sigma2_t = float(sigma2_init)
    for t in range(n):
        eps_t = r[t] - mu
        sigma2_next = omega + alpha * eps_t * eps_t + beta * sigma2_t
        if (not np.isfinite(sigma2_next)) or sigma2_next <= 0:
            sigma2_next = sigma2_t
        sigma_pred[t] = np.sqrt(sigma2_next) / 100.0
        sigma2_t = sigma2_next
    return sigma_pred


def ensemble_predict(data, experts, feature_cols):
    X = data[feature_cols].values
    p_low = data["hmm_p_lowvol"].values.astype(float)
    p_high = data["hmm_p_highvol"].values.astype(float)
    prob_low = experts["lowvol"].predict_proba(X)[:, 1]
    prob_high = experts["highvol"].predict_proba(X)[:, 1]
    prob = p_low * prob_low + p_high * prob_high
    return np.clip(prob, 1e-7, 1 - 1e-7)


def predict_calibrated(data, version, all_experts, calibrators, feature_cols):
    prob_raw = ensemble_predict(data, all_experts[version], feature_cols)
    prob_cal = np.clip(calibrators[version].predict(prob_raw), 1e-7, 1 - 1e-7)
    return prob_raw, prob_cal


def apply_deadzone_filter(data, dz_filter):
    out = data.copy()
    fcols = dz_filter["feature_cols"]
    model = dz_filter["model"]
    iso = dz_filter["isotonic"]
    valid = out[fcols].notna().all(axis=1)
    out["p_deadzone"] = np.nan
    out["p_tradeable"] = np.nan
    if valid.sum() > 0:
        raw = model.predict_proba(out.loc[valid, fcols].values)[:, 1]
        cal = np.clip(iso.predict(raw), 1e-7, 1 - 1e-7)
        out.loc[valid, "p_deadzone"] = cal
        out.loc[valid, "p_tradeable"] = 1 - cal
    return out


def classify_garch(garch_vol, pcts, rules_list):
    if garch_vol is None or not np.isfinite(garch_vol):
        return None
    if garch_vol >= pcts.get("p80", 9999):
        return None
    for rule in rules_list:
        lo_key, hi_key = rule["garch_range"]
        lo = pcts.get(lo_key, 0)
        hi = pcts.get(hi_key, 9999)
        if lo <= garch_vol < hi:
            return rule
    return None


# ─── Estadisticas ─────────────────────────────────────────────────────────────

def compute_stats(trades):
    if not trades:
        return {}
    pnls = [t["pnl_pct"] for t in trades]
    n = len(pnls)
    n_wins = sum(1 for p in pnls if p > 0)
    cumret = 1.0
    peak = 1.0
    max_dd = 0.0
    for p in pnls:
        cumret *= (1 + p)
        peak = max(peak, cumret)
        dd = (peak - cumret) / peak
        max_dd = max(max_dd, dd)
    total_ret = (cumret - 1) * 100
    wr = n_wins / n if n > 0 else None
    arr = np.array(pnls)
    sharpe = float(arr.mean() / arr.std() * np.sqrt(8760)) if n > 1 and arr.std() > 0 else None
    durations = [t.get("duration_h", 1) for t in trades]

    # Profit factor
    gross_win  = sum(p for p in pnls if p > 0)
    gross_loss = abs(sum(p for p in pnls if p < 0))
    pf = gross_win / gross_loss if gross_loss > 0 else None

    return {
        "n_trades": n,
        "n_wins": n_wins,
        "n_losses": n - n_wins,
        "win_rate": round(wr, 4) if wr is not None else None,
        "total_return_pct": round(total_ret, 4),
        "start_capital": START_CAP,
        "end_capital": round(START_CAP * cumret, 2),
        "sharpe_ratio": round(sharpe, 2) if sharpe is not None else None,
        "max_drawdown_pct": round(max_dd * 100, 4),
        "avg_trade_duration_h": round(sum(durations) / len(durations), 1),
        "profit_factor": round(pf, 2) if pf is not None else None,
    }


def compute_by_rule(trades):
    by_rule = {}
    for t in trades:
        r = t["rule"]
        if r not in by_rule:
            by_rule[r] = {"n_trades": 0, "n_wins": 0, "n_losses": 0,
                          "tp": t["tp"], "sl": t["sl"], "pnls": []}
        by_rule[r]["n_trades"] += 1
        by_rule[r]["pnls"].append(t["pnl_pct"])
        if t["pnl_pct"] > 0:
            by_rule[r]["n_wins"] += 1
        else:
            by_rule[r]["n_losses"] += 1
    result = {}
    for r, d in by_rule.items():
        pnls = d.pop("pnls")
        d["win_rate"] = round(d["n_wins"] / d["n_trades"], 4) if d["n_trades"] else None
        d["net_pnl_pct"] = round(sum(pnls), 6)
        result[r] = d
    return result


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("[generate_backtest] Iniciando...")

    # 1. Verificar modelos
    required = [
        "hmm_vol.pkl", "hmm_state_map.pkl", "garch_params.pkl",
        "deadzone_filter_xgb.pkl", "xgb_8_experts.pkl",
        "calibrators.pkl", "feature_cols.pkl",
    ]
    missing = [m for m in required if not os.path.exists(os.path.join(MODELS_DIR, m))]
    if missing:
        print(f"[generate_backtest] ERROR: modelos faltantes: {missing}")
        return

    import joblib

    with open(RULES_PATH, encoding="utf-8") as f:
        rules_cfg = json.load(f)
    pcts       = rules_cfg["garch_percentiles"]
    rules_list = rules_cfg["rules"]

    print("[generate_backtest] Cargando modelos...")
    hmm_vol      = joblib.load(os.path.join(MODELS_DIR, "hmm_vol.pkl"))
    state_map    = joblib.load(os.path.join(MODELS_DIR, "hmm_state_map.pkl"))
    garch_p      = joblib.load(os.path.join(MODELS_DIR, "garch_params.pkl"))
    dz_filter    = joblib.load(os.path.join(MODELS_DIR, "deadzone_filter_xgb.pkl"))
    all_experts  = joblib.load(os.path.join(MODELS_DIR, "xgb_8_experts.pkl"))
    calibrators  = joblib.load(os.path.join(MODELS_DIR, "calibrators.pkl"))
    feature_cols = joblib.load(os.path.join(MODELS_DIR, "feature_cols.pkl"))

    high_state_raw = low_state_raw = None
    for s, label in state_map.items():
        if label == "highvol":
            high_state_raw = int(s)
        elif label == "lowvol":
            low_state_raw = int(s)
    if high_state_raw is None or low_state_raw is None:
        print("[generate_backtest] ERROR: state_map mal formado"); return

    omega      = float(garch_p["omega"])
    alpha_g    = float(garch_p["alpha"])
    beta_g     = float(garch_p["beta"])
    mu         = float(garch_p.get("mu", 0.0))
    sigma2_init = float(garch_p["sigma2_init"])

    # 2. Cargar CSVs completos (sin limite — necesitamos todo el historico para warmup)
    print("[generate_backtest] Cargando CSVs completos (sin limite)...")
    btc = load_csv_ohlcv_full("data/btc_1h.csv").add_prefix("btc_")
    eth = load_csv_ohlcv_full("data/eth_1h.csv").add_prefix("eth_")
    df  = btc.join(eth, how="inner")
    print(f"  {len(df)} velas | {df.index.min()} -> {df.index.max()}")

    # Fear & Greed
    fg_path = "data/fg_1h.csv"
    if os.path.exists(fg_path):
        fg = pd.read_csv(fg_path, index_col=0, parse_dates=True)
        if fg.index.tz is None:
            fg.index = fg.index.tz_localize("UTC")
        if "fg" in fg.columns:
            fg = fg[["fg"]]
        else:
            fg = pd.DataFrame({"fg": 50.0}, index=df.index)
    else:
        fg = pd.DataFrame({"fg": 50.0}, index=df.index)

    # 3. Features
    print("[generate_backtest] Construyendo features...")
    df = build_features(df)
    df = add_fg_features(df, fg)

    # 4. HMM forward filter (sobre TODOS los datos para warm-up correcto)
    train_median = df["btc_volreal24"].dropna().median()
    obs_all = df["btc_volreal24"].fillna(train_median)
    print("[generate_backtest] HMM forward filter...")
    probs_raw = hmm_forward_filter_univariate(hmm_vol, obs_all.values)
    df["hmm_p_lowvol"]  = probs_raw[:, low_state_raw]
    df["hmm_p_highvol"] = probs_raw[:, high_state_raw]
    df["hmm_regime_vol"] = np.where(
        df["hmm_p_highvol"] > df["hmm_p_lowvol"], "highvol", "lowvol"
    )

    # 5. GARCH one-step-ahead (sobre todos los datos)
    ret_scaled = df["btc_logret"].fillna(0.0).values * 100.0
    df["garch_vol_t1"] = garch_one_step_ahead(ret_scaled, omega, alpha_g, beta_g, mu, sigma2_init)

    # 6. Deadzone + prediccion (solo sobre filas con features completas)
    missing_feats = [c for c in feature_cols if c not in df.columns]
    if missing_feats:
        print(f"[generate_backtest] ERROR: features faltantes: {missing_feats}"); return

    df_clean = df.dropna(subset=feature_cols).copy()
    df_clean = df_clean.replace([np.inf, -np.inf], np.nan).dropna(subset=feature_cols)
    if len(df_clean) == 0:
        print("[generate_backtest] ERROR: sin filas con features completas"); return

    print("[generate_backtest] Deadzone + prediccion...")
    df_clean = apply_deadzone_filter(df_clean, dz_filter)
    _, prob_cal = predict_calibrated(df_clean, VERSION, all_experts, calibrators, feature_cols)
    df_clean["prob_sharpe"] = prob_cal

    # 7. Excursiones (t+1): logica del notebook
    #    fav_excursion = high_{t+1} / close_t - 1  (LONG: hasta donde sube la siguiente vela)
    #    adv_excursion = 1 - low_{t+1} / close_t   (LONG: hasta donde baja la siguiente vela)
    df_clean["high_t1"]            = df_clean["btc_high"].shift(-1)
    df_clean["low_t1"]             = df_clean["btc_low"].shift(-1)
    df_clean["future_simple_ret"]  = df_clean["btc_close"].shift(-1) / df_clean["btc_close"] - 1
    df_clean["exit_time"]          = df_clean.index + pd.Timedelta(hours=1)

    df_clean["fav_excursion"] = df_clean["high_t1"] / df_clean["btc_close"] - 1
    df_clean["adv_excursion"] = 1.0 - df_clean["low_t1"] / df_clean["btc_close"]

    # 8. Filtrar set de test 2025
    #    Condicion del notebook: exit_time <= TEST_END (la proxima barra cae dentro del periodo)
    ts_start = pd.Timestamp(TEST_START, tz="UTC")
    ts_end   = pd.Timestamp(TEST_END,   tz="UTC") + pd.Timedelta(days=1)  # hasta 2026-01-01 exclusivo

    test = df_clean[
        (df_clean.index >= ts_start) &
        (df_clean["exit_time"] <= ts_end) &
        df_clean["high_t1"].notna() &
        df_clean["low_t1"].notna() &
        df_clean["future_simple_ret"].notna()
    ].copy()
    print(f"  Barras en test 2025: {len(test)}")

    # 9. Aplicar filtros y generar trades
    trades    = []
    capital   = START_CAP
    trade_id  = 0

    for ts, row in test.iterrows():
        prob    = float(row["prob_sharpe"])
        conf    = max(prob, 1 - prob)
        direction = "LONG" if prob >= 0.5 else "SHORT"
        p_dz    = float(row["p_deadzone"]) if pd.notna(row["p_deadzone"]) else 1.0
        garch_v = float(row["garch_vol_t1"]) if pd.notna(row["garch_vol_t1"]) else 0.0

        # Filtros
        if direction != SIDE:
            continue
        if conf < CONF_THR:
            continue
        if p_dz >= DZ_THR:
            continue

        rule = classify_garch(garch_v, pcts, rules_list)
        if rule is None:
            continue

        # Parametros del trade
        tp = rule["tp"]
        sl = rule["sl"]
        entry_price = float(row["btc_close"])
        fav = float(row["fav_excursion"])
        adv = float(row["adv_excursion"])
        ret_dir = float(row["future_simple_ret"])

        # Logica notebook: TP tiene prioridad sobre SL
        tp_hit = fav >= tp
        sl_hit = (adv >= sl) and not tp_hit

        if tp_hit:
            result    = "WIN"
            exit_price = round(entry_price * (1 + tp), 2)
            pnl_pct   = tp - COST_RT
        elif sl_hit:
            result    = "LOSS"
            exit_price = round(entry_price * (1 - sl), 2)
            pnl_pct   = -sl - COST_RT
        else:
            result    = "CLOSE"
            exit_price = round(entry_price * (1 + ret_dir), 2)
            pnl_pct   = ret_dir - COST_RT

        capital *= (1 + pnl_pct)
        trade_id += 1

        open_time  = ts.strftime("%Y-%m-%dT%H:%M:%SZ")
        exit_ts    = row["exit_time"]
        close_time = exit_ts.strftime("%Y-%m-%dT%H:%M:%SZ") if hasattr(exit_ts, "strftime") else str(exit_ts)

        trades.append({
            "id":           trade_id,
            "open_time":    open_time,
            "close_time":   close_time,
            "entry":        round(entry_price, 2),
            "exit":         exit_price,
            "side":         SIDE,
            "rule":         rule["name"],
            "tp":           tp,
            "sl":           sl,
            "result":       result,
            "pnl_pct":      round(pnl_pct, 6),
            "capital_after": round(capital, 2),
        })

    print(f"\n[generate_backtest] Trades generados: {len(trades)}")
    if trades:
        wins   = sum(1 for t in trades if t["result"] == "WIN")
        losses = sum(1 for t in trades if t["result"] == "LOSS")
        closes = sum(1 for t in trades if t["result"] == "CLOSE")
        print(f"  WIN={wins}  LOSS={losses}  CLOSE={closes}")
        print(f"  Win rate: {wins/len(trades)*100:.1f}%")
        print(f"  Capital final: {capital:.2f} ({(capital/START_CAP-1)*100:+.2f}%)")

    # 10. Curva de equity
    equity_curve = [{"time": int(pd.Timestamp(TEST_START, tz="UTC").timestamp()), "value": START_CAP}]
    cap = START_CAP
    for t in trades:
        ts_sec = int(pd.Timestamp(t["close_time"]).timestamp())
        equity_curve.append({"time": ts_sec, "value": round(t["capital_after"], 2)})

    # 11. Estadisticas
    stats   = compute_stats(trades)
    by_rule = compute_by_rule(trades)

    # Calcular duracion media (siempre 1h en el backtest del notebook ya que es 1-bar hold)
    if trades:
        stats["avg_trade_duration_h"] = 1.0

    # 12. Escribir JSON
    out = {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "description":  (
            "Backtest offline sobre el set de test 2025. Pipeline HMM+GARCH+XGBoost MoE, "
            "version sharpe, solo LONG, reglas TP/SL fijas por bin de volatilidad GARCH. "
            "TP tiene prioridad sobre SL (logica notebook, 1 barra de hold)."
        ),
        "config": {
            "version":       VERSION,
            "direction":     SIDE,
            "cost_rt":       COST_RT,
            "conf_thr":      CONF_THR,
            "dz_thr":        DZ_THR,
            "garch_cap":     "p80",
            "start_capital": START_CAP,
            "test_start":    TEST_START,
            "test_end":      TEST_END,
        },
        "summary":      stats,
        "by_rule":      by_rule,
        "equity_curve": equity_curve,
        "trades":       trades,
    }

    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\n[generate_backtest] Guardado {OUT_PATH} ({size_kb:.1f} KB)")
    print("Ejecuta: git add data/backtest_history.json && git commit -m 'Real 2025 backtest' && git push")


if __name__ == "__main__":
    main()
