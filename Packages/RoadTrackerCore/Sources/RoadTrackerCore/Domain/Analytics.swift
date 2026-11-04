import Foundation

/// Плоское представление поездки для аналитики (собирается из SwiftData-моделей в приложении).
public struct TripSummary: Hashable, Sendable {
    public struct Segment: Hashable, Sendable {
        public var transport: TransportType
        public var cost: Money
        /// Номер маршрута («720»), если указан.
        public var number: String?
        public init(transport: TransportType, cost: Money, number: String? = nil) {
            self.transport = transport
            self.cost = cost
            self.number = number
        }
    }

    public var id: UUID
    public var direction: TripDirection
    public var startedAt: Date
    public var finishedAt: Date
    public var activeSeconds: TimeInterval
    public var timeZoneIdentifier: String?
    public var segments: [Segment]
    /// Стоимость поездки без детализации по сегментам (ручной ввод «итого»).
    public var extraCost: Money
    public var inspectionsWithController: Int
    /// Шаблон маршрута, по которому создана поездка.
    public var routeID: UUID?

    public init(id: UUID = UUID(), direction: TripDirection, startedAt: Date, finishedAt: Date,
                activeSeconds: TimeInterval? = nil, timeZoneIdentifier: String? = nil,
                segments: [Segment] = [], extraCost: Money = .zero, inspectionsWithController: Int = 0,
                routeID: UUID? = nil) {
        self.id = id
        self.routeID = routeID
        self.direction = direction
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.activeSeconds = activeSeconds ?? max(0, finishedAt.timeIntervalSince(startedAt))
        self.timeZoneIdentifier = timeZoneIdentifier
        self.segments = segments
        self.extraCost = extraCost
        self.inspectionsWithController = inspectionsWithController
    }

    public var totalCost: Money { segments.map(\.cost).sum() + extraCost }
    /// Пересадки = число сегментов общественного/любого транспорта, кроме первого (пешие отрезки не считаются).
    public var transfers: Int { max(0, segments.filter { $0.transport != .walk }.count - 1) }
}

public struct PeriodTotals: Equatable, Sendable {
    public var trips: Int = 0
    public var activeSeconds: TimeInterval = 0
    public var cost: Money = .zero
    public var transfers: Int = 0
    public var transports: Set<TransportType> = []
    public var controllers: Int = 0

    public var averageTripSeconds: TimeInterval? { trips > 0 ? activeSeconds / Double(trips) : nil }
    public var averageTripCost: Money? { cost.divided(by: trips) }

    public init() {}
}

public struct MonthComparison: Equatable, Sendable {
    public var current: PeriodTotals
    public var previous: PeriodTotals
    /// Изменение расходов, доля (0.1 = +10 %). nil, если в прошлом месяце расходов не было.
    public var costChange: Double? {
        previous.cost.minorUnits > 0
            ? Double(current.cost.minorUnits - previous.cost.minorUnits) / Double(previous.cost.minorUnits)
            : nil
    }
    public var timeChange: Double? {
        previous.activeSeconds > 0 ? (current.activeSeconds - previous.activeSeconds) / previous.activeSeconds : nil
    }
}

public struct Forecast: Equatable, Sendable {
    /// Средние расходы за день с поездками.
    public var averagePerCommuteDay: Money
    /// Наблюдаемая доля будних дней с поездками (0…1).
    public var commuteDayRate: Double
    public var projected: Money
    /// Число дней с поездками, на которых основан прогноз.
    public var basedOnDays: Int
}

/// Агрегация поездок. Группировка по дням идёт в часовом поясе каждой поездки
/// (поездка относится к дню старта; время в пути через полночь делится между днями отдельно).
public struct SpendingAnalytics: Sendable {
    public var trips: [TripSummary]
    public var calendar: Calendar

    public init(trips: [TripSummary], calendar: Calendar = TripTiming.calendar(forTimeZoneIdentifier: nil)) {
        self.trips = trips
        self.calendar = calendar
    }

    private func tripCalendar(_ t: TripSummary) -> Calendar {
        var c = calendar
        if let id = t.timeZoneIdentifier, let tz = TimeZone(identifier: id) { c.timeZone = tz }
        return c
    }

    /// День поездки (начало дня старта в её часовом поясе), как компоненты Y-M-D.
    public func dayKey(of trip: TripSummary) -> DateComponents {
        tripCalendar(trip).dateComponents([.year, .month, .day], from: trip.startedAt)
    }

