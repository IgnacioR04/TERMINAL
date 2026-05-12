# tfg_signals.py
# Replica exacta de la pipeline horaria del TFG.
# Lee modelos .pkl de models/, descarga datos historicos de BTC/ETH 1h + Fear and Greed,
# construye features causales, aplica HMM, GARCH, deadzone filter, MoE XGBoost, calibradores
# y reglas adaptativas. Genera data/tfg_signals.json
#
# Si falta algun modelo, genera un JSON con status "models_missing" y la UI muestra banner.

import os
import json
import time
import warnings
from datetime import datetime, timezone, timedelta

import numpy as np
import pandas as pd
import requests

warnings.filterwarnings("ignore")

OUT_PATH = "data/tfg_signals.json"
MODELS_DIR = "models"

# Modelos requeridos. Si falta uno, se genera JSON con status models_missing.
REQUIRED_MODELS = [
    "hmm_vol.pkl",
    "hmm_state_map.pkl",
    "garch_params.pkl",
    "deadzone_filter_xgb.pkl",
    "xgb_8_experts.pkl",
    "calibrators.pkl",
    "feature_cols.pkl",
    "adaptive_rules.pkl",
]

# Parametros que coinciden con el TFG.
COST_RT = 0.0012
DEADZONE_THR_RET = 2 * COST_RT
PERIODS_PER_YEAR_HOURLY = 24 * 365
CONF_BOOST = 0.06        # validado en el TFG
SL_RATIO = 999.0         # sin stop loss
MIN_TP_ABS = COST_RT * 1.3
VERSIONS = ["logloss", "error", "brier", "sharpe"]


def write_status(status, message="", extra=None):
    """Escribe un JSON minimo en caso de error o modelos faltantes."""
    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": status,
        "message": message,
    }
    if extra:
        out.update(extra)
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Status. {status}. {message}")


def check_models():
    """Comprueba que todos los .pkl existen."""
    missing = []
    for m in REQUIRED_MODELS:
        p = os.path.join(MODELS_DIR, m)
        if not os.path.exists(p):
            missing.append(m)
    return missing


# ─────────────────────────────────────────────────────────────────────
# Descarga de datos
# ─────────────────────────────────────────────────────────────────────

def fetch_klines_binance(symbol, interval="1h", limit=1000):
    """Velas de Binance. Devuelve DataFrame con datetime UTC index."""
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    r = requests.get(url, params=params, timeout=15)
    r.raise_for_status()
    data = r.json()
    rows = []
    for k in data:
        rows.append({
            "date":   pd.to_datetime(int(k[0]), unit="ms", utc=True),
            "open":   float(k[1]),
            "high":   float(k[2]),
            "low":    float(k[3]),
            "close":  float(k[4]),
            "volume": float(k[5]),
        })
    df = pd.DataFrame(rows).set_index("date").sort_index()
    # La ultima vela esta en curso. La eliminamos para que las features causales sean correctas.
    return df.iloc[:-1]


def fetch_btc_eth_hourly(limit=1000):
    """BTC y ETH 1h alineados. Necesitamos al menos 720 velas (30 dias) para zscore FG."""
    btc = fetch_klines_binance("BTCUSDT", "1h", limit).add_prefix("btc_")
    eth = fetch_klines_binance("ETHUSDT", "1h", limit).add_prefix("eth_")
    return btc.join(eth, how="inner")


def fetch_fear_greed_hourly():
    """
    Fear and Greed de alternative.me. Es diario, lo reindexamos a 1h con ffill.
    """
    r = requests.get("https://api.alternative.me/fng/?limit=0", timeout=15)
    r.raise_for_status()
    data = r.json().get("data", [])
    rows = []
    for item in data:
        ts = int(item.get("timestamp", 0))
        if ts == 0:
            continue
        rows.append({
            "date": pd.to_datetime(ts, unit="s", utc=True),
            "fg":   float(item.get("value", 50)),
        })
    df = pd.DataFrame(rows).set_index("date").sort_index()
    return df


