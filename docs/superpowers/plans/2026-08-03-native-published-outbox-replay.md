# Native Published Outbox Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rehydrate a clean native Redis/PostgreSQL downstream by replaying immutable `PUBLISHED` history envelopes from one SQLite journal without mutating that journal.

**Architecture:** A new operator-only script opens the requested journal with SQLite `mode=ro`, validates all selected history envelopes before transport mutation, then uses Redis `XADD` on the canonical per-login history stream. A target-side marker makes a successful source/target replay idempotent; source journal state is never changed.

**Tech Stack:** Python 3, SQLite, redis-py, pytest.

## Global Constraints

- Do not reset, requeue, update, delete, or otherwise mutate SQLite journals, locks, health, checkpoints, or source outbox rows.
- Use only `mt5:account:{login}:stream:history`; never introduce legacy namespaces.
- Never print Redis credentials, values, lease tokens, or envelope payloads.
- Replay is per journal and requires an explicit confirmation phrase.

---

### Task 1: Read-only replay selection and validation

**Files:**
- Create: `bridge/replay_published_outbox.py`
- Test: `bridge/tests/integration/test_published_outbox_replay.py`

**Interfaces:**
- Produces `PublishedOutboxReplay(source: Path, login: int)` with `read_messages()` returning validated `(event_id, envelope)` rows.

- [ ] **Step 1: Write the failing test**

```python
assert replay.read_messages() == (
    ("deal-event", b'{"message_type":"history.deal"}'),
    ("window-event", b'{"message_type":"history.window"}'),
)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q bridge/tests/integration/test_published_outbox_replay.py`

Expected: FAIL because `bridge.replay_published_outbox` does not exist.

- [ ] **Step 3: Write minimal implementation**

```python
def read_messages(self) -> tuple[tuple[str, bytes], ...]:
    with sqlite3.connect(f"file:{self._source}?mode=ro", uri=True) as connection:
        return tuple(connection.execute(self._selection_sql, (self._login,)))
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q bridge/tests/integration/test_published_outbox_replay.py`

Expected: PASS.

### Task 2: Guarded target publication

**Files:**
- Modify: `bridge/replay_published_outbox.py`
- Test: `bridge/tests/integration/test_published_outbox_replay.py`

**Interfaces:**
- Consumes: validated rows from `PublishedOutboxReplay.read_messages()`.
- Produces `replay(client, target_id)` returning an immutable count summary.

- [ ] **Step 1: Write the failing test**

```python
assert replay.replay(client, target_id="postgres-reset-20260803").published_count == 2
assert client.entries == [("deal-event", b'{"message_type":"history.deal"}'), ("window-event", b'{"message_type":"history.window"}')]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q bridge/tests/integration/test_published_outbox_replay.py`

Expected: FAIL because publication is not implemented.

- [ ] **Step 3: Write minimal implementation**

```python
for event_id, envelope in messages:
    client.xadd(stream_key, {"event_id": event_id, "envelope": envelope})
client.set(marker_key, "complete", nx=True)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q bridge/tests/integration/test_published_outbox_replay.py`

Expected: PASS.

### Task 3: Operator CLI and verification

**Files:**
- Create: `bridge/scripts/replay_published_outbox.py`
- Modify: `bridge/.env.example`
- Test: `bridge/tests/integration/test_published_outbox_replay.py`

**Interfaces:**
- Consumes: `--journal`, `--login`, `--target-id`, and `--confirm REPLAY_PUBLISHED_OUTBOX`.
- Produces: redacted count-only result and nonzero exit on missing confirmation or failed guard.

- [ ] **Step 1: Write the failing test**

```python
assert main(["--journal", str(path), "--login", "10001"]) == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python3 -m pytest -q bridge/tests/integration/test_published_outbox_replay.py`

Expected: FAIL because the CLI does not exist.

- [ ] **Step 3: Write minimal implementation**

```python
parser.add_argument("--confirm")
if args.confirm != "REPLAY_PUBLISHED_OUTBOX":
    return 2
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python3 -m pytest -q bridge/tests/integration/test_published_outbox_replay.py`

Expected: PASS.

- [ ] **Step 5: Verify focused and repository checks**

Run: `python3 -m pytest -q bridge/tests/integration/test_published_outbox_replay.py bridge/tests/integration/test_outbox_dispatcher.py bridge/tests/integration/test_redis_transport.py && node --import tsx --test src/worker-v2/*.test.ts && npm run lint && npm run build:worker-v2 && npx tsc --noEmit`

Expected: all selected checks pass; any unavailable dependency is reported without deployment.
