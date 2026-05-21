# paper_trader.py
# Paper Trading en vivo para BTC/USDT.
# Corre en GitHub Actions cada 10 min. Usa el mismo pipeline que tfg_signals.py
# pero solo evalua la version "sharpe" LONG con TP/SL fijos por bin GARCH.
#
# Parametros validados en TFG (no modificar):
#   CONF_THR  = 0.60
#   DZ_THR    = 0.38
#   GARCH_CAP = p80
#   COST_RT   = 0.0012
#   VERSION   = "sharpe"
#   SIDE      = "LONG"
#
# Reglas:
#   moderada:   p40 <= garch < p50  -> TP=0.003, SL=0.0015
#   media_alta: p60 <= garch < p70  -> TP=0.004, SL=0.002
#
# Archivos de entrada (persistencia):
#   data/paper_state.json  -> estado entre ejecuciones (posicion abierta, capital, trades)
#   models/tp_sl_rules.json -> reglas TP/SL y percentiles GARCH
#
# Archivos de salida:
#   data/paper_trading.json -> datos para la UI (capital, posicion, trades, equity, senales)
#   data/paper_state.json   -> se actualiza en cada ejecucion

import os
import json
import time
import warnings
from datetime import datetime, timezone, timedelta
from copy import deepcopy

import numpy as np
import pandas as pd
import requests

warnings.filterwarnings("ignore")

# ─── Constantes TFG (no modificar) ───────────────────────────────────────────
CONF_THR     = 0.60
DZ_THR       = 0.38
COST_RT      = 0.0012
VERSION      = "sharpe"
SIDE         = "LONG"
MAX_TRADE_H  = 48      # cierre forzado si el trade dura mas de 48h sin TP/SL
START_CAP    = 1000.0  # capital inicial del paper trader

# ─── Paths ────────────────────────────────────────────────────────────────────
MODELS_DIR   = "models"
STATE_PATH   = "data/paper_state.json"
OUT_PATH     = "data/paper_trading.json"
RULES_PATH   = "models/tp_sl_rules.json"

REQUIRED_MODELS = [
    "hmm_vol.pkl", "hmm_state_map.pkl", "garch_params.pkl",
    "deadzone_filter_xgb.pkl", "xgb_8_experts.pkl", "calibrators.pkl",
    "feature_cols.pkl", "adaptive_rules.pkl",
]

# ─── Utilidades de escritura ──────────────────────────────────────────────────

def utcnow_str():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def write_out(data):
    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))


def write_error(message, status="error"):
    write_out({"status": status, "message": message, "updated_at": utcnow_str()})
    print(f"[paper_trader] {status}: {message}")


# ─── Estado persistido ────────────────────────────────────────────────────────

def load_state():
    if os.path.exists(STATE_PATH):
        try:
            with open(STATE_PATH, encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"[paper_trader] Aviso: no se pudo leer {STATE_PATH}: {e}")
    return {
        "capital": START_CAP,
        "position": None,
        "trades": [],
        "last_candle_time": None,
        "start_capital": START_CAP,
        "created_at": utcnow_str(),
    }


def save_state(state):
    os.makedirs("data", exist_ok=True)
    state["updated_at"] = utcnow_str()
    with open(STATE_PATH, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, separators=(",", ":"))


# ─── Reglas TP/SL ────────────────────────────────────────────────────────────

def load_rules():
    with open(RULES_PATH, encoding="utf-8") as f:
        return json.load(f)


def classify_garch(garch_vol, pcts, rules_list):
    """
    Devuelve la regla que aplica para este valor de garch_vol, o None si no hay.
    pcts: dict con p40, p50, p60, p70, p80
    """
    if garch_vol is None or not np.isfinite(garch_vol):
        return None
    if garch_vol >= pcts.get("p80", 9999):
        return None  # excede cap maximo
    for rule in rules_list:
        lo_key, hi_key = rule["garch_range"]
        lo = pcts.get(lo_key, 0)
        hi = pcts.get(hi_key, 9999)
        if lo <= garch_vol < hi:
            return rule
    return None


# ─── Pipeline TFG (funciones identicas a tfg_signals.py) ─────────────────────

