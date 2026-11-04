import Foundation

/// Денежная сумма в минимальных единицах (копейках). Без плавающей точки —
/// суммирование 0.1 + 0.2 не даёт погрешностей в отчётах.
public struct Money: Hashable, Comparable, Codable, Sendable, CustomStringConvertible {
    public var minorUnits: Int
    public var currencyCode: String

    public init(minorUnits: Int, currencyCode: String = "UAH") {
        self.minorUnits = minorUnits
        self.currencyCode = currencyCode
    }

    public static func uah(_ hryvnias: Int, kopecks: Int = 0) -> Money {
        Money(minorUnits: hryvnias * 100 + kopecks)
    }

    public static let zero = Money(minorUnits: 0)

    /// Разбор пользовательского ввода: «30», «30,5», «30.50», «1 250,00».
    public init?(parsing text: String, currencyCode: String = "UAH") {
        let cleaned = text
            .replacingOccurrences(of: "₴", with: "")
            .replacingOccurrences(of: "\u{00A0}", with: "")
            .replacingOccurrences(of: " ", with: "")
            .replacingOccurrences(of: ",", with: ".")
        guard !cleaned.isEmpty, let value = Decimal(string: cleaned, locale: Locale(identifier: "en_US_POSIX")),
              value >= 0 else { return nil }
        let parts = cleaned.split(separator: ".", omittingEmptySubsequences: false)
        guard parts.count <= 2, parts.allSatisfy({ $0.allSatisfy(\.isNumber) }),
              (parts.count < 2 || parts[1].count <= 2) else { return nil }
        var scaled = value * 100
        var rounded = Decimal()
        NSDecimalRound(&rounded, &scaled, 0, .plain)
        self.init(minorUnits: NSDecimalNumber(decimal: rounded).intValue, currencyCode: currencyCode)
    }

    public static func < (lhs: Money, rhs: Money) -> Bool { lhs.minorUnits < rhs.minorUnits }
    public static func + (lhs: Money, rhs: Money) -> Money {
        Money(minorUnits: lhs.minorUnits + rhs.minorUnits, currencyCode: lhs.currencyCode)
    }
    public static func - (lhs: Money, rhs: Money) -> Money {
        Money(minorUnits: lhs.minorUnits - rhs.minorUnits, currencyCode: lhs.currencyCode)
    }
    public static func += (lhs: inout Money, rhs: Money) { lhs = lhs + rhs }

    /// Деление с округлением к ближайшей копейке (для средних значений).
    public func divided(by divisor: Int) -> Money? {
        guard divisor != 0 else { return nil }
        let q = Double(minorUnits) / Double(divisor)
        return Money(minorUnits: Int(q.rounded()), currencyCode: currencyCode)
    }

    public func multiplied(by factor: Double) -> Money {
        Money(minorUnits: Int((Double(minorUnits) * factor).rounded()), currencyCode: currencyCode)
    }

    /// «30 ₴», «30,50 ₴», «1 250 ₴» (неразрывные пробелы). Не зависит от локали устройства,
    /// чтобы отчёты и тесты были детерминированными.
    public var formatted: String {
        let negative = minorUnits < 0
        let absValue = abs(minorUnits)
        let whole = absValue / 100
        let frac = absValue % 100
        var digits = String(whole)
        var grouped = ""
        while digits.count > 3 {
            grouped = "\u{00A0}" + String(digits.suffix(3)) + grouped
            digits.removeLast(3)
        }
        grouped = digits + grouped
        let fracPart = frac == 0 ? "" : "," + (frac < 10 ? "0\(frac)" : "\(frac)")
        let symbol = currencyCode == "UAH" ? "₴" : currencyCode
        return (negative ? "−" : "") + grouped + fracPart + "\u{00A0}" + symbol
    }

    public var description: String { formatted }
}

extension Sequence where Element == Money {
    public func sum() -> Money { reduce(.zero, +) }
}
