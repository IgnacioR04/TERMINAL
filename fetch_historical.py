# fetch_historical.py
# Descarga historico macro, cripto y commodities. Una vez al dia.
# Genera data/historical_data.json

import json
import os
import time
from datetime import datetime, timezone

import yfinance as yf
import pandas as pd

OUT_PATH = "data/historical_data.json"

# Lo que queremos. Yahoo Finance tiene casi todo lo macro.
TICKERS = {
    "indices": {
        "SP500":   {"symbol": "^GSPC",  "name": "S&P 500"},
        "NDX":     {"symbol": "^NDX",   "name": "Nasdaq 100"},
        "DJI":     {"symbol": "^DJI",   "name": "Dow Jones"},
        "RUT":     {"symbol": "^RUT",   "name": "Russell 2000"},
        "STOXX":   {"symbol": "^STOXX50E", "name": "Euro Stoxx 50"},
        "DAX":     {"symbol": "^GDAXI", "name": "DAX"},
        "FTSE":    {"symbol": "^FTSE",  "name": "FTSE 100"},
        "IBEX":    {"symbol": "^IBEX",  "name": "IBEX 35"},
        "CAC":     {"symbol": "^FCHI",  "name": "CAC 40"},
        "N225":    {"symbol": "^N225",  "name": "Nikkei 225"},
        "HSI":     {"symbol": "^HSI",   "name": "Hang Seng"},
        "VIX":     {"symbol": "^VIX",   "name": "VIX"},
    },
    "crypto": {
        "BTC":   {"symbol": "BTC-USD",  "name": "Bitcoin"},
        "ETH":   {"symbol": "ETH-USD",  "name": "Ethereum"},
        "SOL":   {"symbol": "SOL-USD",  "name": "Solana"},
        "BNB":   {"symbol": "BNB-USD",  "name": "BNB"},
        "XRP":   {"symbol": "XRP-USD",  "name": "XRP"},
        "ADA":   {"symbol": "ADA-USD",  "name": "Cardano"},
        "AVAX":  {"symbol": "AVAX-USD", "name": "Avalanche"},
        "DOGE":  {"symbol": "DOGE-USD", "name": "Dogecoin"},
        "LINK":  {"symbol": "LINK-USD", "name": "Chainlink"},
        "DOT":   {"symbol": "DOT-USD",  "name": "Polkadot"},
    },
    "commodities": {
        "GOLD":   {"symbol": "GC=F", "name": "Gold"},
        "SILVER": {"symbol": "SI=F", "name": "Silver"},
        "OIL":    {"symbol": "CL=F", "name": "Crude Oil (WTI)"},
        "BRENT":  {"symbol": "BZ=F", "name": "Brent Crude"},
        "NATGAS": {"symbol": "NG=F", "name": "Natural Gas"},
        "COPPER": {"symbol": "HG=F", "name": "Copper"},
        "PLATINUM": {"symbol": "PL=F", "name": "Platinum"},
        "WHEAT":  {"symbol": "ZW=F", "name": "Wheat"},
        "CORN":   {"symbol": "ZC=F", "name": "Corn"},
        "COFFEE": {"symbol": "KC=F", "name": "Coffee"},
    },
    "forex": {
        "EURUSD": {"symbol": "EURUSD=X", "name": "EUR/USD"},
        "GBPUSD": {"symbol": "GBPUSD=X", "name": "GBP/USD"},
        "USDJPY": {"symbol": "USDJPY=X", "name": "USD/JPY"},
        "USDCHF": {"symbol": "USDCHF=X", "name": "USD/CHF"},
        "USDCNY": {"symbol": "USDCNY=X", "name": "USD/CNY"},
        "DXY":    {"symbol": "DX-Y.NYB", "name": "Dollar Index"},
    },
    "bonds": {
        "US10Y":  {"symbol": "^TNX", "name": "US 10Y Yield"},
        "US2Y":   {"symbol": "^IRX", "name": "US 13W T-Bill"},
        "US30Y":  {"symbol": "^TYX", "name": "US 30Y Yield"},
    },
}


def fetch_one(symbol, period="5y", interval="1d"):
    """Descarga historico. Devuelve lista de dicts."""
    try:
        t = yf.Ticker(symbol)
        df = t.history(period=period, interval=interval, auto_adjust=False)
        if df is None or df.empty:
            return []

        df = df.reset_index()
        # La columna de fecha puede llamarse Date o Datetime.
        date_col = "Date" if "Date" in df.columns else "Datetime"

        out = []
        for _, row in df.iterrows():
            d = row[date_col]
            if hasattr(d, "tz_localize"):
                if d.tz is None:
                    d = d.tz_localize("UTC")
                else:
                    d = d.tz_convert("UTC")
            out.append({
                "date":   d.strftime("%Y-%m-%d"),
                "open":   _safe_float(row.get("Open")),
                "high":   _safe_float(row.get("High")),
                "low":    _safe_float(row.get("Low")),
                "close":  _safe_float(row.get("Close")),
                "volume": _safe_float(row.get("Volume")),
            })
        return out
    except Exception as e:
        print(f"  Error con {symbol}. {e}")
        return []


def _safe_float(x):
    try:
        v = float(x)
        if v != v:  # NaN
            return None
        return v
    except Exception:
        return None


def fetch_fear_greed():
    """Fear and Greed historico de alternative.me (cripto)."""
    import requests
    try:
        r = requests.get("https://api.alternative.me/fng/?limit=0", timeout=15)
        r.raise_for_status()
        data = r.json().get("data", [])
        out = []
        for row in data:
            ts = int(row.get("timestamp", 0))
            if ts == 0:
                continue
            out.append({
                "date":  datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%d"),
                "value": int(row.get("value", 50)),
                "class": row.get("value_classification", ""),
            })
        out.sort(key=lambda x: x["date"])
        return out
    except Exception as e:
        print(f"  Error Fear and Greed. {e}")
        return []


def main():
    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "categories": {},
    }

    for category, items in TICKERS.items():
        print(f"\nCategoria. {category}")
        out["categories"][category] = {}
        for code, info in items.items():
            print(f"  {code} ({info['symbol']})...", end=" ", flush=True)
            bars = fetch_one(info["symbol"])
            out["categories"][category][code] = {
                "name":   info["name"],
                "symbol": info["symbol"],
                "bars":   bars,
            }
            print(f"{len(bars)} barras")
            time.sleep(0.2)  # ser amable con la API

    print("\nFear and Greed...")
    out["fear_greed"] = fetch_fear_greed()
    print(f"  {len(out['fear_greed'])} dias")

    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_mb = os.path.getsize(OUT_PATH) / 1024 / 1024
    print(f"\nGuardado. {OUT_PATH} ({size_mb:.2f} MB)")


if __name__ == "__main__":
    main()