    public func trips(in interval: DateInterval) -> [TripSummary] {
        trips.filter { interval.contains($0.startedAt) && $0.startedAt < interval.end }
    }

    public func totals(in interval: DateInterval) -> PeriodTotals {
        totals(of: trips(in: interval))
    }

    public func totals(of list: [TripSummary]) -> PeriodTotals {
        var t = PeriodTotals()
        for trip in list {
            t.trips += 1
            t.activeSeconds += trip.activeSeconds
            t.cost += trip.totalCost
            t.transfers += trip.transfers
            t.transports.formUnion(trip.segments.map(\.transport))
            t.controllers += trip.inspectionsWithController
        }
        return t
    }

    public func interval(for component: Calendar.Component, containing date: Date) -> DateInterval {
        calendar.dateInterval(of: component, for: date) ?? DateInterval(start: date, duration: 0)
    }

    public func costByDirection(in interval: DateInterval) -> [TripDirection: Money] {
        var result: [TripDirection: Money] = [:]
        for trip in trips(in: interval) { result[trip.direction, default: .zero] += trip.totalCost }
        return result
    }

    /// Расходы по видам транспорта. «Итого» без сегментов попадает в `.other`.
    public func costByTransport(in interval: DateInterval) -> [TransportType: Money] {
        var result: [TransportType: Money] = [:]
        for trip in trips(in: interval) {
            for s in trip.segments { result[s.transport, default: .zero] += s.cost }
            if trip.extraCost.minorUnits > 0 { result[.other, default: .zero] += trip.extraCost }
        }
        return result
    }

