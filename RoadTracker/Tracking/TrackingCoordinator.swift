import Foundation
import Observation
import RoadTrackerCore

/// Связывает чистую машину состояний (RoadTrackerCore) с хранилищем и сервисами iOS.
/// Состояние сохраняется после каждого события: если iOS выгрузит приложение
/// посреди поездки, при следующем запуске запись продолжится с того же места.
@MainActor
@Observable
final class TrackingCoordinator {
    private(set) var machine: TrackingStateMachine
    private(set) var lastError: String?

    @ObservationIgnored private let store: TripStore
    @ObservationIgnored private let defaults: UserDefaults
    /// Обработчик GPS-эффектов. Подключается на этапе 3 (LocationService).
    @ObservationIgnored var locationEffects: ((TrackingEffect) -> Void)?
    /// Обработчик уведомлений. Подключается на этапе 3 (NotificationService).
    @ObservationIgnored var notificationEffects: ((TrackingEffect) -> Void)?

    private static let stateKey = "tracking.machine.v1"

    init(store: TripStore, defaults: UserDefaults = .standard) {
        self.store = store
        self.defaults = defaults
        if let data = defaults.data(forKey: Self.stateKey),
           let restored = try? JSONDecoder().decode(TrackingStateMachine.self, from: data) {
            machine = restored
        } else {
            machine = TrackingStateMachine()
        }
    }

    var activeSession: TripSession? {
        if case .recording(let s) = machine.state { return s }
        return nil
    }

    var pendingSuggestion: TripCandidate? {
        if case .suggestedStart(let c) = machine.state { return c }
        return nil
    }

    func send(_ event: TrackingEvent) {
        let effects = machine.handle(event)
        persist()
        for effect in effects { apply(effect) }
    }

    /// Старт по шаблону маршрута: направление и шаблон берутся из него,
    /// первый этап шаблона открывается сразу.
    func start(template: RouteRecord, at date: Date = .now) {
        guard activeSession == nil else { return }
        send(.userStart(direction: template.direction, mode: .manual, at: date))
        guard let id = activeSession?.tripID else { return }
        perform {
            try store.setRoute(tripID: id, routeID: template.id)
            if let first = template.templateSegments.first {
                try store.appendLiveSegment(tripID: id, transport: first.transport, number: first.number ?? "",
                                            cost: Money(minorUnits: first.cost), at: date)
            }
        }
    }

    /// Действия во время поездки, не меняющие состояние машины (этапы, контролёры, направление).
    func perform(_ action: () throws -> Void) {
        do {
            try action()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func apply(_ effect: TrackingEffect) {
        do {
            switch effect {
            case .tripStarted(let s):
                try store.startTrip(s)
            case .tripPaused(let id, let at):
                try store.setPaused(tripID: id, at: at, paused: true, pauses: activeSession?.pauses ?? [])
            case .tripResumed(let id, let at):
                try store.setPaused(tripID: id, at: at, paused: false, pauses: activeSession?.pauses ?? [])
            case .tripFinished(let s, let end):
                try store.closeOpenSegment(tripID: s.tripID, at: end)
                try store.finishTrip(s, at: end)
            case .tripCancelled(let id):
                if let trip = try store.trip(id: id) { try store.delete(trip) }
            case .createUnconfirmedTrip(let id, let direction, let start, let end):
                try store.createUnconfirmedTrip(id: id, direction: direction, start: start, end: end)
            case .startLocationUpdates, .stopLocationUpdates, .degradedToManual:
                locationEffects?(effect)
            case .suggestStart, .cancelStartSuggestion, .suggestFinish:
                notificationEffects?(effect)
            }
            lastError = nil
        } catch {
            // Данные не теряются: состояние машины уже сохранено, повтор возможен.
            lastError = error.localizedDescription
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(machine) {
            defaults.set(data, forKey: Self.stateKey)
        }
    }
}
