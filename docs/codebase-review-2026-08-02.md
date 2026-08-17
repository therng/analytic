# Codebase review: four focused follow-up tasks

Date: 2026-08-02

> Archived one-off review (2026-08-02) — proposed follow-ups, not a live task list.

This review sampled the repository guidance, dashboard composition, economic
calendar API, and its nearest route tests. It proposes four independent,
small tasks; it does not implement the underlying fixes.

## 1. Typo: repair the product summary in `CLAUDE.md`

**Finding (verified):** `CLAUDE.md` describes the dashboard as “built help
operators” and says users can “drill into performance no lost context.” Both
phrases are missing connecting words.

**Proposed task:** Change the summary to “built to help operators … drill into
performance without losing context.” Keep this as a prose-only edit.

**Acceptance criteria:**

- The opening description is grammatically complete and retains the same
  product meaning.
- No commands, architecture claims, or runtime files change.

**Evidence:** `CLAUDE.md:7`.

## 2. Bug: enforce the economic-calendar expanded window

**Finding (verified):** The documented `scope=expanded` contract is a 30-day
window, but the database query only applies a lower bound of seven days ago and
has no upper bound. The expanded response then returns the entire normalized
database result. Consequently, old events between 7 and 30 days are included,
events older than 30 days are excluded, and arbitrarily distant future events
can leak into the response.

**Proposed task:** Define the 30-day boundary precisely in Bangkok time, pass a
single request-time `now` through the query and normalization paths, and query
the database with both lower and upper bounds. Preserve the existing default
scope behavior separately rather than making both scopes share an accidental
window.

**Acceptance criteria:**

- `scope=expanded` returns only events inside the documented 30-day window at
  both boundaries.
- The default scope still returns today or the nearest fallback events.
- The date key, database bounds, and event status calculations derive from the
  same captured request timestamp, including around Bangkok midnight.
- Focused route tests cover the lower boundary, upper boundary, and an event
  just outside each boundary.

**Evidence:** `AGENTS.md:12`, `src/app/api/economic-events/route.ts:44-49`, and
`src/app/api/economic-events/route.ts:102-110`.

## 3. Documentation discrepancy: correct `BotPnLPanel` placement

**Finding (verified):** The dashboard composition table says the `gain` chip
has no overlay and keeps the balance sparkline as its detail view. A later
component note says `BotPnLPanel` is used in both the `gain` panel and the
`dd -> DD` sub-panel. The implementation renders the chart in the main card
canvas and reserves the drawdown branch for its sub-panels, supporting the
table rather than the later note.

**Proposed task:** Update the `BotPnLPanel` note in `AGENTS.md` so it names only
the actual `dd -> DD` placement, and search other current dashboard docs for
the same stale `gain`-panel claim. Do not rewrite historical plans.

**Acceptance criteria:**

- The component note and composition table agree that `gain` opens no overlay.
- Current documentation names `BotPnLPanel` only where the component is
  rendered.
- Historical records remain unchanged unless they incorrectly claim to
  describe current behavior.

**Evidence:** `AGENTS.md:58-78` and
`src/components/trading-monitor/card/DashboardCard.tsx:540-560`.

## 4. Test improvement: isolate economic-event route tests from live data

**Finding (verified):** The route test calls `economicEvent.deleteMany({})`
against whichever `DATABASE_URL` is active, suppresses every deletion error,
and relies on the production route's error fallback when no database is
available. It also restores `globalThis.fetch` only at the end of the parent
test, so an early assertion failure can leak the mock into later tests. This is
not deterministic unit-test isolation and can delete unrelated local data.

**Proposed task:** Introduce an injectable route dependency (or a narrowly
mockable data-access boundary) for database reads, use in-memory fixtures for
both database-hit and live-fetch fallback cases, and restore global mocks with
`t.after()` or `try/finally`. Remove the destructive cleanup helper.

**Acceptance criteria:**

- The test never connects to or mutates PostgreSQL.
- Database-hit, empty-database fallback, database-error fallback, and upstream
  fetch failure are asserted explicitly.
- Fetch and clock state are restored even when a subtest fails.
- The focused test passes with `DATABASE_URL` unset and with an unreachable
  URL, producing the same assertions in both environments.

**Evidence:** `src/app/api/economic-events/route.test.ts:1-17` and
`src/app/api/economic-events/route.test.ts:198`.
