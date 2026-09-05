---
title: Closeout Package — Migration Closeout, Bridge Cleanup, Wire-Field Dead Plumbing, Docs Truth Pass (8.75 → 8.76)
created: 2026-09-06
author: EM (Claude) via coordinator pipeline
status: approved
---

# Closeout Package: Migration Closeout → Bridge Cleanup → Wire-Field Dead Plumbing → Docs Truth Pass (8.75 → 8.76)

> Approved 2026-09-06. Working draft: `~/.claude/plans/resume-with-ultracode-lazy-haven.md`; advisor rationale: `docs/plans/archive/2026-09-06-advisor-recommendation-vp-product.md`.

## Context

PM opened the session with "discovery what we have to do" (ultracode effort). A 3-lens read-only discovery (docs/plans · git/release · code-debt) converged on four workstreams + one product open loop. PM approved **all four workstreams** and delegated sequencing/scope/W5 disposition to an advisor (`coordinator:vp-product`) with the directive *"ask advisor for recommendation then apply"* — recommendations received and applied. A Plan agent then disk-verified every citation and **materially corrected W4's scope**; the EM re-verified the four load-bearing corrections first-hand (`types.ts`, `report-view-cache.ts`, `preaggregated-cache.ts` reads, 2026-09-06).

Repo: `C:\analytic` on branch `main` @ `bbb6e28` (8.75), clean, fully pushed. Single forexvps Windows host, dev = prod. Live MT5 terminals + live trading data.

## Decisions applied (advisor, PM-ratified)

- **Order: W1 → W2 → W4 → W3.** W1 probes are the ground truth W3 cites; W2 gets a dedicated bridge window before code churn (clean attribution); W3 docs written against the verified end state.
- **W5 (CRITICAL KPI): keep removed + write ADR-0007** — trial ~32 h (8.74 2026-09-01 22:33 → revert 8.75 2026-09-03 06:25), rationale never stated, substrate (`deposit_load_pct`) deliberately preserved; retry preconditions: operator names WHICH aspect failed (weighting/placement/redundancy).
- **PG16 uninstall + postgresql.conf tuning: inside W1 execution**, operator-gated, PG16 strictly last.
- **XLEN gap: won't-fix-with-recurrence-trigger** close-out (not a root-cause hunt).
- **`as any` casts: inside W4** (Commit B, same deploy window). L2 gate: **resolved, no shim** (TTL 300 s + unvalidated `JSON.parse` — old entries die in ≤5 min; verified `report-view-cache.ts:12,:186`).

## Key corrections from disk verification (supersede discovery wording)

1. **W4 shrank.** `preaggregated-cache.ts:554-573`/`:528`/`:581-592`/`:698`/`:1047` feed **live** endpoints — `PositionsResponse.openBySymbol` (`types.ts:345`, non-optional) and `BalanceDetailResponse.balanceCurve` (`types.ts:235`, non-optional). **Do NOT remove.** The overview build (`preaggregated-cache.ts:594-633`) already omits all three deprecated fields — the ~300 KB perf win is banked. Remaining W4 work = dead type/fixture/function plumbing only.
2. **W2 nuance.** Removing `bridge/accounts/*.json` overrides does NOT re-crawl live journals (per-journal checkpoint bounds persist, forward-only). Only fresh journals crawl from 2025-01-01 — ~2 min with ADR-0006 coalescing. **Never reset a live journal to "prove" coalescing** (destroys coverage proof); proof = bridge test suite (404 green) + config verification.
3. **W1 actuals.** Task 7: Steps 1-4 unchecked, Step 5 `[x]`, Step 6 unchecked (`:595-637`). pg-dump implemented as `scripts/pg-dump-daily.ps1` keep-7 (deviation from plan sketch).
4. **Stale docs.** vps-ops `deploy.md:124,160-164` still says `nssm restart bridge` — stale since 8.72. Sanctioned bridge restart: `schtasks /End` + `/Run /TN analytic-bridge` (foreground wrapper — `/End` takes the process tree down).

---

## W1 — Migration closeout (probes → report → gated host ops)

