import SwiftUI

// MARK: - Spacing

struct Spacing {
    private init() {}

    static let xs: CGFloat = 4
    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let base: CGFloat = 16
    static let lg: CGFloat = 20
    static let xl: CGFloat = 24
    static let xxl: CGFloat = 32
    static let xxxl: CGFloat = 48
}

// MARK: - Radius

struct Radius {
    private init() {}

    static let sm: CGFloat = 8
    static let md: CGFloat = 12
    static let lg: CGFloat = 16
    static let xl: CGFloat = 20
    static let xxl: CGFloat = 24
    static let pill: CGFloat = 999
}

// MARK: - Shadow

struct Shadows {
    private init() {}

    static let cardGlow = ShadowStyle(
        color: Color.accentGold.opacity(0.15),
        radius: 16,
        x: 0,
        y: 4
    )

    static let subtleElevation = ShadowStyle(
        color: .black.opacity(0.4),
        radius: 8,
        x: 0,
        y: 2
    )
}

struct ShadowStyle {
    let color: Color
    let radius: CGFloat
    let x: CGFloat
    let y: CGFloat
}

extension View {
    func cardShadow(_ style: ShadowStyle) -> some View {
        self.shadow(color: style.color, radius: style.radius, x: style.x, y: style.y)
    }
}

// MARK: - Animation

struct Animations {
    private init() {}

    /// Standard UI response — matches CSS `--t-base: 200ms`
    static let standard: Animation = .spring(response: 0.2, dampingFraction: 0.82)

    /// Entrance / exit transitions
    static let entrance: Animation = .spring(response: 0.35, dampingFraction: 0.75)

    /// Slow emphasis (beacon ring, pulsing glow)
    static let pulse: Animation = .easeInOut(duration: 1.5).repeatForever(autoreverses: true)

    /// Liquid Glass morphing
    static let glass: Animation = .spring(response: 0.4, dampingFraction: 0.85)
}
