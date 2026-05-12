# fetch_live.py
# Datos en vivo. Se ejecuta en el workflow cada 2 min (o lo que pongas).
# Genera data/live_data.json

import json
import os
import time
from datetime import datetime, timezone

import requests
import yfinance as yf
import pandas as pd
import feedparser

OUT_PATH = "data/live_data.json"

# Cripto via CoinGecko API publica (no requiere key, sin bloqueo geo).
CRYPTO_IDS = {
    "BTCUSDT":  "bitcoin",
    "ETHUSDT":  "ethereum",
    "SOLUSDT":  "solana",
    "BNBUSDT":  "binancecoin",
    "XRPUSDT":  "ripple",
    "ADAUSDT":  "cardano",
    "AVAXUSDT": "avalanche-2",
    "DOGEUSDT": "dogecoin",
    "LINKUSDT": "chainlink",
    "DOTUSDT":  "polkadot",
    "MATICUSDT":"matic-network",
    "ATOMUSDT": "cosmos",
}

CRYPTO_YF = {
    "BTCUSDT": "BTC-USD",
    "ETHUSDT": "ETH-USD",
}

# Indices y FX via Yahoo Finance.
YF_TICKERS = {
    "indices": {
        "SP500":   "^GSPC",
        "NDX":     "^NDX",
        "DJI":     "^DJI",
        "RUT":     "^RUT",
        "STOXX":   "^STOXX50E",
        "DAX":     "^GDAXI",
        "FTSE":    "^FTSE",
        "IBEX":    "^IBEX",
        "CAC":     "^FCHI",
        "N225":    "^N225",
        "HSI":     "^HSI",
        "VIX":     "^VIX",
    },
    "commodities": {
        "GOLD":     "GC=F",
        "SILVER":   "SI=F",
        "OIL":      "CL=F",
        "BRENT":    "BZ=F",
        "NATGAS":   "NG=F",
        "COPPER":   "HG=F",
    },
    "forex": {
        "EURUSD":  "EURUSD=X",
        "GBPUSD":  "GBPUSD=X",
        "USDJPY":  "USDJPY=X",
        "USDCHF":  "USDCHF=X",
        "USDCNY":  "USDCNY=X",
        "DXY":     "DX-Y.NYB",
    },
    "bonds": {
        "US10Y":  "^TNX",
        "US2Y":   "^IRX",
        "US30Y":  "^TYX",
    },
}

# RSS de noticias (sin API key).
RSS_FEEDS = [
    ("CoinDesk",     "https://www.coindesk.com/arc/outboundfeeds/rss/"),
    ("Cointelegraph","https://cointelegraph.com/rss"),
    ("Reuters Biz",  "https://feeds.reuters.com/reuters/businessNews"),
    ("CNBC Markets", "https://www.cnbc.com/id/15839069/device/rss/rss.html"),
    ("Yahoo Fin",    "https://finance.yahoo.com/news/rssindex"),
    ("FT Markets",   "https://www.ft.com/markets?format=rss"),
]


def fetch_crypto_24h():
    """Datos 24h de cripto via CoinGecko."""
    out = {}
    ids = ",".join(CRYPTO_IDS.values())
    try:
        url = "https://api.coingecko.com/api/v3/coins/markets"
        params = {
            "vs_currency": "usd",
            "ids": ids,
            "order": "market_cap_desc",
            "sparkline": "false",
            "price_change_percentage": "24h",
        }
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        data = {item["id"]: item for item in r.json()}
        for pair, cg_id in CRYPTO_IDS.items():
            if cg_id in data:
                d = data[cg_id]
                price = float(d.get("current_price", 0))
                change = float(d.get("price_change_24h", 0))
                change_pct = float(d.get("price_change_percentage_24h", 0))
                out[pair] = {
                    "price":      price,
                    "change":     change,
                    "change_pct": change_pct,
                    "high":       float(d.get("high_24h", 0) or 0),
                    "low":        float(d.get("low_24h", 0) or 0),
                    "volume":     float(d.get("total_volume", 0) or 0),
                    "quote_vol":  float(d.get("total_volume", 0) or 0),
                }
    except Exception as e:
        print(f"Error CoinGecko 24h. {e}")
    return out


def fetch_btc_klines(interval="1h", limit=200):
    """Velas de BTC via Yahoo Finance (funciona desde GitHub Actions)."""
    yf_interval = interval
    if interval == "1h":
        period = "30d"
    elif interval == "5m":
        period = "5d"
    else:
        period = "7d"
    try:
        t = yf.Ticker("BTC-USD")
        df = t.history(period=period, interval=yf_interval, auto_adjust=False)
        if df is None or df.empty:
            return []
        df = df.reset_index()
        date_col = "Datetime" if "Datetime" in df.columns else "Date"
        out = []
        for _, row in df.iterrows():
            d = row[date_col]
            if hasattr(d, "timestamp"):
                ts = int(d.timestamp())
            else:
                ts = int(pd.Timestamp(d).timestamp())
            out.append({
                "time":   ts,
                "open":   float(row.get("Open", 0)),
                "high":   float(row.get("High", 0)),
                "low":    float(row.get("Low", 0)),
                "close":  float(row.get("Close", 0)),
                "volume": float(row.get("Volume", 0)),
            })
        return out
    except Exception as e:
        print(f"Error klines BTC. {e}")
        return []


