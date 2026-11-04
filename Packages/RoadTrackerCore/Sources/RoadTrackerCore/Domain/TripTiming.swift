import Foundation

/// Время поездки: активная продолжительность с учётом пауз и разбиение по календарным дням
/// (поездка через полночь даёт вклад в оба дня).
public enum TripTiming {

    /// Активная продолжительность: [start, end] минус объединение пауз, обрезанных по границам поездки.
    public static func activeDuration(start: Date, end: Date, pauses: [DateInterval]) -> TimeInterval {
        guard end > start else { return 0 }
        let total = end.timeIntervalSince(start)
        let paused = mergedLength(of: pauses, clampedTo: DateInterval(start: start, end: end))
        return max(0, total - paused)
    }

    /// Суммарная длина объединения интервалов внутри `bounds` (перекрытия не считаются дважды).
    public static func mergedLength(of intervals: [DateInterval], clampedTo bounds: DateInterval) -> TimeInterval {
        let clamped = intervals.compactMap { $0.intersection(with: bounds) }
            .filter { $0.duration > 0 }
            .sorted { $0.start < $1.start }
        var total: TimeInterval = 0
        var current: DateInterval?
        for interval in clamped {
            if let c = current, interval.start <= c.end {
                current = DateInterval(start: c.start, end: max(c.end, interval.end))
            } else {
                if let c = current { total += c.duration }
                current = interval
            }
        }
        if let c = current { total += c.duration }
        return total
    }

    /// Разбивает интервал по полуночам календаря (часовой пояс берётся из `calendar`).
    /// Возвращает пары «начало дня → секунды в этом дне».
    public static func splitByDay(start: Date, end: Date, calendar: Calendar) -> [(day: Date, seconds: TimeInterval)] {
        guard end > start else { return [] }
        var result: [(day: Date, seconds: TimeInterval)] = []
        var cursor = start
        while cursor < end {
            let dayStart = calendar.startOfDay(for: cursor)
            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: dayStart) else { break }
            let sliceEnd = min(nextDay, end)
            result.append((day: dayStart, seconds: sliceEnd.timeIntervalSince(cursor)))
            cursor = sliceEnd
        }
        return result
    }

    /// Календарь в часовом поясе поездки (сохраняется при старте), чтобы поездка
    /// в другой стране не «переезжала» в соседний день при смене пояса телефона.
    public static func calendar(forTimeZoneIdentifier identifier: String?) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.locale = Locale(identifier: "ru_UA")
        calendar.firstWeekday = 2 // понедельник
        calendar.timeZone = identifier.flatMap(TimeZone.init(identifier:)) ?? .current
        return calendar
    }
}
