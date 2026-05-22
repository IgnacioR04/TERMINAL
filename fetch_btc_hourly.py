# fetch_btc_hourly.py
# Mantiene data/btc_1h.csv completo y actualizado usando la API publica de Binance.
#
# Logica:
#   1. Lee TODOS los timestamps del CSV y detecta huecos internos (>= 2h de diferencia).
#   2. Para huecos en los ultimos LOOKBACK_DAYS dias, pide a Binance los datos que faltan.
#   3. Tambien descarga el tramo final (desde la ultima barra hasta ahora).
#   4. Si se anadieron filas nuevas con huecos internos, re-ordena el CSV y elimina duplicados.
#
# Asi el CSV siempre esta completo y nunca necesitamos pedir mas de unos dias de golpe.
# Llamado desde historical.yml una vez al dia (cron "0 22 * * *").

import csv
import os
import time
import requests
from datetime import datetime, timezone

OUT_PATH      = "data/btc_1h.csv"
SYMBOL        = "BTCUSDT"
INTERVAL      = "1h"
LIMIT         = 1000          # max por llamada en Binance
LOOKBACK_DAYS = 180           # rellenar huecos dentro de los ultimos 6 meses
MIN_GAP_H     = 2             # ignorar diferencias < 2h (tolerancia a micro-cortes)

FIELDNAMES = [
    "datetime_utc", "open", "high", "low", "close", "volume",
    "asset", "symbol_requested", "symbol_used", "provider",
]


# --- Binance API --------------------------------------------------------------

def _binance_klines(symbol, interval, start_ms, end_ms=None, limit=LIMIT):
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval,
              "limit": limit, "startTime": start_ms}
    if end_ms:
        params["endTime"] = end_ms
    r = requests.get(url, params=params, timeout=30)
    r.raise_for_status()
    return r.json()


def _kline_to_row(k):
    ts_s = int(k[0]) // 1000
    dt   = datetime.fromtimestamp(ts_s, tz=timezone.utc)
    return {
        "datetime_utc":      dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "open":              k[1],
        "high":              k[2],
        "low":               k[3],
        "close":             k[4],
        "volume":            k[5],
        "asset":             "btc",
        "symbol_requested":  "BTC-USD",
        "symbol_used":       SYMBOL,
        "provider":          "binance-vision",
    }


def fetch_range(start_ms, end_ms):
    """Descarga todas las klines entre start_ms y end_ms (exclusivo)."""
    rows = []
    batch = start_ms
    while batch < end_ms:
        klines = _binance_klines(SYMBOL, INTERVAL, batch, end_ms=end_ms - 1, limit=LIMIT)
        if not klines:
            break
        for k in klines:
            ts_ms = int(k[0])
            if ts_ms >= end_ms:
                break
            rows.append(_kline_to_row(k))
        last_ts_ms = int(klines[-1][0])
        if last_ts_ms + 3_600_000 >= end_ms or len(klines) < LIMIT:
            break
        batch = last_ts_ms + 3_600_000
        time.sleep(0.2)
    return rows


# --- Lectura y analisis del CSV ----------------------------------------------

