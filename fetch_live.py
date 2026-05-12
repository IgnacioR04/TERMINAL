# fetch_live.py
# Datos en vivo. Se ejecuta en el workflow cada 2 min (o lo que pongas).
# Genera data/live_data.json

import json
import os
import time
from datetime import datetime, timezone

import requests
import yfinance as yf
import feedparser

OUT_PATH = "data/live_data.json"

# Cripto via Binance API publica. Es gratis y muy rapida.
CRYPTO_PAIRS = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT",
    "XRPUSDT", "ADAUSDT", "AVAXUSDT", "DOGEUSDT",
    "LINKUSDT", "DOTUSDT", "MATICUSDT", "ATOMUSDT",
]

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


def fetch_binance_24h():
    """Datos 24h de Binance para todos los pares."""
    out = {}
    try:
        r = requests.get("https://api.binance.com/api/v3/ticker/24hr", timeout=15)
        r.raise_for_status()
        all_data = {item["symbol"]: item for item in r.json()}
        for pair in CRYPTO_PAIRS:
            if pair in all_data:
                d = all_data[pair]
                out[pair] = {
                    "price":     float(d["lastPrice"]),
                    "change":    float(d["priceChange"]),
                    "change_pct": float(d["priceChangePercent"]),
                    "high":      float(d["highPrice"]),
                    "low":       float(d["lowPrice"]),
                    "volume":    float(d["volume"]),
                    "quote_vol": float(d["quoteVolume"]),
                }
    except Exception as e:
        print(f"Error Binance 24h. {e}")
    return out


def fetch_btc_klines(interval="1h", limit=200):
    """Velas de BTC para grafico. limit max 1000."""
    try:
        url = "https://api.binance.com/api/v3/klines"
        params = {"symbol": "BTCUSDT", "interval": interval, "limit": limit}
        r = requests.get(url, params=params, timeout=15)
        r.raise_for_status()
        out = []
        for k in r.json():
            out.append({
                "time":   int(k[0]) // 1000,
                "open":   float(k[1]),
                "high":   float(k[2]),
                "low":    float(k[3]),
                "close":  float(k[4]),
                "volume": float(k[5]),
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

    print("Binance 24h...")
    out["crypto"] = fetch_binance_24h()
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
