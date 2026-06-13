import SwiftUI

// MARK: - Brand Colors (matches globals.css design tokens)

extension Color {
    // Accent — "Electric Gold" matching CSS --color-accent: #FFD700
    static let accentGold = Color(hex: "#FFD700")

    // Semantic P&L
    static let gainGreen  = Color(hex: "#22C55E")  // tailwind green-500
    static let lossRed    = Color(hex: "#EF4444")  // tailwind red-500
    static let neutralGray = Color(hex: "#6B7280") // tailwind gray-500

    // Surface hierarchy (dark-first)
    static let surfaceBase      = Color(hex: "#0A0A0A")  // near-black base
    static let surfaceElevated  = Color(hex: "#111111")  // card surface
    static let surfaceMuted     = Color(hex: "#1A1A1A")  // subtle containers

    // Glass tint overlays
    static let glassBorder      = Color.white.opacity(0.08)
    static let glassHighlight   = Color.white.opacity(0.04)

    // Text
    static let textPrimary      = Color.white
    static let textSecondary    = Color.white.opacity(0.60)
    static let textTertiary     = Color.white.opacity(0.35)

    // Impact — economic calendar
    static let impactHigh       = Color(hex: "#EF4444")
    static let impactMedium     = Color(hex: "#F59E0B")
    static let impactLow        = Color(hex: "#6B7280")
}

// MARK: - Hex Initializer

extension Color {
    init(hex: String) {
        let hex = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var int: UInt64 = 0
        Scanner(string: hex).scanHexInt64(&int)
        let r, g, b, a: UInt64
        switch hex.count {
        case 6:
            (r, g, b, a) = (int >> 16, (int >> 8) & 0xFF, int & 0xFF, 255)
        case 8:
            (r, g, b, a) = (int >> 24, (int >> 16) & 0xFF, (int >> 8) & 0xFF, int & 0xFF)
        default:
            (r, g, b, a) = (0, 0, 0, 255)
        }
        self.init(
            .sRGB,
            red: Double(r) / 255,
            green: Double(g) / 255,
            blue: Double(b) / 255,
            opacity: Double(a) / 255
        )
    }
}

// MARK: - Gradient Presets

struct Gradients {
    private init() {}

    static let goldAccent = LinearGradient(
        colors: [Color.accentGold, Color.accentGold.opacity(0.6)],
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    static let gainFade = LinearGradient(
        colors: [Color.gainGreen.opacity(0.25), Color.gainGreen.opacity(0)],
        startPoint: .top,
        endPoint: .bottom
    )

    static let lossFade = LinearGradient(
        colors: [Color.lossRed.opacity(0.25), Color.lossRed.opacity(0)],
        startPoint: .top,
        endPoint: .bottom
    )

    static let chartLine = LinearGradient(
        colors: [Color.accentGold, Color.gainGreen],
        startPoint: .leading,
        endPoint: .trailing
    )
}
