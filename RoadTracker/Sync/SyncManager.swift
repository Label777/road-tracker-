import Foundation
import Network
import Observation
import SwiftData
import RoadTrackerCore

@MainActor
@Observable
final class NetworkMonitor {
    private(set) var isOnline = true
    @ObservationIgnored var onChange: ((Bool) -> Void)?
    @ObservationIgnored private let monitor = NWPathMonitor()

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self, self.isOnline != online else { return }
                self.isOnline = online
                self.onChange?(online)
            }
        }
        monitor.start(queue: DispatchQueue(label: "ua.roadtracker.network"))
    }

    deinit { monitor.cancel() }
}

/// Отправляет локальные изменения в облако.
///
/// Гарантии:
/// * очередь хранится в SwiftData и переживает закрытие приложения;
/// * повторы с экспоненциальной задержкой, без «долбёжки» сервера;
/// * upsert по UUID идемпотентен — повторная отправка не создаёт дублей;
/// * конфликт «кто последний» решается на сервере тем же правилом (триггер LWW).
///
/// Загрузка изменений с сервера (второе устройство, переустановка) — Этап 5.
@MainActor
@Observable
final class SyncManager {
    private(set) var status: SyncStatus = .idle(lastSyncedAt: nil)
    private(set) var pendingCount = 0
    private(set) var lastSyncedAt: Date?

    @ObservationIgnored private let context: ModelContext
    @ObservationIgnored private let remote: (any RemoteStore)?
    @ObservationIgnored private let network: NetworkMonitor
    @ObservationIgnored private var isRunning = false
    @ObservationIgnored private var rerunRequested = false
    @ObservationIgnored private var retryTask: Task<Void, Never>?

    init(context: ModelContext, remote: (any RemoteStore)?, network: NetworkMonitor) {
        self.context = context
        self.remote = remote
        self.network = network
        network.onChange = { [weak self] online in
            if online { self?.requestSync() }
        }
        refreshPendingCount()
    }

    /// Можно вызывать сколько угодно часто: параллельные прогоны схлопываются.
    func requestSync() {
        if isRunning { rerunRequested = true; return }
        Task { await run() }
    }

    func run() async {
        isRunning = true
        defer { isRunning = false }
        repeat {
            rerunRequested = false
            await drainQueue()
        } while rerunRequested
        scheduleRetryIfNeeded()
    }

    private func drainQueue() async {
        refreshPendingCount()
        guard pendingCount > 0 else {
            status = .idle(lastSyncedAt: lastSyncedAt)
            return
        }
        guard network.isOnline else { status = .offline(pending: pendingCount); return }
        guard let remote, let userID = await remote.currentUserID() else {
            status = .signedOut(pending: pendingCount)
            return
        }
        status = .syncing(pending: pendingCount)

        let records = (try? context.fetch(FetchDescriptor<SyncOperationRecord>())) ?? []
        let byID = Dictionary(uniqueKeysWithValues: records.map { ($0.id, $0) })
        let ready = SyncQueuePolicy.ready(records.compactMap(\.operation), now: .now)

        var lastError: String?
        for op in ready {
            guard let record = byID[op.id] else { continue }
            do {
                if let row = try payload(for: op, userID: userID) {
                    try await remote.upsert(row)
                }
                // Запись могла измениться во время отправки — тогда операция уже
                // переставлена на «сейчас» и уйдёт ещё раз со свежими данными.
                if record.nextAttemptAt <= op.nextAttemptAt && record.attempts == op.attempts {
                    context.delete(record)
                }
            } catch {
                lastError = error.localizedDescription
                record.apply(SyncQueuePolicy.markFailed(op, error: lastError ?? "", now: .now))
                if !network.isOnline { break }
            }
        }
        try? context.save()
        refreshPendingCount()

        if let lastError, pendingCount > 0 {
            status = network.isOnline ? .failing(pending: pendingCount, message: lastError)
                                      : .offline(pending: pendingCount)
        } else if pendingCount == 0 {
            lastSyncedAt = .now
            status = .idle(lastSyncedAt: lastSyncedAt)
        } else {
            status = .syncing(pending: pendingCount)
        }
    }

    /// Актуальное состояние записи из локальной базы. nil — записи больше нет (нечего отправлять).
    private func payload(for op: PendingOperation, userID: UUID) throws -> RemoteRow? {
        let id = op.entityID
        switch op.entity {
        case .location:
            return try context.fetch(FetchDescriptor<PlaceRecord>(predicate: #Predicate { $0.id == id })).first?.dto(userID: userID)
        case .trip:
            return try context.fetch(FetchDescriptor<TripRecord>(predicate: #Predicate { $0.id == id })).first?.dto(userID: userID)
        case .segment:
            return try context.fetch(FetchDescriptor<SegmentRecord>(predicate: #Predicate { $0.id == id })).first?.dto(userID: userID)
        case .inspection:
            return try context.fetch(FetchDescriptor<InspectionRecord>(predicate: #Predicate { $0.id == id })).first?.dto(userID: userID)
        case .route:
            return try context.fetch(FetchDescriptor<RouteRecord>(predicate: #Predicate { $0.id == id })).first?.dto(userID: userID)
        case .settings:
            return nil // настройки отслеживания появятся на этапе 3
        }
    }

    private func refreshPendingCount() {
        pendingCount = (try? context.fetchCount(FetchDescriptor<SyncOperationRecord>())) ?? 0
    }

    /// Пробуждение к ближайшей отложенной попытке, пока приложение активно.
    /// В фоне досылку выполняет BGAppRefreshTask (этап 5).
    private func scheduleRetryIfNeeded() {
        retryTask?.cancel()
        var descriptor = FetchDescriptor<SyncOperationRecord>(sortBy: [SortDescriptor(\.nextAttemptAt)])
        descriptor.fetchLimit = 1
        guard let next = try? context.fetch(descriptor).first?.nextAttemptAt else { return }
        let delay = max(1, next.timeIntervalSinceNow)
        retryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else { return }
            self?.requestSync()
        }
    }
}