**W1.1 Scheduled tasks** (read-only): `schtasks /Query /TN <task> /V /FO LIST` for `analytic-pg-dump`, `analytic-worker-health-probe`, `analytic-bridge`, `analytic-redis-wsl-keepalive`. Pass = exists, Last Result 0x0, sane Next Run, bridge Running. Nonzero/missing → recorded deviation, box stays unticked.

**W1.2 PG services + conf**: `Get-Service -Name 'postgresql*'` (expect x64-18 Running/Auto, x64-16 Stopped); `Select-String 'C:\Program Files\PostgreSQL\18\data\postgresql.conf' -Pattern '^\s*listen_addresses|^\s*max_wal_size'` — record actuals.

**W1.3 Reboot events**: `Get-WinEvent -FilterHashtable @{LogName='System'; Id=1074,6005,6006; StartTime='2026-08-28'; EndTime='2026-09-01'}` — expect Aug 29 ~21:28 restart + Aug 30 ~02:31 reboot (progress-log claims).

**W1.4 Backups**: `Get-ChildItem C:\backups` — ≤8 dumps (keep-7), newest <24 h, plausible size for 57k-deal DB; cross-check mtime vs task Last Run; confirm `scripts/pg-dump-daily.ps1`.

**W1.5 Live-site criteria** (read-only; Sunday = quiet markets, so "tiles move" = live-key TTL refresh): `curl -fsS https://therng.duckdns.org` → 200; `/api/accounts` → 5 accounts; `curl http://127.0.0.1:9200/health` green; two TTL reads 10 s apart of `mt5:account:7950622:live` via `wsl -d Ubuntu -- redis-cli --no-auth-warning -a "$REDIS_PASSWORD" TTL ...` (source REDIS_PASSWORD from .env, never echo) → TTL ≤ 60, re-set on second read.

**W1.6 Repo docs** — commit `docs(migration): close out Task 7 — probe evidence, final report, deviations`:
- Tick Task 7 Steps 1-4 boxes ONLY where W1.1-W1.5 evidence substantiates (Steps 1-2 via W1.3 event log), each tick with a one-line evidence pointer.
- Append dated Step 6 final report against the `:639` criteria (site opens / accounts render / live tiles move / backfill progressing / reboot survived) — spec rule: "Any unchecked item = not done"; anything unproven stays unchecked and named.
- Add two lists: **Topology deviations accepted** (NSSM-LocalSystem; Redis systemd-in-WSL2 + keepalive task; bridge scheduled task; pg-dump script+keep-7 vs plan sketch) and **Operator decisions** (PG16; postgresql.conf; off-box backup target — plan `:614`).

**W1.7 postgresql.conf tuning — OPERATOR GATE**: `listen_addresses` → loopback (keep firewall rule as defense-in-depth) + `max_wal_size`; ONE window, ONE PG18 restart (`Restart-Service` — native-service exception). Verify: `:9200` health + verify-skill smoke.

**W1.8 PG16 uninstall — OPERATOR GATE, strictly last**: preconditions = same-day green pg-dump verified; PG16 data dir holds nothing sole-copy (one-time dump or verified-disposable); PG18 healthy on 5432. Operator declines → named open deviation with clash risk; W1 does not block.

## W2 — ADR-0006 bridge cleanup (host ops, 2 operator gates)