# ─────────────────────────────────────────────────────────────────────
# Feature engineering. Replica build_features() del TFG.
# ─────────────────────────────────────────────────────────────────────

def build_features(d):
    """Features identicas al notebook del TFG."""
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
    """Anade Fear and Greed con sus features derivadas."""
    df = df.copy()
    fg_reidx = fg.reindex(df.index, method="ffill")
    df["fg"] = fg_reidx["fg"]
    df["fg"] = df["fg"].ffill()

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


# ─────────────────────────────────────────────────────────────────────
# HMM. Replica hmm_forward_filter_univariate() del TFG.
# ─────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────
# GARCH. Replica garch_one_step_ahead() del TFG.
# ─────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────
# Inferencia ensemble. Replica ensemble_predict() del TFG.
# ─────────────────────────────────────────────────────────────────────

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


# ─────────────────────────────────────────────────────────────────────
# Deadzone filter
# ─────────────────────────────────────────────────────────────────────

def apply_deadzone_filter(data, dz_filter):
    """Igual que en el TFG."""
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


# ─────────────────────────────────────────────────────────────────────
# Evaluacion de la regla adaptativa para la vela actual.
# Replica la logica de backtest_v4_with_sl pero solo para la ultima fila.
# ─────────────────────────────────────────────────────────────────────

def evaluate_adaptive_rules_on_last(row, prob_by_version, adaptive_rules,
                                    conf_boost=CONF_BOOST, min_tp_abs=MIN_TP_ABS):
    """
    Para la fila actual (la mas reciente con features completas), evalua que reglas
    activan una operacion. Devuelve lista de senales.
    """
    signals = []
    garch_vol = row.get("garch_vol_t1")
    p_dz = row.get("p_deadzone")
    entry = row.get("btc_close")

    for (version, side), rule in adaptive_rules.items():
        if version not in prob_by_version:
            continue
        prob = prob_by_version[version]
        confidence = max(prob, 1 - prob)
        direction = 1 if prob >= 0.5 else -1
        inferred_side = "LONG" if direction == 1 else "SHORT"

        if inferred_side != side:
            continue

        effective_conf = rule["conf_thr"] + conf_boost
        passes_conf = confidence >= effective_conf
        passes_dz = (p_dz is not None) and np.isfinite(p_dz) and (p_dz <= rule["dz_thr"])
        passes_garch = (garch_vol is not None) and np.isfinite(garch_vol)

        operates = bool(passes_conf and passes_dz and passes_garch)

        tp = None
        if passes_garch:
            tp = max(garch_vol * rule["multiplier"], min_tp_abs)

        signals.append({
            "version":         version,
            "side":            side,
            "prob_cal":        float(prob),
            "confidence":      float(confidence),
            "direction":       int(direction),
            "effective_conf":  float(effective_conf),
            "conf_thr_base":   float(rule["conf_thr"]),
            "dz_thr":          float(rule["dz_thr"]),
            "multiplier":      float(rule["multiplier"]),
            "tp_pct":          float(tp) if tp is not None else None,
            "tp_price":        float(entry * (1 + tp)) if (tp is not None and entry and side == "LONG") else (float(entry * (1 - tp)) if (tp is not None and entry and side == "SHORT") else None),
            "passes_conf":     bool(passes_conf),
            "passes_dz":       bool(passes_dz),
            "passes_garch":    bool(passes_garch),
            "operates":        operates,
        })
    return signals


# ─────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────

