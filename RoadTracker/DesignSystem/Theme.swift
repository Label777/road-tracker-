import SwiftUI

/// Дизайн-токены: графитовый фон, электрический зелёный акцент, компактные карточки.
enum Theme {
    static let background = Color(red: 0.071, green: 0.078, blue: 0.090)     // #121417
    static let surface = Color(red: 0.110, green: 0.122, blue: 0.141)        // #1C1F24
    static let surfaceRaised = Color(red: 0.149, green: 0.165, blue: 0.188)  // #262A30
    static let accent = Color(red: 0.180, green: 0.941, blue: 0.478)         // #2EF07A
    static let accentDim = accent.opacity(0.16)
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.62)
    static let warning = Color(red: 1.0, green: 0.76, blue: 0.28)
    static let danger = Color(red: 1.0, green: 0.36, blue: 0.36)

    static let cornerRadius: CGFloat = 18
    static let spacing: CGFloat = 12
}

struct Card<Content: View>: View {
    var title: LocalizedStringKey?
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let title {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(Theme.textSecondary)
                    .textCase(.uppercase)
            }
            content
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.cornerRadius, style: .continuous))
    }
}

struct Metric: View {
    let value: String
    let label: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(Theme.textPrimary)
                .contentTransition(.numericText())
            Text(label)
                .font(.caption)
                .foregroundStyle(Theme.textSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

enum Format {
    /// «1 ч 05 мин», «45 мин», «0 мин».
    static func duration(_ seconds: TimeInterval) -> String {
        let total = Int(seconds.rounded()) / 60
        let h = total / 60, m = total % 60
        return h > 0 ? String(localized: "\(h) ч \(String(format: "%02d", m)) мин") : String(localized: "\(m) мин")
    }

    static func hours(_ seconds: TimeInterval) -> String {
        String(localized: "\((seconds / 3600).formatted(.number.precision(.fractionLength(1)))) ч")
    }

    static func percentChange(_ value: Double?) -> String? {
        guard let value else { return nil }
        return value.formatted(.percent.precision(.fractionLength(0)).sign(strategy: .always()))
    }
}
