import SwiftUI

// MARK: - Font Scale
// Mirrors web: Bai Jamjuree (numeric mono) + Sarabun (body)
// On iOS we use SF Pro Display / SF Mono as system equivalents

struct TypographyScale {
    private init() {}

    // Display — account balance, equity headline
    static let displayLarge  = Font.system(size: 34, weight: .bold,   design: .default)
    static let displayMedium = Font.system(size: 28, weight: .bold,   design: .default)
    static let displaySmall  = Font.system(size: 22, weight: .semibold, design: .default)

    // Body — labels, descriptions
    static let bodyLarge   = Font.system(size: 17, weight: .regular, design: .default)
    static let bodyMedium  = Font.system(size: 15, weight: .regular, design: .default)
    static let bodySmall   = Font.system(size: 13, weight: .regular, design: .default)

    // Caption
    static let caption     = Font.system(size: 11, weight: .regular, design: .default)
    static let captionBold = Font.system(size: 11, weight: .semibold, design: .default)

    // Numeric mono — matches Bai Jamjuree on web
    static let numericLarge  = Font.system(size: 22, weight: .semibold, design: .monospaced)
    static let numericMedium = Font.system(size: 17, weight: .medium,   design: .monospaced)
    static let numericSmall  = Font.system(size: 13, weight: .regular,  design: .monospaced)

    // KPI chip value
    static let kpiValue = Font.system(size: 15, weight: .semibold, design: .monospaced)
    static let kpiLabel = Font.system(size: 10, weight: .medium,   design: .default)
        .uppercaseSmallCaps()
}

// MARK: - View Modifiers for convenience

extension View {
    func analyticsDisplay()  -> some View { self.font(TypographyScale.displayMedium)  }
    func analyticsBody()     -> some View { self.font(TypographyScale.bodyMedium)     }
    func analyticsCaption()  -> some View { self.font(TypographyScale.caption)        }
    func analyticsNumeric()  -> some View { self.font(TypographyScale.numericMedium)  }
    func analyticsKPIValue() -> some View { self.font(TypographyScale.kpiValue)       }
    func analyticsKPILabel() -> some View { self.font(TypographyScale.kpiLabel)       }
}
