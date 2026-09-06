# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [8.76] - 2026-09-06

### Changed — analytics type-hardening

- **Deprecated overview wire-field plumbing removed** — `TradeExecutionDistribution`/`TradeExecutionHourBucket` types, the never-read `tradeExecutions?` source-contract field, the `EMPTY_TRADE_EXECUTIONS` fixture stub, the never-called `buildTradeExecutionDistribution`, and the orphaned `.trade-executions-chart` CSS block. Live surfaces untouched (`PositionsResponse.openBySymbol` and `BalanceDetailResponse.balanceCurve` serve their own endpoints; the overview build already omitted all three deprecated fields). No L2 compatibility shim needed — report-view cache TTL is 300 s with unvalidated parse.
- **The 9 production `as any` casts in the analytics money path are typed away** — `OpenPositionRow` widened to the real Prisma row shape it was always consumed as; `historyPositions` and both `recentDeals` annotated with their wire element types; vestigial casts dropped (kernel `NumericLike` already accepts Decimal/number/null, `sortDeals` is generic, `prisma` needed no erasure). Contract-fixture `openPosition` rows now carry full rows — the fixture previously pinned `positionId: undefined`/`openPrice: NaN` artifacts (per-timeframe hashes updated). `tsc --noEmit`, lint, and the 87-test affected suite green; deployed with a single `analytic-web` restart, post-deploy smoke confirmed the overview payload carries none of the removed fields.

### Operations — single-host migration closeout

- Migration Task 7 closed with on-host probe evidence (scheduled tasks, event log, backups, live TTLs; final report filed in the plan doc). `postgresql.conf` tuning found already in effect at runtime (`listen_addresses='127.0.0.1'`, `max_wal_size=2GB`). **PG16 uninstalled** — PG18 is the sole owner of port 5432.
- **ADR-0006 host follow-up done**: the 5 interim `bridge/accounts/*.json` lower-bound overrides removed (rollback copy at `bridge/state/retired-overrides-20260906/`), bridge restarted via its scheduled task (`schtasks /End` + `/Run` — 5/5 loops up, zero quarantine, live TTLs republished), journal `.bak`s pruned. vps-ops `deploy.md`/`host-facts.md` bridge-restart references corrected from the stale `nssm restart bridge` wording.

### Operations — vps-ops rogue-terminal tooling