def load_csv_ohlcv(csv_path, limit=5000):
    df = pd.read_csv(csv_path)
    date_col = "datetime_utc" if "datetime_utc" in df.columns else df.columns[0]
    df["date"] = pd.to_datetime(df[date_col], utc=True)
    df = df.set_index("date").sort_index()
    df = df.rename(columns={"open":"open","high":"high","low":"low","close":"close","volume":"volume"})
    df = df[["open","high","low","close","volume"]].astype(float)
    df = df.iloc[-(limit + 1):-1]
    return df


def fetch_btc_eth_hourly(limit=1000):
    btc = load_csv_ohlcv("data/btc_1h.csv", limit).add_prefix("btc_")
    eth = load_csv_ohlcv("data/eth_1h.csv", limit).add_prefix("eth_")
    return btc.join(eth, how="inner")


def fetch_fear_greed_hourly():
    fg_path = "data/fg_1h.csv"
    if os.path.exists(fg_path):
        df = pd.read_csv(fg_path, index_col=0, parse_dates=True)
        if df.index.tz is None:
            df.index = df.index.tz_localize("UTC")
        if "fg" in df.columns:
            return df[["fg"]]
    r = requests.get("https://api.alternative.me/fng/?limit=0", timeout=15)
    r.raise_for_status()
    data = r.json().get("data", [])
    rows = []
    for item in data:
        ts = int(item.get("timestamp", 0))
        if ts == 0:
            continue
        rows.append({"date": pd.to_datetime(ts, unit="s", utc=True), "fg": float(item.get("value", 50))})
    df = pd.DataFrame(rows).set_index("date").sort_index()
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


# ─── Logica de paper trading ──────────────────────────────────────────────────

def compute_stats(trades, start_capital):
    """Calcula metricas resumidas de la lista de trades."""
    if not trades:
        return {
            "n_trades": 0, "n_wins": 0, "n_losses": 0,
            "win_rate": None, "total_return_pct": 0.0,
            "start_capital": start_capital, "sharpe": None,
            "max_drawdown_pct": 0.0,
        }
    pnls = [t["pnl_pct"] for t in trades]
    n = len(pnls)
    n_wins = sum(1 for p in pnls if p > 0)
    n_losses = n - n_wins
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
    # Sharpe anualizado (asumiendo velas horarias, ~8760/año)
    if n > 1:
        arr = np.array(pnls)
        sharpe = float(arr.mean() / arr.std() * np.sqrt(8760)) if arr.std() > 0 else None
    else:
        sharpe = None
    return {
        "n_trades": n,
        "n_wins": n_wins,
        "n_losses": n_losses,
        "win_rate": round(wr, 4) if wr is not None else None,
        "total_return_pct": round(total_ret, 4),
        "start_capital": start_capital,
        "end_capital": round(start_capital * cumret, 4),
        "sharpe": round(sharpe, 2) if sharpe is not None else None,
        "max_drawdown_pct": round(max_dd * 100, 4),
    }


def build_equity_curve(trades, start_capital):
    """Curva de equity desde los trades cerrados."""
    curve = [{"time": None, "value": round(start_capital, 4)}]
    cap = start_capital
    for t in trades:
        cap = t.get("capital_after", cap)
        curve.append({
            "time": t.get("close_time"),
            "value": round(cap, 4),
        })
    return curve


