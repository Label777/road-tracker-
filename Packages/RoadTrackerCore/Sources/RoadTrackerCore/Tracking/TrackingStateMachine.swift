import Foundation

/// Тип места, к которому привязана геозона.
public enum PlaceKind: String, Codable, Sendable, CaseIterable {
    case home, work, other
}

/// Кандидат на поездку, обнаруженный автоматически (выход из геозоны).
/// Это только гипотеза: выход из дома ≠ поездка на работу.
public struct TripCandidate: Codable, Equatable, Sendable {
    public var id: UUID
    public var origin: PlaceKind
    public var detectedAt: Date
    public var suggestedDirection: TripDirection
}

/// Активная сессия записи поездки.
public struct TripSession: Codable, Equatable, Sendable {
    public var tripID: UUID
    public var direction: TripDirection
    public var mode: TrackingMode
    public var origin: PlaceKind?
    public var startedAt: Date
    public var pauses: [DateInterval] = []
    public var pausedSince: Date?
    /// Пользователю уже предложено завершить поездку (чтобы не слать уведомление повторно).
    public var finishSuggestedAt: Date?

    public init(tripID: UUID, direction: TripDirection, mode: TrackingMode, origin: PlaceKind? = nil,
                startedAt: Date, pauses: [DateInterval] = [], pausedSince: Date? = nil) {
        self.tripID = tripID
        self.direction = direction
        self.mode = mode
        self.origin = origin
        self.startedAt = startedAt
        self.pauses = pauses
        self.pausedSince = pausedSince
    }

    public var isPaused: Bool { pausedSince != nil }

    public func activeDuration(at now: Date) -> TimeInterval {
        var all = pauses
        if let p = pausedSince { all.append(DateInterval(start: p, end: max(p, now))) }
        return TripTiming.activeDuration(start: startedAt, end: now, pauses: all)
    }
}

public enum TrackingState: Codable, Equatable, Sendable {
    case idle
    case suggestedStart(TripCandidate)
    case recording(TripSession)
}

public enum TrackingEvent: Equatable, Sendable {
    case userStart(direction: TripDirection, mode: TrackingMode, at: Date)
    case userPause(at: Date)
    case userResume(at: Date)
    case userFinish(at: Date)
    case userCancel
    case acceptSuggestion(mode: TrackingMode, at: Date)
    case dismissSuggestion
    case geofenceExit(PlaceKind, at: Date)
    case geofenceEnter(PlaceKind, at: Date)
    /// Периодическая проверка (при пробуждении приложения) — истечение подсказок.
    case tick(Date)
    /// Пользователь отозвал доступ к геолокации.
    case locationAccessRevoked(at: Date)
}

/// Команды для сервисного слоя. Машина состояний ничего не делает сама — только решает.
public enum TrackingEffect: Equatable, Sendable {
    case suggestStart(TripCandidate)
    case cancelStartSuggestion(UUID)
    case suggestFinish(tripID: UUID)
    case startLocationUpdates
    case stopLocationUpdates
    case tripStarted(TripSession)
    case tripPaused(tripID: UUID, at: Date)
    case tripResumed(tripID: UUID, at: Date)
    case tripFinished(TripSession, finishedAt: Date)
    case tripCancelled(tripID: UUID)
    /// Уведомление пропущено, но есть и выход, и вход в известные геозоны:
    /// создаём НЕподтверждённую поездку (status = suggested) — пользователь подтвердит или удалит её.
    case createUnconfirmedTrip(id: UUID, direction: TripDirection, start: Date, end: Date)
    /// Запись продолжается без GPS (ручной режим), пользователю показывается пояснение.
    case degradedToManual(tripID: UUID)
}

public struct TrackingStateMachine: Codable, Equatable, Sendable {
    public private(set) var state: TrackingState = .idle

    /// Повторный вход в исходную геозону в этот срок = «вышел за хлебом»/дрожание GPS на границе.
    public var bounceWindow: TimeInterval = 5 * 60
    /// Сколько живёт предложение начать поездку без подтверждения.
    public var suggestionTTL: TimeInterval = 2 * 60 * 60
    /// Максимальная правдоподобная длительность неподтверждённой поездки.
    public var maxUnconfirmedDuration: TimeInterval = 4 * 60 * 60

    public init(state: TrackingState = .idle) { self.state = state }

