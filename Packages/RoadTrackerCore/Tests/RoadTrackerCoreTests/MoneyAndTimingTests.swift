import Foundation
import Testing
@testable import RoadTrackerCore

@Suite("Деньги")
struct MoneyTests {
    @Test func formatting() {
        #expect(Money.uah(30).formatted == "30\u{00A0}₴")
        #expect(Money.uah(30, kopecks: 50).formatted == "30,50\u{00A0}₴")
        #expect(Money.uah(30, kopecks: 5).formatted == "30,05\u{00A0}₴")
        #expect(Money.uah(1250).formatted == "1\u{00A0}250\u{00A0}₴")
        #expect(Money.uah(1_000_000).formatted == "1\u{00A0}000\u{00A0}000\u{00A0}₴")
        #expect(Money(minorUnits: -1200).formatted == "−12\u{00A0}₴")
    }

    @Test(arguments: [
        ("30", 3000), ("30,5", 3050), ("30.50", 3050), ("1 250,00", 125000), ("0,01", 1), ("18 ₴", 1800)
    ])
    func parsing(input: String, expected: Int) throws {
        let money = try #require(Money(parsing: input))
        #expect(money.minorUnits == expected)
    }

    @Test(arguments: ["", "abc", "-5", "1,234", "1.2.3"])
    func rejectsInvalid(input: String) {
        #expect(Money(parsing: input) == nil)
    }

    @Test func noFloatingPointDrift() {
        let total = Array(repeating: Money.uah(0, kopecks: 10), count: 3).sum()
        #expect(total == Money.uah(0, kopecks: 30))
    }

    @Test func averageRounding() {
        #expect(Money.uah(100).divided(by: 3) == Money(minorUnits: 3333))
        #expect(Money.uah(100).divided(by: 0) == nil)
    }
}

@Suite("Время поездки")
struct TimingTests {
    @Test func activeDurationSubtractsOverlappingPauses() {
        let s = T.date(2026, 11, 3, 8, 0)
        let e = T.date(2026, 11, 3, 9, 0)
        let pauses = [
            DateInterval(start: T.date(2026, 11, 3, 8, 10), end: T.date(2026, 11, 3, 8, 20)),
            DateInterval(start: T.date(2026, 11, 3, 8, 15), end: T.date(2026, 11, 3, 8, 25)), // перекрытие
            DateInterval(start: T.date(2026, 11, 3, 7, 50), end: T.date(2026, 11, 3, 8, 5)),  // частично до старта
        ]
        // 60 − (8:10–8:25 = 15) − (8:00–8:05 = 5) = 40 мин
        #expect(TripTiming.activeDuration(start: s, end: e, pauses: pauses) == 40 * 60)
    }

    @Test func endBeforeStartIsZero() {
        #expect(TripTiming.activeDuration(start: T.date(2026, 1, 1, 10), end: T.date(2026, 1, 1, 9), pauses: []) == 0)
    }

    @Test func midnightCrossingSplitsBetweenDays() {
        let parts = TripTiming.splitByDay(start: T.date(2026, 11, 3, 23, 40), end: T.date(2026, 11, 4, 0, 30),
                                          calendar: T.calendar)
        #expect(parts.count == 2)
        #expect(parts[0].seconds == 20 * 60)
        #expect(parts[1].seconds == 30 * 60)
        #expect(parts[1].day == T.date(2026, 11, 4))
    }

    @Test func dstTransitionDayIsHandled() {
        // В ночь на 26.10.2025 в Киеве часы переводились 04:00 → 03:00.
        let parts = TripTiming.splitByDay(start: T.date(2025, 10, 25, 23, 0), end: T.date(2025, 10, 26, 5, 0),
                                          calendar: T.calendar)
        #expect(parts.map(\.seconds).reduce(0, +) == 7 * 3600) // реальных часов — 7, не 6
    }
}
