import SwiftUI

// MARK: - Main App Tab Navigation

struct ContentView: View {
    @State private var selectedTab: AppTab = .dashboard
    @State private var isLoading = true

    var body: some View {
        ZStack {
            if isLoading {
                LoadingScreen()
                    .transition(.opacity)
            } else {
                mainTabView
                    .transition(.opacity)
            }
        }
        .animation(Animations.entrance, value: isLoading)
        .task {
            // Simulate initial data load — replace with real async fetch
            try? await Task.sleep(for: .seconds(1.8))
            isLoading = false
        }
    }

    private var mainTabView: some View {
        TabView(selection: $selectedTab) {
            ForEach(AppTab.allCases) { tab in
                tab.rootView
                    .tabItem {
                        Label(tab.title, systemImage: tab.icon)
                    }
                    .tag(tab)
            }
        }
        .tint(Color.accentGold)
    }
}

// MARK: - App Tabs

enum AppTab: String, CaseIterable, Identifiable {
    case dashboard = "dashboard"
    case calendar  = "calendar"
    case news      = "news"
    case settings  = "settings"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .dashboard: "Dashboard"
        case .calendar:  "Calendar"
        case .news:      "News"
        case .settings:  "Settings"
        }
    }

    var icon: String {
        switch self {
        case .dashboard: "chart.xyaxis.line"
        case .calendar:  "calendar"
        case .news:      "newspaper"
        case .settings:  "gearshape"
        }
    }

    @ViewBuilder
    var rootView: some View {
        switch self {
        case .dashboard:
            DashboardPlaceholderView()
        case .calendar:
            CalendarPlaceholderView()
        case .news:
            NewsPlaceholderView()
        case .settings:
            SettingsPlaceholderView()
        }
    }
}

// MARK: - Placeholder Views (replaced in Phase 3)

struct DashboardPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                Color.surfaceBase.ignoresSafeArea()

                VStack(spacing: Spacing.lg) {
                    GlassCard(accentBorder: true) {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Bot_Alpha_01")
                                        .font(TypographyScale.bodyLarge.weight(.semibold))
                                        .foregroundStyle(Color.textPrimary)
                                    Text("IC Markets · MT5")
                                        .analyticsCaption()
                                        .foregroundStyle(Color.textSecondary)
                                }

                                Spacer()

                                ConnectionBadge(isLive: true)
                            }

                            Text("$12,450.00")
                                .font(TypographyScale.displaySmall)
                                .foregroundStyle(Color.accentGold)

                            KPIChipRow(items: [
                                .init(label: "Net Gain", value: "+$540",  color: .gainGreen, icon: "arrow.up.right"),
                                .init(label: "DD",       value: "−3.1%",  color: .lossRed),
                                .init(label: "Pips",     value: "128",    color: .accentGold),
                                .init(label: "Trades",   value: "22",     color: .textSecondary),
                                .init(label: "Open",     value: "2",      color: .impactMedium),
                            ])
                        }
                    }

                    GlassCard {
                        VStack(alignment: .leading, spacing: Spacing.sm) {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text("Bot_Beta_02")
                                        .font(TypographyScale.bodyLarge.weight(.semibold))
                                        .foregroundStyle(Color.textPrimary)
                                    Text("Exness · MT5")
                                        .analyticsCaption()
                                        .foregroundStyle(Color.textSecondary)
                                }
                                Spacer()
                                ConnectionBadge(isLive: false)
                            }

                            Text("$8,920.00")
                                .font(TypographyScale.displaySmall)
                                .foregroundStyle(Color.textSecondary)
                        }
                    }

                    Spacer()
                }
                .padding(Spacing.base)
            }
            .navigationTitle("Analytic")
            .navigationBarTitleDisplayMode(.large)
        }
    }
}

struct CalendarPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                Color.surfaceBase.ignoresSafeArea()
                Text("Economic Calendar")
                    .analyticsBody()
                    .foregroundStyle(Color.textSecondary)
            }
            .navigationTitle("Calendar")
        }
    }
}

struct NewsPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                Color.surfaceBase.ignoresSafeArea()
                Text("News Feed")
                    .analyticsBody()
                    .foregroundStyle(Color.textSecondary)
            }
            .navigationTitle("News")
        }
    }
}

struct SettingsPlaceholderView: View {
    var body: some View {
        NavigationStack {
            ZStack {
                Color.surfaceBase.ignoresSafeArea()
                Text("Settings")
                    .analyticsBody()
                    .foregroundStyle(Color.textSecondary)
            }
            .navigationTitle("Settings")
        }
    }
}

// MARK: - Preview

#Preview("Content View") {
    ContentView()
        .preferredColorScheme(.dark)
}