- **W2.1** Consistency: `git log -1 --format=%ci -- bridge/history.py` (≤2026-08-26) + last `=== wrapper start` in `bridge\logs\bridge-task.log` (later) → running bridge includes coalescing.
- **W2.2** Rollback copy: `mkdir -p bridge/state/retired-overrides-20260906 && cp bridge/accounts/*.json bridge/state/retired-overrides-20260906/` (gitignored, host-durable).
- **W2.3** Delete the 5 `bridge/accounts/<login>.json` overrides (7948784, 7950622, 7953093, 7954220, 7998410).
- **W2.4 OPERATOR GATE — restart bridge**: `schtasks /End /TN analytic-bridge && schtasks /Run /TN analytic-bridge` (scheduled-task mechanism; never touches MT5 terminals).
- **W2.5** Verify 5-10 min: `bridge\state\health\*.json` fresh+healthy; live TTLs refreshing (×2); new `=== wrapper start` line; no quarantine; `:9200` registry 5/5. **Abort:** unhealthy ~10 min → restore W2.2 copy, `/End`+`/Run` again, report.
- **W2.6 OPERATOR GATE (irreversible)** — delete the 5 `bridge/state/journal/*.history-lower-bound.20260818T*.bak`; preconditions: W2.5 green AND a fresh pg-dump exists.
- **W2.7** Memory note rewrite (`C:\Users\supachai\.claude\projects\C--analytic\memory\forexvps-backfill-empty-2025.md` + MEMORY.md hook): overrides removed 2026-09-06; coalescing active; fresh-journal crawl ~2 min (~55-min-silence caveat obsolete); keep 0-deals-in-2025 fact.
- **W2.8** Repo docs — commit `docs(vps-ops): bridge control is schtasks analytic-bridge, not nssm; coalescing follow-up done`: coalescing plan `:3` Status → DONE 2026-09-06; fix `deploy.md:124,160-164`; add bridge-restart line to `host-facts.md` if missing.

## W4 — Dead-plumbing removal + as-any typing (2 commits, 1 deploy)

**Commit A** — `refactor(trading): remove deprecated overview wire-field plumbing (dead since overview omits them)`:
1. `types.ts:130-138`: delete deprecation comment + 3 optional overview fields.
2. `types.ts`: delete `TradeExecutionDistribution` (`:67-77`) + `TradeExecutionHourBucket` (`:58-66`) after grep confirms zero remaining refs.
3. `preaggregated-cache.ts`: drop `:10` import piece; delete `:87` re-export; delete `:244` `tradeExecutions?` (+ reword `:240-244` comment).
4. `view-contract-source.ts`: drop `:13` import piece; delete `EMPTY_TRADE_EXECUTIONS` (`:149-159`) + `:232` assignment.
5. `preaggregated/trade-execution.ts`: delete `buildTradeExecutionDistribution` (no callers — verified) + unused imports; **KEEP the file** (`balance-curve-24h.ts:4` imports `getDealBalancePointValue`).
6. Optional zero-risk: remove orphaned `.trade-executions-chart` CSS block (`globals.css:4432+`, no tsx consumer).
7. Regenerate fixture: `C:/nvm4w/nodejs/node.exe --import tsx scripts/generate-view-contract-fixture.ts`. **GATE:** fixture diff shows ONLY `tradeExecutions` removals — anything else → stop and re-examine.

