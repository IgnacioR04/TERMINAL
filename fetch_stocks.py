# fetch_stocks.py
# Diario. Descarga datos de 150 acciones.
# Genera data/stocks_list.json (indice ligero) y data/stocks_detail/{ticker}.json (uno por accion)

import json
import os
import time
from datetime import datetime, timezone

import yfinance as yf
import pandas as pd

TICKERS_PATH = "tickers.json"
LIST_OUT = "data/stocks_list.json"
DETAIL_DIR = "data/stocks_detail"


def _safe_float(x):
    try:
        v = float(x)
        if v != v:
            return None
        return v
    except Exception:
        return None


def _safe_int(x):
    try:
        return int(x)
    except Exception:
        return None


def fetch_one_ticker(ticker, name, sector, region):
    """
    Descarga datos completos de una accion.
    Devuelve dict con info ligera (para stocks_list) y dict con detalle (para stocks_detail).
    Si falla, devuelve None y la accion se omite.
    """
    try:
        t = yf.Ticker(ticker)

        # Historico diario (5 anos).
        hist = t.history(period="5y", interval="1d", auto_adjust=False)
        if hist is None or hist.empty:
            print(f"    Sin datos historicos.")
            return None, None

        hist = hist.reset_index()
        date_col = "Date" if "Date" in hist.columns else "Datetime"

        bars_daily = []
        for _, row in hist.iterrows():
            d = row[date_col]
            if hasattr(d, "tz_localize"):
                if d.tz is None:
                    d = d.tz_localize("UTC")
                else:
                    d = d.tz_convert("UTC")
            bars_daily.append({
                "date":   d.strftime("%Y-%m-%d"),
                "open":   _safe_float(row.get("Open")),
                "high":   _safe_float(row.get("High")),
                "low":    _safe_float(row.get("Low")),
                "close":  _safe_float(row.get("Close")),
                "volume": _safe_float(row.get("Volume")),
            })

        # Intradia 5m de los ultimos 5 dias.
        bars_intraday = []
        try:
            intra = t.history(period="5d", interval="5m", auto_adjust=False)
            if intra is not None and not intra.empty:
                intra = intra.reset_index()
                dcol = "Datetime" if "Datetime" in intra.columns else "Date"
                for _, row in intra.iterrows():
                    d = row[dcol]
                    if hasattr(d, "tz_localize"):
                        if d.tz is None:
                            d = d.tz_localize("UTC")
                        else:
                            d = d.tz_convert("UTC")
                    bars_intraday.append({
                        "time":  int(d.timestamp()),
                        "open":  _safe_float(row.get("Open")),
                        "high":  _safe_float(row.get("High")),
                        "low":   _safe_float(row.get("Low")),
                        "close": _safe_float(row.get("Close")),
                        "volume": _safe_float(row.get("Volume")),
                    })
        except Exception as e:
            print(f"    Intradia falla. {e}")

        # Ultimo cierre, cambio diario.
        last = bars_daily[-1] if bars_daily else None
        prev = bars_daily[-2] if len(bars_daily) >= 2 else None
        price = last["close"] if last else None
        prev_close = prev["close"] if prev else None
        change_pct = None
        if price is not None and prev_close not in (None, 0):
            change_pct = (price - prev_close) / prev_close * 100

        # Info corporativa.
        info = {}
        try:
            info = t.info or {}
        except Exception:
            info = {}

        market_cap = _safe_float(info.get("marketCap"))
        currency = info.get("currency", "USD")
        pe_ratio = _safe_float(info.get("trailingPE"))
        eps = _safe_float(info.get("trailingEps"))
        dividend_yield = _safe_float(info.get("dividendYield"))
        beta = _safe_float(info.get("beta"))
        fifty_two_high = _safe_float(info.get("fiftyTwoWeekHigh"))
        fifty_two_low = _safe_float(info.get("fiftyTwoWeekLow"))

        # Dividendos historicos.
        dividends = []
        try:
            divs = t.dividends
            if divs is not None and len(divs) > 0:
                cutoff = pd.Timestamp.now(tz="UTC") - pd.Timedelta(days=730)
                divs = divs[divs.index >= cutoff]
                for date, val in divs.items():
                    if hasattr(date, "tz_localize"):
                        if date.tz is None:
                            date = date.tz_localize("UTC")
                        else:
                            date = date.tz_convert("UTC")
                    dividends.append({
                        "date": date.strftime("%Y-%m-%d"),
                        "amount": _safe_float(val),
                    })
        except Exception:
            pass

        # Splits historicos.
        splits = []
        try:
            sp = t.splits
            if sp is not None and len(sp) > 0:
                for date, val in sp.items():
                    if hasattr(date, "tz_localize"):
                        if date.tz is None:
                            date = date.tz_localize("UTC")
                        else:
                            date = date.tz_convert("UTC")
                    splits.append({
                        "date":  date.strftime("%Y-%m-%d"),
                        "ratio": _safe_float(val),
                    })
        except Exception:
            pass

        # Proximos earnings desde calendar.
        next_earnings = None
        try:
            cal = t.calendar
            if cal is not None:
                if isinstance(cal, pd.DataFrame) and not cal.empty:
                    if "Earnings Date" in cal.index:
                        v = cal.loc["Earnings Date"]
                        if hasattr(v, "iloc"):
                            v = v.iloc[0]
                        if isinstance(v, (pd.Timestamp, datetime)):
                            next_earnings = v.strftime("%Y-%m-%d")
                elif isinstance(cal, dict):
                    ed = cal.get("Earnings Date")
                    if ed:
                        if isinstance(ed, list) and ed:
                            v = ed[0]
                        else:
                            v = ed
                        if isinstance(v, (pd.Timestamp, datetime)):
                            next_earnings = v.strftime("%Y-%m-%d")
        except Exception:
            pass

        light = {
            "ticker":      ticker,
            "name":        name,
            "sector":      sector,
            "region":      region,
            "price":       price,
            "change_pct":  change_pct,
            "market_cap":  market_cap,
            "currency":    currency,
            "pe_ratio":    pe_ratio,
            "dividend_yield": dividend_yield,
        }

        detail = {
            "ticker":      ticker,
            "name":        name,
            "sector":      sector,
            "region":      region,
            "currency":    currency,
            "price":       price,
            "change_pct":  change_pct,
            "market_cap":  market_cap,
            "pe_ratio":    pe_ratio,
            "eps":         eps,
            "dividend_yield": dividend_yield,
            "beta":        beta,
            "fifty_two_week_high": fifty_two_high,
            "fifty_two_week_low":  fifty_two_low,
            "long_name":   info.get("longName", name),
            "industry":    info.get("industry", ""),
            "country":     info.get("country", ""),
            "website":     info.get("website", ""),
            "description": (info.get("longBusinessSummary") or "")[:1500],
            "employees":   _safe_int(info.get("fullTimeEmployees")),
            "bars_daily":  bars_daily,
            "bars_intraday": bars_intraday,
            "dividends":   dividends,
            "splits":      splits,
            "next_earnings": next_earnings,
        }

        return light, detail
    except Exception as e:
        print(f"    Excepcion. {e}")
        return None, None


