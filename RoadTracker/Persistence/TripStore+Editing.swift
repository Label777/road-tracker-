import Foundation
import SwiftData
import RoadTrackerCore

// Сохранение черновиков. Меняются и ставятся в очередь только реально изменённые записи:
// лишнее обновление updated_at могло бы перетереть более свежую правку с другого устройства.

extension TripStore {

    // MARK: Поездка целиком

    @discardableResult
    func save(_ draft: TripDraft) throws -> TripRecord {
        if draft.issues(now: clock()).contains(where: \.isBlocking) { throw StoreError.invalidInterval }
        let now = clock()
        let trip: TripRecord
        if let id = draft.id, let existing = try self.trip(id: id) {
            trip = existing
        } else {
            trip = TripRecord(id: draft.id ?? UUID(), direction: draft.direction, startedAt: draft.startedAt,
                              finishedAt: draft.finishedAt, mode: .manual, status: .completed, now: now)
            context.insert(trip)
            enqueue(.trip, trip.id, .upsert)
        }

        var tripChanged = false
        func set<V: Equatable>(_ keyPath: ReferenceWritableKeyPath<TripRecord, V>, _ value: V) {
            if trip[keyPath: keyPath] != value { trip[keyPath: keyPath] = value; tripChanged = true }
        }
        set(\.directionRaw, draft.direction.rawValue)
        set(\.startedAt, draft.startedAt)
        if trip.status != .active && trip.status != .paused { set(\.finishedAt, draft.finishedAt) }
        set(\.routeID, draft.routeID)
        set(\.extraCost, draft.extraCost.minorUnits)
        set(\.comment, draft.comment.isEmpty ? nil : draft.comment)
        if trip.status == .suggested { set(\.statusRaw, TripStatus.completed.rawValue) }

        // Этапы: удалённые из черновика → tombstone, новые → вставка, изменённые → обновление
        let draftIDs = Set(draft.segments.map(\.id))
        for segment in trip.liveSegments where !draftIDs.contains(segment.id) {
            tombstone(segment, now: now)
            tripChanged = true // итоговая стоимость поездки изменилась
        }
        for (index, d) in draft.segments.enumerated() {
            let segment: SegmentRecord
            if let existing = trip.segments.first(where: { $0.id == d.id && $0.deletedAt == nil }) {
                segment = existing
            } else {
                segment = SegmentRecord(id: d.id, position: index, transport: d.transport, now: now)
                segment.trip = trip
                context.insert(segment)
                tripChanged = true
            }
            if apply(d, index: index, to: segment, now: now) { tripChanged = true }
            try syncInspection(d.inspection, trip: trip, segmentID: segment.id, now: now)
        }
        try syncInspection(draft.tripInspection, trip: trip, segmentID: nil, now: now)

        if tripChanged { touch(trip) }
        try commit()
        return trip
    }

    /// Возвращает true, если этап изменился.
    private func apply(_ d: SegmentDraft, index: Int, to s: SegmentRecord, now: Date) -> Bool {
        let before = SegmentDraft(s, inspection: nil)
        var target = d
        target.inspection = nil
        let positionChanged = s.position != index
        guard before != target || positionChanged else { return false }
        s.position = index
        s.transferNumber = index
        s.transport = d.transport
        s.transportNumber = d.number.trimmed
        s.routeName = d.routeName.trimmed
        s.startedAt = d.startedAt
        s.finishedAt = d.finishedAt
        s.cost = d.cost.minorUnits
        s.distanceMeters = d.distanceMeters
        s.comment = d.comment.trimmed
        s.updatedAt = now
        enqueue(.segment, s.id, .upsert)
        return true
    }

    private func syncInspection(_ draft: InspectionDraft?, trip: TripRecord, segmentID: UUID?, now: Date) throws {
        let existing = trip.liveInspections.first { $0.segmentID == segmentID }
        guard let draft else {
            if let existing { tombstone(existing, now: now) }
            return
        }
        let record: InspectionRecord
        if let existing, existing.id == draft.id {
            record = existing
            guard InspectionDraft(existing) != draft else { return }
        } else {
            if let existing { tombstone(existing, now: now) }
            record = InspectionRecord(id: draft.id, outcome: draft.outcome, observedAt: draft.observedAt,
                                      segmentID: segmentID, now: now)
            record.trip = trip
            context.insert(record)
        }
        record.outcome = draft.outcome
        record.observedAt = draft.observedAt
        record.comment = draft.comment.trimmed
        record.updatedAt = now
        enqueue(.inspection, record.id, .upsert)
    }

    private func tombstone(_ s: SegmentRecord, now: Date) {
        s.deletedAt = now
        s.updatedAt = now
        enqueue(.segment, s.id, .delete)
        if let trip = s.trip {
            for i in trip.liveInspections where i.segmentID == s.id { tombstone(i, now: now) }
        }
    }

    private func tombstone(_ i: InspectionRecord, now: Date) {
        i.deletedAt = now
        i.updatedAt = now
        enqueue(.inspection, i.id, .delete)
    }

    // MARK: Быстрые действия во время поездки