def fetch_yf_batch(symbols):
    """Cotizaciones intradia de Yahoo para varios simbolos. Devuelve dict."""
    out = {}
    if not symbols:
        return out
    try:
        # download es mas rapido que iterar Ticker.
        df = yf.download(
            tickers=" ".join(symbols),
            period="2d",
            interval="1d",
            progress=False,
            auto_adjust=False,
            group_by="ticker",
            threads=True,
        )
        for sym in symbols:
            try:
                if len(symbols) == 1:
                    sub = df
                else:
                    sub = df[sym]
                sub = sub.dropna()
                if len(sub) < 1:
                    out[sym] = None
                    continue
                last = sub.iloc[-1]
                prev = sub.iloc[-2] if len(sub) >= 2 else last
                price = float(last["Close"])
                prev_close = float(prev["Close"])
                change = price - prev_close
                change_pct = (change / prev_close * 100) if prev_close != 0 else 0
                out[sym] = {
                    "price":      price,
                    "prev_close": prev_close,
                    "change":     change,
                    "change_pct": change_pct,
                    "high":       _safe_float(last.get("High")),
                    "low":        _safe_float(last.get("Low")),
                    "volume":     _safe_float(last.get("Volume")),
                }
            except Exception:
                out[sym] = None
    except Exception as e:
        print(f"Error yf batch. {e}")
    return out


def _safe_float(x):
    try:
        v = float(x)
        if v != v:
            return None
        return v
    except Exception:
        return None


def fetch_news(limit_per_feed=10):
    """Agrega noticias de varios RSS."""
    items = []
    for source, url in RSS_FEEDS:
        try:
            feed = feedparser.parse(url)
            for entry in feed.entries[:limit_per_feed]:
                published = entry.get("published", "") or entry.get("updated", "")
                items.append({
                    "source":    source,
                    "title":     entry.get("title", ""),
                    "link":      entry.get("link", ""),
                    "summary":   _clean_summary(entry.get("summary", "")),
                    "published": published,
                })
        except Exception as e:
            print(f"  Error RSS {source}. {e}")
    # Ordenar por fecha si se puede.
    items.sort(key=lambda x: x.get("published", ""), reverse=True)
    return items[:80]


def _clean_summary(s):
    if not s:
        return ""
    import re
    s = re.sub(r"<[^>]+>", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s[:300]


def fetch_fear_greed_now():
    """Fear and Greed actual."""
    try:
        r = requests.get("https://api.alternative.me/fng/?limit=1", timeout=10)
        r.raise_for_status()
        d = r.json().get("data", [])
        if not d:
            return None
        x = d[0]
        return {
            "value": int(x.get("value", 50)),
            "class": x.get("value_classification", ""),
            "ts":    int(x.get("timestamp", 0)),
        }
    except Exception as e:
        print(f"Error FG actual. {e}")
        return None


def fetch_economic_calendar():
    """
    Calendario economico desde Investing via scraping ligero.
    Si falla, devuelve lista vacia y la UI lo trata.
    """
    # Investing requiere headers. Lo intentamos.
    headers = {
        "User-Agent": "Mozilla/5.0 (compatible; TFG-Terminal/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
    }
    out = []
    try:
        url = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
        r = requests.get(url, headers=headers, timeout=15)
        if r.status_code == 200:
            data = r.json()
            for ev in data:
                out.append({
                    "title":    ev.get("title", ""),
                    "country":  ev.get("country", ""),
                    "date":     ev.get("date", ""),
                    "impact":   ev.get("impact", ""),
                    "forecast": ev.get("forecast", ""),
                    "previous": ev.get("previous", ""),
                    "actual":   ev.get("actual", ""),
                })
    except Exception as e:
        print(f"Error calendario. {e}")
    return out


def main():
    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }

    print("CoinGecko 24h...")
    out["crypto"] = fetch_crypto_24h()
    print(f"  {len(out['crypto'])} pares")

    print("BTC klines 1h...")
    out["btc_klines_1h"] = fetch_btc_klines("1h", 200)
    print(f"  {len(out['btc_klines_1h'])} velas")

    print("BTC klines 5m...")
    out["btc_klines_5m"] = fetch_btc_klines("5m", 120)
    print(f"  {len(out['btc_klines_5m'])} velas")

    for category, tickers in YF_TICKERS.items():
        print(f"YF {category}...")
        symbols = list(tickers.values())
        raw = fetch_yf_batch(symbols)
        out[category] = {}
        for code, sym in tickers.items():
            out[category][code] = raw.get(sym)
        time.sleep(0.3)

    print("Fear and Greed...")
    out["fear_greed"] = fetch_fear_greed_now()

    print("Noticias...")
    out["news"] = fetch_news()
    print(f"  {len(out['news'])} titulares")

    print("Calendario economico...")
    out["calendar"] = fetch_economic_calendar()
    print(f"  {len(out['calendar'])} eventos")

    os.makedirs("data", exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"\nGuardado. {OUT_PATH} ({size_kb:.1f} KB)")


if __name__ == "__main__":
    main()
