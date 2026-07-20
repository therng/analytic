# bridge_v2

Clean MT5 bridge, rebuilt from the raw source upward. Three jobs, nothing else:

1. Connect to MT5 (one explicit portable terminal).
2. Pull raw data correctly (no field loss).
3. Emit it straight through.

Self-contained: the old `bridge/` directory it was originally built beside has
since been deleted; `bridge_v2/` has no dependency on it.

## Why

The old bridge mixes MT5 extraction, position reconstruction, Redis transport,
checkpoint coordination, close-event enrichment, MAE/MFE tracking, and recovery
state in one process. When a number is wrong, there is no way to tell whether
MT5, the bridge, Redis, or the worker corrupted it.

V2 makes the chain provable end to end:

```
MT5 raw  ==  exported artifacts  ==  Redis messages
```

Only once that holds do we build a new worker to turn raw Deals/Orders into
positions and write the DB.

## Not in V2 (deliberately)

No barriers, no custom history ACK keys, no PostgreSQL-backed ACK mirrors, no
parent chunk ids, no reconstruction checkpoints, no close-position dedupe sets,
no live close-event reconstruction, no MAE/MFE, no history reaching back to
2000, no worker-controlled bridge startup.

**V2 does not build ClosedPositions.** It publishes raw Deals and Orders
faithfully; the Node worker reconstructs positions with tested, account-mode-aware
logic. That is what preserves partial closes, multiple entries, reversals,
close-by trades, commission-only records, and later MT5 corrections.

## Phase 1 — raw verifier

Prove the source before connecting anything downstream.

```powershell
python -m bridge_v2.raw_export `
  --terminal-path "C:\path\to\terminal64.exe" `
  --from-date "2026-01-01T00:00:00" `
  --output ".\artifacts\7948784"
```

MT5 methods called: `account_info()`, `terminal_info()`, `positions_get()`,
`history_deals_get(from, now)`, `history_orders_get(from, now)`.

Writes: `account.json`, `terminal.json`, `open_positions.json`, `deals.jsonl`,
`orders.jsonl`, `summary.json`, `validation.json`. Every MT5 field survives
(`_asdict()`); nothing is reduced to the old bridge schema.

`validation.json` reports account/broker/trade+margin mode, counts, time ranges,
duplicate tickets, missing/zero position ids, deals referencing unknown orders,
deals grouped by position id, entry/type/order-type histograms, positions with
no/multiple entry or exit deals, INOUT reversals, OUT_BY close-bys,
commission-only and fee-only deals, and balance/credit/correction/bonus/tax/
dividend/charge records. `summary.json` carries the per-position diagnostic
reconciliation (Decimal only, never float).

## Three MT5 outcomes, never blurred

| Outcome  | Meaning                                                 | Handling                    |
| -------- | ------------------------------------------------------- | --------------------------- |
| `OK`     | returned a value (an empty tuple is a real "zero rows") | proceed                     |
| `FAILED` | returned `None` — MT5's failure signal                  | abort; print `last_error()` |
| `ERROR`  | raised an exception                                     | abort                       |

A failed call is **never** converted into an empty result, and never advances a
cursor. See `mt5_client.py`.

## Time handling

MT5 `time`, `time_setup`, `time_done`, `time_msc` are Unix UTC epochs. V2 and
the Node workers preserve those instants; neither applies the broker UTC
offset.

Every record therefore keeps both:

- `time` — the raw epoch, verbatim, untouched
- `time_iso` — the same UTC epoch rendered as an ISO string. A human-readable
  mirror of `time`.

Local system time is never substituted for a record's time. `--from-date` is a
**query boundary only**.

## Phase 2 — minimal bridge

```powershell
python -m bridge_v2.main --terminal-path "C:\...\terminal64.exe" --from-date "2026-01-01T00:00:00"
```

Live (every 2s): `account_info` + `positions_get` → `mt5:v2:bridge:{login}:heartbeat`,
`mt5:v2:account:{login}:live`, `mt5:v2:account:{login}:positions`. Live positions
preserve ticket, identifier, symbol, type, magic, reason, volume, price_open,
price_current, sl, tp, profit, swap, comment, time, time_msc. The live loop never
computes a closed position and never emits a close event when a ticket disappears.

History (30-day windows from 2026-01-01, configurable): raw records → the
`mt5:v2:history:deals` / `mt5:v2:history:orders` streams, **one Redis message per
raw MT5 record**, standard consumer groups and stream ids only. The bridge owns
exactly one piece of state: `mt5:v2:history:{login}:cursor`.

Cursor rules: advance only after every record in the window publishes; never
advance on MT5 failure; never turn a failure into an empty window; empty windows
do advance (coverage stays provable); republishing a window is safe because MT5
ticket ids are stable and downstream upserts on them.

## Supervisor

`run_all_v2.py` only discovers approved portable terminals, spawns one V2 bridge
per terminal with an explicit path, prevents duplicate processes, restarts
failures with bounded backoff, and stops children cleanly. It never touches
history cursors or Redis history state.

## Install

```bash
pip install -r bridge_v2/requirements.txt
```

## Tests

```bash
python3 -m pytest -q bridge_v2/tests/
```

Covers serialization (no field loss), time conversion, empty results, failed MT5
calls, duplicate detection, and Decimal reconciliation. No MT5 or Redis needed.
