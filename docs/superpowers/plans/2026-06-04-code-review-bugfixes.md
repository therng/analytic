# Code Review Bugfixes — June 2026

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix 5 bugs surfaced by the June 4 code review: a deal-filtering bug that silently corrupts analytics metrics, a latent multi-account WebSocket publish bug, a fragile sign encoding in the Bot PnL tooltip, missing network isolation in docker-compose, and a deferred env-validation regression in prisma.ts.

**Architecture:** Each task is an isolated patch to a single file (or pair). No cross-task dependencies. Tasks 1–3 require test coverage; Tasks 4–5 are configuration-only with manual verification.

**Tech Stack:** TypeScript (Node test runner, `node --import tsx --test`), Python (pytest), Docker Compose, Caddy v2.

---

## Task 1: Fix deal-filtering false-negative in analytics.ts

**Severity:** HIGH — corrupts drawdown, growth, and balance curves for any account where a trade deal has `type = ""` and `comment = null`.

**Root cause:** `Boolean(deal.type || deal.comment)` treats an empty-string `type` as falsy, so trades where MT5 emits `type = ""` and no comment are silently excluded from the running-balance calculation.

**Occurrences:**
- `src/lib/trading/analytics.ts:147` — inside `buildUnitDrawdownCurve`
- `src/lib/trading/analytics.ts:773` — inside `buildDailyPnlBuckets`

**Files:**
- Modify: `src/lib/trading/analytics.ts:147,773`
- Modify: `src/lib/trading/analytics.test.ts`

- [ ] **Step 1: Write a failing test**

Add to `src/lib/trading/analytics.test.ts`:

```typescript
import { buildUnitDrawdownCurve } from "./analytics";

test("buildUnitDrawdownCurve includes trade deals with empty-string type and null comment", () => {
  const start = new Date("2026-01-01T00:00:00.000Z");
  const end   = new Date("2026-01-31T23:59:59.000Z");

  // A deposit (type="deposit") followed by one trade with type="" and no comment
  const deals = [
    { time: new Date("2026-01-01T01:00:00.000Z"), profit: 10_000, swap: 0, commission: 0, type: "deposit", comment: null },
    { time: new Date("2026-01-10T08:00:00.000Z"), profit: 500,    swap: -2, commission: -3, type: "",        comment: null },
  ] as any[];

  const result = buildUnitDrawdownCurve(deals, start, end, null);

  // The trade at Jan 10 adds net 495 to the running balance
  // Without the fix, points is empty (trade excluded) → endBalance = startBalance = 10_000
  // With the fix, points has one entry → endBalance = 10_495
  assert.equal(result.points.length, 1, "trade deal must appear in balance curve");
  assert.equal(result.endBalance, 10_495);
});
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
node --import tsx --test src/lib/trading/analytics.test.ts 2>&1 | grep -E "FAIL|pass|fail|Error"
```

Expected: test fails with `assertion failed: 0 === 1`

- [ ] **Step 3: Apply the fix in analytics.ts**

Replace the two occurrences of `Boolean(deal.type || deal.comment)` with a helper that treats empty string as "no type":

At the top of the function section (near line 80, alongside other helpers), add:

```typescript
function hasDealTypeOrComment(deal: { type: string | null | undefined; comment: string | null | undefined }): boolean {
  return (deal.type != null && deal.type !== "") || (deal.comment != null && deal.comment !== "");
}
```

Then change **line 147**:
```typescript
// Before:
if (op === null && Boolean(deal.type || deal.comment)) {
// After:
if (op === null && hasDealTypeOrComment(deal)) {
```

And change **line 773**:
```typescript
// Before:
if (!Boolean(deal.type || deal.comment)) continue;
// After:
if (!hasDealTypeOrComment(deal)) continue;
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
node --import tsx --test src/lib/trading/analytics.test.ts 2>&1 | grep -E "FAIL|pass|fail|Error|ok"
```

Expected: all tests pass (including the new one)

- [ ] **Step 5: Run full analytics test suite**

```bash
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/position-metrics.test.ts
```

Expected: no failures

- [ ] **Step 6: Commit**

```bash
git add src/lib/trading/analytics.ts src/lib/trading/analytics.test.ts
git commit -m "fix(analytics): include trade deals with empty-string type in balance curve"
```

---

## Task 2: Fix fragile grossLoss sign encoding in BotPnLPanel tooltip

**Severity:** LOW (cosmetically correct today but will silently break if `grossLoss` storage convention changes)

**Root cause:** `grossLoss` is stored as a negative number (e.g. `-500`). The tooltip passes it directly to `formatCompactSignedNumber`, which prepends a `"-"` sign by calling `getSignedPrefix(numeric)`. The double-negative happens to cancel out and render `-500` correctly — but only because `formatCompactNumber` internally takes `Math.abs`. Any future refactor storing `grossLoss` as a positive magnitude would flip the display to `+500`.

