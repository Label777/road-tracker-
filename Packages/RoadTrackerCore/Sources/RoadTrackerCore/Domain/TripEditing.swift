import Foundation

/// Этап маршрута в шаблоне (хранится в routes.segments как JSON).
public struct RouteTemplateSegment: Codable, Hashable, Sendable {
    public var transport: TransportType
    public var number: String?
    public var routeName: String?
    /// Типичная стоимость, копейки.
    public var cost: Int

    public init(transport: TransportType, number: String? = nil, routeName: String? = nil, cost: Money = .zero) {
        self.transport = transport
        self.number = number
        self.routeName = routeName
        self.cost = cost.minorUnits
    }

    enum CodingKeys: String, CodingKey {
        case transport = "transport_type"
        case number = "transport_number"
        case routeName = "route_name"
        case cost
    }
}

/// Проверка поездки перед сохранением. Ошибки блокируют сохранение,
/// предупреждения показываются, но не мешают (пользователь знает лучше).
public enum TripValidation {
    public enum Issue: Equatable, Sendable {
        case endBeforeStart
        case startInFuture
        case tooLong(hours: Int)
        case segmentEndBeforeStart(index: Int)
        case segmentOutsideTrip(index: Int)
        case segmentsOverlap(index: Int)

        public var isBlocking: Bool {
            switch self {
            case .endBeforeStart, .startInFuture, .segmentEndBeforeStart: true
            case .tooLong, .segmentOutsideTrip, .segmentsOverlap: false
            }
        }
    }

    public struct SegmentTimes: Equatable, Sendable {
        public var start: Date?
        public var end: Date?
        public init(start: Date?, end: Date?) {
            self.start = start
            self.end = end
        }
    }

    /// Допуск на неточный ввод времени (минуты в DatePicker).
    static let tolerance: TimeInterval = 60

    public static func validate(start: Date, end: Date?, segments: [SegmentTimes], now: Date,
                                maxHours: Int = 6) -> [Issue] {
        var issues: [Issue] = []
        if start > now.addingTimeInterval(tolerance) { issues.append(.startInFuture) }
        if let end {
            if end <= start { issues.append(.endBeforeStart) }
            else if end.timeIntervalSince(start) > Double(maxHours) * 3600 { issues.append(.tooLong(hours: maxHours)) }
        }
        var previousEnd: Date?
        for (i, s) in segments.enumerated() {
            if let a = s.start, let b = s.end, b < a { issues.append(.segmentEndBeforeStart(index: i)) }
            let lower = start.addingTimeInterval(-tolerance)
            let upper = (end ?? .distantFuture).addingTimeInterval(tolerance)
            if [s.start, s.end].compactMap({ $0 }).contains(where: { $0 < lower || $0 > upper }) {
                issues.append(.segmentOutsideTrip(index: i))
            }
            if let p = previousEnd, let a = s.start, a < p.addingTimeInterval(-tolerance) {
                issues.append(.segmentsOverlap(index: i))
            }
            previousEnd = s.end ?? s.start ?? previousEnd
        }
        return issues
    }
}

/// Фильтры истории.
public struct TripFilter: Equatable, Sendable {
    public enum Controllers: String, CaseIterable, Sendable {
        case any, met, notMet
    }

    public var dateRange: DateInterval?
    /// Пустое множество = все.
    public var directions: Set<TripDirection> = []
    public var transports: Set<TransportType> = []
    public var minCost: Money?
    public var maxCost: Money?
    public var controllers: Controllers = .any
    public var routeID: UUID?
    /// Поиск по номеру маршрута («720»).
    public var routeNumber: String = ""

    public init() {}

    public var isActive: Bool { self != TripFilter() }

    public var activeCount: Int {
        [dateRange != nil, !directions.isEmpty, !transports.isEmpty, minCost != nil || maxCost != nil,
         controllers != .any, routeID != nil, !routeNumber.trimmingCharacters(in: .whitespaces).isEmpty]
            .filter { $0 }.count
    }

    public func matches(_ t: TripSummary) -> Bool {
        if let r = dateRange, !(t.startedAt >= r.start && t.startedAt < r.end) { return false }
        if !directions.isEmpty, !directions.contains(t.direction) { return false }
        if !transports.isEmpty, transports.isDisjoint(with: t.segments.map(\.transport)) { return false }
        if let minCost, t.totalCost < minCost { return false }
        if let maxCost, t.totalCost > maxCost { return false }
        switch controllers {
        case .any: break
        case .met: if t.inspectionsWithController == 0 { return false }
        case .notMet: if t.inspectionsWithController > 0 { return false }
        }
        if let routeID, t.routeID != routeID { return false }
        let number = routeNumber.trimmingCharacters(in: .whitespaces)
        if !number.isEmpty,
           !t.segments.contains(where: { ($0.number ?? "").localizedCaseInsensitiveContains(number) }) { return false }
        return true
    }
}

/// Сетка месяца для календаря: недели с понедельника, пустые ячейки — nil.
public struct MonthGrid: Equatable, Sendable {
    public let monthStart: Date
    public let cells: [Date?]

    public init(containing date: Date, calendar: Calendar) {
        let interval = calendar.dateInterval(of: .month, for: date) ?? DateInterval(start: date, duration: 0)
        monthStart = interval.start
        let weekday = calendar.component(.weekday, from: interval.start)
        let leading = (weekday - calendar.firstWeekday + 7) % 7
        var cells: [Date?] = Array(repeating: nil, count: leading)
        var cursor = interval.start
        while cursor < interval.end {
            cells.append(cursor)
            guard let next = calendar.date(byAdding: .day, value: 1, to: cursor) else { break }
            cursor = next
        }
        while cells.count % 7 != 0 { cells.append(nil) }
        self.cells = cells
    }

    public var weeks: [[Date?]] {
        stride(from: 0, to: cells.count, by: 7).map { Array(cells[$0..<min($0 + 7, cells.count)]) }
    }
}
