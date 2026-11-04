import Foundation
import SwiftData
import RoadTrackerCore

// Локальная база (SwiftData) — источник истины для UI. Облако — копия.
// Перечисления хранятся как String rawValue: так надёжнее работают #Predicate и миграции.
// UUID генерируется на устройстве и совпадает с id строки в Supabase.

@Model
final class PlaceRecord {
    @Attribute(.unique) var id: UUID
    var kindRaw: String
    var name: String
    var address: String?
    var latitude: Double
    var longitude: Double
    var radius: Int
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    init(id: UUID = UUID(), kind: PlaceKind, name: String, address: String? = nil,
         latitude: Double, longitude: Double, radius: Int = 150, now: Date = .now) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.name = name
        self.address = address
        self.latitude = latitude
        self.longitude = longitude
        self.radius = radius
        self.createdAt = now
        self.updatedAt = now
    }

    var kind: PlaceKind { PlaceKind(rawValue: kindRaw) ?? .other }
}

@Model
final class TripRecord {
    @Attribute(.unique) var id: UUID
    var routeID: UUID?
    var directionRaw: String
    var startedAt: Date
    var finishedAt: Date?
    var timeZoneIdentifier: String
    /// Закодированный [DateInterval] пауз.
    var pausesData: Data?
    /// Стоимость без разбивки по этапам (быстрый ручной ввод), копейки.
    var extraCost: Int
    var distanceMeters: Int?
    var trackingModeRaw: String
    var statusRaw: String
    var comment: String?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    @Relationship(deleteRule: .cascade, inverse: \SegmentRecord.trip)
    var segments: [SegmentRecord] = []
    @Relationship(deleteRule: .cascade, inverse: \InspectionRecord.trip)
    var inspections: [InspectionRecord] = []
    @Relationship(deleteRule: .cascade, inverse: \TrackPointRecord.trip)
    var trackPoints: [TrackPointRecord] = []

    init(id: UUID = UUID(), direction: TripDirection, startedAt: Date, finishedAt: Date? = nil,
         timeZone: TimeZone = .current, mode: TrackingMode, status: TripStatus, now: Date = .now) {
        self.id = id
        self.directionRaw = direction.rawValue
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        self.timeZoneIdentifier = timeZone.identifier
        self.extraCost = 0
        self.trackingModeRaw = mode.rawValue
        self.statusRaw = status.rawValue
        self.createdAt = now
        self.updatedAt = now
    }

    var direction: TripDirection {
        get { TripDirection(rawValue: directionRaw) ?? .other }
        set { directionRaw = newValue.rawValue }
    }
    var status: TripStatus {
        get { TripStatus(rawValue: statusRaw) ?? .completed }
        set { statusRaw = newValue.rawValue }
    }
    var trackingMode: TrackingMode {
        get { TrackingMode(rawValue: trackingModeRaw) ?? .manual }
        set { trackingModeRaw = newValue.rawValue }
    }
    var pauses: [DateInterval] {
        get { pausesData.flatMap { try? JSONDecoder().decode([DateInterval].self, from: $0) } ?? [] }
        set { pausesData = try? JSONEncoder().encode(newValue) }
    }

    var liveSegments: [SegmentRecord] {
        segments.filter { $0.deletedAt == nil }.sorted { $0.position < $1.position }
    }
    var liveInspections: [InspectionRecord] { inspections.filter { $0.deletedAt == nil } }

    var totalCost: Money {
        Money(minorUnits: extraCost + liveSegments.reduce(0) { $0 + $1.cost })
    }

    var activeSeconds: TimeInterval {
        TripTiming.activeDuration(start: startedAt, end: finishedAt ?? .now, pauses: pauses)
    }
}

@Model
final class SegmentRecord {
    @Attribute(.unique) var id: UUID
    var trip: TripRecord?
    var position: Int
    var transportRaw: String
    var transportNumber: String?
    var routeName: String?
    var startedAt: Date?
    var finishedAt: Date?
    /// Копейки.
    var cost: Int
    var distanceMeters: Int?
    var transferNumber: Int
    var comment: String?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    init(id: UUID = UUID(), position: Int, transport: TransportType, transportNumber: String? = nil,
         cost: Money = .zero, now: Date = .now) {
        self.id = id
        self.position = position
        self.transportRaw = transport.rawValue
        self.transportNumber = transportNumber
        self.cost = cost.minorUnits
        self.transferNumber = position
        self.createdAt = now
        self.updatedAt = now
    }

    var transport: TransportType {
        get { TransportType(rawValue: transportRaw) ?? .other }
        set { transportRaw = newValue.rawValue }
    }
}

