import Foundation

/// Сущности, которые синхронизируются с Supabase. rawValue = имя таблицы.
public enum SyncEntity: String, Codable, Sendable, CaseIterable {
    case location = "locations"
    case route = "routes"
    case trip = "trips"
    case segment = "trip_segments"
    case inspection = "inspections"
    case settings = "settings"

    /// Порядок отправки: родители раньше детей, иначе сервер отклонит FK.
    public var uploadPriority: Int {
        switch self {
        case .location: 0
        case .route: 1
        case .trip: 2
        case .segment: 3
        case .inspection: 4
        case .settings: 5
        }
    }
}

public enum SyncOperationKind: String, Codable, Sendable {
    case upsert
    /// Мягкое удаление (tombstone deleted_at) — чтобы удаление дошло до других устройств.
    case delete
}

/// Ожидающая операция. Полезная нагрузка не хранится: при отправке берётся
/// актуальное состояние записи из локальной базы (всегда самое свежее).
public struct PendingOperation: Codable, Equatable, Sendable, Identifiable {
    public var id: UUID
    public var entity: SyncEntity
    public var entityID: UUID
    public var kind: SyncOperationKind
    public var enqueuedAt: Date
    public var attempts: Int
    public var nextAttemptAt: Date
    public var lastError: String?

    public init(id: UUID = UUID(), entity: SyncEntity, entityID: UUID, kind: SyncOperationKind,
                enqueuedAt: Date, attempts: Int = 0, nextAttemptAt: Date? = nil, lastError: String? = nil) {
        self.id = id
        self.entity = entity
        self.entityID = entityID
        self.kind = kind
        self.enqueuedAt = enqueuedAt
        self.attempts = attempts
        self.nextAttemptAt = nextAttemptAt ?? enqueuedAt
        self.lastError = lastError
    }
}

public enum SyncQueuePolicy {

    /// Добавляет операцию, схлопывая дубли по (entity, entityID):
    /// много правок одной поездки → одна отправка; удаление поглощает upsert.
    public static func enqueue(_ op: PendingOperation, into queue: [PendingOperation]) -> [PendingOperation] {
        var result = queue
        if let i = result.firstIndex(where: { $0.entity == op.entity && $0.entityID == op.entityID }) {
            var existing = result[i]
            // Удалённая запись остаётся удалённой (UUID не переиспользуются).
            existing.kind = (op.kind == .delete || existing.kind == .delete) ? .delete : .upsert
            // Новая правка — повод отправить сразу, сбрасываем бэкофф.
            existing.attempts = 0
            existing.nextAttemptAt = op.enqueuedAt
            existing.lastError = nil
            result[i] = existing
        } else {
            result.append(op)
        }
        return result
    }

    /// Операции, готовые к отправке, в безопасном порядке (родители → дети, удаления детей → родителей).
    public static func ready(_ queue: [PendingOperation], now: Date, limit: Int = 50) -> [PendingOperation] {
        let due = queue.filter { $0.nextAttemptAt <= now }
        let upserts = due.filter { $0.kind == .upsert }
            .sorted { ($0.entity.uploadPriority, $0.enqueuedAt) < ($1.entity.uploadPriority, $1.enqueuedAt) }
        let deletes = due.filter { $0.kind == .delete }
            .sorted { ($0.entity.uploadPriority, $0.enqueuedAt) > ($1.entity.uploadPriority, $1.enqueuedAt) }
        return Array((upserts + deletes).prefix(limit))
    }

    /// Экспоненциальный бэкофф с джиттером: 2, 4, 8 … с, не больше 15 минут.
    public static func backoff(attempt: Int, jitter: Double = Double.random(in: 0...1)) -> TimeInterval {
        let base = min(900, pow(2, Double(min(attempt, 10))))
        return base * (0.75 + 0.5 * jitter)
    }

    public static func markFailed(_ op: PendingOperation, error: String, now: Date,
                                  jitter: Double = Double.random(in: 0...1)) -> PendingOperation {
        var copy = op
        copy.attempts += 1
        copy.lastError = error
        copy.nextAttemptAt = now.addingTimeInterval(backoff(attempt: copy.attempts, jitter: jitter))
        return copy
    }
}

/// Решение конфликта: last-write-wins по времени правки, совпадает с триггером на сервере.
public enum ConflictResolver {
    public enum Winner: Equatable, Sendable { case local, remote }

    public static func resolve(localUpdatedAt: Date, remoteUpdatedAt: Date,
                               localDeletedAt: Date?, remoteDeletedAt: Date?) -> Winner {
        // Удалённая на сервере запись не воскрешается старой локальной правкой.
        if let rd = remoteDeletedAt, localDeletedAt == nil, localUpdatedAt <= rd { return .remote }
        if let ld = localDeletedAt, remoteDeletedAt == nil, remoteUpdatedAt <= ld { return .local }
        return localUpdatedAt >= remoteUpdatedAt ? .local : .remote
    }
}

public enum SyncStatus: Equatable, Sendable {
    case idle(lastSyncedAt: Date?)
    case syncing(pending: Int)
    case offline(pending: Int)
    case failing(pending: Int, message: String)
    case signedOut(pending: Int)
}
