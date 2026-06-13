# Implementation Plan: iOS Native App — Liquid Glass Design System (iOS 26)

**Track ID:** ios-native-app_20260610
**Spec:** [spec.md](./spec.md)
**Created:** 2026-06-10
**Status:** [ ] Not Started

## Overview

Build the iOS app as a new Xcode project (`ios/`) inside the monorepo. Phase 1 establishes the project scaffold and design system foundations (Liquid Glass tokens, typography, color). Phase 2 implements the networking layer and data models mirroring the existing API. Phase 3 builds the core dashboard screens. Phase 4 adds real-time updates and live data. Phase 5 polishes with iOS 26-specific features and app store preparation.

---

## Phase 1: Project Setup & Design System Foundation

Scaffold the Xcode project, configure build targets, and establish the Liquid Glass design system as a reusable SwiftUI layer.

### Tasks

- [ ] Task 1.1: Create Xcode project `ios/Analytic.xcodeproj` — SwiftUI, iOS 26 deployment target, MVVM folder structure (`Models/`, `ViewModels/`, `Views/`, `Services/`, `DesignSystem/`)
- [ ] Task 1.2: Configure schemes for Dev (localhost/ngrok) and Production (`therng.duckdns.org`) with `APIBaseURL` build setting
- [ ] Task 1.3: Define design tokens in `DesignSystem/Tokens.swift` — accent color (Electric/gold `#FFD700`), background materials, spacing scale, corner radii
- [ ] Task 1.4: Build `GlassCard` SwiftUI component using `.glassEffect()` modifier (iOS 26) — primary container for all panels
- [ ] Task 1.5: Build `GlassNavigationBar` and tab bar with Liquid Glass material
- [ ] Task 1.6: Typography system — SF Pro Display for headers, SF Mono for numeric values, matching existing dashboard hierarchy
- [ ] Task 1.7: Dark mode first — verify all glass materials render correctly in dark and light mode

### Verification

- [ ] App launches on iOS 26 Simulator, shows tab bar with glass material
- [ ] `GlassCard` renders with correct translucency and blur on sample content

---

## Phase 2: Networking Layer & Data Models

Implement the API client and Swift data models that mirror the existing Next.js API responses.

### Tasks

- [ ] Task 2.1: `APIClient.swift` — async/await `URLSession` wrapper with base URL injection, JSON decoding, error handling
- [ ] Task 2.2: Define Swift `Codable` models: `TradingAccount`, `AccountSnapshot`, `AccountReportResult`, `Position`, `OpenPosition`, `EconomicEvent`, `NewsItem`
- [ ] Task 2.3: `AccountService.swift` — fetch account list, snapshots, report results
- [ ] Task 2.4: `EconomicCalendarService.swift` — fetch `/api/economic-events?scope=expanded`
- [ ] Task 2.5: `NewsService.swift` — fetch `/api/news`
- [ ] Task 2.6: `WebSocketService.swift` — `URLSessionWebSocketTask` connecting to FastAPI gateway; publishes equity/balance beacon events via `AsyncStream`
- [ ] Task 2.7: Write unit tests for JSON decoding against fixture responses (snapshot real API responses as test fixtures)

### Verification

- [ ] `APIClient` successfully fetches accounts from dev environment
- [ ] WebSocket connects and receives live equity updates
- [ ] Unit tests pass for all model decoders

---

## Phase 3: Core Dashboard Screens

Build the main UI screens using the design system components from Phase 1 and data from Phase 2.

### Tasks

