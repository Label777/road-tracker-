import Foundation
import Testing
@testable import RoadTrackerCore

@Suite("Финансовая аналитика")
struct AnalyticsTests {

    @Test func totalsAndTransfers() {
        let trip = T.trip(T.date(2026, 11, 3, 7, 40), minutes: 45,
                          segments: [(.walk, 0), (.minibus, 2000), (.metro, 2800)])
        #expect(trip.totalCost == Money.uah(48))
        #expect(trip.transfers == 1) // маршрутка → метро; пешие отрезки не считаются
        let a = SpendingAnalytics(trips: [trip], calendar: T.calendar)
        let day = a.interval(for: .day, containing: T.date(2026, 11, 3, 12))
        let totals = a.totals(in: day)
        #expect(totals.trips == 1)
        #expect(totals.activeSeconds == 45 * 60)
        #expect(totals.transports == [.walk, .minibus, .metro])
    }

    @Test func dayBoundariesFollowTripTimeZone() {
        // 23:30 по Киеву — это ещё 3 ноября, хотя в UTC тоже 3-е, а в Токио уже 4-е.
        let trip = T.trip(T.date(2026, 11, 3, 23, 30), minutes: 20)
        let a = SpendingAnalytics(trips: [trip], calendar: T.calendar)
        #expect(a.dayKey(of: trip).day == 3)
        #expect(a.totals(in: a.interval(for: .day, containing: T.date(2026, 11, 4, 1))).trips == 0)
    }

    @Test func costByDirectionAndTransport() {
        let trips = [
            T.trip(T.date(2026, 11, 3, 8), minutes: 40, direction: .toWork, segments: [(.minibus, 2000), (.metro, 1000)]),
            T.trip(T.date(2026, 11, 3, 18), minutes: 50, direction: .toHome, segments: [(.metro, 1000)]),
        ]
        let a = SpendingAnalytics(trips: trips, calendar: T.calendar)
        let month = a.interval(for: .month, containing: T.date(2026, 11, 10))
        #expect(a.costByDirection(in: month) == [.toWork: .uah(30), .toHome: .uah(10)])
        #expect(a.costByTransport(in: month) == [.minibus: .uah(20), .metro: .uah(20)])
        #expect(a.averageCommuteDayCost(in: month) == .uah(40))
    }

    @Test func monthComparison() {
        let trips = [
            T.trip(T.date(2026, 10, 15, 8), minutes: 40, segments: [(.metro, 2000)]),
            T.trip(T.date(2026, 11, 3, 8), minutes: 60, segments: [(.metro, 3000)]),
        ]
        let cmp = SpendingAnalytics(trips: trips, calendar: T.calendar).monthComparison(containing: T.date(2026, 11, 20))
        #expect(cmp.current.cost == .uah(30))
        #expect(cmp.previous.cost == .uah(20))
        #expect(cmp.costChange == 0.5)
        #expect(cmp.timeChange == 0.5)
    }

    @Test func dailySeriesFillsGaps() {
        let a = SpendingAnalytics(trips: [T.trip(T.date(2026, 11, 3, 8), minutes: 30, segments: [(.bus, 1500)])],
                                  calendar: T.calendar)
        let week = a.interval(for: .weekOfYear, containing: T.date(2026, 11, 4))
        let series = a.dailySeries(in: week)
        #expect(series.count == 7)
        #expect(series[0].day == T.date(2026, 11, 2)) // неделя с понедельника
        #expect(series[1].cost == .uah(15))
        #expect(series[2].cost == .zero)
    }

    @Test func forecastNeedsEnoughData() {
        let trips = (2...3).map { T.trip(T.date(2026, 11, $0, 8), minutes: 30, segments: [(.metro, 5000)]) }
        let a = SpendingAnalytics(trips: trips, calendar: T.calendar)
        #expect(a.forecast(for: .month, now: T.date(2026, 11, 4, 12)) == nil)
    }

