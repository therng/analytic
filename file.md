* 1ab2d03 feat(schema): complete MT5 analytics migration phase 1
* 39d2ead docs: add MT5 drawdown panel reference guide
* aee874e test(worker-v3): add reason decoders, magic/reason/priceStoplimit/timeExpiration mapping + full test coverage
* 40e4b6a fix: DrawdownPanel dataviz refactor + tooltip/legend overlap fix
* 2bdfba0 feat: capture DEAL_MAGIC/DEAL_REASON, ORDER_MAGIC/ORDER_REASON, and fix Position.magic propagation
* 1c6f930 chore: restore DrawdownPanel, add MT5 metrics migration and docs
* d461122 audit
* 000a873 fix: correct DD abs panel equity when no open positions
* d6c754c refactor: simplify preaggregated-cache duplicated logic
* 6be8e46 perf: dedup live poll renders, split cache versionKey by equity vs aggregate
* 2d5595f chore: bump version to 7.91
* 93a6793 fix(worker-v2): correct stateFor() return type to match LiveSyncState
* cee3b05 perf: accelerate timeframe chart updates
* a106e90 fix(worker-v2): fingerprint live hash contents, not lastSeen timestamp
* 9d8f4a1 perf(worker-v2): skip unchanged live persistence
* b6f7295 refactor: remove unused isDatabaseUnavailableError, consolidate StreamKind
* d4d153a perf: avoid spread-based min/max over unbounded regression population
* 1aa5041 fix: replace ApexCharts responsive array with matchMedia to avoid resize stack overflow
* 92ea35f chore: remove obsolete MAE versus MFE chart
* eddd45f fix: give trade distribution panel body its own grid row
* e2fc7ba style: add responsive trade distribution panel
* d469d54 refactor: replace MAE MFE panel with trade distributions
* 41cbd18 fix: preserve suppressed line-series markers on mobile
* 6741072 feat: rebuild MT5 trade distribution ApexCharts
* c3cbf73 feat: add trade distribution chart models
* a07d5a9 refactor: build MT5 trade distributions from positions
* 161cce2 test: prove trade distribution regressions use full population
* fa18066 feat: define closed-position distribution payload
* 9ed7089 feat: add trade distribution analysis helpers
* 7a11285 Remove submodules: recursive from checkout to fix missing submodule error
* 1ed1ed8 Add recursive submodule checkout to workflow
* 11e5775 feat: MAE/MFE scatter panel (#92)
| * 67e0596 refactor: repurpose MAX chip for MAE/MFE, drop separate chip
| * b47a5cb Update src/lib/trading/preaggregated-cache.ts
| * 2bc8af0 Update src/components/trading-monitor/card/DashboardCard.tsx
| *   fab821b Merge origin/main into codex/mae, resolve DD gauge relocation conflicts
| |\  
| |/  
|/|   
* |   e0e490d Merge pull request #89 from therng/feat/dd-quality-gauges-relocation
|\ \  
| * | c12352a ci: remove deleted growth test
| * | d992394 docs: add DD gauge relocation plan
| * | 3e9ce59 chore: bump v7.89
| * | 1eec57f fix: complete DD quality gauge integration
| * | 652a7c3 docs: correct DD sub-panel chip guidance
| * | 3348e2b docs: clarify PerformanceRadar layout
| * | 1170610 docs: reserve DD max panel for MAE MFE
| * | faaec4c fix: correct DD gauge grid layout
| * | 07daa05 feat: move DD quality gauges into win panel
| | | *   9ffa4f6 WIP on codex/mae: 1aef911 docs: add missing test file entries to CLAUDE.md
| | |/|\  
| | | | * fd5e89b untracked files on codex/mae: 1aef911 docs: add missing test file entries to CLAUDE.md
| | | * 1cba775 index on codex/mae: 1aef911 docs: add missing test file entries to CLAUDE.md
| | |/  
| | * 1aef911 docs: add missing test file entries to CLAUDE.md
| | * edd80d3 fix: MAE/MFE chip count only counts plottable points
| | * 359d827 Optimize MaeMfePanel chart to prevent unnecessary redraws
| | * bfb4123 refactor: consolidate docs to superpowers/plans, remove obsolete files
| | * 9ca970f docs: document MAE MFE scatter panel
| | * 2bc0ce1 feat: wire MAE MFE DD subpanel
| | * 9df05b5 fix: style MAE MFE axis titles
| | * 3944f52 feat: add MAE MFE scatter panel
| | * ef10334 feat: expose scoped MAE MFE scatter data
| | * 7a6e8fe docs: design MAE/MFE scatter panel
| |/  
| * c4e55a3 docs: design DD gauge relocation
|/  
* 5b35f9c chore: bump v7.88
* a7874bd chore: cut dead deps, env vars, and pass-through formatters
* d3386b2 chore: bump v7.87
* c0c5c35 feat: compute per-trade MAE/MFE from PositionExcursion at position close
* 6b0b967 docs: fix stale test-command list in CLAUDE.md, bump v7.86
* ec83996 fix: deposit KPI dropping comment-matched deals, refresh not reaching card fetches
* 8bb4e2c refactor(social): rebuild sparkline reactions as single toggle action
* 1e46df0 fix: center sparkline reaction bar
* 5efcb2f chore: regenerate next-env.d.ts route types path
* efa97b1 fix(dashboard): stop 1D balance sparkline double-counting historical P&L
* 49b2f20 docs: specify iOS panel loading states
* 5fbdd6a fix(dashboard): render 1D equity line solid instead of dashed
* f163d84 feat(trade-history): add cursor-paginated trade-history API route
* 15810e3 docs: reconcile stale CLAUDE.md/TODO.md entries, add worker-v3 status banners
* d8bfce6 feat(dashboard): redesign bot sheet toolbar and full-height expand
* 474b3e1 feat(worker-v2): add Package 3A schema and corrupted lifecycle handling (#88)
| * a62474e chore: bump version to 7.81
| * 061d5ef fix(worker-v2): log corrupted position lifecycles, not just ambiguous-reopen
| * 9568809 feat(worker-v2): distinguish corrupted lifecycles from open positions
| * e284e8b feat(schema): add WorkerMessageFailure table and BridgeHistoryChunk.reconstructionAlgorithmVersion
| * 4290a7f docs: add Package 3a implementation plan
| * a99f56c fix(analytics): exclude fee from net P/L, align with worker-v2/v3
|/  
* 49db508 perf(trade-history): paginate trade history via cursor instead of full-history fetch
* 598ed6b fix(worker-v3): don't silently mis-price or mis-classify corrupted lifecycles
* 1eb6c7f chore: reformat codebase and add worker-v3 scaffolding
* 505aa43 fix(worker-v2): include fee in ClosedPosition netPnl
* 1b2089e chore: bump version to 7.79
* a2e28ac fix(worker): unreliable require.main guard leaked live workers via tests
* 607f063 chore: bump version to 7.78
* 2246643 feat(worker-v2): reconstruct ClosedPosition from Deal history
* f1935a7 feat(worker): cut over live-state writes to Worker V2
* b2187c3 fix: close Worker V2 and Bridge V2 review gaps (#87)
| * ed69f40 fix(worker-v2): revert entrypoint guard to require.main === module
| * ec13758 fix(worker-v2): guard main() entrypoint so importing index.ts for tests is side-effect free
| * 3b28142 feat(worker-v2): add WORKER_V2_ENABLE_LIVE_SYNC toggle, default off
| * 51f3dba docs(worker-v2): add Phase 4 parallel validation plan
|/  
* ac17197 chore: deploy Worker V2 service
*   dd0522f Merge pull request #86 from therng/codex/reaction-select-burst
|\  
| * a1351c6 chore: remove legacy bridge tooling and plan worker v2
| * 8490a19 feat: animate selected sparkline reactions
|/  
| * dd41e6f chore: deploy Worker V2 service
|/  
*   77ae288 Merge pull request #84 from therng/worktree-worker-v2-redis-to-postgres
|\  
| * 132dac6 docs(worker-v2): add Redis-to-PostgreSQL implementation plan
| * 0a0c798 fix(worker-v2): close runtime resources on shutdown
| * a46bcfd Update src/worker-v2/index.ts
| * 312bc09 Update src/worker-v2/decimal.ts
| * 087124b Update src/worker-v2/index.ts
| * ffe4a75 test(worker-v2): prove account A's Prisma failure doesn't stop account B
| * a3f8273 fix(worker-v2): reclaim pending entries every loop iteration, not just at startup
| * 88adaa2 fix(worker-v2): give each concurrent loop its own Redis connection
| * 5c855d9 fix(worker-v2): drop .ts extensions from relative imports
| * ff09355 feat(worker-v2): wire entrypoint and add npm scripts
| * fd4c5f8 test(worker-v2): add test for mixed valid/invalid positions in live sync
| * a0299d3 feat(worker-v2): sync live account snapshot and open positions, heartbeat-gated
| * 546c349 feat(worker-v2): wire Deal/Order stream handlers to idempotent upserts
| * a60bdb9 fix: guard against null entries in reclaimPending
| * 2fa7630 feat(worker-v2): add generic Redis Stream consumer-group loop
| * ba22b94 feat(worker-v2): add status tracker and health endpoint
| * 67c0b15 feat(worker-v2): add raw MT5 record to Prisma input mappers
| * 13fb1f8 feat(worker-v2): add deal/order/live/position payload validators
| * 10f4320 feat(worker-v2): add enabled-account registry loader
| * 5283ecf feat(worker-v2): add Decimal-safe numeric helpers
|/  
* ae54ea6 refactor(bridge-v2): consolidate shared helpers
*   9cbb128 Merge pull request #83 from therng/add-claude-github-actions-1783960703564
|\  
| * a919ce0 "Update Claude Code Review workflow"
| * 0cc83de "Update Claude PR Assistant workflow"
|/  
*   c35e9ba Merge pull request #82 from therng/feature/bridge-v2
|\  
| * f785d1a fix(bridge-v2): account-level election, not per-terminal lock racing
| * 2a55fbc feat(bridge-v2): add MT5 extraction and duplicate account protection
|/  
* 8e1f36f fix: closed-position Lua arg bug + account-scoped history chunk IDs (#81)
| * 492d95f v7.75: bump version for closed-position Lua argument fix
| * 8c75d1c fix(bridge): publish closed position payload with correct Lua argument
| * eb93bc9 fix(worker): scope history chunk IDs by account
|/  
* 8f7e931 v7.74: automatic MT5 history backfill, broker UTC offset, balanceAfter fix
* 2456e7f docs: close remaining bridge-cutover TODO items
* d3629cf v7.73: TODO.md cleanup, nssm README refactor, gitignore local agent tooling
* 80aad7f docs: rewrite bridge/README.md for clarity
* 77819fd v7.72: closed-position sl/tp mapping, caveman IDE scaffolding, backfill verify script
* 7bcd68c v7.71: strip dead code and unused type scaffolding
* 2db052d v7.70: fix dashboard timeframe scoping, XAUUSD pip calc, bridge default backfill
* 7a1fdfc fix: unify dashboard timeframe contract, drop legacy allHistory bypass
* 73a3f01 Show magic number in trade rows, drop open-time from history (#80)
* bedc0e1 fix(worker): write to ClosedPosition and fix balance curve starting at zero
*   afa33bb Merge branch 'chore/ponytail-audit-cuts' into main
|\  
| * 81af99d chore: bump version to 7.68
* | 669cabf Merge pull request #79 from therng/chore/ponytail-audit-cuts
|\| 
| * aa3a855 fix: remove deleted position-timeframe.test.ts from CI test list
| * e283dd6 chore: cut remaining ponytail-audit dead code and deps
|/  
* 1bfc1be fix: correct source-boundary bugs, remove dead code, dedupe fetch/motion patterns
* 7ffd359 fix: re-add python to CodeQL matrix now that bridge/ has real Python source
* 2ede27b fix: use clip-path instead of overflow-y for chart vertical clipping
* 85c7b49 fix: stop oversized chart touch targets from stealing 1D tab taps
* 8fa99f8 feat: add DB-backed polling scaffold for economic calendar events
* 15d3a3a fix: use reasonable default date range for history sync when cursor unavailable
*   34e7586 Merge branch 'feature/mt5-equity-sampler-hardening'
|\  
| * 2052099 fix: improve MT5 bridge history sync error reporting and diagnostics
| * ce999cb ci: add build/lint/test workflow, remove redundant Gemini automation
| * fc6f9bb feat: expand all-history support for pips/positions and hunt equity anchor drift
| * 1101fa0 fix: align account overview Prisma queries
| * 1592584 fix: restore bridge runtime build
| * 4524adf feat: harden MT5 runtime stream ingestion
| * 42c1b65 feat: optimize dashboard data flow
|/  
* 4b83c29 fix(bridge): improve MT5 terminal discovery robustness
* d45fcd8 style(monitor): align BotPnLPanel list row structure with TradeHistoryPanel
* b6b90b6 style(monitor): restructure TradeHistoryPanel summary row and detail grid
* 91bdb50 fix: harden mt5 startup discovery and attach checks
* 84fcda4 feat(monitor): force Pips and Heatmap panels to always show overall account data
* 4e1bc46 user's Startup folder
* 066366b feat: Refactor hooks and resolve skill conflicts
* 2b903aa allow all shortcut
* 0c9ea04 fix: harden MT5 terminal discovery
*   9266c36 Merge pull request #74 from therng/codex-bridge-redis-dashboard-ux
|\  
| * 549673f fix: complete trade history row details
| * e0ea4fc docs: add vps mt5 ops skill references
| * 46a97fb fix: preserve mt5 deal direction in bridge mapper
| * 25f3c66 fix: split mt5 history cursors by stream
| * 40b9728 docs: align MT5 bridge Redis contracts
| * 831fe0c fix: make mt5 history sync opt-in
| * abe036c fix: restrict mt5 discovery to approved startup shortcuts
| * 4c907e4 fix: discover mt5 terminals outside startup
| * 8aeadde fix: serialize mt5 bridge redis hashes
| * 5c95fad fix: harden mt5 bridge history cursor
| * 3c88647 fix: align bridge redis dashboard pipeline
|/  
* 21fedbb fix: force MT5 portable mode
* 7df6be3 fix: backfill full MT5 bridge history
* d4b1a67 fix: preserve bridge deal balances
* ff97deb feat: wire bridge import workflow
* 7bb14c1 feat(worker): add FTP_IMPORT_ENABLED kill switch for bridge cutover
* 414eee2 feat(social): unvote sparkline reactions, hold-to-slide-select gesture
* 70ca4ef fix: address final review findings (order state type, stale live-data guard)
* af440ba docs: document bridge history sync, tracking, and FTP cutover procedure
* bea2673 feat(scripts): add bridge-vs-FTP Position/Deal comparison script for validation
* 05d2ad2 feat(worker): sync AccountSnapshot/OpenPosition from bridge live data, add peak-equity/drawdown
* 3d935cd feat(worker): consume bridge Redis streams into Bridge* shadow tables
* 8c1c1f5 feat(worker): add bridge-mapper for raw MT5 payload -> Prisma row mapping
* e733101 feat(bridge): publish enriched position-closed event with final MAE/MFE
* f50cc60 fix(bridge): advance history cursor on closed orders, not just deals
* 0278822 feat(bridge): sync closed-trade history to Redis streams every 30s
* c49aebd feat(bridge): track running MAE/MFE and peak equity, persist to Redis
* 3549037 feat(bridge): add pure MAE/MFE and equity-drawdown tracking module
* ed2764a feat(db): add MAE/MFE/drawdown columns, Order table, and Bridge* shadow tables
* 9a4125e docs: add implementation plan for bridge/FTP->Postgres migration
* 122cb2f docs: add design spec for bridge/FTP->Postgres migration (MAE/MFE, drawdown, raw data capture)
* 3d7a039 chore: remove bridge/analysis Python eval tooling and its docs
* c865ca4 docs: document bridge/ and bridge/analysis/ in CLAUDE.md key directories
* e888e4f feat: add MAE/MFE + drawdown evaluation charts (bridge/analysis); revert version bump 7.1->7.0
* 239ffd0 docs: sync AGENTS.md with BotPnLPanel filter/sort + radar-only layout, add version-bump workflow note
* ab67d73 fix: simplify PerformanceQualityPanel, add bot-history filter/sort, drop redundant WIN kpi prop
* 65f1d29 fix: reflect live bridge connection in account active status
* b4fed20 fix: require REDIS_URL with password for worker service
* 6d82758 fix(equity-line): correct table-time alignment, add Redis timeout guard, and sampler overlap guard
* 58019c8 fix: pin postcss to patched version via npm override
* f6ba11d docs: sync CLAUDE.md with current schema, tests, and env vars
* 6395408 feat(bridge):   exitcodes,statemachine,circuitbreaker,heartbeathealthcheck
* 19f7b9a  equilty line
* f321f73 docs: note the new 1D equity line in AGENTS.md
* d54eff7 feat: wire live equityCurve and value-flash into the dashboard card's sparkline
* 80bd348 feat: render equity line on 1D sparkline sharing the balance line's scale
* da6bd34 feat(worker): sample intraday equity/margin and per-position P/L every minute
* f7647a7 feat: expose equityCurve on the 1D balance API response
* b6b42eb feat: add equity curve builder merging DB snapshots with live Redis equity
* 8ce04b0 Wire --env-file .env.test into test:env npm scripts
* 951866f Add isolated docker-compose test stack for db/redis
* 2ae7afa fix(bridge): reliable shutdown, backoff, and reconnect for MT5 bridges
* bebb473 feat(db): add EquitySnapshot and PositionExcursion tables for intraday equity tracking
* 011b6e5 chore(db): drop unused social_shouts table
* 9fcaad6 docs: add design spec for equity line + intraday equity/margin snapshots
* 90a617c fix: require REDIS_PASSWORD instead of defaulting (port 6379 is public)
* 4358f70 feat(mt5-live): configure Redis realtime and MT5 bridge integration
* 1f32dba fix: worker health server and lint cleanup
* fb1f772 fix: UI/UX accessibility and interaction review fixes
* 178d960 fix(bridge): use %APPDATA% env var for Startup folder path
* 839e5f4 perf(bridge): add Redis lock + pipeline batching to mt5_bridge
* d7ec147 feat: MT5 live bridge — real-time open positions and KPIs from Redis
* e81625f fix: load .env file in run_all.py so REDIS_URL is picked up automatically
* 774d88a fix: force RESP2 protocol to fix Redis HELLO auth error with redis-py v8
* b9f5be9 feat: expose Redis port and add password for external bridge access
* 3520acf feat: add Python MT5 real-time bridge + live API route
* 8acbdc1 fix: BotPnLPanel design review — CSS typos, close button, and code cleanup
* 08fc2e5 fix: remove empty JSX fragment preventing component render
* 59ecd57 fix: remove python from CodeQL matrix (no Python source in repo)
* e7ea386 refactor: optimize voted check with mGet and add aria-disabled
* ce3837e feat: limit sparkline votes to once per hour per session
* f63e1ef perf: precompute timeframe-invariant calculations once per cache rebuild
* 27ff261 refactor: deduplicate time.ts formatters and date parsers, drop dead gtag type
* 26e0619 fix: prevent skeleton-forever hang with layered timeouts
* e41287f feat: sparkline tooltip typography upgrade (ui-ux-pro-max)
* 5f31d98 fix: tooltip z-order + emoji picker pill redesign
* acb22cd refactor: rebuild social API from scratch with shared social lib
* d9005f5 feat: tap-to-toggle picker, base emoji only, portal over chart+kpi
* 65a2b8c fix: debug sweep — sort order, emoji set, hold-ring, placement isolation
* bbba969 chore: cleanup docs/fonts, simplify Caddyfile, bump to v6.92
* b50a64b fix: sparkline reactions security & robustness (code review fixes)
* 81bf854 feat: anonymous sparkline reactions (👍🎉😱) on 1D chart
* 1084606 fix: hide accounts absent from FTP for >24h instead of showing Inactive
* 73d493e feat: BotPnLPanel framer-motion redesign, DD loop cycle, KPI instant swap
* 6610c57 a11y/ux: fix touch targets, focus rings, accessibility, and docs
* 06bfdf1 perf: add server-side list cache to getAccountListItems
* 3302073 chore: v6.91 — drop Python services, clean junk, fix lint
* 2f58a28 feat: add long-press history panel with expandable rows to BotPnLPanel
* a0a9f2a perf: eliminate duplicate API requests and useMemo overhead from review
* 294d55e feat: add EquityHistory time-series, fix max deposit load, enhance performance bars
* a5a4e8c refactor: clean up unused code and document canvas & toggle enhancements
* f5dcd22 feat: update patterns visualization components
* 3ff958b fix: scope DD sub-panel toggles and positions timeframe
* c3b9b92 docs: add equity snapshot time series design spec
* 55b98f9 chore: add design-sync config for Analytic UI Kit
* 416352a fix: resolve code review findings in drawdown panel and analytics layer
* d7f935f chore(deps): bump undici in the npm_and_yarn group across 1 directory
* 61a808b fix: update drawdown dashboard panels
* e96dbdc fix: refine dashboard kpi metrics
* 0c7be50 delete branch
* 20cb872 chore(conductor): Delete all tracks
* 2fa8a1c chore(conductor): Fix missing index.md in social-layer track
* 94bdd82 chore(conductor): Delete iOS native app track and remove multi-platform artifacts
* bc6c3b3 refactor(animation): centralize all framer-motion variants into src/lib/animations.ts
* 2150450 chore(dashboard): checkpoint before animation system rebuild
*   10420b3 Merge pull request #65 from therng/add-claude-github-actions-1781878546674
|\  
| * 75a99ae "Claude Code Review workflow"
| * 4d03dd3 "Claude PR Assistant workflow"
|/  
* 4a871ba fix(social): polish shout layer and reorder dashboard KPI chips
* 3091a76 feat(conductor): Register social-layer track as completed
*   eefb732 Merge pull request #64 from therng/alert-autofix-3
|\  
| * 93d0a49 Potential fix for code scanning alert no. 3: DOM text reinterpreted as HTML
|/  
* 4cc50f4 delete ios
* 7cf5093 WIP: epitaxy pre-switch from main
* cf03fab fix(docker): add AUTH_SECRET and REDIS_URL to web service
* f582492 fix: regenerate package-lock.json to resolve esbuild version mismatch
*   9f708f5 Merge remote-tracking branch 'origin/main'
|\  
| * e454fce Add heartbeat health endpoint to the background import worker (#63)
* |   b72e3c0 merge: feat/social-layer into main
|\ \  
| * | 9bdfc26 feat: dashboard card refactor, social layer, patterns, iOS scaffold, and type fixes
| * | a627c91 fix(social): SSE cleanup, reaction atomicity, toggle rollback, username race
| * | 15a3f1e feat(social): wire ShoutTicker, EmojiReactionBar, UsernameSetup into dashboard
| * | b893bdf feat(social): add ShoutModal and ShoutTicker components
| * | 38d2dd4 feat(social): add EmojiReactionBar component
| * | c542769 feat(social): add useSocialSession, useShouts, useReactions hooks
| * | a89ee40 feat(social): add reactions API with toggle (GET + POST)
| * | 127bcc9 feat(social): add SSE stream for real-time shout delivery
| * | 1fa9806 fix(social): use promise cache for Redis client, wrap shout upsert in transaction
| * | 73b8335 feat(social): add shouts API (GET + POST) with Redis publish
| * | 497a25d feat(social): add username claim API
| * | 83e8256 feat(social): add NextAuth config with Google + Apple providers
| * | 12f72da fix(social): add cascade deletes, indexes, and VarChar constraints to social models
| * | 6117e28 feat(social): add SocialUser, Shout, Reaction prisma models
| * | 355634c docs: add social layer implementation plan
| * | d40dea7 docs: add social layer design spec — Shout Ticker + Emoji Reactions
| * | 2d57516 refactor(loading-screen): improve responsiveness and visual design
* | | 336e236 docs: add social layer implementation plan
* | | 994b58b docs: add social layer design spec — Shout Ticker + Emoji Reactions
* | | 798c965 refactor(loading-screen): improve responsiveness and visual design
| |/  
|/|   
* | 07ca2cb chore(deps): bump esbuild (#61)
* | a697d54 Widen Deal/Position analytical indexes to cover sort tiebreakers (#62)
|/  
* 60f5bcf chore: lean codebase — remove dead code, unused files, and stale exports (#60)
* a9f0ff6 Create codeql.yml
* e9ac996 Revert "docs: add landscape + tablet layout improvement design spec"
* 46b9a4b 6.9
* b3c4aff fix(portrait): eliminate empty space below heatmap in pips panel — switch overlay to normal flow
* d5fd7be feat(layout): restructure landscape columns — BotPnL→col1, heatmap→col2 bottom row
* 94fd2f6 fix(css): widen landscape right panel — mobile 36%→40%, tablet 38%→42%
* 713afcc fix(css): widen tablet landscape right column 38% → 42%
* 73622c9 fix(charts): disable ApexCharts animations to prevent elDefs.node null crash on unmount
* 7197f44 feat(tablet): wire forcePortrait + TabletPortraitOverview into DashboardClient
* b06bfa8 feat(tablet): add TabletPortraitOverview grid+detail view with CSS
* a5e2a09 feat(css): add account-card--tablet-landscape with 38% right panel and fluid tokens
* a727604 fix(css): split landscape breakpoint, fix mobile landscape overflow with fluid clamp heights
* 0da96f0 refactor(layout): replace dual isDesktop/isLandscape with useLayoutTier hook
* 40103f4 fix(layout): clarify layoutTier collapse behavior in comment + tests
* 50495bb feat(layout): add deriveLayoutTier utility with boundary tests
* 32f8385 docs: add landscape + tablet layout implementation plan
* 2430b6f docs: add landscape + tablet layout improvement design spec
* 7ff34cd fix: resolve duplicate news keys and ApexCharts null crash on unmount
* b36c6c4 feat(news): add ForexFactory high-impact USD events to XAUUSD news feed
* 37429a7 fix(pips-panel): resolve pips table + heatmap overlap in portrait mode
* 898f1cd feat(eco-cal): grabber under row + drag-down expand + today collapsed + date sections
* 60e5fc8 fix(desktop): resolve 7 bugs + stagger API calls for performance
* 0b2705d "add design system"
* 26c270a fix(loading): align candle animation CSS with design tokens
* 03d1638 fix(radar): resolve NaN polygon vertices and BotPnL chart type mismatch
* c470cdc feat(eco-cal): expandable calendar panel with framer-motion drag + history
* 9b4075d feat(eco-cal): expand API to support multi-week scope with 30-day history
* 3fb4f0a chore(conductor): initialize project with expandable eco-cal track
* 985dfdc feat(radar): economic calendar panel, performance quality gauges, Thai fonts (#57)
* 4fc48df 6.8
* 8fc2809 Add economic calendar to news panel (#56)
* deaf913 feat(opens): show news feed in overlay when no open positions
* e67e83e feat(ui): polish interactions, iOS touch, and opens-empty CTA
* 5d303c4 fix(ui): tighten BotPnLPanel chart, legend, and tf-row spacing
* 7e65310 fix(ui): use --font-th-bold (Mitr) for วิเคราะห์ทางเทคนิค button
* d486370 fix(news): increase panel height 158→208px to show one more news row
* 149f6a9 fix(news): restore deduplicate call lost during refactor
* 929cf8a fix(news): apply Noto Sans Thai font to news feed
* 3d886a4 fix(news): add tag/ทอง feed; tag/ดอลล์ returns 404 — skipped
* a2a9ec7 refactor(news): use InfoQuest tag feeds instead of general feed + keyword filter
* 19ddbc2 fix(news): tighten InfoQuest filter to XAUUSD-relevant only
* 373d74b fix(news): add สหรัฐ to InfoQuest keywords
* 343fe57 fix(news): add COMEX, ราคาทองคำ, ตลาดทองคำนิวยอร์ก to InfoQuest keywords
* ca11e14 feat(news): use InfoQuest only, remove FXStreet source
* f934ca0 fix(news): filter InfoQuest to Thai-language articles only
* f6aeb10 fix(news): narrow InfoQuest keywords to Thai-specific terms only
* b456826 feat(news): expand keyword filter to oil, dollar, USD topics
* d5b174b feat(news): replace Yahoo RSS widget with internal XAUUSD news aggregator
* 8021809 chore(release): 6.8
* 68e9e1e feat(open-positions): show XAUUSD analysis CTA + top stories on empty
* ca9c266 fix(analytics): wire ABS KPI to period-scoped funding totals
* f2077ca docs(plan): resolve Task 5 as not-applicable for local/dev deployment
* dc5bca0 docs(plan): mark Tasks 1-4 done in code-review-bugfixes plan
* 2545cbf chore: save v6.8 working state
* c3663d0 fix(infra): restore backend_net internal:true to prevent outbound access from db/redis
* 50d35d5 fix(test): use correct SECRET in ingest_deals test
* 492189b fix(gateway): publish deals to each account's channel separately in ingest_deals
* 0897cf3 fix(BotPnLPanel): make grossLoss sign explicit in tooltip to prevent sign-flip on refactor
* e75038d fix(analytics): fix hasDealTypeOrComment helper signature to accept optional BalanceRow fields
* 631fc6f fix(analytics): include trade deals with empty-string type in balance curve
* 98a5d7b revert: 7f345a8 (restore task tracking state)
* 7f345a8 docs: update plan and TODO lists for completed tasks
* 8a802f5 test(collector): increase test coverage for sync_deals
* 84a7369 fix(frontend): use env variable for WS URL
* 2a9f1f2 feat: add server-side downsampling
* 1d90c07 refactor: extract growth core logic
| * 739b700 Session ee09abd7-1882-44b2-8dc9-cbae169b267e - checkpoint turn 0
| * 82ca244 chore: replace Docker Compose with native Linux systemd services
| * b91f937 ssl work
|/  
* 6d6a4a1 fix(gateway): improve health check reliability with curl and increased timeouts
* 701d85d fix(backend): implement health check endpoint to resolve docker-compose startup deadlock
* 19f67e9 docs: synchronize all markdown documentation with 6.6.0 real-time architecture
* 6f6b2bb fix(backend): resolve websocket hanging tests, state pollution, and runtime warnings
* 42c5a3d fix docker
* 50a3985 vps
* c4191be feat(infra): overhaul docker deployment for v2 architecture
* b76a1bf fix(collector): prevent infinite MT5 spawning by handling non-portable terminals
* 6904e46 chore(collector): add numpy dependency for MetaTrader5
* bcc1002 fix(collector): use relative imports for standalone/EXE execution compatibility
* 787452a fix(collector): enforce portable=True for MT5 instances to prevent Roaming collisions
* 670262a feat: switch to custom Caddy with DuckDNS plugin and remove Cloudflare Tunnel
* 9bee24a fix: use relative imports in main.py for standalone/EXE execution
* 18c1c07 feat: support multiple MT5 instances via MT5_PATH and PowerShell automation
* d89dccc feat: add Cloudflare Tunnel and DuckDNS SSL configuration
* 918eaf7 feat: enable automatic SSL for therng.thddns.net using Caddy
* 23a7be0 chore: improve deployment resilience and add CI/CD configurations
* 42da78e chore: release version 6.6.0 with real-time architecture
* 690098b chore: add packaging script for collector
* 24705ce feat: connect frontend to realtime websocket
* 70c47c3 feat: complete trade reconciliation endpoint
* 131f611 feat: implement deal sync logic in collector sidecar
* 93df9a2 feat: add get_deals to mt5_client
* d3eedd0 feat: add snapshot persistence worker
* c085124 feat: implement websocket fanout
* 7ec5afc feat: implement HMAC signature verification
* 2bbed18 chore: add backend requirements
* b9f8e2e feat: expose shared models in backend and collector
* a9894f0 feat: add shared Pydantic models for MT5 analytics
* 2604e48 chore: upgrade to Next.js 16 and React 19
* 78ce6ea "adjust size font gauge"
* 8764ea9 "new toogle icon"
* eb50861 "6.5"
* b6c90e9 "6.5"
* 54aaf80 refactor(BotPnLPanel): rebuild chart with Chart.js vertical bar chart (#55)
* 237d284 fix(ui): lock pinch-zoom on panels, fix trade history scrollbar, tighten perf-quality layout
* d04a914 fix(PipsPerformanceTable): pips+ neutral, pips- negative color tone
* ab7ec19 fix(PerformanceQualityPanel): update zone colors to red/yellow/green/blue
* e0ca84a feat(PerformanceQualityPanel): scope Sharpe/PF/Recovery to selected timeframe
* 09547e8 fix(TradeHistoryPanel): use neutral color for positive trail value
* 5c2ecd3 fix(SummaryChip): recalculate card position on resize + reset longPress flag
* 9a308a2 fix(PipsPerformanceTable): reorder columns to %, Profit, Pips, Vol.
* 2a81107 feat(KpiPreviewCard): position hint card above trigger button
* bc7dffa fix(KpiPreviewCard): shrink card to fit text content
* 9dc606b fix(BotPnLPanel): align tooltip font sizes with sparkline chart tooltip
* 6376b02 fix(panel): lock pinch-to-zoom inside overlay panels
* 8f48e9b feat(DD panel): add Profitability bar and update KPI hint copy
* 78d3bc1 fix(BotPnLPanel): fix bot label extraction and regex match (#54)
* c9477e6 fix(BotPnLPanel): extract label from #<id>|<label> bot comment format (#53)
* cddc847 Redesign KPI hint card to show only the explanation (#52)
* 0a84afb edit gauge
* a35f497 Release 6.3.0: numbers-first gauge redesign, trades timeframe fix, iOS polish (#51)
* 1c36c1b Release 6.3.0: gauge quality panel, trades timeframe selector, BotPnL fixes
* 481195d Update BotPnLPanel.tsx
* a102ae7 Update BotPnLPanel.tsx
* 569d48f Delete trading-dashboard-version-update.skill
* 4ab8ad3 Delete zoom-transition-modal.skill
* 8539fc2 Delete .vscode directory
* 69f3b73 Delete .github/workflows directory
* 824ff72 Delete .gemini directory
* 0a83239 docs: refresh CLAUDE.md to match current repo state (#49)
* cee824c Add GitHub Actions workflow for Next.js deployment
* 90fb43b Create node.js.yml
* 7d4fbf0 Add Docker Image CI workflow
* 5dc6779 Create docker-publish.yml
* ba7b825 chore(deps): bump next in the npm_and_yarn group across 1 directory (#46)
* e725ff5 tsconfig.json fix
* 2097673 chore: bump version to 6.3.0
* dfa5569 feat(bot-pnl): add tooltip box and BotPnLPanel component
* 0523b11 fix(dashboard): rebuild DD panel quality chart as readable benchmark bars (#47)
* 5bf12ce chore(deps): bump basic-ftp in the npm_and_yarn group across 1 directory (#42)
* 177bd7d style(dashboard): mute inactive account name and chart line (#45)
* a67698a fix(open-positions): uniform font size and right-align comment in expanded row
* 475f009 feat(account-sorting): sort accounts by weekly growth performance
* 75075e6 fix(dashboard): chart tooltip persists on desktop click (#44)
* 2cabf4b refactor(dashboard): single ring on sparkline live beacon (#43)
* 1b80b89 feat(dashboard): natural heartbeat blink for sparkline live beacon (#41)
* 60ab8d6 chore: add systemd service, editor settings, and dashboard skills
* 9c97b1e chore: remove bind directive from Caddyfile and clean up compose whitespace
* 6192772 Update heatmap day labels to M W F (#40)
* e6f73da feat(dashboard): add long-press hint to DD panel gauges, remove quest… (#39)
* bd378bb feat(infra): enable automatic HTTPS for therng.thddns.net
* 50ecb2b release: v6.0.0 - Preview Cards and UI Refinements
* a75fbc9 chore: stage accumulated changes across layout, UI, and docs
* c983593 feat(ui): replace no-account empty state with candle animation
* 4844314 chore: ignore .worktrees directory
* 46d3b04 fix(layout): apply mobile portrait full-screen layout fixes
* e54a42f style(launch): optimize for portrait fullscreen and ignore safe area
* f25f4a7 refactor(launch): focus launch screen on mobile portrait only (#38)
* a7cc0c5 refactor(dashboard): focus layout on mobile portrait only (#37)
* db2cc82 fix(ios): resolve black bar on initial load in Safari and PWA (#36)
* 75bd691 fix: clear animation on action sheet drag to enable visual feedback
* 658eced refactor: apply code simplifications to improve readability and maintainability
* 8b5235c refactor(ui): remove desktop cockpit and use landscape carousel universally for wide screens
* 5bc78a7 fix(ui): force full viewport height as default to prevent initial portrait clipping
* 6803d5e fix(ui): resolve iPhone edge-to-edge layout and black bar issues
* 8b869ba fix: export positionPips from account-data.ts
* 386d90a refactor: eliminate code duplication and improve cache efficiency
* 09917e5 Restore removed skills: database-migrations, postgresql-table-design, prisma-postgres
* 5efd567 fix: normalize margin level serialization (#34)
* b09a373 fix: eliminate black bar at bottom on first mobile load (#35)
* 7b3b0fe Delete Landscape-Analytic.png
* 8750952 Delete Analytic.png
* 0873f99 Delete 2.png
* 22701be Delete 1.png
* 98ec302 fix landscape
* a42fbb3 fix: remove deprecated tsconfig setting
* 8cc0028 ts fix
* 9208979 hint
* bf1237b Create SECURITY.md for security policy and reporting
* 0214639 refactor: tighten landscape detail grid layout
* f7031fc feat: show performance quality and pips summary automatically on desktop and landscape
* 00a6cc7 feat: version 5.0 with finalized desktop and landscape layouts
* 2fd1250 refactor(landscape): rebuild mobile landscape as 2-pane split with tabbed details (#32)
* 3617adb fix: DD overlay covers timeframe selector, remove AI login chart labels
* 85f8744 fix: DD panel profit factor shows no data in scoped timeframes
* 9294e6f refactor: simplify KPI hint UI and darken overlay backgrounds
* b5b01e2 feat: annualize Sharpe ratio and improve metric gauges
* a356ccd Remove solid background from mobile portrait overlay panels (#31)
* 6a5e5f5 chore: remove auto_https global option from Caddyfile
* 85a522c fix: widen account card frame and keep timeframe visible on DD overlay
* 9a3fa5f fix: enable HTTPS auto-configuration in Caddy (#30)
* bfcb117 ignore safeare bottom
* 87810c7 fix: normalize margin level serialization (#29)
* 0bb11ed Add Claude Code GitHub Workflow (#28)
* c9349f6 Replace chart with open positions table when Open tapped in mobile portrait (#27)
* e1eb89f fix: keep launch gate working when Safari blocks storage
* f4220c8 Overlay DD/Pips/Trades panels over chart + timeframe (mobile portrait) (#26)
* 06a0e4a Replace chart with trade history table when Trades tapped in mobile portrait (#25)
* 56814da Replace chart with quality panel when DD tapped in mobile portrait (#24)
* 82c9588 feat: refine launch screen insight animation and layout (#23)
* 59ed306 feat: refine launch candle stream
* 53db186 feat: refine launch screen landscape layout (#22)
* c706da0 feat: refresh launch experience
* 048ac5d feat: rebrand launch screen as "Quiet Ledger" (#21)
* 091570d feat: refine dashboard metrics and launch screen
* 3506201 fix: stabilize launch screen and build baseline
* 2704f01 feat: rebuild KPI hint — desktop floating tooltip + mobile action sheet
* e0a60da feat: KPI hint overlay — tap-hold (iOS) / hover (desktop) with Thai definitions (#20)
* 9466193 fix: tighten timeframe selector spacing to match KPI row gap (#19)
* de63976 fix: dashboard UX polish — timeframe keeps expanded KPI, pips/label styles, green dot blink (#18)
* 6d5c9ef feat: redesign launch screen with cinematic logo animation + economic events
* 03feff8 Claude/ai login design 4ctuh (#17)
* 6346595 Delete .github/workflows directory
* fe88eff feat: AI login gate + zero-cost local insight composer (#16)
* 79525fd fix: match expanded KPI label font to KPI chip, remove unused component (#15)
* 354d9f0 fix: remove stale launch screen conflict CSS
* 7d2d0cd ..
* 56aba82 Retheme dashboard: pure black background, electric blue accent, unified KPI font
* 65fac06 4.0
*   19ef02c Merge branch 'claude/loading-screen-typewriter-effect'
|\  
| * 8de3fe5 Add typewriter effect to LoadingScreen AI status text
* | 01d2c27 Add typewriter effect to LoadingScreen AI status text
|/  
*   ef692e7 Merge pull request #11 from therng/claude/add-claude-documentation-xfKoW
|\  
| * 84d1cb5 Update CLAUDE.md with comprehensive v4.0 codebase documentation
|/  
*   9011cad Merge pull request #9 from therng/dependabot/npm_and_yarn/npm_and_yarn-e1f204eff9
|\  
| * daf37ed chore(deps): bump basic-ftp in the npm_and_yarn group across 1 directory
* |   0bab3fb Merge pull request #10 from therng/claude/analyze-test-coverage-1rmun
|\ \  
| * | 223f699 Add AI Core loading screen splash on app startup
| |/  
* / 0cacd27 4.0
|/  
* c806695 Fix Thai 1D chart boundaries and table time handling
* e24a880 feat: add pips performance table and refactor trading analytics
* 6c9cf15 fix: stop dashboard auto-refresh flash and keep pips as table view
* 65469cc chore: clean up globals css
* 9b65ae7 new landscap
* c417e81 Add baseline CI workflow
*   f6c9b87 Merge pull request #5 from therng/codex/add-baseline-ci-workflow
|\  
| * 7e87f61 chore: add baseline CI workflow
* |   d52add3 Merge pull request #6 from therng/dependabot/npm_and_yarn/npm_and_yarn-2dee6a94ba
|\ \  
| * | 1defca0 Bump basic-ftp in the npm_and_yarn group across 1 directory
* | |   1f6456e Merge pull request #7 from therng/codex/locate-and-fix-important-codebase-bug
|\ \ \  
| |/ /  
|/| |   
| * | ccec20c fix: promote rounded compact values to K suffix
|/ /  
* | 1986343 db
* | 5a0eb30 fix: restore lint and build pipeline
* | 050f7d4 ios
* | c38920c chore: add baseline CI workflow
|/  
*   b1b3857 Merge pull request #3 from therng/dependabot/npm_and_yarn/npm_and_yarn-51f20fa610
|\  
| * 5c9282a Bump the npm_and_yarn group across 1 directory with 4 updates
|/  
* 6085b06 feat: refine landscape account cards
* ecd4831 feat: overhaul trading monitor and add mobile experiments
* edfa8cf fix: make funding and win stats stable across timeframes and polish profit panel UI
* 6c682dd fix bug
* 4f832e8 Add cleanup script and trading monitor redesign
* f6c098f Complete frontend redesign and schema refactoring
* 6523b61 worker
* c05da45 re dark
* 8e38937 Implement cashflow-neutral drawdown and parser regressions
* 1db4b38 v2
* 3fb1cb8 v2
* fd15a85 v2
* 3e9adb3 1.0
* c012f40 Initial commit
