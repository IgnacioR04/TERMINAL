# fetch_btc_hourly.py
# Actualiza data/btc_1h.csv con los ultimos datos horarios de BTC.
# Detecta el ultimo timestamp en el CSV y descarga solo las barras que faltan.
# Fuente: Binance public REST API (sin autenticacion).
# Llamado desde historical.yml una vez al dia.

import csv
import os
import time
import requests
from datetime import datetime, timezone

OUT_PATH = "data/btc_1h.csv"
SYMBOL   = "BTCUSDT"
INTERVAL = "1h"
LIMIT    = 1000  # max por llamada en Binance


def _binance_klines(symbol, interval, start_ms, end_ms=None, limit=1000):
    """Descarga klines de Binance desde start_ms hasta end_ms."""
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit, "startTime": start_ms}
    if end_ms:
        params["endTime"] = end_ms
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def _kline_to_row(k):
    """Convierte una kline de Binance a fila CSV."""
    ts_s = int(k[0]) // 1000
    dt   = datetime.fromtimestamp(ts_s, tz=timezone.utc)
    return {
        "datetime_utc": dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "open":         k[1],
        "high":         k[2],
        "low":          k[3],
        "close":        k[4],
        "volume":       k[5],
        "asset":        "btc",
        "symbol_requested": "BTC-USD",
        "symbol_used":  SYMBOL,
        "provider":     "binance-vision",
    }


def read_last_timestamp(path):
    """Devuelve el ultimo epoch (segundos) guardado en el CSV, o None si vacio."""
    if not os.path.exists(path):
        return None
    last_ts = None
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = row.get("datetime_utc", "")
            if raw:
                try:
                    dt = datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                    ts = int(dt.timestamp())
                    if last_ts is None or ts > last_ts:
                        last_ts = ts
                except ValueError:
                    pass
    return last_ts


def main():
    os.makedirs("data", exist_ok=True)

    now_ms  = int(time.time() * 1000)
    now_s   = int(time.time())

    last_ts = read_last_timestamp(OUT_PATH)

    if last_ts is None:
        # CSV no existe o vacio: descarga las ultimas 12 semanas (~2000 barras)
        start_ms = (now_s - 84 * 86400) * 1000
        print(f"CSV vacio. Descargando desde 84 dias atras...")
    else:
        # Solo descarga lo que falta (a partir de la siguiente hora)
        gap_hours = (now_s - last_ts) // 3600
        if gap_hours < 2:
            print(f"CSV actualizado (ultima barra hace {gap_hours}h). Nada que hacer.")
            return
        start_ms = (last_ts + 3600) * 1000
        print(f"Ultima barra: {datetime.fromtimestamp(last_ts, tz=timezone.utc).isoformat()}. Faltan ~{gap_hours} barras.")

    # Descarga en lotes de 1000
    new_rows = []
    batch_start = start_ms
    while batch_start < now_ms - 3600_000:  # no incluir la hora actual incompleta
        klines = _binance_klines(SYMBOL, INTERVAL, batch_start, limit=LIMIT)
        if not klines:
            break
        for k in klines:
            ts_ms = int(k[0])
            if ts_ms >= now_ms - 3600_000:  # ignorar hora actual
                break
            new_rows.append(_kline_to_row(k))
        batch_start = int(klines[-1][0]) + 3600_000
        print(f"  Descargadas {len(new_rows)} barras hasta {new_rows[-1]['datetime_utc']}")
        if len(klines) < LIMIT:
            break
        time.sleep(0.3)

    if not new_rows:
        print("No hay barras nuevas.")
        return

    # Si el CSV no existia, crear con cabecera
    fieldnames = ["datetime_utc","open","high","low","close","volume","asset","symbol_requested","symbol_used","provider"]
    write_header = not os.path.exists(OUT_PATH) or os.path.getsize(OUT_PATH) < 10

    with open(OUT_PATH, "a", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerows(new_rows)

    print(f"\nAnadidas {len(new_rows)} barras a {OUT_PATH}")


if __name__ == "__main__":
    main()