    /// «Сел в транспорт»: закрывает текущий этап и открывает новый в момент `at`.
    @discardableResult
    func appendLiveSegment(tripID: UUID, transport: TransportType, number: String, cost: Money, at: Date) throws -> SegmentRecord? {
        guard let trip = try trip(id: tripID) else { return nil }
        let segments = trip.liveSegments
        if let open = segments.last, open.finishedAt == nil {
            open.finishedAt = at
            open.updatedAt = at
            enqueue(.segment, open.id, .upsert)
        }
        let segment = SegmentRecord(position: segments.count, transport: transport,
                                    transportNumber: number.trimmed, cost: cost, now: clock())
        segment.startedAt = at
        segment.trip = trip
        context.insert(segment)
        enqueue(.segment, segment.id, .upsert)
        touch(trip)
        try commit()
        return segment
    }

    /// «Контролёр»: отметка на текущем этапе (или на поездке, если этапов нет).
    func recordInspection(tripID: UUID, outcome: InspectionOutcome, at: Date) throws {
        guard let trip = try trip(id: tripID) else { return }
        let segmentID = trip.liveSegments.last?.id
        var draft = trip.liveInspections.first { $0.segmentID == segmentID }.map(InspectionDraft.init)
            ?? InspectionDraft(outcome: outcome, observedAt: at)
        draft.outcome = outcome
        draft.observedAt = at
        try syncInspection(draft, trip: trip, segmentID: segmentID, now: clock())
        try commit()
    }

    /// Закрыть последний открытый этап при завершении поездки.
    func closeOpenSegment(tripID: UUID, at: Date) throws {
        guard let trip = try trip(id: tripID), let open = trip.liveSegments.last, open.finishedAt == nil else { return }
        open.finishedAt = max(at, open.startedAt ?? at)
        open.updatedAt = clock()
        enqueue(.segment, open.id, .upsert)
        try commit()
    }

    func setDirection(tripID: UUID, _ direction: TripDirection) throws {
        guard let trip = try trip(id: tripID), trip.direction != direction else { return }
        trip.direction = direction
        touch(trip)
        try commit()
    }

    // MARK: Места

    @discardableResult
    func save(_ draft: PlaceDraft) throws -> PlaceRecord {
        guard draft.isValid else { throw StoreError.invalidPlace }
        let now = clock()
        // Дом и Работа — по одному: прежний становится «другим местом»
        if draft.kind != .other {
            let kind = draft.kind.rawValue
            let others = try context.fetch(FetchDescriptor<PlaceRecord>(
                predicate: #Predicate { $0.kindRaw == kind && $0.deletedAt == nil }))
            for p in others where p.id != draft.id {
                p.kindRaw = PlaceKind.other.rawValue
                p.updatedAt = now
                enqueue(.location, p.id, .upsert)
            }
        }
        let place: PlaceRecord
        if let id = draft.id, let existing = try self.place(id: id) {
            place = existing
        } else {
            place = PlaceRecord(kind: draft.kind, name: draft.name, latitude: draft.latitude,
                                longitude: draft.longitude, now: now)
            context.insert(place)
        }
        place.kindRaw = draft.kind.rawValue
        place.name = draft.name.trimmingCharacters(in: .whitespaces)
        place.address = draft.address.trimmed
        place.latitude = draft.latitude
        place.longitude = draft.longitude
        place.radius = draft.radius
        place.updatedAt = now
        enqueue(.location, place.id, .upsert)
        try commit()
        return place
    }

    func delete(_ place: PlaceRecord) throws {
        place.deletedAt = clock()
        place.updatedAt = clock()
        enqueue(.location, place.id, .delete)
        try commit()
    }

    // MARK: Шаблоны маршрутов

    @discardableResult
    func save(_ draft: RouteDraft) throws -> RouteRecord {
        guard draft.isValid else { throw StoreError.invalidRoute }
        let now = clock()
        let route: RouteRecord
        if let id = draft.id, let existing = try self.route(id: id) {
            route = existing
        } else {
            route = RouteRecord(name: draft.name, direction: draft.direction, now: now)
            context.insert(route)
        }
        route.name = draft.name.trimmingCharacters(in: .whitespaces)
        route.direction = draft.direction
        route.originID = draft.originID
        route.destinationID = draft.destinationID
        route.templateSegments = draft.segments.map {
            RouteTemplateSegment(transport: $0.transport, number: $0.number.trimmed,
                                 routeName: $0.routeName.trimmed, cost: $0.cost)
        }
        route.updatedAt = now
        enqueue(.route, route.id, .upsert)
        try commit()
        return route
    }

    func delete(_ route: RouteRecord) throws {
        route.deletedAt = clock()
        route.updatedAt = clock()
        enqueue(.route, route.id, .delete)
        try commit()
    }

    func place(id: UUID) throws -> PlaceRecord? {
        try context.fetch(FetchDescriptor<PlaceRecord>(predicate: #Predicate { $0.id == id })).first
    }

    func route(id: UUID) throws -> RouteRecord? {
        try context.fetch(FetchDescriptor<RouteRecord>(predicate: #Predicate { $0.id == id })).first
    }
}

extension String {
    /// nil для пустой строки — чтобы в базе не копились "" вместо NULL.
    var trimmed: String? {
        let t = trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }
}
