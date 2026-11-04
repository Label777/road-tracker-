import Foundation
import Testing
@testable import RoadTrackerCore

@Suite("Машина состояний отслеживания")
struct TrackingStateMachineTests {
    let t0 = T.date(2026, 11, 3, 7, 40)
    func at(_ minutes: Double) -> Date { t0.addingTimeInterval(minutes * 60) }

    @Test func leavingHomeOnlySuggests() {
        var m = TrackingStateMachine()
        let fx = m.handle(.geofenceExit(.home, at: t0))
        guard case .suggestStart(let c) = fx.first else { Issue.record("нет подсказки"); return }
        #expect(c.suggestedDirection == .toWork)
        #expect(fx.count == 1) // ни GPS, ни поездки без подтверждения
        #expect(m.state == .suggestedStart(c))
    }

    @Test func acceptedSuggestionStartsAtExitTime() {
        var m = TrackingStateMachine()
        _ = m.handle(.geofenceExit(.home, at: t0))
        let fx = m.handle(.acceptSuggestion(mode: .gps, at: at(4)))
        guard case .tripStarted(let s) = fx.first else { Issue.record("поездка не начата"); return }
        #expect(s.startedAt == t0)
        #expect(fx.contains(.startLocationUpdates))
    }

    @Test func crossingSeveralGeofencesDoesNotDuplicate() {
        var m = TrackingStateMachine()
        _ = m.handle(.geofenceExit(.home, at: t0))
        #expect(m.handle(.geofenceExit(.other, at: at(1))).isEmpty)
        #expect(m.handle(.geofenceExit(.home, at: at(2))).isEmpty)
        _ = m.handle(.acceptSuggestion(mode: .manual, at: at(3)))
        #expect(m.handle(.userStart(direction: .toWork, mode: .manual, at: at(4))).isEmpty)
        #expect(m.handle(.geofenceExit(.home, at: at(5))).isEmpty)
    }

    @Test func arrivalSuggestsFinishOnce() {
        var m = TrackingStateMachine()
        _ = m.handle(.userStart(direction: .toWork, mode: .gps, at: t0))
        guard case .recording(let s) = m.state else { Issue.record(); return }
        #expect(m.handle(.geofenceEnter(.work, at: at(40))) == [.suggestFinish(tripID: s.tripID)])
        #expect(m.handle(.geofenceEnter(.work, at: at(41))).isEmpty)
        let fx = m.handle(.userFinish(at: at(42)))
        guard case .tripFinished(_, let end) = fx.first else { Issue.record(); return }
        #expect(end == at(42))
        #expect(fx.contains(.stopLocationUpdates))
        #expect(m.state == .idle)
    }

