import Foundation

/// Одно наблюдение для статистики.
public struct InspectionObservation: Hashable, Sendable {
    public var outcome: InspectionOutcome
    public var observedAt: Date
    public var transport: TransportType?
    public var routeLabel: String?

    public init(outcome: InspectionOutcome, observedAt: Date, transport: TransportType? = nil, routeLabel: String? = nil) {
        self.outcome = outcome
        self.observedAt = observedAt
        self.transport = transport
        self.routeLabel = routeLabel
    }
}

/// Насколько можно доверять доле. Пороги выбраны так, чтобы при малой выборке
/// UI прямо говорил «данных недостаточно», а не показывал «вероятность 100 %».
public enum Reliability: String, Sendable, Comparable {
    case insufficient   // < 10 наблюдений
    case low            // 10–29
    case moderate       // 30–99
    case good           // ≥ 100

    public init(sampleSize n: Int) {
        switch n {
        case ..<10: self = .insufficient
        case ..<30: self = .low
        case ..<100: self = .moderate
        default: self = .good
        }
    }

    private var rank: Int { [Reliability.insufficient, .low, .moderate, .good].firstIndex(of: self)! }
    public static func < (a: Reliability, b: Reliability) -> Bool { a.rank < b.rank }
}

/// Доля с 95 % доверительным интервалом Уилсона (корректен при малых n и долях около 0/1,
/// в отличие от нормального приближения, которое при 0 из 5 даёт интервал [0; 0]).
public struct Proportion: Equatable, Sendable {
    public var successes: Int
    public var trials: Int
    public var estimate: Double? { trials > 0 ? Double(successes) / Double(trials) : nil }
    public var interval: ClosedRange<Double>? { Proportion.wilson(successes: successes, trials: trials) }
    public var reliability: Reliability { Reliability(sampleSize: trials) }

    public init(successes: Int, trials: Int) {
        precondition(successes >= 0 && successes <= trials)
        self.successes = successes
        self.trials = trials
    }

    public static func wilson(successes: Int, trials: Int, z: Double = 1.959964) -> ClosedRange<Double>? {
        guard trials > 0 else { return nil }
        let n = Double(trials), p = Double(successes) / n
        let z2 = z * z
        let denom = 1 + z2 / n
        let center = (p + z2 / (2 * n)) / denom
        let margin = z * sqrt(p * (1 - p) / n + z2 / (4 * n * n)) / denom
        return max(0, center - margin)...min(1, center + margin)
    }
}

/// Аналитика наблюдений. Это описание прошлого опыта пользователя, а не прогноз:
/// наблюдения неслучайны (пользователь отмечает их не всегда), поэтому UI показывает
/// размер выборки, интервал и уровень достоверности рядом с каждой долей.
public struct InspectionStatistics: Sendable {
    public var observations: [InspectionObservation]
    public var calendar: Calendar

    public init(observations: [InspectionObservation], calendar: Calendar = TripTiming.calendar(forTimeZoneIdentifier: nil)) {
        self.observations = observations
        self.calendar = calendar
    }

    /// Наблюдения с известным исходом (unknown не входит в знаменатель).
    public var known: [InspectionObservation] { observations.filter { $0.outcome != .unknown } }

    public var encounters: Int { observations.filter { $0.outcome.controllerPresent == true }.count }
    public var checks: Int { observations.filter { $0.outcome.ticketChecked == true }.count }

    /// Доля поездок/отрезков, где встретился контролёр.
    public var encounterRate: Proportion { Proportion(successes: encounters, trials: known.count) }
    /// Доля поездок/отрезков, где проверили билет.
    public var checkRate: Proportion { Proportion(successes: checks, trials: known.count) }

    public var countsByOutcome: [InspectionOutcome: Int] {
        Dictionary(grouping: observations, by: \.outcome).mapValues(\.count)
    }

    /// Проверки по часам суток (0–23): доля проверок среди известных наблюдений этого часа.
    public var checkRateByHour: [Int: Proportion] {
        grouped { calendar.component(.hour, from: $0.observedAt) }
    }

    public var checkRateByRoute: [String: Proportion] {
        grouped { $0.routeLabel ?? "—" }
    }

    public var checkRateByTransport: [TransportType: Proportion] {
        grouped { $0.transport ?? .other }
    }

    private func grouped<K: Hashable>(_ key: (InspectionObservation) -> K) -> [K: Proportion] {
        Dictionary(grouping: known, by: key).mapValues { group in
            Proportion(successes: group.filter { $0.outcome.ticketChecked == true }.count, trials: group.count)
        }
    }
}