    /// Ряд «день → сумма/время» для графиков; дни без поездок заполняются нулями.
    public func dailySeries(in interval: DateInterval) -> [(day: Date, cost: Money, seconds: TimeInterval)] {
        var costs: [Date: Money] = [:]
        var seconds: [Date: TimeInterval] = [:]
        for trip in trips(in: interval) {
            let day = calendar.startOfDay(for: trip.startedAt)
            costs[day, default: .zero] += trip.totalCost
            seconds[day, default: 0] += trip.activeSeconds
        }
        var result: [(day: Date, cost: Money, seconds: TimeInterval)] = []
        var cursor = calendar.startOfDay(for: interval.start)
        while cursor < interval.end {
            result.append((day: cursor, cost: costs[cursor] ?? .zero, seconds: seconds[cursor] ?? 0))
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return result
    }

    /// Итоги по дням (ключ — начало дня) для календаря истории.
    public func dailyTotals(in interval: DateInterval) -> [Date: PeriodTotals] {
        let grouped = Dictionary(grouping: trips(in: interval)) { calendar.startOfDay(for: $0.startedAt) }
        return grouped.mapValues { totals(of: $0) }
    }

    /// Средняя стоимость рабочего дня = расходы / число дней, в которые были поездки.
    public func averageCommuteDayCost(in interval: DateInterval) -> Money? {
        let list = trips(in: interval)
        let days = Set(list.map { calendar.startOfDay(for: $0.startedAt) })
        return totals(of: list).cost.divided(by: days.count)
    }

    public func monthComparison(containing date: Date) -> MonthComparison {
        let current = interval(for: .month, containing: date)
        let prevDate = calendar.date(byAdding: .month, value: -1, to: current.start) ?? current.start
        let previous = interval(for: .month, containing: prevDate)
        return MonthComparison(current: totals(in: current), previous: totals(in: previous))
    }

    /// Прогноз расходов до конца периода (месяц/год).
    ///
    /// Модель намеренно простая и прозрачная:
    /// уже потрачено + (средний расход за день с поездками) × (доля будних дней с поездками) × (оставшиеся будни).
    /// Статистика берётся за последние `lookbackDays` дней до `now`, чтобы в начале месяца прогноз не был пустым.
    /// Возвращает nil, если дней с поездками меньше `minDays` — прогноз был бы случайным.
    public func forecast(for component: Calendar.Component, now: Date,
                         lookbackDays: Int = 56, minDays: Int = 5) -> Forecast? {
        let period = interval(for: component, containing: now)
        let todayStart = calendar.startOfDay(for: now)
        guard let lookbackStart = calendar.date(byAdding: .day, value: -lookbackDays, to: todayStart),
              let tomorrow = calendar.date(byAdding: .day, value: 1, to: todayStart) else { return nil }

        let history = trips(in: DateInterval(start: lookbackStart, end: tomorrow))
        let commuteDays = Set(history.map { calendar.startOfDay(for: $0.startedAt) })
        guard commuteDays.count >= minDays,
              let avg = totals(of: history).cost.divided(by: commuteDays.count) else { return nil }

        let observedWeekdays = weekdays(from: lookbackStart, to: tomorrow)
        let weekdayCommuteDays = commuteDays.filter { !calendar.isDateInWeekend($0) }.count
        let rate = observedWeekdays > 0 ? min(1, Double(weekdayCommuteDays) / Double(observedWeekdays)) : 0

        let spent = totals(in: DateInterval(start: period.start, end: min(tomorrow, period.end))).cost
        let remainingWeekdays = weekdays(from: tomorrow, to: period.end)
        let projected = spent + avg.multiplied(by: rate * Double(remainingWeekdays))
        return Forecast(averagePerCommuteDay: avg, commuteDayRate: rate,
                        projected: projected, basedOnDays: commuteDays.count)
    }

    func weekdays(from start: Date, to end: Date) -> Int {
        var count = 0
        var cursor = calendar.startOfDay(for: start)
        while cursor < end {
            if !calendar.isDateInWeekend(cursor) { count += 1 }
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        return count
    }
}

/// Калькулятор «деньги против времени» для двух вариантов маршрута.
public struct RouteOption: Equatable, Sendable {
    public var name: String
    public var minutes: Double
    public var cost: Money
    public init(name: String, minutes: Double, cost: Money) {
        self.name = name
        self.minutes = minutes
        self.cost = cost
    }
}

public struct SavingsComparison: Equatable, Sendable {
    public enum Verdict: Equatable, Sendable {
        /// Один вариант и дешевле, и не медленнее — компромисса нет.
        case dominates(winner: String)
        /// Дешевле, но дольше: есть цена минуты.
        case tradeOff
        case identical
    }

    public var verdict: Verdict
    /// Сколько денег экономит более дешёвый вариант за одну поездку.
    public var moneySaved: Money
    /// Сколько минут теряется на более дешёвом варианте (0, если он не медленнее).
    public var minutesLost: Double
    /// Сколько стоит одна сэкономленная (т. е. потраченная более дорогим вариантом) минута.
    public var costPerMinute: Money?
    public var cheaperName: String

    public static func compare(_ a: RouteOption, _ b: RouteOption) -> SavingsComparison {
        let (cheap, pricey) = a.cost <= b.cost ? (a, b) : (b, a)
        let saved = pricey.cost - cheap.cost
        let lost = cheap.minutes - pricey.minutes
        if saved.isZero && abs(lost) < 0.0001 {
            return SavingsComparison(verdict: .identical, moneySaved: .zero, minutesLost: 0,
                                     costPerMinute: nil, cheaperName: cheap.name)
        }
        if lost <= 0 {
            return SavingsComparison(verdict: .dominates(winner: cheap.name), moneySaved: saved,
                                     minutesLost: 0, costPerMinute: nil, cheaperName: cheap.name)
        }
        if saved.isZero {
            // Одинаковая цена, но один быстрее — побеждает быстрый.
            let fast = a.minutes <= b.minutes ? a : b
            return SavingsComparison(verdict: .dominates(winner: fast.name), moneySaved: .zero,
                                     minutesLost: 0, costPerMinute: nil, cheaperName: cheap.name)
        }
        let perMinute = Money(minorUnits: Int((Double(saved.minorUnits) / lost).rounded()),
                              currencyCode: saved.currencyCode)
        return SavingsComparison(verdict: .tradeOff, moneySaved: saved, minutesLost: lost,
                                 costPerMinute: perMinute, cheaperName: cheap.name)
    }

    /// Проекция на N поездок (например, 44 поездки = 22 рабочих дня туда-обратно).
    public func projected(trips: Int) -> (money: Money, hours: Double) {
        (Money(minorUnits: moneySaved.minorUnits * trips, currencyCode: moneySaved.currencyCode),
         minutesLost * Double(trips) / 60)
    }
}

private extension Money {
    var isZero: Bool { minorUnits == 0 }
}
