import SwiftUI

// MARK: - KPI Chip
// Matches the web dashboard "KPI chip" pattern: net gain, drawdown, pips, trades, open positions

struct KPIChip: View {
    let label: String
    let value: String
    var color: Color = .textPrimary
    var icon: String? = nil

    var body: some View {
        VStack(spacing: 2) {
            HStack(spacing: 4) {
                if let icon {
                    Image(systemName: icon)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundStyle(color.opacity(0.7))
                }
                Text(value)
                    .analyticsKPIValue()
                    .foregroundStyle(color)
                    .lineLimit(1)
            }

            Text(label)
                .analyticsKPILabel()
                .foregroundStyle(Color.textTertiary)
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, Spacing.xs + 2)
        .background {
            RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                .fill(color.opacity(0.08))
                .overlay {
                    RoundedRectangle(cornerRadius: Radius.md, style: .continuous)
                        .stroke(color.opacity(0.2), lineWidth: 1)
                }
        }
    }
}

// MARK: - KPI Chip Row (horizontal scrollable strip)

struct KPIChipRow: View {
    struct Item: Identifiable {
        let id = UUID()
        let label: String
        let value: String
        var color: Color = .textPrimary
        var icon: String? = nil
    }

    let items: [Item]

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Spacing.sm) {
                ForEach(items) { item in
                    KPIChip(
                        label: item.label,
                        value: item.value,
                        color: item.color,
                        icon: item.icon
                    )
                }
            }
            .padding(.horizontal, Spacing.base)
        }
    }
}

// MARK: - Preview

#Preview("KPI Chips") {
    ZStack {
        Color.surfaceBase.ignoresSafeArea()

        VStack(spacing: Spacing.lg) {
            KPIChipRow(items: [
                .init(label: "Net Gain", value: "+$1,240", color: .gainGreen, icon: "arrow.up.right"),
                .init(label: "Drawdown", value: "−4.2%",  color: .lossRed,   icon: "arrow.down"),
                .init(label: "Pips",     value: "312",     color: .accentGold),
                .init(label: "Trades",   value: "47",      color: .textSecondary),
                .init(label: "Open",     value: "3",       color: .impactMedium, icon: "chart.xyaxis.line"),
            ])
        }
    }
    .preferredColorScheme(.dark)
}