**Files:**
- Modify: `src/components/trading-monitor/BotPnLPanel.tsx:235-247`

- [ ] **Step 1: Locate the tooltip custom renderer**

Open `src/components/trading-monitor/BotPnLPanel.tsx`. Find:

```typescript
const val = isProfit ? bot.grossProfit : bot.grossLoss;
const count = isProfit ? bot.wins : bot.losses;
const color = isProfit ? POSITIVE_BORDER : NEGATIVE_BORDER;

return `
  <div class="bot-pnl-tooltip">
    <span style="color: ${color}; font-weight: 600;">${formatCompactSignedNumber(val, 1)}</span>
    <span style="color: #FFEB3B; font-weight: 600;"> (${count})</span>
  </div>
`;
```

- [ ] **Step 2: Apply the fix — make the sign explicit**

Replace the `val` line so it never relies on the sign stored in `grossLoss`:

```typescript
// Before:
const val = isProfit ? bot.grossProfit : bot.grossLoss;
// After:
const val = isProfit ? bot.grossProfit : -Math.abs(bot.grossLoss);
```

This is a no-op for current behavior (since `grossLoss` is already negative) but makes the intent clear and survives future storage-convention changes.

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
npm run build 2>&1 | tail -5
```

Expected: `Route (app)` table printed, exit 0

- [ ] **Step 4: Commit**

```bash
git add src/components/trading-monitor/BotPnLPanel.tsx
git commit -m "fix(BotPnLPanel): make grossLoss sign explicit in tooltip to prevent sign-flip on refactor"
```

---

## Task 3: Fix latent multi-account publish in ingest_deals

**Severity:** MEDIUM (latent — current collector always sends single-account batches, but the endpoint contract does not enforce this)

**Root cause:** `account_id = deals[0].account_id` extracts only the first deal's account. The full payload is published to `deals:{account_id}`. If a batch ever contains deals from multiple accounts, all accounts after the first miss their live updates.

**Fix strategy:** Group deals by `account_id` and publish a per-account sub-list to each channel. Each subscriber receives only its own account's deals in the same list format as before.

**Files:**
- Modify: `backend/main.py:61-67`

- [ ] **Step 1: Write a unit test for the new grouping behavior**

Create `backend/test_main_ingest.py`:

```python
import json
import pytest
from unittest.mock import AsyncMock, patch
from fastapi.testclient import TestClient
from backend.main import app
from backend.security import sign_payload

def make_signed_headers(payload: str):
    import time
    timestamp = str(int(time.time()))
    nonce = "test-nonce-001"
    sig = sign_payload(payload, timestamp, nonce, "test-secret")
    return {
        "x-signature": sig,
        "x-timestamp": timestamp,
        "x-nonce": nonce,
    }

@pytest.mark.asyncio
async def test_ingest_deals_publishes_to_each_account_channel():
    """Deals from two different accounts must publish to two separate channels."""
    deals = [
        {"account_id": "A1", "deal_no": "1", "time": "2026-01-01T00:00:00", "profit": 100, "swap": 0, "commission": 0, "type": "buy", "comment": None},
        {"account_id": "B2", "deal_no": "2", "time": "2026-01-01T00:00:01", "profit": -50, "swap": 0, "commission": 0, "type": "sell", "comment": None},
    ]
    payload = json.dumps(deals)
    headers = make_signed_headers(payload)

    published = {}
    async def fake_publish(channel, data):
        published[channel] = json.loads(data)

    with patch("backend.main.redis_client") as mock_redis:
        mock_redis.publish = AsyncMock(side_effect=fake_publish)
        client = TestClient(app)
        resp = client.post("/api/v1/ingest/deals", content=payload, headers={**headers, "content-type": "application/json"})

    assert resp.status_code == 200
    assert "deals:A1" in published, "channel for account A1 must receive a publish"
    assert "deals:B2" in published, "channel for account B2 must receive a publish"
    assert all(d["account_id"] == "A1" for d in published["deals:A1"])
    assert all(d["account_id"] == "B2" for d in published["deals:B2"])
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
cd backend && source venv/bin/activate && PYTHONPATH=.. pytest test_main_ingest.py -v 2>&1 | tail -20
```

Expected: `FAILED` — both channels are not published (only `deals:A1` is, from first deal)

- [ ] **Step 3: Apply the fix in main.py**

Replace lines 61–67 in `backend/main.py`:

```python
# Before:
    if not deals:
        return {"status": "ok", "count": 0}
        
    account_id = deals[0].account_id
    await redis_client.publish(f"deals:{account_id}", payload)
    
    return {"status": "ok", "count": len(deals)}

# After:
    if not deals:
        return {"status": "ok", "count": 0}

    from collections import defaultdict
    by_account: dict[str, list] = defaultdict(list)
    for deal in deals:
        by_account[deal.account_id].append(deal.model_dump())

    for acct_id, acct_deals in by_account.items():
        await redis_client.publish(f"deals:{acct_id}", json.dumps(acct_deals))

    return {"status": "ok", "count": len(deals)}
