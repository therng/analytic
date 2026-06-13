# Analytic — iOS App

Native iOS 26 trading dashboard with Liquid Glass design system.

## Setup

### Prerequisites

- Xcode 26 (beta) or later
- iOS 26 SDK
- macOS Sequoia

### Create Xcode Project

1. Open Xcode → **Create New Project**
2. Choose **iOS → App**
3. Configure:
   - **Product Name:** `Analytic`
   - **Team:** your Apple Developer account
   - **Bundle ID:** `com.therng.analytic`
   - **Interface:** SwiftUI
   - **Language:** Swift
   - **Minimum Deployment:** iOS 26.0
   - Uncheck "Include Tests" (add manually later)
4. Save to `ios/` inside the monorepo root

### Add Source Files

All Swift source files in `ios/Analytic/` are pre-generated. After creating the project:

1. In Xcode, right-click the `Analytic` group → **Add Files to "Analytic"**
2. Select all folders from `ios/Analytic/`:
   - `DesignSystem/`
   - `Components/`
   - `Models/`
   - `ViewModels/`
   - `Views/`
   - `Services/`
   - `App/`
3. Ensure **"Add to target: Analytic"** is checked

### Build Configurations / Schemes

Create two schemes in Xcode:

| Scheme | `APIBaseURL` | `WebSocketURL` |
|--------|-------------|----------------|
| `Analytic Dev` | `http://localhost:3000` | `ws://localhost:8000` |
| `Analytic Prod` | `https://therng.duckdns.org` | `wss://therng.duckdns.org/ws` |

Add build setting `API_BASE_URL` with the value per scheme, then reference in `Info.plist`:
```xml
<key>APIBaseURL</key>
<string>$(API_BASE_URL)</string>
```

### Run

Select `Analytic Dev` scheme → `iPhone 16 Pro (iOS 26)` simulator → ⌘R

## Architecture

```
ios/Analytic/
├── App/
│   ├── AnalyticApp.swift       # @main entry
│   └── ContentView.swift       # Tab navigation
├── DesignSystem/
│   ├── Tokens.swift            # Spacing, Radius, Shadow, Animation constants
│   ├── ColorPalette.swift      # Brand colors, hex init, gradients
│   ├── Typography.swift        # Font scale, view modifiers
│   └── GlassEffect.swift       # GlassCard, GlassPill, GlassSectionHeader
├── Components/
│   ├── KPIChip.swift           # KPI chip + horizontal scrollable strip
│   ├── LiveBeaconRing.swift    # Animated WebSocket status ring
│   └── LoadingScreen.swift     # Launch screen with candlestick animation
├── Models/           # Phase 2: Codable data models
├── ViewModels/       # Phase 2: @Observable ViewModels
├── Views/            # Phase 3: Dashboard, Calendar, News, Settings
└── Services/         # Phase 2: APIClient, WebSocketService
```

## Phase Progress

- [x] Phase 1 — Project Setup & Design System
- [ ] Phase 2 — Networking Layer & Data Models
- [ ] Phase 3 — Core Dashboard Screens
- [ ] Phase 4 — Real-time Updates & State Management
- [ ] Phase 5 — iOS 26 Features & Distribution