def main():
    print("TFG signals. Iniciando...")

    missing = check_models()
    if missing:
        write_status("models_missing",
                     f"Faltan modelos en models/. {missing}",
                     extra={"missing": missing})
        return

    # Importar joblib solo si los modelos estan.
    import joblib

    print("Cargando modelos...")
    hmm_vol     = joblib.load(os.path.join(MODELS_DIR, "hmm_vol.pkl"))
    state_map   = joblib.load(os.path.join(MODELS_DIR, "hmm_state_map.pkl"))
    garch_p     = joblib.load(os.path.join(MODELS_DIR, "garch_params.pkl"))
    dz_filter   = joblib.load(os.path.join(MODELS_DIR, "deadzone_filter_xgb.pkl"))
    all_experts = joblib.load(os.path.join(MODELS_DIR, "xgb_8_experts.pkl"))
    calibrators = joblib.load(os.path.join(MODELS_DIR, "calibrators.pkl"))
    feature_cols = joblib.load(os.path.join(MODELS_DIR, "feature_cols.pkl"))
    adaptive_rules_raw = joblib.load(os.path.join(MODELS_DIR, "adaptive_rules.pkl"))

    # adaptive_rules_raw debe ser dict {(version, side). {multiplier, conf_thr, dz_thr}}.
    # Si esta serializado con keys como strings, lo reconvertimos.
    adaptive_rules = {}
    for k, v in adaptive_rules_raw.items():
        if isinstance(k, tuple):
            adaptive_rules[k] = v
        elif isinstance(k, str):
            parts = k.split("__")
            if len(parts) == 2:
                adaptive_rules[(parts[0], parts[1])] = v

    print(f"Reglas adaptativas cargadas. {len(adaptive_rules)}")

    # Inferir parametros GARCH y mapeo de estados.
    omega = float(garch_p["omega"])
    alpha_g = float(garch_p["alpha"])
    beta_g = float(garch_p["beta"])
    mu = float(garch_p.get("mu", 0.0))
    sigma2_init = float(garch_p["sigma2_init"])
    high_state_raw = None
    low_state_raw = None
    for s, label in state_map.items():
        if label == "highvol":
            high_state_raw = int(s)
        elif label == "lowvol":
            low_state_raw = int(s)
    if high_state_raw is None or low_state_raw is None:
        write_status("error", "state_map mal formado")
        return

    print("Descargando BTC y ETH 1h...")
    try:
        df = fetch_btc_eth_hourly(limit=1000)
    except Exception as e:
        write_status("error", f"Error descargando OHLCV. {e}")
        return
    print(f"  {len(df)} velas. {df.index.min()} -> {df.index.max()}")

    print("Descargando Fear and Greed...")
    try:
        fg = fetch_fear_greed_hourly()
    except Exception as e:
        print(f"  Aviso. {e}. Continuo con fg=50.")
        idx = pd.date_range(df.index.min(), df.index.max(), freq="1H", tz="UTC")
        fg = pd.DataFrame({"fg": 50.0}, index=idx)

    print("Construyendo features...")
    df = build_features(df)
    df = add_fg_features(df, fg)

    # HMM forward filter sobre toda la serie.
    print("Aplicando HMM...")
    train_median = df["btc_volreal24"].dropna().median()
    obs_all = df["btc_volreal24"].fillna(train_median)
    probs_raw = hmm_forward_filter_univariate(hmm_vol, obs_all.values)
    df["hmm_p_lowvol"]  = probs_raw[:, low_state_raw]
    df["hmm_p_highvol"] = probs_raw[:, high_state_raw]
    df["hmm_regime_vol"] = np.where(df["hmm_p_highvol"] > df["hmm_p_lowvol"], "highvol", "lowvol")

    # GARCH one-step-ahead.
    print("Aplicando GARCH...")
    ret_scaled = df["btc_logret"].fillna(0.0).values * 100.0
    df["garch_vol_t1"] = garch_one_step_ahead(ret_scaled, omega, alpha_g, beta_g, mu, sigma2_init)

    # Verificar que todas las features existen.
    missing_feats = [c for c in feature_cols if c not in df.columns]
    if missing_feats:
        write_status("error",
                     f"Features faltantes despues de construirlas. {missing_feats}")
        return

    # Filtrar a filas con features completas.
    df_clean = df.dropna(subset=feature_cols).copy()
    df_clean = df_clean.replace([np.inf, -np.inf], np.nan).dropna(subset=feature_cols)
    if len(df_clean) == 0:
        write_status("error", "No hay filas con todas las features completas")
        return

    print("Aplicando deadzone filter...")
    df_clean = apply_deadzone_filter(df_clean, dz_filter)

    print("Generando predicciones de los 4 expertos calibrados...")
    prob_by_version_last = {}
    history_predictions = {}
    for version in VERSIONS:
        prob_raw, prob_cal = predict_calibrated(df_clean, version, all_experts, calibrators, feature_cols)
        prob_by_version_last[version] = float(prob_cal[-1])
        history_predictions[version] = {
            "prob_raw": prob_raw[-200:].tolist(),
            "prob_cal": prob_cal[-200:].tolist(),
        }

    # Fila actual. Es la ultima vela completa, su prediccion es para la vela siguiente (proxima hora).
    last_row = df_clean.iloc[-1]
    last_time = df_clean.index[-1]
    # La prediccion es para entry t+1h.
    target_time = last_time + pd.Timedelta(hours=1)

    print("Evaluando reglas adaptativas para la vela actual...")
    signals = evaluate_adaptive_rules_on_last(last_row, prob_by_version_last, adaptive_rules)

    # Senal activa (alguna que opere).
    active = [s for s in signals if s["operates"]]
    has_active = len(active) > 0

    # Ranking del top-3 por confianza incluso si no operan.
    signals_sorted = sorted(signals, key=lambda s: s["confidence"], reverse=True)

    # Historico de probabilidades para grafico (ultimas 200 velas).
    history_idx = df_clean.index[-200:].strftime("%Y-%m-%dT%H:%M:%SZ").tolist()
    history_price = df_clean["btc_close"].iloc[-200:].astype(float).tolist()
    history_garch = df_clean["garch_vol_t1"].iloc[-200:].astype(float).tolist()
    history_hmm_p_high = df_clean["hmm_p_highvol"].iloc[-200:].astype(float).tolist()
    history_p_dz = df_clean["p_deadzone"].iloc[-200:].astype(float).tolist()

    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "ok",
        "current_candle": {
            "time": last_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "close": float(last_row["btc_close"]),
            "high":  float(last_row["btc_high"]),
            "low":   float(last_row["btc_low"]),
            "volume": float(last_row["btc_volume"]),
        },
        "target_time": target_time.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "regime": {
            "label":      str(last_row["hmm_regime_vol"]),
            "p_lowvol":   float(last_row["hmm_p_lowvol"]),
            "p_highvol":  float(last_row["hmm_p_highvol"]),
        },
        "garch_vol_t1": float(last_row["garch_vol_t1"]),
        "p_deadzone":   float(last_row["p_deadzone"]) if pd.notna(last_row["p_deadzone"]) else None,
        "p_tradeable":  float(last_row["p_tradeable"]) if pd.notna(last_row["p_tradeable"]) else None,
        "predictions": {
            v: {
                "prob_cal": prob_by_version_last[v],
                "confidence": float(max(prob_by_version_last[v], 1 - prob_by_version_last[v])),
                "direction": "LONG" if prob_by_version_last[v] >= 0.5 else "SHORT",
            }
            for v in VERSIONS
        },
        "signals": signals_sorted,
        "active_signals": active,
        "has_active_signal": has_active,
        "config": {
            "cost_rt": COST_RT,
            "conf_boost": CONF_BOOST,
            "deadzone_thr_ret": DEADZONE_THR_RET,
            "min_tp_abs": MIN_TP_ABS,
            "sl_ratio": SL_RATIO,
        },
        "history": {
            "time":         history_idx,
            "btc_close":    history_price,
            "garch_vol_t1": history_garch,
            "hmm_p_highvol": history_hmm_p_high,
            "p_deadzone":   history_p_dz,
            "predictions":  history_predictions,
        },
        "feature_count": len(feature_cols),
    }

    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\nGuardado. {OUT_PATH} ({size_kb:.1f} KB)")
    print(f"Senales activas. {len(active)}")
    for s in active:
        print(f"  {s['version']}/{s['side']}. conf={s['confidence']:.3f}, tp={s['tp_pct']*100:.3f}%")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        write_status("error", f"Excepcion no controlada. {e}")