```

- [ ] **Step 4: Run the test to confirm it passes**

```bash
cd backend && source venv/bin/activate && PYTHONPATH=.. pytest test_main_ingest.py -v 2>&1 | tail -10
```

Expected: `PASSED`

- [ ] **Step 5: Run the full backend test suite**

```bash
cd backend && source venv/bin/activate && PYTHONPATH=.. pytest 2>&1 | tail -10
```

Expected: no regressions

- [ ] **Step 6: Commit**

```bash
git add backend/main.py backend/test_main_ingest.py
git commit -m "fix(gateway): publish deals to each account's channel separately in ingest_deals"
```

---

## Task 4: Restore backend_net network isolation in docker-compose

**Severity:** MEDIUM (defense-in-depth regression — database, Redis, and gateway have unnecessary outbound internet access)

**Root cause:** `backend_net: internal: true` was removed from `docker-compose.yml`. This was present in the prior version to prevent data-tier containers from initiating outbound connections.

**Note on worker:** The worker is on **both** `frontend_net` and `backend_net`. Restoring `internal: true` on `backend_net` does not cut off the worker's outbound access — it still has a route via `frontend_net`. Only `db` and `redis` (which are on `backend_net` only) become truly isolated.

**Files:**
- Modify: `docker-compose.yml` (networks section, ~line 161)

- [ ] **Step 1: Open docker-compose.yml and find the networks section**

Locate:
```yaml
networks:
  frontend_net:
  backend_net:
```

- [ ] **Step 2: Add `internal: true` to backend_net**

```yaml
networks:
  frontend_net:
  backend_net:
    internal: true
```

- [ ] **Step 3: Verify the stack starts cleanly**

```bash
docker compose config 2>&1 | grep -A3 "backend_net"
```

Expected output includes `internal: true`

- [ ] **Step 4: (If running locally) Restart the stack and confirm services connect**

```bash
docker compose down && docker compose up -d
docker compose ps
```

Expected: all services `running`

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml
git commit -m "fix(infra): restore backend_net internal:true to prevent outbound access from db/redis"
```

---

## Task 5: Address TLS removal in Caddyfile (decision required)

**Severity:** HIGH if this deployment is internet-facing; N/A if behind an existing TLS terminator

**Background:** The previous `Caddyfile` served `therng.duckdns.org` over TLS with HSTS (`max-age=31536000`). The current config binds only `:80`. HMAC-signed collector payloads (`X-Signature`, `X-Timestamp`, `X-Nonce`) now travel over plaintext HTTP.

**Decision tree:**

- **If the stack runs locally / behind an existing TLS proxy (e.g. Cloudflare, Nginx, another Caddy):** no action needed in this file — TLS is terminated upstream.
- **If the stack is directly internet-facing (public IP, port 80 exposed):** TLS must be restored.

**Files:**
- Modify: `Caddyfile` (if TLS restoration is needed)
- Modify: `.env.example` (re-add `DUCKDNS_TOKEN`, `DUCKDNS_DOMAIN`, `ACME_EMAIL`)

- [ ] **Step 1: Confirm deployment context**

Run on the production host:
```bash
curl -I http://localhost/api/health
# If this is behind a TLS proxy, check:
# cat /etc/nginx/sites-enabled/* | grep ssl   OR
# check Cloudflare dashboard for the domain
```

If behind TLS proxy → skip remaining steps. If directly internet-facing → continue.

- [ ] **Step 2 (internet-facing only): Restore TLS block in Caddyfile**

Replace the `:80 {` opening with the domain and TLS config:

```caddyfile
{env.CADDYFILE_DOMAIN} {
  tls {env.ACME_EMAIL}

  # ... (keep all existing directives inside) ...
}
```

Add to `.env` / `.env.example`:
```
CADDYFILE_DOMAIN=therng.duckdns.org
ACME_EMAIL=your_email@example.com
DUCKDNS_TOKEN=your_token
```

- [ ] **Step 3 (internet-facing only): Add HSTS header**

Inside the `header { }` block in Caddyfile, add:
```caddyfile
Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
```

- [ ] **Step 4: Validate Caddy config syntax**

```bash
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile
```

Expected: `Valid configuration`

- [ ] **Step 5: Commit (if changes were made)**

```bash
git add Caddyfile .env.example
git commit -m "fix(caddy): restore TLS and HSTS for internet-facing deployment"
```

---

## Quick-reference: test commands

```bash
# TypeScript unit tests
node --import tsx --test src/lib/trading/analytics.test.ts
node --import tsx --test src/lib/trading/position-metrics.test.ts
node --import tsx --test src/components/trading-monitor/formatters.test.ts

# Python backend tests
cd backend && source venv/bin/activate && PYTHONPATH=.. pytest

# Build verification
npm run build && npm run lint
```