- MT5 build 6180 liveupdate post-reboot follow-up (plan: `docs/plans/2026-09-06-kill-liveupdate-staging-duplicates.md`): two stuck staging duplicates (MT1 7532 / MT9 9504) force-killed by PID after graceful close was refused (staging processes have no reachable window); stack verified fully recovered — worker `:9200/health` ok, 5/5 install-dir `/portable` terminals, live TTLs 55–59 s. **`mt5ops.py` gained `term rogue [--kill]`** — classifies every `terminal64.exe` as `ok`/`nonportable`/`staging-duplicate`/`updater`/`unknown` (list-only by default; `--kill` = `taskkill /F` by PID). Its `status` no longer lies post-migration: accounts read `bridge\state\discovered-accounts\`, `bridge` row = `analytic-bridge` scheduled-task state, `redis-wsl` row = TCP 6379 probe, `svc restart bridge` drives schtasks End/Run. MT7/MT9 EA re-attachment (`.chr` procedure per `vps-ops/references/ea-inputs.md`) still pending operator confirm.

### Docs — truth pass

- Postmortem written for the 2026-08-30 undocumented-teardown outage (`docs/incidents/2026-08-30-undocumented-teardown-outage.md`); `ARCHITECTURE.md` open items closed (historical ingestion proven end-to-end — Deal count 57,491 at 2026-08-30 → 60,537 at 2026-09-06; the one-time XLEN gap closed as won't-fix-with-recurrence-trigger); **ADR-0007** records the 8.74→8.75 CRITICAL-KPI removal with explicit retry preconditions. Package plan: `docs/plans/2026-09-06-closeout-package.md`.
- Known state: account 7998410 dark since 2026-09-03 07:14Z (terminal not delivering; operator to restart the host) — no data-loss event; worker registry retains the lease.

## [8.75] - 2026-09-03

### Removed — CRITICAL urgency KPI

- **The 8.74 `CRITICAL` urgency score is removed** — `src/lib/trading/critical-score.ts` deleted, `critical_score` dropped from `SerializedAccount` and the `serializeAccountBundle` payload, the supplementary `CRITICAL` KPI chip, the ≥70 critical card edge (all three card variants), the `kchip--critical`/`:has()` dense-grid CSS, and the metric-registry entry. The `SummaryChip` `chipClassName` prop and `KpiChipItem.className` plumbing added solely for the chip are also gone.
- **Pre-existing fields kept** — the XAUUSD-volume deposit-load estimate (`deposit_load_pct`/`deposit_load_source`, shipped before 8.74) is untouched; only the composite urgency score over it is removed.
- **View-build contract fixture regenerated** (`scripts/generate-view-contract-fixture.ts`) for the removed contract-source field. Verify skill `driver.mjs` `criticalChips` counter retired; `AGENTS.md` synced (chip list, source boundaries, metric definitions). No worker/bridge/schema changes — full unit suite, `tsc --noEmit`, and lint pass.

## [8.74] - 2026-09-01

### Added — CRITICAL urgency KPI (0–100)

- **`critical_score` added to the accounts-list payload** — current-state urgency computed read-time in `serializeAccountBundle` via `computeCriticalScore` (`src/lib/trading/critical-score.ts`): floating loss to equity (35 pts, full at 5%), margin level 1000→100 (50 pts), and the pre-existing XAUUSD deposit-load estimate 40→100% (15 pts); an account with no open positions scores 0. Deliberately current-state only — no `Deal`/`Position` history consumed, not timeframe-filtered.
- **Supplementary `CRITICAL` KPI chip + critical card edge** — the chip renders on the expanded card only while the score is non-zero (threshold-tinted ≥40/≥70 via the new `SummaryChip` `chipClassName` prop, semantic `kchip--critical`), and the collapsed strip carries an `account-card--critical` edge at score ≥70 so urgency stays visible without expanding. The expanded card recalculates from the freshest live snapshot inputs rather than reusing the payload's serialized score.
- **Merged alongside the 8.73 autonomous-expansion payload field** — `SerializedAccount` carries both `position_opened_recently` and `critical_score`; the view-build contract fixture regenerated (`scripts/generate-view-contract-fixture.ts`) for the new contract-source field.

## [8.73] - 2026-08-31

### Changed — autonomous card expansion, chevron removed

- **Card expansion is autonomous (24h rule)** — an account whose most recent position was OPENED within the last 24h (still open or since closed) renders the full card by default; quieter accounts auto-collapse to the compact strip. Supersedes the 8.66 predicate (`today_trade_count > 0 || open_position_count > 0`, a Bangkok report-day notion) with a rolling window keyed on position open times — a position held for days no longer keeps its card expanded, and one opened 20h ago does even if already closed.
- **`position_opened_recently` added to the accounts-list payload** — computed read-time in `serializeAccountBundle` from `OpenPosition.openTime` plus the fetched `Position` rows (a position opened within 24h always lands in one of those two sets); no schema migration, no worker change. The list-cache version key now also tracks `Position`/`OpenPosition` max timestamps — fixing a latent staleness where position-derived fields (`today_trade_count` included) could serve stale after a new position landed, since Position writes never bump account/snapshot `updatedAt`.
- **The expand/collapse chevron is gone** — the whole collapsed card is the tap target (`LazyDashboardCard` wraps the strip in a `.strip-tap` button: full-card hitbox, `focus-visible` ring, native Enter/Space, `touch-action: manipulation` so landscape carousel swipes still pan from a chip). Expansion is one-way: tapping a collapsed card pins a session-only expand (the override map only ever sets true; `expand_card` analytics still fires on manual expands) — collapsing is the autonomous rule's job alone, there is no manual collapse.
- **Runtime-verified** on a spare-port dev server (Node Playwright + system Chrome, portrait + landscape): tap-to-expand with KPI grid mount, reload re-derivation, landscape chip tap, and touch-swipe panning from a chip (identical to pre-patch production behavior). `AGENTS.md` + `README.md` + the verify skill updated (`.strip-expand` selector retired; dev-server `localhost`-only gotcha recorded).

## [8.72] - 2026-08-30

### Ops — 2026-08-30 outage postmortem + service-tier rebuild

- **Outage recorded**: an undocumented session tore down all five NSSM services (graceful, ordered) and removed their registrations immediately before the 02:31 host reboot — ~13 h total outage (site + MT5 ingestion dark) while 5 terminals traded uncollected. Reconstructed from the Windows event log; entry appended to the migration plan progress log.
- **Redis topology re-recorded**: Redis is **8.0.5 inside WSL2 Ubuntu behind systemd** (unit enabled) held alive by the `analytic-redis-wsl-keepalive` ONLOGON scheduled task (a `wsl --exec sleep infinity` session holder — WSL2 distros terminate when their last session closes, which was the outage's root cause). The planned NSSM `redis-wsl` service is retired: LocalSystem cannot see the per-user distro and the `supachai` service password was unavailable.
- **`analytic-worker` / `analytic-web` / `caddy` reinstalled as NSSM LocalSystem services** (deviation recorded); the surviving 8.71 standalone build was smoke-tested on a spare port before install (clean — no `InvariantError`); caddy re-verified on `https://therng.duckdns.org` (200) using the pre-teardown cert storage (valid to 2026-11-16).
- **`bridge` restored** via the `analytic-bridge` ONLOGON scheduled task (supachai, console session) after the NSSM LocalSystem variant proved unable to publish (journal ACL + identity probe issues; quarantine cleared via `bridge.scripts.clear_quarantine`). All 5 logins lease and publish live state (`mt5:account:{login}:live` TTL-refreshing; worker registry 5/5).
- **Maintenance automation closed**: `analytic-pg-dump` (daily 04:05, retention 7, first dump verified) and `analytic-worker-health-probe` (5 min, watches worker health AND the redis 6379 relay) via `scripts/pg-dump-daily.ps1` / `scripts/worker-health-probe.ps1`; stale `pginstall` task deleted; `CLAUDE.md` + `docs/architecture/c4-model.md` + vps-ops `host-facts.md` synced to the current topology.

## [8.71] - 2026-08-29

### Fixed — performance radar data correctness + scoped activity clamp

