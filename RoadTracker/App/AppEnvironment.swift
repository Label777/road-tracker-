import Foundation
import SwiftData
import RoadTrackerCore

/// Корень зависимостей (composition root). Сервисы создаются один раз и передаются вниз через Environment.
@MainActor
final class AppEnvironment {
    let container: ModelContainer
    let store: TripStore
    let network: NetworkMonitor
    let sync: SyncManager
    let tracking: TrackingCoordinator
    let isCloudConfigured: Bool

    init(inMemory: Bool = false) throws {
        container = try RoadTrackerSchema.makeContainer(inMemory: inMemory)
        let context = container.mainContext
        context.autosaveEnabled = false // сохраняем явно, вместе с операцией очереди

        store = TripStore(context: context)
        network = NetworkMonitor()

        let remote: (any RemoteStore)? = SupabaseConfig.fromBundle().map(SupabaseRemoteStore.init(config:))
        isCloudConfigured = remote != nil
        sync = SyncManager(context: context, remote: remote, network: network)
        tracking = TrackingCoordinator(store: store)

        store.onCommit = { [sync] in sync.requestSync() }
    }

    /// Запуск/возврат в приложение: досылка очереди, истечение подсказок, очистка старых треков.
    func onBecameActive() {
        tracking.send(.tick(.now))
        try? store.purgeTrackPoints(olderThan: 30)
        sync.requestSync()
    }
}