**Commit B** — `refactor(trading): type the 9 production as-any casts in the analytics money path` (pure typing): `preaggregated-cache.ts:553` (widen/map `OpenPositionRow`), `:1048` (Decimal/number, null unions at the row→wire boundary), `:1055`/`:1137` (mapped literal element types), `account-data.ts:217,:241` (align with `computeCompoundedGrowth`'s deal param — export `DealLike` or widen structurally), `:296` (align `ReportAnchoredPosition`), `deal-kernel.ts:276` (unify structural deal type), `calculate-report-results.ts:49` (minimal structural interface of only the prisma methods used). **RULE:** a REAL value-shape mismatch discovered → STOP and surface (correctness finding, not typing chore).

**Tests (both commits):** `node --import tsx --test` on `preaggregated-cache` / `analytics` / `account-data` / `view-build-contract` / `view-build-worker.e2e` / `timeframe-view-dedupe` / `metric-registry` / `timeframe-route-contract` tests + `npm run lint` + `npx tsc --noEmit`.

**Deploy (single web restart for whole package):** `nssm stop caddy` → `nssm stop analytic-web` (caddy FIRST — EBUSY/memory rail) → `npm run build` (chains worker bundle) → `nssm restart analytic-web` → `nssm restart caddy`. Restart ONLY analytic-web (`src/worker-v2` imports nothing from `@/lib/trading` — verified). Post-deploy: verify skill with `ANALYTIC_URL=http://localhost:3000` (never starts/stops anything on 3000) + `curl` an overview — response contains none of `openBySymbol`/`balanceCurve`/`tradeExecutions`.

## W3 — Docs truth pass + ADR-0007 (last)

- **W3.1** Write `docs/incidents/2026-08-30-undocumented-teardown-outage.md` following the `2026-08-journal-acl-fix.md` 5-section template (Impact/Detection/Root Cause/Resolution/Prevention). Sources: migration plan `:648-655` + CHANGELOG 8.72. Timeline: 01:55 InvariantError 500s → 02:24-02:31 teardown + NSSM deregistration + reboot → 15:10 rebuild → 16:15 web → 17:00 bridge. Impact: ~13 h dark, 5 terminals uncollected, **zero persisted-data loss** (PG18 intact, 57,491 Deals). Root cause: process failure — unlogged destructive teardown during an active incident.
- **W3.2** `ARCHITECTURE.md:596` — close with Aug-30 evidence (57,491 Deals / 5 accounts / 5/5 live leases / forward-only sync).
- **W3.3** `ARCHITECTURE.md:595` — monitoring-note close-out: one-time, unreproduced since 2026-08-30, root cause explicitly unproven, bounded investigation only on recurrence. (Operator-silent default = this wording.)
- **W3.4** Write **ADR-0007** (advisor ruling): CRITICAL urgency KPI removed after 8.74 trial; rationale not stated; substrate retained for reuse; retry preconditions = operator names which aspect failed. Cross-ref from CHANGELOG 8.75 entry.
- **W3.5** `node .claude/skills/docs-sync/scripts/docs-impact.mjs` over the full diff; fix flagged docs.
- **W3.6** Version bump **8.75 → 8.76** + single CHANGELOG 8.76 block covering W1-W4 + push. **OPERATOR GATE** (repo rule).

## Sequencing + commits

Execution: W1.1-W1.5 probes → W1.6 docs → W1.7/W1.8 gated host ops → W2 window → W4 code+deploy → W3 docs → bump+push. W2 + W4-deploy may share one operator-attended window (bridge ops BEFORE web deploy — one interruption, two confirm gates). Commit order in git: W4-A, W4-B, W1 docs, W3 docs, W2 docs + bump + CHANGELOG last.

## Final verification (package done =)

Repo: lint + tsc + listed tests green; `npm run build` succeeded; fixture diff clean. Runtime: public URL 200; overview payload free of the 3 fields; `:9200` green; bridge 5/5 leases; live TTLs refreshing; `C:\backups` fresh. Host: no `bridge/accounts/*.json`; 5 `.bak` files gone (post-gate); all 4 scheduled tasks Last Result 0x0. Docs: Task 7 reconciled + final report filed; postmortem exists; ARCHITECTURE `:595`/`:596` closed; `deploy.md` fixed; docs-impact clean. Shipped: single push at 8.76.

## Operator gates during execution

1. PG16 uninstall (W1.8 — preconditions required) · 2. postgresql.conf window (W1.7) · 3. Off-box backup target yes/no (W1 report question) · 4. Bridge restart (W2.4) · 5. `.bak` deletion (W2.6, irreversible) · 6. XLEN close-out confirm (W3.3, default close-out) · 7. Version bump + push (W3.6).

## Appendix — discovery evidence (condensed)

| Source | Finding |
|---|---|
| Migration plan `:595-637,:648-655` | Task 7 unticked vs Aug-30 evidence; PG16/pg-tuning/deviations open |
| Coalescing plan `:3,39-41` + ADR-0006:77-81 | Host follow-up open; 5 overrides confirmed on disk 2026-09-06 |
| CHANGELOG 8.72/8.74/8.75 | Outage rebuild recorded; CRITICAL KPI add→revert, no rationale |
| `types.ts:131-138` etc. | Deprecated wire fields — overview omission verified; live surfaces are other endpoints |
| git | Single branch, clean, 0 unpushed — nothing unshipped |
| Code markers | Zero TODO/FIXME; 9 production `as any` in money path; retired runtimes absent |
