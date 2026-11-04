import Foundation
import SwiftData
import Testing
import RoadTrackerCore
@testable import RoadTracker

/// Интеграционные тесты локальной базы: SwiftData in-memory + очередь синхронизации.
@MainActor
@Suite("Локальная база и очередь")
struct TripStoreTests {
    let container: ModelContainer
    let store: TripStore
    var context: ModelContext { container.mainContext }

    init() throws {
        container = try RoadTrackerSchema.makeContainer(inMemory: true)
        container.mainContext.autosaveEnabled = false
        store = TripStore(context: container.mainContext)
    }

    private func queue() throws -> [PendingOperation] {
        try context.fetch(FetchDescriptor<SyncOperationRecord>()).compactMap(\.operation)
    }

    @Test func manualTripIsSavedAndQueuedAtomically() throws {
        let start = Date(timeIntervalSince1970: 1_793_000_000)
        let trip = try store.createManualTrip(direction: .toWork, start: start, end: start.addingTimeInterval(2700),
                                              segments: [(.minibus, "720", .uah(20)), (.metro, nil, .uah(28))])
        #expect(trip.totalCost == .uah(48))
        #expect(trip.summary.transfers == 1)
        let ops = try queue()
        #expect(ops.count == 3)
        #expect(Set(ops.map(\.entity)) == [.trip, .segment])
        #expect(!context.hasChanges) // всё записано одним сохранением
    }

    @Test func rejectsInvalidInterval() {
        let now = Date.now
        #expect(throws: TripStore.StoreError.self) {
            try store.createManualTrip(direction: .toWork, start: now, end: now, segments: [])
        }
    }

    @Test func repeatedEditsDoNotGrowQueue() throws {
        let session = TripSession(tripID: UUID(), direction: .toWork, mode: .manual, startedAt: .now)
        try store.startTrip(session)
        try store.startTrip(session) // повтор не создаёт дубль
        try store.setPaused(tripID: session.tripID, at: .now, paused: true, pauses: [])
        try store.finishTrip(session, at: .now.addingTimeInterval(60))
        #expect(try context.fetchCount(FetchDescriptor<TripRecord>()) == 1)
        #expect(try queue().count == 1)
    }

    @Test func deleteIsTombstonedAndSynced() throws {
        let start = Date.now.addingTimeInterval(-3600)
        let trip = try store.createManualTrip(direction: .toHome, start: start, end: .now,
                                              segments: [(.bus, nil, .uah(15))])
        try store.delete(trip)
        #expect(trip.deletedAt != nil)
        #expect(trip.segments.allSatisfy { $0.deletedAt != nil })
        let ops = try queue()
        #expect(ops.allSatisfy { $0.kind == .delete })
        #expect(try store.completedSummaries().isEmpty)
    }

    @Test func coordinatorSurvivesRestart() throws {
        let defaults = UserDefaults(suiteName: "test.\(UUID())")!
        let first = TrackingCoordinator(store: store, defaults: defaults)
        first.send(.userStart(direction: .toWork, mode: .manual, at: .now))
        let tripID = try #require(first.activeSession?.tripID)

        let restored = TrackingCoordinator(store: store, defaults: defaults) // «перезапуск» приложения
        #expect(restored.activeSession?.tripID == tripID)
        restored.send(.userFinish(at: .now.addingTimeInterval(120)))
        #expect(try store.trip(id: tripID)?.status == .completed)
    }
}
