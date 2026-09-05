---
title: Archive — Advisor recommendation (vp-product), W1–W5 closeout package
created: 2026-09-06
author: coordinator:vp-product (advisor dispatch)
status: archive
---

# Archive: Advisor recommendation (coordinator:vp-product) — W1–W5 package, 2026-09-06

> Verbatim advisor output from the 2026-09-06 closeout-package planning session. PM directive was "ask advisor for recommendation then apply" — all rulings below were applied to `docs/plans/2026-09-06-closeout-package.md`.

## 1. Execution order

**W1 → W2 → W4 → W3.**

- **W1 first** — it is the evidence pass. Its probes (service/task/config actuals) are the ground truth W3's docs will cite, and its final report is the artifact that makes W3's truth pass cheap instead of re-derivation. Read-mostly, low risk, de-risks everything after.
- **W2 second** — the only live-bridge touch. Run it as its own dedicated maintenance window BEFORE any code churn so bridge state changes and web deploys never interleave; if the dashboard misbehaves later, attribution is clean. W2's post-override coverage proof is also the freshest evidence for closing ARCHITECTURE.md:596 in W3.
- **W4 third** — code-only, one rebuild+deploy window, fully covered by the existing unit suite (preaggregated-cache / view-build-contract / e2e tests). Do NOT defer on the L2-aging gate: the gate is actively resolvable, not a wait-condition (see §2).
- **W3 last** — docs written against the verified END state of W1+W2+W4, so the postmortem, the :596 closure, and ARCHITECTURE.md amendments don't need amendment churn. One clarification: the postmortem evidence (logs, journal states, migration-plan log entries) is on disk; a week's delay doesn't degrade it.

## 2. Scope adjustments

**W1:**
- **PG16 uninstall: INSIDE W1**, final step, operator-confirmed at execution time. It is residue of the very migration W1 closes; a stopped PG16 sharing port 5432 with PG18 is a live misconfiguration, and a closeout report shipping with it dangling isn't honest. Preconditions: (a) same-day green pg-dump of PG18 verified first, (b) confirm PG16's data dir isn't the sole holder of pre-migration data (pg-dump only began at 8.72) — one-time dump or verified-disposable before uninstall. If the operator declines: record as named open deviation with the clash risk stated; the rest of W1 does not block on it.
- **postgresql.conf tuning: INSIDE W1** — bind `listen_addresses` to loopback (data plane is loopback-only by design; keep the firewall rule as defense-in-depth) and set `max_wal_size`, in ONE maintenance window with one PG18 restart (`Restart-Service` — native service, the sole sc.exe exception). Verify via worker health probe + verify-skill smoke after.
- **Off-box backup target (:614): separate operator decision** — W1's report poses the question with one priced recommendation; do not implement in this package.
- **Topology deviations: reconcile docs to reality, no rearchitecture.** NSSM-as-LocalSystem, Redis-in-WSL2, bridge-as-scheduled-task are all working states with CLAUDE.md already reflecting them; changing service identities on a live host is risk without a driving defect. Record as accepted deviations in the final report + plan errata.

**W2:** Keep scope tight; add verification rails, not features: (a) snapshot the 5 journals' coverage state before the override removal; (b) EXPECT the by-design ~55-min/account silent empty-window crawl from 2025-01-01 once overrides drop (memory note: 2025 is provably empty) — schedule it, don't alarm at it; (c) post-restart idempotency check against the 57,491-Deal baseline; (d) **.bak prune stays in scope but is the LAST step**, only after coverage re-proof is green and one fresh pg-dump exists — those .baks are the only rollback artifact for the override removal; (e) fix the stale "nssm restart bridge" wording in the plan/ADR references while there.