    @Test func missedNotificationCreatesUnconfirmedTrip() {
        var m = TrackingStateMachine()
        _ = m.handle(.geofenceExit(.home, at: t0), newID: { UUID(uuidString: "00000000-0000-0000-0000-0000000000AA")! })
        let fx = m.handle(.geofenceEnter(.work, at: at(45)))
        #expect(fx.contains(.createUnconfirmedTrip(id: UUID(uuidString: "00000000-0000-0000-0000-0000000000AA")!,
                                                   direction: .toWork, start: t0, end: at(45))))
        #expect(m.state == .idle)
    }

    @Test func returningHomeCancelsSuggestion() {
        var m = TrackingStateMachine()
        _ = m.handle(.geofenceExit(.home, at: t0))
        let fx = m.handle(.geofenceEnter(.home, at: at(3)))
        #expect(fx.count == 1)
        guard case .cancelStartSuggestion = fx.first else { Issue.record(); return }
        #expect(m.state == .idle)
    }

    @Test func suggestionExpires() {
        var m = TrackingStateMachine()
        _ = m.handle(.geofenceExit(.home, at: t0))
        #expect(m.handle(.tick(at(60))).isEmpty)
        #expect(m.handle(.tick(at(121))).count == 1)
        #expect(m.state == .idle)
    }

    @Test func pausesAreExcludedAndFinishWhilePausedCloses() {
        var m = TrackingStateMachine()
        _ = m.handle(.userStart(direction: .toWork, mode: .manual, at: t0))
        _ = m.handle(.userPause(at: at(10)))
        #expect(m.handle(.userPause(at: at(11))).isEmpty) // повторная пауза игнорируется
        _ = m.handle(.userResume(at: at(20)))
        _ = m.handle(.userPause(at: at(30)))
        let fx = m.handle(.userFinish(at: at(40)))
        guard case .tripFinished(let s, let end) = fx.first else { Issue.record(); return }
        #expect(TripTiming.activeDuration(start: s.startedAt, end: end, pauses: s.pauses) == 20 * 60)
    }

    @Test func revokedPermissionDegradesToManualWithoutLosingTrip() {
        var m = TrackingStateMachine()
        _ = m.handle(.userStart(direction: .toWork, mode: .gps, at: t0))
        let fx = m.handle(.locationAccessRevoked(at: at(5)))
        #expect(fx.contains(.stopLocationUpdates))
        guard case .recording(let s) = m.state else { Issue.record("поездка потеряна"); return }
        #expect(s.mode == .manual)
    }

    @Test func stateSurvivesAppTermination() throws {
        var m = TrackingStateMachine()
        _ = m.handle(.userStart(direction: .toHome, mode: .gps, at: t0))
        _ = m.handle(.userPause(at: at(5)))
        let data = try JSONEncoder().encode(m)
        let restored = try JSONDecoder().decode(TrackingStateMachine.self, from: data)
        #expect(restored == m)
    }
}

@Suite("Очередь синхронизации")
struct SyncQueueTests {
    let now = T.date(2026, 11, 3, 9)
    let id = UUID()

    @Test func coalescesRepeatedEdits() {
        var q: [PendingOperation] = []
        for i in 0..<5 {
            q = SyncQueuePolicy.enqueue(.init(entity: .trip, entityID: id, kind: .upsert,
                                              enqueuedAt: now.addingTimeInterval(Double(i))), into: q)
        }
        #expect(q.count == 1)
    }

    @Test func deleteSupersedesUpsert() {
        var q = SyncQueuePolicy.enqueue(.init(entity: .trip, entityID: id, kind: .upsert, enqueuedAt: now), into: [])
        q = SyncQueuePolicy.enqueue(.init(entity: .trip, entityID: id, kind: .delete, enqueuedAt: now), into: q)
        q = SyncQueuePolicy.enqueue(.init(entity: .trip, entityID: id, kind: .upsert, enqueuedAt: now), into: q)
        #expect(q.map(\.kind) == [.delete])
    }

