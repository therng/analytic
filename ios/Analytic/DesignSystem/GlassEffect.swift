import SwiftUI

// MARK: - Glass Card Shape

/// Primary container component for the Liquid Glass design language.
/// Uses iOS 26 `.glassEffect()` with a gold accent border overlay.
struct GlassCard<Content: View>: View {
    var cornerRadius: CGFloat
    var padding: CGFloat
    var accentBorder: Bool
    var content: () -> Content

    init(
        cornerRadius: CGFloat = Radius.xl,
        padding: CGFloat = Spacing.base,
        accentBorder: Bool = false,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.cornerRadius = cornerRadius
        self.padding = padding
        self.accentBorder = accentBorder
        self.content = content
    }

    var body: some View {
        content()
            .padding(padding)
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .stroke(
                                accentBorder
                                    ? Color.accentGold.opacity(0.4)
                                    : Color.glassBorder,
                                lineWidth: accentBorder ? 1.5 : 1
                            )
                    }
            }
            .glassEffect(
                Glass().cornerRadius(cornerRadius)
            )
    }
}

// MARK: - Elevated Glass Card (with shadow)

struct ElevatedGlassCard<Content: View>: View {
    var cornerRadius: CGFloat
    var content: () -> Content

    init(
        cornerRadius: CGFloat = Radius.xl,
        @ViewBuilder content: @escaping () -> Content
    ) {
        self.cornerRadius = cornerRadius
        self.content = content
    }

    var body: some View {
        GlassCard(cornerRadius: cornerRadius, content: content)
            .cardShadow(Shadows.subtleElevation)
    }
}

// MARK: - Glass Section Header

struct GlassSectionHeader: View {
    let title: String
    var subtitle: String? = nil
    var trailingContent: AnyView? = nil

    var body: some View {
        HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(TypographyScale.bodyMedium.weight(.semibold))
                    .foregroundStyle(Color.textPrimary)

                if let subtitle {
                    Text(subtitle)
                        .analyticsCaption()
                        .foregroundStyle(Color.textSecondary)
                }
            }

            Spacer()

            trailingContent
        }
        .padding(.horizontal, Spacing.base)
        .padding(.bottom, Spacing.sm)
    }
}

// MARK: - Glass Pill (for KPI labels, tags)

struct GlassPill: View {
    let label: String
    var color: Color = .accentGold

    var body: some View {
        Text(label)
            .font(TypographyScale.captionBold)
            .foregroundStyle(color)
            .padding(.horizontal, Spacing.sm)
            .padding(.vertical, Spacing.xs)
            .background {
                Capsule()
                    .fill(color.opacity(0.12))
                    .overlay {
                        Capsule()
                            .stroke(color.opacity(0.3), lineWidth: 1)
                    }
            }
    }
}

// MARK: - View Modifier: Glass Background

struct GlassBackgroundModifier: ViewModifier {
    var cornerRadius: CGFloat

    func body(content: Content) -> some View {
        content
            .background {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .overlay {
                        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                            .stroke(Color.glassBorder, lineWidth: 1)
                    }
            }
            .glassEffect(Glass().cornerRadius(cornerRadius))
    }
}

extension View {
    func glassBackground(cornerRadius: CGFloat = Radius.xl) -> some View {
        self.modifier(GlassBackgroundModifier(cornerRadius: cornerRadius))
    }
}

// MARK: - Preview

#Preview("Glass Components") {
    ZStack {
        Color.surfaceBase
            .ignoresSafeArea()

        VStack(spacing: Spacing.lg) {
            GlassCard(accentBorder: true) {
                VStack(alignment: .leading, spacing: Spacing.sm) {
                    Text("Account: Bot_Alpha")
                        .font(TypographyScale.bodyLarge.weight(.semibold))
                        .foregroundStyle(Color.textPrimary)

                    Text("Balance: $12,450.00")
                        .analyticsNumeric()
                        .foregroundStyle(Color.accentGold)
                }
            }

            GlassCard {
                HStack {
                    GlassPill(label: "+2.4%", color: .gainGreen)
                    GlassPill(label: "LIVE", color: .accentGold)
                    GlassPill(label: "12 trades", color: .textSecondary)
                }
            }
        }
        .padding(Spacing.base)
    }
    .preferredColorScheme(.dark)
}