- [ ] Task 3.1: `AccountListView` — scrollable list of `GlassCard` account rows; sort by Growth 1D desc (matching web default); KPI chips (net gain, drawdown, pips, trades, open positions)
- [ ] Task 3.2: `AccountDetailView` — drill-in sheet with balance/equity sparkline, full KPI grid, performance quality indicators
- [ ] Task 3.3: `BalanceChartView` — Swift Charts line chart for balance/equity curve with period selector (1D / 1W / 1M / All)
- [ ] Task 3.4: `ProfitHeatmapView` — custom SwiftUI grid (month × day) with color gradient, matching `ProfitHeatmapPanel` logic
- [ ] Task 3.5: `OpenPositionsView` — table of open positions with floating P/L, colored by direction
- [ ] Task 3.6: `EconomicCalendarView` — grouped list by date/impact with expandable detail rows; mirrors `EconomicCalendarPanel`
- [ ] Task 3.7: `NewsFeedView` — news cards with sentiment badge; sources from `/api/news`
- [ ] Task 3.8: Tab bar navigation: Dashboard · Calendar · News · Settings

### Verification

- [ ] All screens navigate correctly from tab bar
- [ ] Account list renders with correct KPI data from live API
- [ ] Heatmap and chart render with real position/deal data

---

## Phase 4: Real-time Updates & Live Data

Wire the WebSocket service into ViewModels so the UI reflects live equity changes without manual refresh.

### Tasks

- [ ] Task 4.1: `AccountViewModel` subscribes to `WebSocketService.AsyncStream`; updates `@Observable` state for live equity/balance
- [ ] Task 4.2: Live equity beacon ring on account cards — animated ring (matching web pulsing indicator) using `Canvas` or `TimelineView`
- [ ] Task 4.3: Pull-to-refresh on `AccountListView` triggers full API refetch
- [ ] Task 4.4: Background app refresh — `BGAppRefreshTask` to keep data warm when app is backgrounded
- [ ] Task 4.5: Offline state handling — show last-known data with "last updated" timestamp when network unavailable

### Verification

- [ ] Live equity updates appear on account cards within ≤5s of backend event
- [ ] Beacon ring animates while WebSocket is connected; stops when disconnected
- [ ] App shows stale-data warning correctly when offline

---

## Phase 5: iOS 26 Features, Polish & Distribution

Add platform-specific enhancements, accessibility, and prepare for TestFlight/App Store distribution.

### Tasks

- [ ] Task 5.1: **Live Activities** — `AccountLiveActivity` showing top account equity + P/L on Lock Screen / Dynamic Island during active market hours
- [ ] Task 5.2: **WidgetKit** — small/medium home screen widget showing account balance and daily growth for a selected account
- [ ] Task 5.3: **Spotlight** integration — index accounts so they appear in Spotlight search
- [ ] Task 5.4: Haptic feedback on key interactions (account tap, refresh, alert thresholds)
- [ ] Task 5.5: Accessibility — `accessibilityLabel` on all chart elements, VoiceOver support for KPI chips, Dynamic Type support
- [ ] Task 5.6: App icon — adapt existing "Equity Ascent" candlestick motif for iOS icon grid (1024×1024 + all required sizes)
- [ ] Task 5.7: LaunchScreen / splash with logo animation (mirror `LoadingScreen.tsx` concept in SwiftUI)
- [ ] Task 5.8: Settings screen — API base URL override, refresh interval, account display preferences
- [ ] Task 5.9: `CHANGELOG`, `ios/README.md`, update root `CLAUDE.md` with iOS build instructions
- [ ] Task 5.10: Xcode Cloud or manual archive → TestFlight upload

### Verification

- [ ] Live Activity appears on Lock Screen when triggered
- [ ] Widget renders correct data on Home Screen
- [ ] VoiceOver navigates all screens without skipped elements
- [ ] Build archives cleanly with no warnings; uploads to TestFlight

---

## Final Verification

- [ ] All 5 acceptance criteria met
- [ ] iOS 26 Simulator + physical device tested
- [ ] No critical accessibility issues
- [ ] App connects to `therng.duckdns.org` production endpoint successfully
- [ ] Core data paths verified: accounts list, real-time equity, heatmap, calendar, news
- [ ] Ready for TestFlight review

---

_Generated by Conductor. Tasks marked [~] in progress, [x] complete._