**W3:**
- **CUT the XLEN root-cause hunt.** It's a one-time anomaly, not reproduced through a 13h outage rebuild and a week of 5-min health probes since. Record it as won't-fix-with-recurrence-trigger (postmortem + ARCHITECTURE.md:595 amendment): "one-time, unreproduced since 2026-08-30, reopen if stream-gap detection fires." That's honest closure, not a silent drop.
- **ADD: close ARCHITECTURE.md:596** with a concrete per-account count query (Deals/Orders/Positions vs journal coverage windows) using Aug-30 evidence + W2's post-state. Cheap, and it's the package's one real "verification debt" item.
- Fold the W5 deliverable (§3) in here; run docs-sync at the end.

**W4:**
- **The 9 `as any` casts: INSIDE W4**, as a second phase/commit after field removal. Same files, one deploy window, one test cycle — splitting them buys a second rebuild+restart on a live host for nothing. Sequence fields-first so shapes settle before typing; rule: if eliminating a cast surfaces a REAL value-shape mismatch (Decimal/number, string/number), STOP and surface — that's a correctness finding in the money path, not a typing chore.
- **L2 gate: resolve actively, don't wait.** The fields are optional purely so pre-deprecation L2 entries parse (types.ts:131-138), and L2 is version-rekeyed by design (preaggregated-cache.ts:1544). Step 0 = probe live L2 keys for pre-deprecation entries; if any persist, force a re-key/invalidation at deploy — reconstruct-from-PostgreSQL after Redis loss is a stated repo invariant, so cold L2 is safe by design, just a bounded rebuild bump.

## 3. W5 disposition

**(b) Keep removed + record it as ADR-0007.** The evidence: 8.74 shipped 2026-09-01 22:33, revert 8.75 2026-09-03 06:25 — a deliberate, thorough revert (20 files, +25/−279) after ~32 hours of live trial. The operator tried it and removed it; that action is the only signal, and reticence about the reason is not a mandate to re-add. (c) would put an unverified-problem product workstream into an ops-heavy package and most likely rebuild the wrong thing — twice. (a) alone can't close the loop honestly because there IS no stated rationale to record; only its absence.

Write ADR-0007 ("CRITICAL urgency KPI removed after 8.74 trial; substrate retained") in docs/decisions/ — the repo's canonical, greppable decision surface, no new directory needed. Content: what was built (35/50/15 composite, ≥40/≥70 thresholds), that removal rationale was not stated, that deposit_load_pct/deposit_load_source substrate was deliberately preserved for reuse, and explicit retry preconditions: operator names WHICH aspect failed (weighting, placement, or redundancy with existing chips) before any redesign. Cross-ref from the CHANGELOG 8.75 entry.

## 4. Top 3 risks (live single host)

1. **W2 bridge restart gaps live MT5 ingestion.** Mitigation: execute in the weekend low-liquidity window; pre/post checks that live keys republish, streams advance, worker health green — durable state is unaffected by design (SQLite journal + PG authority; Redis is a mirror).
2. **W1 PG maintenance window: single DB outage + PG16/PG18 port-5432 footgun.** Mitigation: verified same-day pg-dump before ANY step; native-service restart path only; PG16 uninstall strictly last, only after PG18 confirmed healthy on 5432.
3. **W4 corrupts displayed financials via stale-L2 parse or cast-induced silent mismatch.** Mitigation: step-0 L2 probe + forced re-key at deploy (mechanism exists in-code), full unit suite, prod smoke via verify skill before "done", stop-on-real-bug rule during cast elimination.

Cross-cutting: each deploy window bumps `package.json` version per repo rule and stops caddy + analytic-web before `npm run build` (EBUSY lock).

---

*Note (EM, post-design): the plan-designer's disk verification later sharpened two advisor premises — (1) W4's deprecated-field compute is smaller than the discovery suggested (the overview build already omits the three fields; the cited compute sites serve LIVE positions/balance endpoints and must stay), and (2) the L2 gate is even simpler than "force re-key": report-view-cache TTL is 300 s with unvalidated JSON.parse, so old-build entries cannot outlive 5 minutes. The advisor's rulings (do W4 now, casts inside W4, W5→ADR-0007) stand unchanged.*
