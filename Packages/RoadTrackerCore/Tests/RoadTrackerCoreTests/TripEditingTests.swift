import Foundation
import Testing
@testable import RoadTrackerCore

@Suite("Проверка поездки")
struct TripValidationTests {
    let s = T.date(2026, 11, 3, 8, 0)
    let e = T.date(2026, 11, 3, 8, 50)
    let now = T.date(2026, 11, 3, 12, 0)
    func at(_ m: Double) -> Date { s.addingTimeInterval(m * 60) }

    @Test func validTripHasNoIssues() {
        let issues = TripValidation.validate(start: s, end: e, segments: [
            .init(start: at(0), end: at(20)), .init(start: at(25), end: at(50))
        ], now: now)
        #expect(issues.isEmpty)
    }

    @Test func blockingErrors() {
        #expect(TripValidation.validate(start: s, end: s, segments: [], now: now) == [.endBeforeStart])
        #expect(TripValidation.validate(start: now.addingTimeInterval(3600), end: nil, segments: [], now: now) == [.startInFuture])
        let bad = TripValidation.validate(start: s, end: e, segments: [.init(start: at(30), end: at(10))], now: now)
        #expect(bad.contains(.segmentEndBeforeStart(index: 0)))
        #expect(bad.contains { $0.isBlocking })
    }

    @Test func warningsDoNotBlock() {
        let issues = TripValidation.validate(start: s, end: e, segments: [
            .init(start: at(0), end: at(30)), .init(start: at(20), end: at(70))
        ], now: now)
        #expect(issues.contains(.segmentsOverlap(index: 1)))
        #expect(issues.contains(.segmentOutsideTrip(index: 1)))
        #expect(!issues.contains { $0.isBlocking })
    }

    @Test func midnightTripIsValid() {
        let start = T.date(2026, 11, 3, 23, 40)
        let end = T.date(2026, 11, 4, 0, 30)
        #expect(TripValidation.validate(start: start, end: end, segments: [], now: T.date(2026, 11, 4, 9)).isEmpty)
    }

    @Test func templateSegmentJSONMatchesDatabaseKeys() throws {
        let data = try JSONEncoder().encode(RouteTemplateSegment(transport: .minibus, number: "720", cost: .uah(20)))
        let json = try #require(String(data: data, encoding: .utf8))
        #expect(json.contains("\"transport_type\":\"minibus\""))
        #expect(json.contains("\"transport_number\":\"720\""))
        #expect(json.contains("\"cost\":2000"))
    }
}

@Suite("Фильтры истории")
struct TripFilterTests {
    let route = UUID()
    var trips: [TripSummary] {
        [
            TripSummary(direction: .toWork, startedAt: T.date(2026, 11, 3, 8), finishedAt: T.date(2026, 11, 3, 9),
                        segments: [.init(transport: .minibus, cost: .uah(20), number: "720"),
                                   .init(transport: .metro, cost: .uah(8))],
                        inspectionsWithController: 1, routeID: route),
            TripSummary(direction: .toHome, startedAt: T.date(2026, 11, 3, 18), finishedAt: T.date(2026, 11, 3, 19),
                        segments: [.init(transport: .bus, cost: .uah(15), number: "24")]),
            TripSummary(direction: .toWork, startedAt: T.date(2026, 11, 5, 8), finishedAt: T.date(2026, 11, 5, 9),
                        segments: [.init(transport: .taxi, cost: .uah(180))]),
        ]
    }

    func count(_ f: TripFilter) -> Int { trips.filter(f.matches).count }

    @Test func emptyFilterMatchesAll() {
        #expect(count(TripFilter()) == 3)
        #expect(!TripFilter().isActive)
    }

    @Test func combinedFilters() {
        var f = TripFilter()
        f.directions = [.toWork]
        #expect(count(f) == 2)
        f.transports = [.metro, .bus]
        #expect(count(f) == 1)
        #expect(f.activeCount == 2)

        var cost = TripFilter()
        cost.minCost = .uah(20); cost.maxCost = .uah(100)
        #expect(count(cost) == 1) // 28 ₴

        var ctrl = TripFilter(); ctrl.controllers = .met
        #expect(count(ctrl) == 1)
        ctrl.controllers = .notMet
        #expect(count(ctrl) == 2)

        var byRoute = TripFilter(); byRoute.routeID = route
        #expect(count(byRoute) == 1)

        var number = TripFilter(); number.routeNumber = " 72 "
        #expect(count(number) == 1)

        var dates = TripFilter()
        dates.dateRange = DateInterval(start: T.date(2026, 11, 4), end: T.date(2026, 11, 6))
        #expect(count(dates) == 1)
    }
}

@Suite("Календарь")
struct MonthGridTests {
    @Test func november2026StartsOnSunday() {
        let grid = MonthGrid(containing: T.date(2026, 11, 15), calendar: T.calendar)
        #expect(grid.cells.prefix(6).allSatisfy { $0 == nil }) // Пн–Сб пустые
        #expect(grid.cells[6] == T.date(2026, 11, 1))
        #expect(grid.cells.compactMap { $0 }.count == 30)
        #expect(grid.cells.count % 7 == 0)
        #expect(grid.weeks.count == 6)
    }

    @Test func dailyTotalsForCalendarCells() {
        let a = SpendingAnalytics(trips: [
            T.trip(T.date(2026, 11, 3, 8), minutes: 40, segments: [(.metro, 800)], controllers: 1),
            T.trip(T.date(2026, 11, 3, 18), minutes: 50, direction: .toHome, segments: [(.metro, 800)]),
        ], calendar: T.calendar)
        let totals = a.dailyTotals(in: a.interval(for: .month, containing: T.date(2026, 11, 10)))
        let day = totals[T.date(2026, 11, 3)]
        #expect(day?.trips == 2)
        #expect(day?.cost == .uah(16))
        #expect(day?.activeSeconds == 90 * 60)
        #expect(day?.controllers == 1)
        #expect(totals.count == 1)
    }
}
