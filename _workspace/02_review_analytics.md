# Trading analytics review — persist bridge owner identity

## Scope

- Commit: `c1855274fcb4e6a240aba5c95ab501df3c708c0f`
- Intent inferred from commit: preserve durable producer identity, history checkpoint,
  and live sequence when terminal profile changes or supervisor restarts.
- Worktree changes outside commit were excluded from review.

## Source and metric trace

- No dashboard metric, formula, API field, serializer, or display mapping changed.
- History still publishes raw MT5 Deal/Order rows unchanged. Commit changes only the
  identity namespace used for checkpoints, windows, natural IDs, and event IDs:
  `bridge/history.py:139`, `bridge/history.py:304`, `bridge/history.py:404`.
- Live payload still contains the same raw account, position, and order values.
  Commit changes only producer profile, durable sequence key, and event identity:
  `bridge/live.py:98`, `bridge/live.py:228`, `bridge/live.py:239`.
- Worker reconciles computed profile identity to the profile already stored for the
  login before registering the epoch and constructing pollers:
  `bridge/worker.py:626`, `bridge/worker.py:634`, `bridge/worker.py:641`.
- History checkpoint lookup follows the reconciled journal identity:
  `bridge/session_wiring.py:123`.

## Analytics rules

- Authoritative source boundaries unchanged: Deal/Order payload values are not
  converted, rounded, or replaced by snapshot values.
- Timeframe filtering and raw broker-server timestamps unchanged.
- Deposit/withdrawal segmentation unchanged.
- Closed-position P/L formula (`profit + swap + commission`) unchanged.
- No presentation rounding introduced.
- `src/lib/trading/metric-registry.ts` needs no update because no displayed metric
  meaning, source, formula, API field, or target changed.

## Tests

Focused changed-path and journal/worker integration tests:

```bash
python3 -m pytest -q bridge/tests/unit/test_history.py bridge/tests/unit/test_live.py bridge/tests/integration/test_history_journal.py bridge/tests/integration/test_supervisor.py bridge/tests/integration/test_journal_producer_registration.py bridge/tests/integration/test_worker_outbox_wiring.py -k 'not test_package_can_be_started_through_python_dash_m_bridge'
```

Expected and observed output:

```text
73 passed, 1 deselected
```

Full `bridge/tests` collection was unavailable because local environment lacks
`hypothesis`. The startup integration test was deselected because local environment
also lacks `psutil`; its failure was dependency import failure, not an assertion in
changed logic.

## Verdict

**pass** — no material trading-analytics semantic issue found. Identity continuity
reduces duplicate or reset ingestion risk without changing financial values.

analytics review: pass