def read_timestamps(path):
    """Devuelve un set de todos los epoch-segundos presentes en el CSV."""
    if not os.path.exists(path):
        return set()
    ts_set = set()
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            raw = row.get("datetime_utc", "")
            if raw:
                try:
                    dt = datetime.strptime(raw, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
                    ts_set.add(int(dt.timestamp()))
                except ValueError:
                    pass
    return ts_set


def find_gaps(ts_set, lookback_days, now_s, interval_s=3600):
    """
    Devuelve lista de (start_ms, end_ms) para huecos dentro de los ultimos
    `lookback_days` dias.  start_ms es la primera barra que falta;
    end_ms es la primera barra que YA EXISTE despues del hueco (exclusivo).
    """
    cutoff = now_s - lookback_days * 86400
    recent = sorted(t for t in ts_set if t >= cutoff)
    if not recent:
        return []

    gaps = []
    for i in range(1, len(recent)):
        gap_s = recent[i] - recent[i - 1]
        if gap_s >= interval_s * MIN_GAP_H:
            gaps.append((
                (recent[i - 1] + interval_s) * 1000,   # primera barra faltante (ms)
                recent[i] * 1000,                       # limite exclusivo (ms)
            ))
    return gaps


# --- Escritura ---------------------------------------------------------------

def append_rows(path, new_rows):
    """Agrega filas al final del CSV. Crea cabecera si el archivo es nuevo."""
    write_header = not os.path.exists(path) or os.path.getsize(path) < 10
    with open(path, "a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        if write_header:
            w.writeheader()
        w.writerows(new_rows)


def sort_and_deduplicate(path):
    """
    Re-lee el CSV completo, lo ordena por datetime_utc, elimina duplicados
    y lo escribe de nuevo. Solo se llama cuando se rellenaron huecos internos.
    """
    all_rows = []
    with open(path, newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            all_rows.append(row)

    all_rows.sort(key=lambda r: r.get("datetime_utc", ""))
    seen = set()
    deduped = []
    for row in all_rows:
        key = row.get("datetime_utc", "")
        if key and key not in seen:
            seen.add(key)
            deduped.append(row)

    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDNAMES)
        w.writeheader()
        w.writerows(deduped)

    return len(deduped), len(all_rows) - len(deduped)


# --- Main -------------------------------------------------------------------

def main():
    os.makedirs("data", exist_ok=True)
    now_ms = int(time.time() * 1000)
    now_s  = int(time.time())

    print(f"[fetch_btc_hourly] Leyendo timestamps de {OUT_PATH}...")
    ts_set = read_timestamps(OUT_PATH)

    if not ts_set:
        # CSV vacio: descarga las ultimas 12 semanas
        start_ms = (now_s - 84 * 86400) * 1000
        end_ms   = now_ms - 3_600_000
        print("  CSV vacio. Descargando 84 dias...")
        rows = fetch_range(start_ms, end_ms)
        if rows:
            append_rows(OUT_PATH, rows)
            print(f"  {len(rows)} barras escritas.")
        return

    last_ts  = max(ts_set)
    first_ts = min(ts_set)
    print(f"  {len(ts_set):,} barras | "
          f"{datetime.fromtimestamp(first_ts, tz=timezone.utc).date()} -> "
          f"{datetime.fromtimestamp(last_ts, tz=timezone.utc).date()}")

    # 1. Detectar huecos internos en los ultimos LOOKBACK_DAYS dias
    gaps = find_gaps(ts_set, LOOKBACK_DAYS, now_s)
    gap_rows_added = 0
    need_sort = False

    if gaps:
        print(f"  Huecos encontrados: {len(gaps)}")
        for start_ms, end_ms in gaps:
            t0 = datetime.fromtimestamp(start_ms // 1000, tz=timezone.utc)
            t1 = datetime.fromtimestamp(end_ms   // 1000, tz=timezone.utc)
            expected_h = (end_ms - start_ms) // 3_600_000
            print(f"    Rellenando {t0.strftime('%Y-%m-%d %H:%M')} -> "
                  f"{t1.strftime('%Y-%m-%d %H:%M')} (~{expected_h}h)")
            rows = fetch_range(start_ms, end_ms)
            if rows:
                append_rows(OUT_PATH, rows)
                gap_rows_added += len(rows)
                need_sort = True
                print(f"      +{len(rows)} barras")
            else:
                print(f"      Sin datos disponibles para este rango")
    else:
        print("  Sin huecos internos recientes.")

    # 2. Tramo final: desde la ultima barra hasta ahora (sin hora actual incompleta)
    incomplete_hour_ms = now_ms - 3_600_000
    tail_gap_h = (now_s - last_ts) // 3600
    if tail_gap_h >= 2:
        start_tail = (last_ts + 3600) * 1000
        print(f"  Descargando {tail_gap_h}h nuevas (cola)...")
        rows = fetch_range(start_tail, incomplete_hour_ms)
        if rows:
            append_rows(OUT_PATH, rows)
            print(f"  +{len(rows)} barras anadidas al final.")
        else:
            print("  Sin barras nuevas en la cola.")
    else:
        print(f"  Cola al dia (ultima barra hace {tail_gap_h}h, <2h).")

    # 3. Re-ordenar y deduplicar si se rellenaron huecos internos
    if need_sort:
        total, removed = sort_and_deduplicate(OUT_PATH)
        print(f"  CSV re-ordenado: {total:,} barras ({removed} duplicados eliminados)")

    size_kb = os.path.getsize(OUT_PATH) / 1024
    print(f"[fetch_btc_hourly] Listo. {OUT_PATH} = {size_kb:,.0f} KB")


if __name__ == "__main__":
    main()
