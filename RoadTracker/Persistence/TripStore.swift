import Foundation
import SwiftData
import RoadTrackerCore

/// Единая точка изменения данных. Каждое изменение и соответствующая операция
/// синхронизации сохраняются ОДНИМ `context.save()` — изменение не может
/// оказаться в базе без записи в очереди (и наоборот), даже если приложение закроют.
@MainActor
final class TripStore {
    let context: ModelContext
    /// Вызывается после успешного сохранения (SyncManager запускает отправку).
    var onCommit: (() -> Void)?
    let clock: () -> Date

    init(context: ModelContext, clock: @escaping () -> Date = { .now }) {
        self.context = context
        self.clock = clock
    }

    // MARK: Поездки

    @discardableResult
    func startTrip(_ session: TripSession) throws -> TripRecord {
        if let existing = try trip(id: session.tripID) { return existing } // идемпотентно
        let trip = TripRecord(id: session.tripID, direction: session.direction, startedAt: session.startedAt,
                              mode: session.mode, status: .active, now: clock())
        context.insert(trip)
        enqueue(.trip, trip.id, .upsert)
        try commit()
        return trip
    }

    func setPaused(tripID: UUID, at date: Date, paused: Bool, pauses: [DateInterval]) throws {
        guard let trip = try trip(id: tripID) else { return }
        trip.status = paused ? .paused : .active
        trip.pauses = pauses
        touch(trip)
        try commit()
    }

    func finishTrip(_ session: TripSession, at end: Date) throws {
        guard let trip = try trip(id: session.tripID) else { return }
        trip.finishedAt = end
        trip.pauses = session.pauses
        trip.status = .completed
        trip.trackingMode = session.mode
        touch(trip)
        try commit()
    }

    /// Поездка, введённая вручную задним числом (например, забыли нажать «Старт»).
    @discardableResult
    func createManualTrip(direction: TripDirection, start: Date, end: Date,
                          segments: [(transport: TransportType, number: String?, cost: Money)],
                          comment: String? = nil) throws -> TripRecord {
        guard end > start else { throw StoreError.invalidInterval }
        let now = clock()
        let trip = TripRecord(direction: direction, startedAt: start, finishedAt: end,
                              mode: .manual, status: .completed, now: now)
        trip.comment = comment
        context.insert(trip)
        enqueue(.trip, trip.id, .upsert)
        for (index, s) in segments.enumerated() {
            let segment = SegmentRecord(position: index, transport: s.transport, transportNumber: s.number,
                                        cost: s.cost, now: now)
            segment.trip = trip
            context.insert(segment)
            enqueue(.segment, segment.id, .upsert)
        }
        try commit()
        return trip
    }

    /// Неподтверждённая поездка из автоопределения (уведомление было пропущено).
    func createUnconfirmedTrip(id: UUID, direction: TripDirection, start: Date, end: Date) throws {
        guard try trip(id: id) == nil else { return }
        let trip = TripRecord(id: id, direction: direction, startedAt: start, finishedAt: end,
                              mode: .auto, status: .suggested, now: clock())
        context.insert(trip)
        enqueue(.trip, trip.id, .upsert)
        try commit()
    }

    func confirm(_ trip: TripRecord) throws {
        trip.status = trip.finishedAt == nil ? .active : .completed
        touch(trip)
        try commit()
    }

    /// Удаление = tombstone: запись скрывается сразу, а удаление синхронизируется на сервер
    /// и другие устройства. Физически строки удаляются позже (purge_tombstones на сервере).
    func delete(_ trip: TripRecord) throws {
        let now = clock()
        for segment in trip.segments where segment.deletedAt == nil {
            segment.deletedAt = now; segment.updatedAt = now
            enqueue(.segment, segment.id, .delete)
        }
        for inspection in trip.inspections where inspection.deletedAt == nil {
            inspection.deletedAt = now; inspection.updatedAt = now
            enqueue(.inspection, inspection.id, .delete)
        }
        // Трек — чувствительные данные, его храним только локально: удаляем сразу.
        for point in trip.trackPoints { context.delete(point) }
        trip.deletedAt = now
        trip.updatedAt = now
        enqueue(.trip, trip.id, .delete)
        try commit()
    }