def main():
    with open(TICKERS_PATH, "r", encoding="utf-8") as f:
        tickers_by_region = json.load(f)

    os.makedirs(DETAIL_DIR, exist_ok=True)

    list_out = []
    total = sum(len(v) for v in tickers_by_region.values())
    print(f"Total tickers a descargar. {total}")

    counter = 0
    for region, items in tickers_by_region.items():
        for entry in items:
            counter += 1
            ticker = entry["ticker"]
            name = entry["name"]
            sector = entry.get("sector", "")
            print(f"[{counter}/{total}] {ticker} ({name})")

            light, detail = fetch_one_ticker(ticker, name, sector, region)
            if light is None:
                continue

            list_out.append(light)

            # Guardar el detalle.
            safe_name = ticker.replace("/", "_").replace(".", "_").replace("^", "_")
            detail_path = os.path.join(DETAIL_DIR, f"{safe_name}.json")
            with open(detail_path, "w", encoding="utf-8") as f:
                json.dump(detail, f, ensure_ascii=False, separators=(",", ":"))

            time.sleep(0.2)

    # Indice ligero.
    out = {
        "updated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "count":      len(list_out),
        "stocks":     list_out,
    }
    with open(LIST_OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))

    size_kb = os.path.getsize(LIST_OUT) / 1024
    print(f"\nGuardado indice. {LIST_OUT} ({size_kb:.1f} KB)")
    print(f"Detalles en. {DETAIL_DIR}/")


if __name__ == "__main__":
    main()