    @Test func monthlyForecast() throws {
        // Каждый будний день с 9 сентября по 4 ноября: две поездки по 50 ₴.
        let cal = T.calendar
        var trips: [TripSummary] = []
        var day = T.date(2026, 9, 9)
        while day <= T.date(2026, 11, 4) {
            if !cal.isDateInWeekend(day) {
                trips.append(T.trip(day.addingTimeInterval(8 * 3600), minutes: 30, segments: [(.metro, 5000)]))
                trips.append(T.trip(day.addingTimeInterval(9 * 3600), minutes: 30, direction: .toHome, segments: [(.metro, 5000)]))
            }
            day = cal.date(byAdding: .day, value: 1, to: day)!
        }
        let f = try #require(SpendingAnalytics(trips: trips, calendar: cal).forecast(for: .month, now: T.date(2026, 11, 4, 12)))
        #expect(f.averagePerCommuteDay == .uah(100))
        #expect(f.commuteDayRate == 1)
        // Потрачено 2–4 ноября: 300 ₴ + осталось 18 будних дней × 100 ₴
        #expect(f.projected == .uah(2100))
    }
}

@Suite("Калькулятор экономии")
struct SavingsTests {
    @Test func exampleFromSpec() {
        let r = SavingsComparison.compare(RouteOption(name: "А", minutes: 35, cost: .uah(30)),
                                          RouteOption(name: "Б", minutes: 50, cost: .uah(18)))
        #expect(r.verdict == .tradeOff)
        #expect(r.cheaperName == "Б")
        #expect(r.moneySaved == .uah(12))
        #expect(r.minutesLost == 15)
        #expect(r.costPerMinute == Money(minorUnits: 80)) // 0,80 ₴ за минуту
        let month = r.projected(trips: 44)
        #expect(month.money == .uah(528))
        #expect(month.hours == 11)
    }

    @Test func cheaperAndFasterDominates() {
        let r = SavingsComparison.compare(RouteOption(name: "А", minutes: 30, cost: .uah(20)),
                                          RouteOption(name: "Б", minutes: 40, cost: .uah(25)))
        #expect(r.verdict == .dominates(winner: "А"))
        #expect(r.costPerMinute == nil)
    }

    @Test func samePriceFasterWins() {
        let r = SavingsComparison.compare(RouteOption(name: "А", minutes: 50, cost: .uah(20)),
                                          RouteOption(name: "Б", minutes: 40, cost: .uah(20)))
        #expect(r.verdict == .dominates(winner: "Б"))
    }

    @Test func identical() {
        let r = SavingsComparison.compare(RouteOption(name: "А", minutes: 40, cost: .uah(20)),
                                          RouteOption(name: "Б", minutes: 40, cost: .uah(20)))
        #expect(r.verdict == .identical)
    }
}

@Suite("Контролёры")
struct InspectionTests {
    @Test func wilsonIntervalForSmallSamples() throws {
        let p = Proportion(successes: 0, trials: 5)
        let ci = try #require(p.interval)
        #expect(ci.lowerBound < 1e-9)
        #expect(abs(ci.upperBound - 0.4345) < 0.001) // а не «0 %»
        #expect(p.reliability == .insufficient)
    }

    @Test func reliabilityThresholds() {
        #expect(Reliability(sampleSize: 9) == .insufficient)
        #expect(Reliability(sampleSize: 10) == .low)
        #expect(Reliability(sampleSize: 30) == .moderate)
        #expect(Reliability(sampleSize: 100) == .good)
    }

    @Test func unknownExcludedFromDenominator() {
        let d = T.date(2026, 11, 3, 8)
        let stats = InspectionStatistics(observations: [
            .init(outcome: .ticketChecked, observedAt: d, transport: .metro),
            .init(outcome: .presentNotChecked, observedAt: d, transport: .metro),
            .init(outcome: .noController, observedAt: d.addingTimeInterval(9 * 3600), transport: .minibus, routeLabel: "720"),
            .init(outcome: .checkedAtTransfer, observedAt: d, transport: .metro),
            .init(outcome: .unknown, observedAt: d),
        ], calendar: T.calendar)
        #expect(stats.known.count == 4)
        #expect(stats.encounters == 3)
        #expect(stats.checks == 2)
        #expect(stats.checkRate.estimate == 0.5)
        #expect(stats.checkRateByHour[8] == Proportion(successes: 2, trials: 3))
        #expect(stats.checkRateByHour[17] == Proportion(successes: 0, trials: 1))
        #expect(stats.checkRateByRoute["720"]?.trials == 1)
        #expect(stats.countsByOutcome[.unknown] == 1)
    }
}
