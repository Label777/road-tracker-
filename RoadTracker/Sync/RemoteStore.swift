import Foundation
import RoadTrackerCore

/// Абстракция облака: позволяет тестировать SyncManager без сети и заменить бэкенд.
protocol RemoteStore: Sendable {
    /// Текущий пользователь (nil — не авторизован, синхронизация откладывается).
    func currentUserID() async -> UUID?
    /// Идемпотентный upsert по id. Удаление — это upsert с заполненным deleted_at.
    func upsert(_ row: RemoteRow) async throws
}

/// Строка для отправки. Ключи совпадают с колонками PostgreSQL (snake_case).
enum RemoteRow: Sendable {
    case location(LocationDTO)
    case trip(TripDTO)
    case segment(SegmentDTO)
    case inspection(InspectionDTO)

    var table: String {
        switch self {
        case .location: SyncEntity.location.rawValue
        case .trip: SyncEntity.trip.rawValue
        case .segment: SyncEntity.segment.rawValue
        case .inspection: SyncEntity.inspection.rawValue
        }
    }
}

struct LocationDTO: Codable, Sendable {
    var id: UUID
    var user_id: UUID
    var kind: String
    var name: String
    var address: String?
    var latitude: Double
    var longitude: Double
    var radius: Int
    var updated_at: Date
    var deleted_at: Date?
}

struct TripDTO: Codable, Sendable {
    var id: UUID
    var user_id: UUID
    var route_id: UUID?
    var direction: String
    var started_at: Date
    var finished_at: Date?
    var time_zone: String
    var duration_seconds: Int?
    var paused_seconds: Int
    var total_cost: Int
    var currency: String
    var distance_meters: Int?
    var tracking_mode: String
    var status: String
    var comment: String?
    var updated_at: Date
    var deleted_at: Date?
}

struct SegmentDTO: Codable, Sendable {
    var id: UUID
    var user_id: UUID
    var trip_id: UUID
    var position: Int
    var transport_type: String
    var transport_number: String?
    var route_name: String?
    var started_at: Date?
    var finished_at: Date?
    var cost: Int
    var distance_meters: Int?
    var transfer_number: Int
    var comment: String?
    var updated_at: Date
    var deleted_at: Date?
}

struct InspectionDTO: Codable, Sendable {
    var id: UUID
    var user_id: UUID
    var trip_id: UUID
    var segment_id: UUID?
    var outcome: String
    var location_latitude: Double?
    var location_longitude: Double?
    var observed_at: Date
    var comment: String?
    var updated_at: Date
    var deleted_at: Date?
}

// MARK: - Маппинг локальных моделей

extension PlaceRecord {
    func dto(userID: UUID) -> RemoteRow {
        .location(LocationDTO(id: id, user_id: userID, kind: kindRaw, name: name, address: address,
                              latitude: latitude, longitude: longitude, radius: radius,
                              updated_at: updatedAt, deleted_at: deletedAt))
    }
}

extension TripRecord {
    func dto(userID: UUID) -> RemoteRow {
        let paused = finishedAt.map { end in
            TripTiming.mergedLength(of: pauses, clampedTo: DateInterval(start: startedAt, end: max(startedAt, end)))
        } ?? 0
        return .trip(TripDTO(
            id: id, user_id: userID, route_id: routeID, direction: directionRaw,
            started_at: startedAt, finished_at: finishedAt, time_zone: timeZoneIdentifier,
            duration_seconds: finishedAt.map { _ in Int(activeSeconds.rounded()) },
            paused_seconds: Int(paused.rounded()), total_cost: totalCost.minorUnits, currency: "UAH",
            distance_meters: distanceMeters, tracking_mode: trackingModeRaw, status: statusRaw,
            comment: comment, updated_at: updatedAt, deleted_at: deletedAt))
    }
}

extension SegmentRecord {
    func dto(userID: UUID) -> RemoteRow? {
        guard let tripID = trip?.id else { return nil }
        return .segment(SegmentDTO(
            id: id, user_id: userID, trip_id: tripID, position: position, transport_type: transportRaw,
            transport_number: transportNumber, route_name: routeName, started_at: startedAt,
            finished_at: finishedAt, cost: cost, distance_meters: distanceMeters,
            transfer_number: transferNumber, comment: comment, updated_at: updatedAt, deleted_at: deletedAt))
    }
}

extension InspectionRecord {
    func dto(userID: UUID) -> RemoteRow? {
        guard let tripID = trip?.id else { return nil }
        return .inspection(InspectionDTO(
            id: id, user_id: userID, trip_id: tripID, segment_id: segmentID, outcome: outcomeRaw,
            location_latitude: latitude, location_longitude: longitude, observed_at: observedAt,
            comment: comment, updated_at: updatedAt, deleted_at: deletedAt))
    }
}
