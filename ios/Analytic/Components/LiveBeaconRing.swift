import SwiftUI

// MARK: - Live Beacon Ring
// Mirrors the web "pulsing ring" framer-motion indicator on the heatmap Today cell.
// Animates while WebSocket is connected; fades when disconnected.

struct LiveBeaconRing: View {
    let isLive: Bool
    var size: CGFloat = 10
    var color: Color = .accentGold

    @State private var pulseScale: CGFloat = 1.0
    @State private var pulseOpacity: Double = 0.8

    var body: some View {
        ZStack {
            // Outer pulse ring
            Circle()
                .stroke(color.opacity(pulseOpacity * 0.4), lineWidth: 2)
                .scaleEffect(pulseScale)
                .frame(width: size * 2.4, height: size * 2.4)

            // Inner solid dot
            Circle()
                .fill(color)
                .frame(width: size, height: size)
                .overlay {
                    // Subtle highlight
                    Circle()
                        .fill(Color.white.opacity(0.3))
                        .frame(width: size * 0.45, height: size * 0.45)
                        .offset(x: -size * 0.12, y: -size * 0.12)
                }
        }
        .opacity(isLive ? 1 : 0.25)
        .onChange(of: isLive, initial: true) { _, live in
            if live {
                startPulse()
            } else {
                withAnimation(.easeOut(duration: 0.3)) {
                    pulseScale = 1.0
                    pulseOpacity = 0.8
                }
            }
        }
    }

    private func startPulse() {
        withAnimation(
            .easeOut(duration: 1.2).repeatForever(autoreverses: false)
        ) {
            pulseScale = 2.0
            pulseOpacity = 0
        }
    }
}

// MARK: - Connection Status Badge

struct ConnectionBadge: View {
    let isLive: Bool

    var body: some View {
        HStack(spacing: 5) {
            LiveBeaconRing(isLive: isLive, size: 6)

            Text(isLive ? "LIVE" : "OFFLINE")
                .font(TypographyScale.captionBold)
                .foregroundStyle(isLive ? Color.accentGold : Color.textTertiary)
        }
        .padding(.horizontal, Spacing.sm)
        .padding(.vertical, 4)
        .background {
            Capsule()
                .fill((isLive ? Color.accentGold : Color.textTertiary).opacity(0.1))
                .overlay {
                    Capsule()
                        .stroke((isLive ? Color.accentGold : Color.textTertiary).opacity(0.25), lineWidth: 1)
                }
        }
    }
}

// MARK: - Preview

#Preview("Live Beacon") {
    ZStack {
        Color.surfaceBase.ignoresSafeArea()

        HStack(spacing: Spacing.xxl) {
            VStack(spacing: Spacing.md) {
                LiveBeaconRing(isLive: true, size: 12)
                Text("Connected").analyticsCaption().foregroundStyle(.textSecondary)
            }

            VStack(spacing: Spacing.md) {
                LiveBeaconRing(isLive: false, size: 12)
                Text("Offline").analyticsCaption().foregroundStyle(.textTertiary)
            }

            VStack(spacing: Spacing.md) {
                ConnectionBadge(isLive: true)
                ConnectionBadge(isLive: false)
            }
        }
    }
    .preferredColorScheme(.dark)
}