- **`computeTradeActivityPercent` clamps held spans to the scoped window** — positions are selected by `closeTime >= since` but their counted open→close day span previously leaked days before `since` into the numerator while the denominator stayed window-length, so the 1D view could exceed 100% (a position held 6 days closing today scored 600%, silently clamped at the radar rim). Active days now never exceed the window; the `all` path is unchanged. Four new unit tests pin the clamp, partial overlap, and empty-window semantics.
- **`PerformanceRadar` tooltip leads with real metric values** — the normalized 0-100 score is no longer the headline; each axis now reads its actual value (`-` when missing) as the headline, with the plotted score and a ยิ่งสูง/ต่ำยิ่งดี orientation cue demoted to a secondary hint line, so MAX LOAD >100% (pre-stop-out) and the inverted MAX DD axis are no longer indistinguishable from their scores.
- **No-data no longer fabricates a score** — a 0% MAX DD in a window with zero closed positions (which the inversion previously plotted as a perfect score) now renders at the center and reads "ไม่มีข้อมูล"; missing inputs map to the center on every axis instead of the extremes.
- **`metric-registry` gains the radar-axis descriptors** — `max-balance-drawdown-pct`, `win-percent`, `algo-trading`, `trade-activity` now document source/formula/apiField exactly as implemented; the exact-array contract test covers them.
- **React aligned to 19.2.7** — an npm refresh floated `react` to 19.2.8 against the exact-pinned `react-dom` 19.2.7 (version-mismatch crash), which broke dev-server route compilation and a production rebuild returned 500s; `react` is now pinned exactly to `19.2.7` (mirroring `react-dom`) so the pair cannot drift again.
- `AGENTS.md` — radar tooltip/no-data semantics, Trade Activity % definition.

## [8.70] - 2026-08-29

### Added — heatmap tooltip P/L tint

- **`ProfitHeatmapPanel` tap-tooltip P/L tinted by sign** — positive P/L values render through the green tone class and negative through the red (`tone-positive`/`tone-negative`), so the tap tooltip reads at a glance which cells gained or lost; zero stays untinted. Runtime-verified on a spare-port dev server with Node Playwright + system Chrome.

## [8.69] - 2026-08-28

### Fixed — live position times stop guessing the broker UTC offset

- **Null `brokerUtcOffsetMinutes` renders `-` instead of shifting times by 0** — the live route no longer defaults an unconfigured broker offset to 0: `normalizeMt5PositionTimes` nulls `openTime` (`Mt5Position.openTime` widened to `number | null`), `DashboardCard` passes `openedAt: null` through, and `formatBangkokDateTime` renders `-` per the zero-as-empty convention — matching the worker's fail-loud rule instead of displaying times shifted by the full broker offset.
- Docs — nssm-only service control promoted from a buried mt5ops reference into the vps-ops Never-list, host-facts, and CLAUDE.md deploy notes.

## [8.68] - 2026-08-27

### Changed — backfill empty-region window coalescing (ADR-0006)

- **30-day windows over empty regions** — while the committed prior window is provably empty (zero deals and zero orders), the bridge sizes the next backfill window to `BRIDGE_HISTORY_EMPTY_WINDOW_RAW` (default 30 days) instead of the fixed 1-day span, collapsing back to `BRIDGE_HISTORY_WINDOW_RAW` once a window is non-empty; the 2025 empty prefix is crossed in ~14 windows instead of ~420.
- Coverage semantics unchanged — windows stay contiguous half-open `[start, end)` ranges, so the gap-free coverage proof never depended on window granularity. Durability is untouched: progress still advances only when the SQLite journal records the window and the worker durably persists the chunk.
- Fail-safe defaults — a missing prior window (emptiness unknowable), an unset `empty_window_raw`, or a prior-window row that can't be loaded all keep the fixed maximum span; `HistoryPolicy` rejects an empty span below `maximum_window_raw`.
- Tests — six unit cases (coarse first window on fresh journal, widening after empty prior, collapse after non-empty prior, missing-prior fallback, disabled-by-default span, policy validation) plus two journal-integration cases (coarse→fine transition replays overlap idempotently, legacy fine-empty journal widens under the new policy without checkpoint reset).
- Docs — ADR-0006 (`docs/decisions/0006-empty-region-window-coalescing.md`), `docs/ARCHITECTURE.md` §6, `bridge/README.md`, `bridge/.env.example`, `CLAUDE.md` history-durability section, implementation plan marked IMPLEMENTED.

## [8.67] - 2026-08-26

### Changed — account sort precedence: today's trades first

- **`compareAccountListItems` reordered** — today's closed-trade count (`today_trade_count`) is now the primary sort key, so accounts actively trading rank above quiet ones; tie-breakers follow as growth `1D` desc → pips `1D` desc → balance desc → accountNo asc (previously growth led and trades broke ties third).
- Aligns the list order with the activity-driven card collapse (8.66): the accounts rendering full cards are also the ones at the top of the list.
- `account-data.test.ts` sort suite rewritten for the new precedence; `CLAUDE.md` account-ordering convention updated.

## [8.66] - 2026-08-25

### Changed — activity-driven card collapse; chevron after name; TODAY rail removed

Course-correction on 8.65 after operator feedback — hierarchy now comes from card size itself, not an added rail.