    public mutating func handle(_ event: TrackingEvent, newID: () -> UUID = { UUID() }) -> [TrackingEffect] {
        switch (state, event) {

        // ---------- ручное управление
        case (.idle, .userStart(let direction, let mode, let at)):
            return start(TripSession(tripID: newID(), direction: direction, mode: mode, origin: nil, startedAt: at))

        case (.suggestedStart(let c), .userStart(let direction, let mode, let at)):
            // Пользователь начал вручную — подсказка больше не нужна, дубля не будет.
            var effects: [TrackingEffect] = [.cancelStartSuggestion(c.id)]
            effects += start(TripSession(tripID: newID(), direction: direction, mode: mode, origin: c.origin, startedAt: at))
            return effects

        case (.recording, .userStart):
            return [] // уже идёт запись — повторный старт игнорируется

        case (.recording(var s), .userPause(let at)) where !s.isPaused:
            s.pausedSince = at
            state = .recording(s)
            return s.mode == .manual ? [.tripPaused(tripID: s.tripID, at: at)]
                                     : [.tripPaused(tripID: s.tripID, at: at), .stopLocationUpdates]

        case (.recording(var s), .userResume(let at)) where s.isPaused:
            if let p = s.pausedSince, at > p { s.pauses.append(DateInterval(start: p, end: at)) }
            s.pausedSince = nil
            state = .recording(s)
            return s.mode == .manual ? [.tripResumed(tripID: s.tripID, at: at)]
                                     : [.tripResumed(tripID: s.tripID, at: at), .startLocationUpdates]

        case (.recording(var s), .userFinish(let at)):
            let end = max(at, s.startedAt)
            if let p = s.pausedSince { s.pauses.append(DateInterval(start: p, end: max(p, end))); s.pausedSince = nil }
            state = .idle
            return s.mode == .manual ? [.tripFinished(s, finishedAt: end)]
                                     : [.tripFinished(s, finishedAt: end), .stopLocationUpdates]

        case (.recording(let s), .userCancel):
            state = .idle
            return s.mode == .manual ? [.tripCancelled(tripID: s.tripID)]
                                     : [.tripCancelled(tripID: s.tripID), .stopLocationUpdates]

        // ---------- подсказки автоопределения
        case (.idle, .geofenceExit(let place, let at)):
            guard place != .other else { return [] }
            let c = TripCandidate(id: newID(), origin: place, detectedAt: at,
                                  suggestedDirection: place == .home ? .toWork : .toHome)
            state = .suggestedStart(c)
            return [.suggestStart(c)]

        case (.suggestedStart(let c), .geofenceExit):
            return expiredIfNeeded(c, now: nil) // повторный выход (пересечение геозон) — дубль не создаём

        case (.suggestedStart(let c), .acceptSuggestion(let mode, _)):
            // Время старта — момент выхода из геозоны, а не момент нажатия.
            return start(TripSession(tripID: c.id, direction: c.suggestedDirection, mode: mode,
                                     origin: c.origin, startedAt: c.detectedAt))

        case (.suggestedStart(let c), .dismissSuggestion):
            state = .idle
            return [.cancelStartSuggestion(c.id)]

        case (.suggestedStart(let c), .geofenceEnter(let place, let at)):
            state = .idle
            if place == c.origin {
                // Вернулся туда же: короткий выход или дрожание GPS — поездкой не считаем.
                return [.cancelStartSuggestion(c.id)]
            }
            let duration = at.timeIntervalSince(c.detectedAt)
            guard duration > 0, duration <= maxUnconfirmedDuration else { return [.cancelStartSuggestion(c.id)] }
            // Уведомление пропущено, но маршрут «место → другое место» зафиксирован геозонами.
            let direction: TripDirection = switch (c.origin, place) {
            case (.home, .work): .toWork
            case (.work, .home): .toHome
            default: .other
            }
            return [.cancelStartSuggestion(c.id),
                    .createUnconfirmedTrip(id: c.id, direction: direction, start: c.detectedAt, end: at)]

        case (.suggestedStart(let c), .tick(let now)):
            return expiredIfNeeded(c, now: now)

        case (.suggestedStart(let c), .locationAccessRevoked):
            state = .idle
            return [.cancelStartSuggestion(c.id)]

        // ---------- прибытие во время записи
        case (.recording(var s), .geofenceEnter(let place, let at)):
            guard s.finishSuggestedAt == nil, !s.isPaused else { return [] }
            if place == s.origin && at.timeIntervalSince(s.startedAt) < bounceWindow { return [] }
            s.finishSuggestedAt = at
            state = .recording(s)
            return [.suggestFinish(tripID: s.tripID)]

        case (.recording(var s), .locationAccessRevoked):
            guard s.mode != .manual else { return [] }
            s.mode = .manual
            state = .recording(s)
            return [.stopLocationUpdates, .degradedToManual(tripID: s.tripID)]

        default:
            return []
        }
    }

    private mutating func start(_ s: TripSession) -> [TrackingEffect] {
        state = .recording(s)
        return s.mode == .manual ? [.tripStarted(s)] : [.tripStarted(s), .startLocationUpdates]
    }

    private mutating func expiredIfNeeded(_ c: TripCandidate, now: Date?) -> [TrackingEffect] {
        guard let now, now.timeIntervalSince(c.detectedAt) > suggestionTTL else { return [] }
        state = .idle
        return [.cancelStartSuggestion(c.id)]
    }
}
