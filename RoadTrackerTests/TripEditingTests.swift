import Foundation
import SwiftData
import Testing
import RoadTrackerCore
@testable import RoadTracker

@MainActor
@Suite("Редактирование поездок, мест и маршрутов")
struct TripEditingTests {
    let container: ModelContainer
    let store: TripStore
    var context: ModelContext { container.mainContext }
    let base = Date(timeIntervalSince1970: 1_793_000_000)

    init() throws {
        container = try RoadTrackerSchema.makeContainer(inMemory: true)
        container.mainContext.autosaveEnabled = false
        store = TripStore(context: container.mainContext, clock: { Date(timeIntervalSince1970: 1_793_010_000) })
    }

    private func queue() throws -> [PendingOperation] {
        try context.fetch(FetchDescriptor<SyncOperationRecord>()).compactMap(\.operation)
    }

    private func clearQueue() throws {
        try context.delete(model: SyncOperationRecord.self)
        try context.save()
    }

    private func draft() -> TripDraft {
        var d = TripDraft()
        d.startedAt = base
        d.finishedAt = base.addingTimeInterval(45 * 60)
        var a = SegmentDraft(transport: .minibus, number: "720", cost: .uah(20))
        a.inspection = InspectionDraft(outcome: .ticketChecked, observedAt: base.addingTimeInterval(600))
        d.segments = [a, SegmentDraft(transport: .metro, cost: .uah(8))]
        return d
    }

    @Test func savesTripWithSegmentsAndInspection() throws {
        let trip = try store.save(draft())
        #expect(trip.totalCost == .uah(28))
        #expect(trip.liveSegments.map(\.transportNumber) == ["720", nil])
        #expect(trip.liveInspections.count == 1)
        #expect(trip.liveInspections.first?.segmentID == trip.liveSegments.first?.id)
        #expect(try queue().count == 4) // поездка, 2 этапа, наблюдение
    }

    @Test func unchangedResaveQueuesNothing() throws {
        let trip = try store.save(draft())
        try clearQueue()
        try store.save(TripDraft(trip))
        #expect(try queue().isEmpty)
    }

    @Test func removingSegmentTombstonesItAndItsInspection() throws {
        let trip = try store.save(draft())
        try clearQueue()
        var edit = TripDraft(trip)
        edit.segments.removeFirst()
        try store.save(edit)
        #expect(trip.liveSegments.count == 1)
        #expect(trip.liveInspections.isEmpty)
        #expect(trip.totalCost == .uah(8))
        let kinds = Dictionary(grouping: try queue(), by: \.entity).mapValues { $0.map(\.kind) }
        // удалённый этап → delete, оставшийся сменил позицию → upsert
        #expect(kinds[.segment]?.map(\.rawValue).sorted() == ["delete", "upsert"])
        #expect(kinds[.inspection] == [.delete])
        #expect(kinds[.trip] == [.upsert])
    }

    @Test func reorderUpdatesPositions() throws {
        let trip = try store.save(draft())
        var edit = TripDraft(trip)
        edit.segments.reverse()
        try store.save(edit)
        #expect(trip.liveSegments.map(\.transport) == [.metro, .minibus])
    }

    @Test func liveSegmentsCloseThePreviousOne() throws {
        let session = TripSession(tripID: UUID(), direction: .toWork, mode: .manual, startedAt: base)
        try store.startTrip(session)
        try store.appendLiveSegment(tripID: session.tripID, transport: .minibus, number: "720", cost: .uah(20), at: base)
        try store.recordInspection(tripID: session.tripID, outcome: .presentNotChecked, at: base.addingTimeInterval(300))
        try store.appendLiveSegment(tripID: session.tripID, transport: .metro, number: "", cost: .uah(8),
                                    at: base.addingTimeInterval(1200))
        try store.closeOpenSegment(tripID: session.tripID, at: base.addingTimeInterval(2400))
        let trip = try #require(try store.trip(id: session.tripID))
        let segs = trip.liveSegments
        #expect(segs.count == 2)
        #expect(segs[0].finishedAt == base.addingTimeInterval(1200))
        #expect(segs[1].finishedAt == base.addingTimeInterval(2400))
        #expect(trip.liveInspections.first?.segmentID == segs[0].id)
    }

    @Test func onlyOneHomeAndWork() throws {
        var home = PlaceDraft(kind: .home)
        let first = try store.save(home)
        home = PlaceDraft(kind: .home)
        home.latitude = 50.40
        let second = try store.save(home)
        #expect(first.kind == .other)
        #expect(second.kind == .home)
    }

    @Test func routeTemplateCreatesTripDraft() throws {
        var r = RouteDraft()
        r.name = "Дом → работа"
        r.segments = [SegmentDraft(transport: .minibus, number: "720", cost: .uah(20)),
                      SegmentDraft(transport: .metro, cost: .uah(8))]
        let route = try store.save(r)
        #expect(route.typicalCost == .uah(28))
        let d = TripDraft(route: route, startedAt: base, finishedAt: base.addingTimeInterval(2700))
        let trip = try store.save(d)
        #expect(trip.routeID == route.id)
        #expect(trip.totalCost == .uah(28))
        #expect(trip.summary.routeID == route.id)
    }

    @Test func blockingValidationPreventsSave() {
        var d = draft()
        d.finishedAt = d.startedAt
        #expect(throws: TripStore.StoreError.self) { try store.save(d) }
    }
}
