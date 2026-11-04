import Foundation
@testable import RoadTrackerCore

enum T {
    static let kyiv = TimeZone(identifier: "Europe/Kyiv")!
    static var calendar: Calendar { TripTiming.calendar(forTimeZoneIdentifier: "Europe/Kyiv") }

    /// Дата в киевском времени: T.date(2026, 11, 3, 7, 40)
    static func date(_ y: Int, _ m: Int, _ d: Int, _ h: Int = 0, _ min: Int = 0, tz: TimeZone = kyiv) -> Date {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = tz
        return c.date(from: DateComponents(year: y, month: m, day: d, hour: h, minute: min))!
    }

    static func trip(_ start: Date, minutes: Double, direction: TripDirection = .toWork,
                     segments: [(TransportType, Int)] = [], tz: String? = "Europe/Kyiv",
                     controllers: Int = 0) -> TripSummary {
        TripSummary(direction: direction, startedAt: start, finishedAt: start.addingTimeInterval(minutes * 60),
                    timeZoneIdentifier: tz,
                    segments: segments.map { .init(transport: $0.0, cost: Money(minorUnits: $0.1)) },
                    inspectionsWithController: controllers)
    }
}