- **Auto-organize by activity** — accounts that traded today (`today_trade_count > 0`) or hold open positions (`open_position_count > 0`) render the full card; quiet accounts auto-collapse to the compact strip. Quiet rows shrink, active rows expand — size is the scanning signal.
- **Chevron moved inline after the account name** (44×44 hit box preserved via negative-margin layout pull; `aria-expanded` and rotation unchanged) — the numbers side of the strip is now flush right with nothing between it and the edge.
- **TODAY rail removed** — strip carries identity (name/#/status + chevron), today growth, and equity only; rail-only strip props (`openCount`/`floatingPl`/`live`) dropped.
- **Session-only expansion pins** — manual expand/collapse pins that card for the session (state map in `DashboardClient`, no `localStorage`); every reload re-organizes by today's activity, and unpinned cards re-organize live as pull/resume refreshes land new trade counts.
- **Deferred placeholder shares the strip header** — `DeferredDashboardCard` (activity-expanded cards below the eager slots) now renders the same `AccountCardStrip` over its skeleton body with real equity/growth and the collapse chevron, instead of the old placeholder header that showed `balance` labeled "Balance" and growth "-".
- **Collapsed names truncate to one line** (ellipsis) so strip height is deterministic; `contain-intrinsic-size` retuned to the measured one-line strip (52px content-box portrait / 61px landscape chip — totals ≈80/82px) so content-visibility reservations match what renders instead of jumping 6–36px on first reveal. Landscape chip width 340→320px.
- `AccountCardStrip.test.ts` rewritten for the new contracts (chevron-after-name, rail absence, activity-driven default, no-persistence, single render site, 44px toggle, landscape chips).

## [8.65] - 2026-08-25

### Changed — collapsed-first account cards ("which accounts traded today" at a glance)

- **Compact strip header** (`AccountCardStrip.tsx`, new) — every card now starts collapsed to a dealing-row strip: name/#/status, today growth, equity, and the TODAY rail (`4 trades +$164.20 · ⦿ 2 open +$46.35`). Accounts in the market render lit mono numerals; quiet accounts render a ghost "No trades today" — the lit/dim contrast makes a 5-account scan instant. The open-segment dot pulses only while a live bridge connection feeds the card.
- **Zero per-card requests while collapsed** — the strip renders entirely from the accounts-list payload. New serialized field `open_position_count` (from `openPositions.length`, single builder `serializeAccountBundle`) backs the "N open" segment; `floating_pl` was already on the payload. Collapsed cards no longer mount `useLiveData` 2s polls or overview/balance fetches — on load the dashboard issues exactly one request (`/api/accounts`) until the operator expands a card.
- **Expand/collapse** — chevron button (44×44, `aria-expanded`, rotates 180°) mounts the full body (timeframe strip, curve, KPI chips, panels); the strip persists as the expanded card's header, now fed live-bridge values (live equity/flash, live open count, live floating P/L). Strip growth stays pinned to TODAY regardless of the body's selected timeframe — the number's scope is now stated instead of silently switching.
- **Persistence** — the expanded set survives reloads via `localStorage` (`analytic:expanded-cards`), applied post-mount to keep SSR HTML stable; below-fold restored cards keep the deferred-mount observer + 4s fallback (`LazyDashboardCard` now scopes deferral to expanded cards only).
- **Landscape** — collapsed cards render as compact swipeable chips in the horizontal carousel instead of full-height panels.
- Chart-scrub behavior preserved (scrubbing the curve flips the strip's number to that point's balance via the aria label); `trackCardExpand` analytics event added.
- Fixtures: view-contract fixture regenerated (`open_position_count` in the contract account), `formatters.test.ts` / `account-data.test.ts` fixtures extended, new `AccountCardStrip.test.ts` contract suite (rail gating, payload-only strip, 44px toggle, 12px mono minimum, reduced-motion pulse guard, landscape chips).

## [8.64] - 2026-08-25

### Changed — timeframe-switch latency (sparkline + KPI chips)

Root causes confirmed by a 4-way parallel code investigation (client fetch / server routes / view-build / render path); every fix below targets an evidenced bottleneck in the switch path.

**Client:**

- **Stale-while-switch** (`useApiResource.ts`) — switching timeframe no longer nulls the previous resource's data: KPI chips keep the old timeframe's values and the chart keeps its curve until the new payload lands, instead of flashing chips to `-` and the chart to a skeleton for the full round trip. First-ever load still starts empty.
- Curve series are now point-capped server-side (below), so the sparkline's per-point SVG commit (segment path + hit-target circle per point, per card) drops from thousands of nodes on 1y/all to ≤480 — this render cost was paid on every switch, warm or cold.

**Server:**

- **Curve LTTB downsampling** (new `CURVE_POINT_BUDGET = 480`, `downsampleBy` in `core/downsample.ts`) — `balanceCurve` (was one point per deal), `drawdownCurve`, and the balance route's `equityCurve`/`equityDrawdownCurve`/`depositLoadCurve` (was per-60s sample, ~10k rows for the 7-day window) are shape-preserving LTTB-sampled server-side with endpoints always kept. Payloads shrink from MBs to KBs on long windows; the equity builders also `select` only the columns they read. View-build contract fixture unchanged (synthetic source is under budget).
- **Equity ticks no longer discard the worker session** (worker protocol extension) — a ~60s `EquitySnapshot` tick used to mint a new `sourceId`, re-stringifying the ~15MB source on the main thread, re-parsing + re-running the 1.8s timeframe-invariant precompute in the worker, and rebuilding every warm timeframe (6–8s of worker CPU per account per minute, exactly when users switch). New `patch` message re-keys the worker session in place (snapshots replaced via structured clone; parsed source and precompute survive — equity never feeds the precompute). A missed patch (evicted session) falls back to a full source send, and an `unknown sourceId` build now retries once with the source instead of erroring the request.
- **Equity revalidation retention** (`selectEquityRevalidationPlan`) — equity reaches a built view ONLY through the scoped deposit-load peak (`computeMaximalDepositLoad`), so a tick that doesn't move a window's peak retains that view byte-identically (re-keyed into Redis L2 under the new version) instead of rebuilding it. Only peak-moved timeframes rebuild.
- **Background timeframe prewarm** (single-lane queue, one build at a time with event-loop yields and bundle-identity checks) — after a cold build or aggregate rebuild, the remaining dashboard timeframes warm in the background so the first switch to any timeframe lands on a memoized view; interactive requests interleave at single-build granularity.
- **Equity-series memo** (`equity-curve.ts`) — the balance route's snapshot-derived series are served from a 10s-TTL, in-flight-deduped memo: a 5-card switch burst collapses to one `EquitySnapshot` query instead of 10; the live-point merge stays per-request so the freshest polled equity still tops the curve.

## [8.61] - 2026-08-25

### Changed — view-build pipeline + panel payloads architecture refactor (loading-time performance)

Root-caused via 6-way parallel investigation with adversarial verification and a synthetic 28k-deal/20k-position benchmark; every number below is measured on this codebase.

**Server build pipeline (`src/lib/trading/`):**

- **In-flight build dedupe** — `bundle.timeframes` now memoizes build *promises*, so a card mount's burst of same-view requests (overview+balance+positions page-1) shares ONE worker build instead of 3–4 duplicate multi-second builds.
- **Worker protocol v2** (`view-build-worker.ts` / `view-build-worker-entry.ts`) — the worker retains the parsed source per `sourceId` (aggregate+equity version), so the ~15MB source JSON is stringified/transferred **once per version** instead of once per timeframe build (measured 384ms + 14.85MB per transfer on the main event loop); views return via postMessage structured clone instead of per-view JSON strings (saves a further ~330ms stringify/parse on large views); background warm loops batch all warm timeframes into one request. Worker respawns on transient thread errors (permanent inline fallback only after 3 consecutive errors); `shutdownViewBuildWorker()` added for graceful teardown.
- **Timeframe-invariant precompute** (new `view-precompute.ts`) — all-time/YTD/yearly growth, deal-comment and order maps, and the former main-thread bundle precompute (~0.85s per rebuild) are computed once per source version inside the worker and shared by every timeframe build. Measured `buildTimeframeView` on the synthetic source: `1d` **2.24s → 0.34s (−85%)**, `all` 4.79s → 2.80s; cold 4-timeframe warm ~11.5s → ~5.8s worker CPU with the main event loop now blocked only once per version instead of per build. The deal-comment FIFO lookup uses a per-build cursor (shared maps must not be drained destructively across builds).
- **History-only aggregate version key** — `buildAccountAggregateVersionKey` now keys ONLY on latest deal time, latest position close time, and report-result recompute stamp. `AccountSnapshot.updatedAt` (~2s churn while trading) and `TradingAccount.reportDate` drift (~5min) no longer invalidate the cache, so live ticks stop triggering full-history DB reloads + view-rebuild waves; equity freshness is served by the (now incremental, single-row append) equity patch path with warm worker rebuilds. Tradeoff: equity-derived view fields (maximalDepositLoad, open-position floats) can lag one revalidation cycle — the UI already overlays live `/live` data.
- **Server-side panel aggregates** (new `preaggregated/panel-aggregates.ts`) — `positions.summary.botPerformance` (per-bot gross/net/wins/losses) and `summary.dailyPnl` (Bangkok-day buckets) computed inside the view build.

**Client payloads:**

- **Bot P/L panel** (`BotPnLPanel.tsx`) — the chart/table now read the cached `positions?…&history=0` summary (~KB); the mount-time serial pagination loop over every closed position (multi-MB, 6 serial roundtrips on 1M+ timeframes, re-downloaded on every DD-chip open) is replaced by an on-demand, page-capped (5 pages), session-cached fetch that runs only when a bot drill-down sheet opens.
- **P/L heatmap** — reads `summary.dailyPnl` from the all-time summary instead of downloading every lifetime position (`limit=100000`, ~MBs).
- **DD→WIN/EXPECT performance panels** — the 17 scalars `PerformanceBars`/`PerformanceRadar` need ride the overview payload (`kpis.performance`), so sub-panel switches render from already-loaded data instead of a separate `history=0` roundtrip; `needsPositionSummary` is now opens-only.
- **Overview diet** — `overview.balanceCurve`/`openBySymbol`/`tradeExecutions` are no longer emitted (zero dashboard consumers; the curve alone was ~300KB per long timeframe, downloaded twice via overview+balance). Fields stay optional on the wire type for older Redis L2 entries.
- **Prefetch hygiene** — the redundant `limit=1` intent probe is gone (overview+balance prefetches already warm the same server view); the mount-time `timeframe=all&history=0` prefetch no longer forces the heaviest (full-history) build seconds after load — chips fetch on first tap.

**Build chain:** `npm run build` now chains `build:view-worker` before `next build`, and `scripts/sync-standalone.mjs` **fails** when the worker bundle is missing — previously a skipped step silently shipped a web process where every view build ran inline on the event loop (the exact multi-second stalls the worker exists to prevent).

### Added

- View-build contract test (`view-build-contract.test.ts` + `view-contract-source.ts` + regenerable fixture via `scripts/generate-view-contract-fixture.ts`) pinning all 7 view kinds byte-stable across build-pipeline refactors; in-flight/batch dedupe tests; worker protocol e2e test against the real bundle; panel-aggregate tests.

## [8.47–8.57] - 2026-08-20..2026-08-24 (backfilled)

Performance series that previously existed only as commit subjects; accepted tradeoffs made explicit:

- **8.47** — warm timeframe views in background after equity patch; prefetch positions view on timeframe intent.
- **8.48** — serve warm views during equity-only changes (60s EquitySnapshot ticks), revalidate in background. *Tradeoff: equity-derived view fields may lag one tick.*
- **8.49** — serve-stale on aggregate-version change too; live ticks no longer force synchronous rebuilds on the request path.
- **8.50** — yield the event loop between background view builds; bound fire-and-forget Redis view-cache writes at 2s. *Rationale: a slow-but-reachable Redis must never make a request slower than skipping the cache.*
- **8.52** — whole-repo simplify pass (dedupe hot-path computations, single sort+reverse for positions).
- **8.53** — stop liveness-driven rebuild storm: `lastSeenAt` column (pure liveness, excluded from cache version keys), bridge upsert fingerprint guard, DB-side earliest-open aggregate, concurrent equity builds, client LRU + deduped writes.
- **8.56** — move timeframe view builds to a worker thread (JSON-RPC, lazy singleton, inline fallback). *Tradeoff carried into 8.61: source was re-serialized per single-timeframe build; fixed by the protocol-v2 session cache.*
- **8.58** — instant trades chip (cached page-1, mount/timeframe-intent prefetch, skeleton states, content-visibility row windowing). *Tradeoff carried into 8.61: mount-time prefetches forced the heaviest builds seconds after load.*

Redis L2 view cache invariants (unchanged by 8.61): 512KB per-value cap — accounts whose view set exceeds it are never Redis-cached and fall back to live compute (correctness unaffected; cold-start cost only), 300s TTL, 300ms read / 2s write timeouts, keys embed both version keys.

## [8.59] - 2026-08-25

### Changed

- **`vps-ops` skill: merged the standalone `mt5-ops` hermes skill into it** (`.claude/skills/vps-ops/`). New `references/mt5ops.md` + `scripts/mt5ops.py` (status / svc / stack / term / pause / resume / notify / reboot-check) are now the single source for MT5 terminal + service-stack ops; the duplicate hermes-side `mt5-ops` skill is retired. `mt5ops.py term start` now launches terminals ONLY via a `.lnk` (Startup first, else the parked `C:\pause` shortcut) — direct `terminal64.exe /portable` launches are refused (portable-profile rule); previously it ran the exe directly. Status-summary send path is now the Photon SMS sidecar (`mt5ops.py notify`, replaces the stale hermes-gateway/iMessage discovery flow in `status-summary.md`).

## [8.58] - 2026-08-25

### Added

- **`vps-ops` skill** (`.claude/skills/vps-ops/`, with `.agents/skills/vps-ops` symlink) — Windows-only operations runbook for the forexvps single host: iMessage status summaries via the hermes gateway, deploy flow, first-time NSSM installs, and MT5 EA `.chr` input edits. Repo is the source of truth; hermes consumes a copy at `C:\Users\supachai\.agents\skills\vps-ops\` (install flow in the skill's `INSTALL.md`).

### Removed

- **Harness workflow fully retired** (skill tree was already deleted by e918803 "reset skill"): `docs/harness/analytic/team-spec.md`, `_workspace/` durable handoffs, `scripts/check-harness-review.sh` pre-push secret/env guard, `scripts/install-git-hooks.sh` + `package.json` `hooks:install`/`harness:check` scripts, and the Codex-side `.codex/skills/harness/` meta-skill. **Note: there is no longer any automated pre-push secret check — never commit hardcoded secrets or `.env*` files.** Dangling references cleaned from `CLAUDE.md`, `README.md`, `vps-ops/references/deploy.md`, and `bridge/scripts/install-service.ps1`.

## [8.46] - 2026-08-21

### Removed

- **Docker dev/test stack deleted** — `Dockerfile` (web image), `Dockerfile.caddy` (xcaddy DuckDNS build), `docker-compose.test.yml` (isolated db-test:5434 / redis-test:6380), `.dockerignore`, and `.env.test.example`. Production has run as native Windows services on forexvps since the 2026-08-17 single-host migration; the dev Compose stack was already retired in 8.45-era leanness passes, and CI provisions its own Postgres service container without any repo Docker files.
- `scripts/backup-postgres.sh` — dumped the retired Compose-era `analytic-db-1` container; obsolete under the native PostgreSQL 18 service.
- `package.json`: `test:env:up` / `test:env:down` scripts removed with the test Compose stack. Opt-in integration tests (`RUN_WORKER_V2_HISTORY_INTEGRATION=1`, `RUN_HISTORY_RECOVERY_INTEGRATION=1`, bridge durable-Redis integration) now require manually provisioned local PostgreSQL + Redis.

### Changed

- README/CONTRIBUTING/CLAUDE.md/ci.yml guidance rewritten for native (or WSL2) PostgreSQL + Redis with `DATABASE_URL`/`REDIS_URL`; stray Compose references dropped. `.gitignore` no longer whitelists `.env.test.example`.

## [8.44] - 2026-08-20

### Removed

- **`ssh-vps` skill deleted** (`.claude/skills/ssh-vps/`, 14 files) — the SSH-based ops runbook for the forexvps host. Claude Code now runs on the host itself, so the SSH-hop framing is obsolete; on-host operational knowledge lives in `CLAUDE.md` (deploy flow), the `run-analytic` skill, and the 2026-08-17 migration plan. Dangling references cleaned from `CLAUDE.md`, `README.md`, `docs/architecture/c4-model.md`, `docs/architecture-data-models.md`, and `run-analytic/SKILL.md` (content preserved, pointers dropped).

## [8.43] - 2026-08-20

### Removed

- **Superseded/completed planning docs deleted** (content remains in git history): `docs/IMPLEMENTATION_PLAN.md` (superseded — implemented in `bridge/`), `docs/worker-v3-implementation-plan.md` (superseded — worker v2 sole worker), `docs/pg15-to-pg16-migration.md` (historical runbook), `docs/codebase-review-2026-08-02.md` (one-off review), all 7 July-era `docs/plans/*.md`, and `docs/superpowers/plans/2026-08-{02,03}-*.md` (implemented: dashboard doc fixes, outbox replay). Kept: `2026-08-17-windows-single-host-migration.md` (Task 7 items still open) and `2026-08-18-backfill-empty-region-coalescing.md` (planned, not started).
- `docs/ARCHITECTURE.md`: dropped the stale "working-tree change as of 2026-08-01" note pointing at the deleted IMPLEMENTATION_PLAN.md (ADR 0001's historical references left untouched per point-in-time record convention).
- Repo hygiene: stale remote-tracking refs pruned (remote had only `main`); `v8.42` tag synced.

## [8.42] - 2026-08-20

### Changed

- **`deepmerge-ts` override scoped and pinned exactly:** the override introduced in 8.41 (to clear the advisory in `@prisma/config`'s `deepmerge-ts` 7.1.5 pin) moves from root-scoped `"^8.0.0"` to `"@prisma/config": { "deepmerge-ts": "8.0.1" }`. The exact pin also makes the lockfile-less runner-stage `npm install prisma@6.19.3` inside the Docker image deterministic — the standalone `package.json` shipped by `scripts/sync-standalone.mjs` carries the override into the runner, so a future `deepmerge-ts` 8.x release can no longer float into the `prisma migrate deploy` path on image rebuilds.
- **Override removal condition:** drop the `@prisma/config` override once `@prisma/config` depends on `deepmerge-ts >= 8.0.1` (check: `npm view @prisma/config@latest dependencies`, then confirm `npm audit` stays clean without the override).

## [8.19] - 2026-08-01

### Changed

- **Redis key namespace migrated:** the legacy `mt5n:v1:*` namespace has been retired. Production is cut over to `mt5:account:{login}:*` (lease, lease-epoch, fence-counter, live, stream:history), with all keys for one account hash-tagged to the same Redis Cluster slot. Bridge (VPS) and worker-v2 were redeployed and restarted together; verified across all active accounts (lease TTL, live timestamp advancing, history stream readable, consumer group lag/pending at 0, PostgreSQL ingestion continuing).
- Redis key generation centralized: `src/lib/mt5-redis-keys.ts` (worker-v2/lib) and `bridge/redis_transport.py`'s `RedisLease.cluster_keys()` (bridge) are now the single source of each side's key format.
- `cache:report-view:*` and `social:sparkline:*` established as top-level Redis namespaces, siblings of `mt5:`, not nested under it — derived/application state with independent lifecycles from the MT5 bridge protocol.

### Removed

- **`stream:live` removed from the Redis contract** — a write-only mirror of every live/error publication with zero consumers (confirmed by repo-wide grep). Removed from producer code (`bridge/redis_transport.py`, `bridge/live.py`), tests, and documentation.
- Legacy `mt5n:v1:*` Redis keys deleted from production after the new namespace was verified healthy (25 keys, `SCAN`+`UNLINK`, zero failures).

## [6.91] - 2026-06-23

### Changed

- **Stack simplified to Next.js-only:** Removed Python FastAPI gateway (`backend/`), MT5 collector sidecar (`collector/`), shared Pydantic models (`shared/`), and their Dockerfiles. The historical FTP→Worker→PostgreSQL→Next.js path remains the sole data pipeline.
- **docker-compose:** Removed `gateway` and `snapshot` services; removed `caddy` dependency on `gateway`; removed `x-backend-build` and `x-backend-depends-on` anchors.
- **SparklineChart 1D axis:** Fixed x-axis labels to use Bangkok timezone (UTC+7) instead of raw UTC hours.

### Removed

- `backend/`, `collector/`, `shared/` — Python services and shared models
- `Dockerfile.backend`, `Dockerfile.collector` — Python container build files
- `CA/` — SSL certificate files
- `migration.sql`, `test-base.txt` — stale one-off files

## [Unreleased]

### Fixed (2026-06-11 audit)

- **EconomicCalendarPanel**: Restored full framer-motion implementation from HEAD; removed light-theme inline styles that broke dark terminal design
- **BotPnLPanel**: Disabled ApexCharts animations to prevent `elDefs.node null` crash on unmount (regression from cleanup)
- **useRealtimeAccount**: Added exponential backoff WebSocket reconnect (2s–30s, max 10 retries); removed console logs; changed return type to `void`
- **DashboardClient**: Removed unused `dcRightView`/`setDcRightView` state; fixed named import for EconomicCalendarPanel
- **OpenPositionsPanel**: Fixed named import for EconomicCalendarPanel
- **preaggregated-cache**: Removed unused `currentFloatingProfit` variable
- **eslint.config.mjs**: Added `.remember/**` to lint ignore list
- **stats/page.tsx**: Changed value import to `import type` for SerializedAccount

## [6.8.0] - 2026-06-04

### Added

- **Open-positions empty state:** Render an explicit "วิเคราะห์ทางเทคนิค XAUUSD" CTA that opens the technical-analysis modal, plus an embedded TradingView timeline of ICMARKETS:XAUUSD top stories in `th_TH`.
- **TradingView analysis modal:** Reusable zoom-in/out modal hosting the existing technical-analysis widget.
- **Server-side balance-curve downsampling:** Reduces payload for long timeframes before sending to the client.

### Changed

- **ABS KPI is now period-scoped:** `absoluteDrawdown` in both `overview.kpis` and `balanceDetail.summary` now uses `totalWithdrawals(period) + balance − totalDeposits(period)`, driven by the existing timeframe selector. Previous wiring fed `max(0, …)` into a loss-only formatter that always rendered "0".
- Extracted growth-calculation core logic into reusable helper.
- Frontend uses an environment variable for the WebSocket URL.

### Fixed

- **Balance curve drops empty-type trade deals:** `hasDealTypeOrComment` no longer treats `type=""` as "no metadata", so trades MT5 emits with empty `type` and `null` comment are included in the running balance, drawdown, and growth calculations.
- **Multi-account WebSocket publish:** `ingest_deals` groups deals by account and publishes to each account's Redis channel separately.
- **BotPnL tooltip sign:** Tooltip writes `grossLoss` with an explicit sign so future sign-convention refactors cannot silently flip it.
- **Backend network isolation:** Restored `internal: true` on `backend_net` so `db` and `redis` cannot reach the public network.
- **Gateway health checks:** Switched to `curl` with longer timeouts; added a real `/health` endpoint to break the docker-compose startup deadlock.

### Removed

- `backend/abs_calculation.py` placeholder (had a SyntaxError, `Decimal` + `float` TypeError, missing balance-adjustment classifier, and a different formula than the dashboard).
- Old `TradingViewTechnicalAnalysis` component in favor of the new modal-hosted widget.

## [6.6.0] - 2026-05-24

### Added

- **Real-time Architecture Rewrite:** Complete transition to a near-realtime, multi-tenant architecture.
- **Python MT5 Collector (Sidecar):** New lightweight, resilient worker that polls MT5 terminals every second and pushes HMAC-signed payloads.
- **FastAPI Ingestion Gateway:** New backend service to validate, authenticate, and route incoming MT5 data.
- **Redis Live-State Cache:** Integrated Redis for real-time state management (equity, PnL, positions) and Pub/Sub broadcasting.
- **Real-time WebSocket Streaming:** Frontend now receives live updates via WebSockets, eliminating aggressive client-side polling.
- **Snapshot Persistence Worker:** Background service that persists 1-minute state snapshots from Redis to PostgreSQL for historical analytics.
- **Incremental Trade Reconciliation:** Efficient deal syncing mechanism using ticket cursors.
- **Shared Schemas:** Centralized Pydantic models for cross-service type safety.

### Fixed

- **WebSocket Disconnect Detection:** Fixed the FastAPI WebSocket endpoint to correctly detect client disconnects using `asyncio.wait` and `FIRST_COMPLETED` strategy.
- **Hanging WebSocket Tests:** Resolved issues where `test_websocket.py` would hang due to event loop conflicts between `TestClient` and `asyncio.create_task`.
- **Global Test State Pollution:** Fixed `test_main.py` globally mocking the Redis client, which caused failures in isolated test modules.
- **Signature Verification Mocking:** Corrected a hardcoded secret in `test_redis.py` that caused 401 Unauthorized errors during testing.
- **Persistence Worker Warnings:** Fixed `RuntimeWarning`s in `test_worker.py` caused by improper `AsyncMock` usage for synchronous connection methods.

## [6.3.0] - 2026-05-16

### Added

- Added BotPnLPanel showing per-bot gross profit/loss as bars with a tap tooltip.
- Added a timeframe selector below the history list in the Trades panel.

### Changed

- Redesigned the Performance Quality panel as semicircular benchmark gauges (Poor/Fair/Good/Great) with a zone-colored value and per-metric subtitle.

### Fixed

- Fixed the BotPnL tooltip being clipped by the chart frame so it is now visible, and trimmed it to show only the bar values.
- Updated the app version to 6.3.

## [6.2.0] - 2026-05-13

### Added

- Added long-press guidance for DD panel gauges and refreshed loading/performance hints across the dashboard. ([PR #39](https://github.com/therng/analytic/pull/39))

### Changed

- Sorted accounts by weekly growth performance so the strongest accounts surface first.
- Updated heatmap day labels to M/W/F. ([PR #40](https://github.com/therng/analytic/pull/40))
- Simplified the sparkline live beacon to a single ring with a natural heartbeat blink. ([PR #41](https://github.com/therng/analytic/pull/41), [PR #43](https://github.com/therng/analytic/pull/43))
- Muted inactive account names and chart lines for cleaner focus. ([PR #45](https://github.com/therng/analytic/pull/45))

### Fixed

- Kept the chart tooltip visible on desktop click. ([PR #44](https://github.com/therng/analytic/pull/44))
- Tightened open-position expanded-row typography and comment alignment.
- Updated the app version to 6.2.

## [6.0.0] - 2026-05-06

### Changed

- Redesigned KPI and Performance Quality hints as Preview Cards with zoom transitions.
- Redesigned Open Positions row layout with expandable details (S/L, T/P, Comments).
- Optimized Loading Screen candle animation (faster loop cycle).
- Refactored Loading Screen component for better performance.
- Fixed Pips Performance Table to be non-scrollable for better visibility.

### Fixed

- Fixed missing 'memo' import in Performance Quality Panel.
- Resolved Next.js build cache corruption issues.

### Added

- Standard documentation files (CONTRIBUTING, CHANGELOG).

### Fixed

- Fixed Safari Safe Area display issues on the Stats page.