def check_and_close_position(state, current_candle):
    """
    Comprueba si el trade abierto ha alcanzado TP, SL o ha expirado.
    Modifica state en el sitio. Devuelve True si se cerro alguna posicion.
    """
    pos = state.get("position")
    if pos is None:
        return False

    entry_price = pos["entry_price"]
    tp_price = pos["tp_price"]
    sl_price = pos["sl_price"]
    entry_time_str = pos["entry_time"]
    rule = pos["rule"]
    tp_pct = pos["tp_pct"]
    sl_pct = pos["sl_pct"]
    capital_at_entry = pos["capital_at_entry"]

    close_price = current_candle["close"]
    high_price = current_candle.get("high", close_price)
    low_price = current_candle.get("low", close_price)
    candle_time_str = current_candle["time"]

    entry_dt = datetime.fromisoformat(entry_time_str.replace("Z", "+00:00"))
    candle_dt = datetime.fromisoformat(candle_time_str.replace("Z", "+00:00"))
    hours_open = (candle_dt - entry_dt).total_seconds() / 3600

    result = None
    exit_price = close_price

    # SL tiene prioridad sobre TP (peor caso)
    if low_price <= sl_price:
        result = "LOSS"
        exit_price = sl_price
        net_pnl_pct = -sl_pct - COST_RT
    elif high_price >= tp_price:
        result = "WIN"
        exit_price = tp_price
        net_pnl_pct = tp_pct - COST_RT
    elif hours_open >= MAX_TRADE_H:
        result = "TIMEOUT"
        exit_price = close_price
        net_pnl_pct = (close_price / entry_price - 1) - COST_RT

    if result is None:
        return False

    # Cerrar trade
    capital_after = round(capital_at_entry * (1 + net_pnl_pct), 4)
    trade_record = {
        "trade_id": pos.get("trade_id", len(state["trades"]) + 1),
        "open_time": entry_time_str,
        "close_time": candle_time_str,
        "entry_price": round(entry_price, 2),
        "exit_price": round(exit_price, 2),
        "side": SIDE,
        "rule": rule,
        "tp_pct": tp_pct,
        "sl_pct": sl_pct,
        "result": result,
        "pnl_pct": round(net_pnl_pct, 6),
        "capital_before": round(capital_at_entry, 4),
        "capital_after": capital_after,
        "duration_h": round(hours_open, 1),
    }

    state["trades"].append(trade_record)
    state["capital"] = capital_after
    state["position"] = None

    pnl_fmt = f"{'+' if net_pnl_pct >= 0 else ''}{net_pnl_pct * 100:.3f}%"
    print(f"[paper_trader] Trade cerrado: {result} {pnl_fmt} | capital={capital_after:.2f}")
    return True