    @Test func parentsUploadBeforeChildren() {
        var q: [PendingOperation] = []
        q = SyncQueuePolicy.enqueue(.init(entity: .inspection, entityID: UUID(), kind: .upsert, enqueuedAt: now), into: q)
        q = SyncQueuePolicy.enqueue(.init(entity: .segment, entityID: UUID(), kind: .upsert, enqueuedAt: now), into: q)
        q = SyncQueuePolicy.enqueue(.init(entity: .trip, entityID: UUID(), kind: .upsert, enqueuedAt: now.addingTimeInterval(5)), into: q)
        q = SyncQueuePolicy.enqueue(.init(entity: .trip, entityID: UUID(), kind: .delete, enqueuedAt: now), into: q)
        q = SyncQueuePolicy.enqueue(.init(entity: .segment, entityID: UUID(), kind: .delete, enqueuedAt: now), into: q)
        let order = SyncQueuePolicy.ready(q, now: now.addingTimeInterval(10)).map { "\($0.kind.rawValue):\($0.entity.rawValue)" }
        #expect(order == ["upsert:trips", "upsert:trip_segments", "upsert:inspections",
                          "delete:trip_segments", "delete:trips"])
    }

    @Test func failedOperationWaitsWithBackoff() {
        let op = PendingOperation(entity: .trip, entityID: id, kind: .upsert, enqueuedAt: now)
        let failed = SyncQueuePolicy.markFailed(op, error: "offline", now: now, jitter: 0.5)
        #expect(failed.attempts == 1)
        #expect(failed.nextAttemptAt == now.addingTimeInterval(2))
        #expect(SyncQueuePolicy.ready([failed], now: now).isEmpty)
        #expect(SyncQueuePolicy.backoff(attempt: 50, jitter: 1) <= 900 * 1.25)
    }

    @Test func conflictLastWriteWins() {
        let early = now, late = now.addingTimeInterval(60)
        #expect(ConflictResolver.resolve(localUpdatedAt: late, remoteUpdatedAt: early, localDeletedAt: nil, remoteDeletedAt: nil) == .local)
        #expect(ConflictResolver.resolve(localUpdatedAt: early, remoteUpdatedAt: late, localDeletedAt: nil, remoteDeletedAt: nil) == .remote)
        // Старая локальная правка не воскрешает удалённую на другом устройстве запись
        #expect(ConflictResolver.resolve(localUpdatedAt: early, remoteUpdatedAt: late, localDeletedAt: nil, remoteDeletedAt: late) == .remote)
    }
}

@Suite("GPS")
struct GeoTests {
    func sample(_ lat: Double, _ lon: Double, _ sec: Double, acc: Double = 10) -> TrackSample {
        TrackSample(point: GeoPoint(latitude: lat, longitude: lon),
                    timestamp: T.date(2026, 11, 3, 8).addingTimeInterval(sec), horizontalAccuracy: acc)
    }

    @Test func haversine() {
        let d = GeoMath.distance(GeoPoint(latitude: 50, longitude: 30), GeoPoint(latitude: 51, longitude: 30))
        #expect(abs(d - 111_195) < 50)
    }

    @Test func stationaryJitterDoesNotAccumulate() {
        // 10 минут на месте с шумом ±5 м
        let samples = (0..<60).map { i in
            sample(50.45 + (i.isMultiple(of: 2) ? 0.00004 : -0.00004), 30.52, Double(i) * 10)
        }
        #expect(TrackProcessor().distance(of: samples) == 0)
    }

    @Test func rejectsInaccurateAndImpossibleJumps() {
        let samples = [
            sample(50.4500, 30.52, 0),
            sample(50.4510, 30.52, 60),                 // ~111 м
            sample(50.5500, 30.52, 61),                 // скачок 11 км за 1 с — мусор
            sample(50.4520, 30.52, 120, acc: 300),      // неточная отметка
            sample(50.4520, 30.52, 180),                // ещё ~111 м
        ]
        let d = TrackProcessor().distance(of: samples)
        #expect(abs(d - 222.4) < 2)
    }

    @Test func detectsStop() {
        var samples = (0..<6).map { sample(50.45 + Double($0) * 0.001, 30.52, Double($0) * 20) } // едем
        samples += (0..<12).map { sample(50.4551, 30.52, 120 + Double($0) * 15) }              // стоим 165 с
        samples += (0..<3).map { sample(50.457 + Double($0) * 0.001, 30.52, 320 + Double($0) * 20) }
        let stops = StopDetector().stops(in: samples)
        #expect(stops.count == 1)
        #expect(stops.first.map { $0.interval.duration >= 150 } == true)
    }

    @Test func adaptivePolicy() {
        #expect(GPSPolicy.recommended(speed: 1, isStationary: true, lowPowerMode: false, batteryLevel: 1).accuracy == .hundredMeters)
        #expect(GPSPolicy.recommended(speed: 1.2, isStationary: false, lowPowerMode: false, batteryLevel: 1).distanceFilter == 15)
        #expect(GPSPolicy.recommended(speed: 20, isStationary: false, lowPowerMode: true, batteryLevel: 1).accuracy == .hundredMeters)
    }
}
