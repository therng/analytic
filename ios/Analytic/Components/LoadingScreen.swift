import SwiftUI

// MARK: - Launch Loading Screen
// Mirrors LoadingScreen.tsx — logo mark with animated candlestick line draw

struct LoadingScreen: View {
    @State private var lineProgress: CGFloat = 0
    @State private var logoOpacity: Double = 0
    @State private var subtitleOpacity: Double = 0

    var body: some View {
        ZStack {
            Color.surfaceBase.ignoresSafeArea()

            VStack(spacing: Spacing.xl) {
                Spacer()

                // Logo mark — candlestick motif
                CandlestickLogoMark()
                    .frame(width: 80, height: 80)
                    .opacity(logoOpacity)

                // App name
                VStack(spacing: Spacing.xs) {
                    Text("Analytic")
                        .font(TypographyScale.displaySmall)
                        .foregroundStyle(Color.textPrimary)

                    Text("Trading Dashboard")
                        .analyticsCaption()
                        .foregroundStyle(Color.textSecondary)
                }
                .opacity(subtitleOpacity)

                Spacer()

                // Animated line draw progress
                LoadingLineIndicator(progress: lineProgress)
                    .frame(width: 120, height: 2)
                    .padding(.bottom, Spacing.xxxl)
            }
        }
        .onAppear {
            withAnimation(.easeOut(duration: 0.5)) {
                logoOpacity = 1
            }
            withAnimation(.easeOut(duration: 0.5).delay(0.2)) {
                subtitleOpacity = 1
            }
            withAnimation(.easeInOut(duration: 1.2).delay(0.3)) {
                lineProgress = 1
            }
        }
    }
}

// MARK: - Candlestick Logo Mark

struct CandlestickLogoMark: View {
    var body: some View {
        Canvas { context, size in
            let w = size.width
            let h = size.height
            let barWidth: CGFloat = w * 0.18

            // Rising equity line
            var linePath = Path()
            linePath.move(to: CGPoint(x: w * 0.05, y: h * 0.75))
            linePath.addCurve(
                to: CGPoint(x: w * 0.95, y: h * 0.18),
                control1: CGPoint(x: w * 0.35, y: h * 0.72),
                control2: CGPoint(x: w * 0.65, y: h * 0.22)
            )
            context.stroke(
                linePath,
                with: .linearGradient(
                    Gradient(colors: [.accentGold, .gainGreen]),
                    startPoint: CGPoint(x: 0, y: h),
                    endPoint: CGPoint(x: w, y: 0)
                ),
                lineWidth: 3
            )

            // Bullish candlestick body (right side)
            let candleX = w * 0.72
            let candleBody = CGRect(x: candleX - barWidth / 2, y: h * 0.3, width: barWidth, height: h * 0.35)
            context.fill(
                Path(roundedRect: candleBody, cornerRadius: 2),
                with: .color(.gainGreen)
            )
            // Wick
            var wickPath = Path()
            wickPath.move(to: CGPoint(x: candleX, y: h * 0.16))
            wickPath.addLine(to: CGPoint(x: candleX, y: h * 0.3))
            wickPath.move(to: CGPoint(x: candleX, y: h * 0.65))
            wickPath.addLine(to: CGPoint(x: candleX, y: h * 0.76))
            context.stroke(wickPath, with: .color(.gainGreen), lineWidth: 1.5)
        }
    }
}

// MARK: - Loading Line Indicator

struct LoadingLineIndicator: View {
    let progress: CGFloat

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 1)
                    .fill(Color.white.opacity(0.1))

                RoundedRectangle(cornerRadius: 1)
                    .fill(Gradients.goldAccent)
                    .frame(width: geo.size.width * progress)
                    .animation(Animations.entrance, value: progress)
            }
        }
    }
}

// MARK: - Preview

#Preview("Loading Screen") {
    LoadingScreen()
}