def try_open_position(state, last_row, current_candle, rules_cfg, candle_time_str):
    """
    Intenta abrir una posicion si la senal es valida.
    """
    if state.get("position") is not None:
        return None

    # Verificar que el candle ha cambiado (no abrir dos veces en la misma vela)
    if state.get("last_candle_time") == candle_time_str:
        print(f"[paper_trader] Ya procesado el candle {candle_time_str}")
        return None

    prob_cal = float(last_row.get("prob_sharpe", 0.5))
    confidence = max(prob_cal, 1 - prob_cal)
    direction = "LONG" if prob_cal >= 0.5 else "SHORT"
    p_dz = float(last_row.get("p_deadzone", 1.0)) if pd.notna(last_row.get("p_deadzone")) else 1.0
    garch_vol = float(last_row.get("garch_vol_t1", 0)) if pd.notna(last_row.get("garch_vol_t1")) else 0

    # Filtros
    if direction != SIDE:
        print(f"[paper_trader] Senal SHORT ignorada (solo LONG)")
        return {"eligible": False, "reason": f"Direccion {direction} (solo LONG)", "prob_cal": prob_cal, "confidence": confidence, "p_deadzone": p_dz, "garch_vol": garch_vol}

    if confidence < CONF_THR:
        print(f"[paper_trader] Confianza {confidence:.3f} < {CONF_THR}")
        return {"eligible": False, "reason": f"Confianza {confidence*100:.1f}% < {CONF_THR*100:.0f}%", "prob_cal": prob_cal, "confidence": confidence, "p_deadzone": p_dz, "garch_vol": garch_vol}

    if p_dz > DZ_THR:
        print(f"[paper_trader] P(deadzone) {p_dz:.3f} > {DZ_THR}")
        return {"eligible": False, "reason": f"P(deadzone) {p_dz*100:.1f}% > {DZ_THR*100:.0f}%", "prob_cal": prob_cal, "confidence": confidence, "p_deadzone": p_dz, "garch_vol": garch_vol}

    pcts = rules_cfg["garch_percentiles"]
    rules_list = rules_cfg["rules"]
    rule = classify_garch(garch_vol, pcts, rules_list)

    if rule is None:
        print(f"[paper_trader] GARCH {garch_vol:.5f} fuera de rango de reglas")
        return {"eligible": False, "reason": f"GARCH {garch_vol:.5f} sin regla activa", "prob_cal": prob_cal, "confidence": confidence, "p_deadzone": p_dz, "garch_vol": garch_vol}

    # Abrir posicion
    entry_price = float(current_candle["close"])
    tp_price = entry_price * (1 + rule["tp"])
    sl_price = entry_price * (1 - rule["sl"])
    trade_id = len(state["trades"]) + 1

    state["position"] = {
        "trade_id": trade_id,
        "side": SIDE,
        "entry_price": round(entry_price, 2),
        "entry_time": candle_time_str,
        "tp_price": round(tp_price, 2),
        "sl_price": round(sl_price, 2),
        "tp_pct": rule["tp"],
        "sl_pct": rule["sl"],
        "rule": rule["name"],
        "capital_at_entry": round(state["capital"], 4),
    }

    print(f"[paper_trader] Trade abierto: #{trade_id} LONG @ {entry_price:.2f} | "
          f"TP={tp_price:.2f} SL={sl_price:.2f} | regla={rule['name']}")

    return {
        "eligible": True, "reason": None,
        "prob_cal": prob_cal, "confidence": confidence,
        "p_deadzone": p_dz, "garch_vol": garch_vol,
        "rule": rule["name"], "tp": rule["tp"], "sl": rule["sl"],
    }


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("[paper_trader] Iniciando...")

    # 1. Verificar modelos
    missing = [m for m in REQUIRED_MODELS if not os.path.exists(os.path.join(MODELS_DIR, m))]
    if missing:
        write_error(f"Modelos faltantes: {missing}", status="models_missing")
        return

    if not os.path.exists(RULES_PATH):
        write_error(f"No se encuentra {RULES_PATH}")
        return

    import joblib
    rules_cfg = load_rules()

    print("[paper_trader] Cargando modelos...")
    hmm_vol      = joblib.load(os.path.join(MODELS_DIR, "hmm_vol.pkl"))
    state_map    = joblib.load(os.path.join(MODELS_DIR, "hmm_state_map.pkl"))
    garch_p      = joblib.load(os.path.join(MODELS_DIR, "garch_params.pkl"))
    dz_filter    = joblib.load(os.path.join(MODELS_DIR, "deadzone_filter_xgb.pkl"))
    all_experts  = joblib.load(os.path.join(MODELS_DIR, "xgb_8_experts.pkl"))
    calibrators  = joblib.load(os.path.join(MODELS_DIR, "calibrators.pkl"))
    feature_cols = joblib.load(os.path.join(MODELS_DIR, "feature_cols.pkl"))

    # Resolver estado HMM
    high_state_raw = low_state_raw = None
    for s, label in state_map.items():
        if label == "highvol":
            high_state_raw = int(s)
        elif label == "lowvol":
            low_state_raw = int(s)
    if high_state_raw is None or low_state_raw is None:
        write_error("state_map mal formado"); return

    omega      = float(garch_p["omega"])
    alpha_g    = float(garch_p["alpha"])
    beta_g     = float(garch_p["beta"])
    mu         = float(garch_p.get("mu", 0.0))
    sigma2_init = float(garch_p["sigma2_init"])

    # 2. Descargar datos
    print("[paper_trader] Cargando CSV horarios...")
    try:
        df = fetch_btc_eth_hourly(limit=1000)
    except Exception as e:
        write_error(f"Error cargando OHLCV: {e}"); return
    print(f"  {len(df)} velas | {df.index.min()} → {df.index.max()}")

    try:
        fg = fetch_fear_greed_hourly()
    except Exception as e:
        print(f"  FearGreed fallback: {e}")
        idx = pd.date_range(df.index.min(), df.index.max(), freq="1H", tz="UTC")
        fg = pd.DataFrame({"fg": 50.0}, index=idx)

    # 3. Features + HMM + GARCH
    print("[paper_trader] Construyendo features...")
    df = build_features(df)
    df = add_fg_features(df, fg)

    train_median = df["btc_volreal24"].dropna().median()
    obs_all = df["btc_volreal24"].fillna(train_median)
    probs_raw = hmm_forward_filter_univariate(hmm_vol, obs_all.values)
    df["hmm_p_lowvol"]  = probs_raw[:, low_state_raw]
    df["hmm_p_highvol"] = probs_raw[:, high_state_raw]
    df["hmm_regime_vol"] = np.where(df["hmm_p_highvol"] > df["hmm_p_lowvol"], "highvol", "lowvol")

    ret_scaled = df["btc_logret"].fillna(0.0).values * 100.0
    df["garch_vol_t1"] = garch_one_step_ahead(ret_scaled, omega, alpha_g, beta_g, mu, sigma2_init)

    # 4. Deadzone + prediccion sharpe
    missing_feats = [c for c in feature_cols if c not in df.columns]
    if missing_feats:
        write_error(f"Features faltantes: {missing_feats}"); return

    df_clean = df.dropna(subset=feature_cols).copy()
    df_clean = df_clean.replace([np.inf, -np.inf], np.nan).dropna(subset=feature_cols)
    if len(df_clean) == 0:
        write_error("Sin filas con features completas"); return

    print("[paper_trader] Deadzone + prediccion sharpe...")
    df_clean = apply_deadzone_filter(df_clean, dz_filter)
    _, prob_cal = predict_calibrated(df_clean, VERSION, all_experts, calibrators, feature_cols)
    df_clean["prob_sharpe"] = prob_cal

    last_row = df_clean.iloc[-1]
    last_time_str = df_clean.index[-1].strftime("%Y-%m-%dT%H:%M:%SZ")

    current_candle = {
        "time":   last_time_str,
        "close":  float(last_row["btc_close"]),
        "high":   float(last_row["btc_high"]),
        "low":    float(last_row["btc_low"]),
        "volume": float(last_row["btc_volume"]),
    }

    # 5. Cargar estado y aplicar logica paper trading
    state = load_state()

    # 5a. Verificar si el trade abierto ha alcanzado TP/SL/expiry
    closed_now = check_and_close_position(state, current_candle)

    # 5b. Intentar abrir nuevo trade (solo si no hay posicion y vela nueva)
    signal_info = try_open_position(state, last_row, current_candle, rules_cfg, last_time_str)

    # Actualizar ultimo candle procesado
    state["last_candle_time"] = last_time_str

    # 6. Guardar estado
    save_state(state)

    # 7. Construir JSON de salida
    stats = compute_stats(state["trades"], state["start_capital"])
    equity_curve = build_equity_curve(state["trades"], state["start_capital"])

    # P&L de la posicion actual (si existe)
    open_pos = state.get("position")
    if open_pos:
        current_price = current_candle["close"]
        entry_p = open_pos["entry_price"]
        unrealized_pct = (current_price / entry_p - 1) - COST_RT / 2
        open_pos = dict(open_pos)
        open_pos["current_price"] = round(current_price, 2)
        open_pos["unrealized_pct"] = round(unrealized_pct * 100, 3)

    # Pipeline metrics para la UI
    pipeline_info = {
        "regime_label":    str(last_row["hmm_regime_vol"]),
        "p_lowvol":        round(float(last_row["hmm_p_lowvol"]), 4),
        "p_highvol":       round(float(last_row["hmm_p_highvol"]), 4),
        "garch_vol_t1":    round(float(last_row["garch_vol_t1"]), 6),
        "p_deadzone":      round(float(last_row["p_deadzone"]), 4) if pd.notna(last_row["p_deadzone"]) else None,
        "prob_sharpe":     round(float(last_row["prob_sharpe"]), 4),
    }

    out = {
        "status":         "ok",
        "updated_at":     utcnow_str(),
        "capital":        round(state["capital"], 4),
        "start_capital":  state["start_capital"],
        "position":       open_pos,
        "trades":         state["trades"][-100:],  # ultimos 100 trades en JSON
        "equity_curve":   equity_curve,
        "stats":          stats,
        "current_signal": signal_info,
        "current_candle": current_candle,
        "pipeline":       pipeline_info,
        "config": {
            "version":    VERSION,
            "direction":  SIDE,
            "conf_thr":   CONF_THR,
            "dz_thr":     DZ_THR,
            "cost_rt":    COST_RT,
            "max_trade_h": MAX_TRADE_H,
        },
    }

    write_out(out)
    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"[paper_trader] Guardado {OUT_PATH} ({size_kb:.1f} KB)")
    print(f"  Capital: {state['capital']:.2f} | Trades: {stats['n_trades']} | WR: {stats.get('win_rate', 0)*100 if stats.get('win_rate') else 0:.1f}%")
    if open_pos:
        print(f"  Posicion abierta: LONG @ {open_pos['entry_price']} | TP={open_pos['tp_price']} SL={open_pos['sl_price']}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        traceback.print_exc()
        write_error(f"Excepcion no controlada: {e}")