@Model
final class InspectionRecord {
    @Attribute(.unique) var id: UUID
    var trip: TripRecord?
    var segmentID: UUID?
    var outcomeRaw: String
    var latitude: Double?
    var longitude: Double?
    var observedAt: Date
    var comment: String?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    init(id: UUID = UUID(), outcome: InspectionOutcome, observedAt: Date, segmentID: UUID? = nil, now: Date = .now) {
        self.id = id
        self.outcomeRaw = outcome.rawValue
        self.observedAt = observedAt
        self.segmentID = segmentID
        self.createdAt = now
        self.updatedAt = now
    }

    var outcome: InspectionOutcome {
        get { InspectionOutcome(rawValue: outcomeRaw) ?? .unknown }
        set { outcomeRaw = newValue.rawValue }
    }
}

/// Точка GPS-трека. По умолчанию хранится только на устройстве и удаляется
/// по истечении срока хранения (settings.trackRetentionDays).
@Model
final class TrackPointRecord {
    var trip: TripRecord?
    var recordedAt: Date
    var latitude: Double
    var longitude: Double
    var horizontalAccuracy: Double
    var speed: Double

    init(sample: TrackSample) {
        self.recordedAt = sample.timestamp
        self.latitude = sample.point.latitude
        self.longitude = sample.point.longitude
        self.horizontalAccuracy = sample.horizontalAccuracy
        self.speed = sample.speed
    }
}

/// Шаблон маршрута: «Дом → маршрутка 720 → метро → Работа».
@Model
final class RouteRecord {
    @Attribute(.unique) var id: UUID
    var name: String
    var directionRaw: String
    var originID: UUID?
    var destinationID: UUID?
    /// Закодированный [RouteTemplateSegment].
    var segmentsData: Data?
    var createdAt: Date
    var updatedAt: Date
    var deletedAt: Date?

    init(id: UUID = UUID(), name: String, direction: TripDirection, now: Date = .now) {
        self.id = id
        self.name = name
        self.directionRaw = direction.rawValue
        self.createdAt = now
        self.updatedAt = now
    }

    var direction: TripDirection {
        get { TripDirection(rawValue: directionRaw) ?? .other }
        set { directionRaw = newValue.rawValue }
    }
    var templateSegments: [RouteTemplateSegment] {
        get { segmentsData.flatMap { try? JSONDecoder().decode([RouteTemplateSegment].self, from: $0) } ?? [] }
        set { segmentsData = try? JSONEncoder().encode(newValue) }
    }
    var typicalCost: Money { Money(minorUnits: templateSegments.reduce(0) { $0 + $1.cost }) }
}

/// Постоянная очередь синхронизации: переживает закрытие и перезапуск приложения.
@Model
final class SyncOperationRecord {
    @Attribute(.unique) var id: UUID
    var entityRaw: String
    var entityID: UUID
    var kindRaw: String
    var enqueuedAt: Date
    var attempts: Int
    var nextAttemptAt: Date
    var lastError: String?

    init(_ op: PendingOperation) {
        self.id = op.id
        self.entityRaw = op.entity.rawValue
        self.entityID = op.entityID
        self.kindRaw = op.kind.rawValue
        self.enqueuedAt = op.enqueuedAt
        self.attempts = op.attempts
        self.nextAttemptAt = op.nextAttemptAt
        self.lastError = op.lastError
    }

    var operation: PendingOperation? {
        guard let entity = SyncEntity(rawValue: entityRaw), let kind = SyncOperationKind(rawValue: kindRaw) else { return nil }
        return PendingOperation(id: id, entity: entity, entityID: entityID, kind: kind, enqueuedAt: enqueuedAt,
                                attempts: attempts, nextAttemptAt: nextAttemptAt, lastError: lastError)
    }

    func apply(_ op: PendingOperation) {
        kindRaw = op.kind.rawValue
        attempts = op.attempts
        nextAttemptAt = op.nextAttemptAt
        lastError = op.lastError
    }
}

enum RoadTrackerSchema {
    static var models: [any PersistentModel.Type] {
        [PlaceRecord.self, RouteRecord.self, TripRecord.self, SegmentRecord.self, InspectionRecord.self,
         TrackPointRecord.self, SyncOperationRecord.self]
    }

    @MainActor
    static func makeContainer(inMemory: Bool = false) throws -> ModelContainer {
        if !inMemory {
            // При первом запуске папки Application Support ещё нет — SwiftData
            // пишет ошибку CoreData и «восстанавливается». Создаём её заранее.
            try FileManager.default.createDirectory(at: .applicationSupportDirectory,
                                                    withIntermediateDirectories: true)
        }
        let configuration = ModelConfiguration("RoadTracker", isStoredInMemoryOnly: inMemory)
        return try ModelContainer(for: Schema(models), configurations: configuration)
    }
}