    func trip(id: UUID) throws -> TripRecord? {
        var descriptor = FetchDescriptor<TripRecord>(predicate: #Predicate { $0.id == id })
        descriptor.fetchLimit = 1
        return try context.fetch(descriptor).first
    }

    /// Завершённые поездки для аналитики.
    func completedSummaries() throws -> [TripSummary] {
        let completed = TripStatus.completed.rawValue
        let descriptor = FetchDescriptor<TripRecord>(
            predicate: #Predicate { $0.deletedAt == nil && $0.statusRaw == completed },
            sortBy: [SortDescriptor(\.startedAt)])
        return try context.fetch(descriptor).map(\.summary)
    }

    // MARK: Приватность

    /// Удалить всю локальную историю координат (треки и координаты наблюдений).
    func deleteLocationHistory() throws {
        try context.delete(model: TrackPointRecord.self)
        let withCoordinates = try context.fetch(FetchDescriptor<InspectionRecord>(
            predicate: #Predicate { $0.latitude != nil }))
        for inspection in withCoordinates {
            inspection.latitude = nil
            inspection.longitude = nil
            inspection.updatedAt = clock()
            enqueue(.inspection, inspection.id, .upsert)
        }
        try commit()
    }

    /// Удаляет точки треков старше срока хранения.
    func purgeTrackPoints(olderThan days: Int) throws {
        guard let cutoff = Calendar.current.date(byAdding: .day, value: -days, to: clock()) else { return }
        try context.delete(model: TrackPointRecord.self, where: #Predicate { $0.recordedAt < cutoff })
        try context.save()
    }

    // MARK: Очередь

    func touch(_ trip: TripRecord) {
        trip.updatedAt = clock()
        enqueue(.trip, trip.id, .upsert)
    }

    func enqueue(_ entity: SyncEntity, _ id: UUID, _ kind: SyncOperationKind) {
        let raw = entity.rawValue
        let descriptor = FetchDescriptor<SyncOperationRecord>(
            predicate: #Predicate { $0.entityRaw == raw && $0.entityID == id })
        let existing = (try? context.fetch(descriptor)) ?? []
        let incoming = PendingOperation(entity: entity, entityID: id, kind: kind, enqueuedAt: clock())
        let merged = SyncQueuePolicy.enqueue(incoming, into: existing.compactMap(\.operation))
        guard let result = merged.first(where: { $0.entity == entity && $0.entityID == id }) else { return }
        if let record = existing.first {
            record.apply(result)
        } else {
            context.insert(SyncOperationRecord(result))
        }
    }

    func commit() throws {
        try context.save()
        onCommit?()
    }

    enum StoreError: LocalizedError {
        case invalidInterval
        case invalidPlace
        case invalidRoute
        var errorDescription: String? {
            switch self {
            case .invalidInterval: String(localized: "Проверьте время поездки и её этапов.")
            case .invalidPlace: String(localized: "Укажите название места и радиус от 100 до 2000 м.")
            case .invalidRoute: String(localized: "Укажите название маршрута и хотя бы один этап.")
            }
        }
    }
}

extension TripRecord {
    var summary: TripSummary {
        TripSummary(id: id, direction: direction, startedAt: startedAt, finishedAt: finishedAt ?? startedAt,
                    activeSeconds: activeSeconds, timeZoneIdentifier: timeZoneIdentifier,
                    segments: liveSegments.map {
                        .init(transport: $0.transport, cost: Money(minorUnits: $0.cost), number: $0.transportNumber)
                    },
                    extraCost: Money(minorUnits: extraCost),
                    inspectionsWithController: liveInspections.filter { $0.outcome.controllerPresent == true }.count,
                    routeID: routeID)
    }
}
