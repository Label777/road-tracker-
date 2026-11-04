import Foundation
import RoadTrackerCore

// Черновики для экранов редактирования. Форма меняет черновик (value type),
// а в базу он попадает целиком при «Сохранить». Так незавершённая правка не уйдёт
// в облако, если синхронизация сохранит контекст, пока форма открыта.

struct InspectionDraft: Equatable, Identifiable {
    var id = UUID()
    var outcome: InspectionOutcome = .noController
    var observedAt: Date = .now
    var comment = ""

    init(outcome: InspectionOutcome = .noController, observedAt: Date = .now) {
        self.outcome = outcome
        self.observedAt = observedAt
    }

    init(_ r: InspectionRecord) {
        id = r.id
        outcome = r.outcome
        observedAt = r.observedAt
        comment = r.comment ?? ""
    }
}

struct SegmentDraft: Equatable, Identifiable {
    var id = UUID()
    var transport: TransportType = .minibus
    var number = ""
    var routeName = ""
    var startedAt: Date?
    var finishedAt: Date?
    var cost: Money = .zero
    var distanceMeters: Int?
    var comment = ""
    var inspection: InspectionDraft?

    init(transport: TransportType = .minibus, number: String = "", cost: Money = .zero) {
        self.transport = transport
        self.number = number
        self.cost = cost
    }

    init(_ r: SegmentRecord, inspection: InspectionRecord?) {
        id = r.id
        transport = r.transport
        number = r.transportNumber ?? ""
        routeName = r.routeName ?? ""
        startedAt = r.startedAt
        finishedAt = r.finishedAt
        cost = Money(minorUnits: r.cost)
        distanceMeters = r.distanceMeters
        comment = r.comment ?? ""
        self.inspection = inspection.map(InspectionDraft.init)
    }

    init(template: RouteTemplateSegment) {
        transport = template.transport
        number = template.number ?? ""
        routeName = template.routeName ?? ""
        cost = Money(minorUnits: template.cost)
    }

    var title: String {
        number.isEmpty ? transport.title : "\(transport.title) №\(number)"
    }
}

struct TripDraft: Equatable {
    var id: UUID?
    var direction: TripDirection = .toWork
    var startedAt: Date = .now.addingTimeInterval(-45 * 60)
    var finishedAt: Date = .now
    var routeID: UUID?
    var extraCost: Money = .zero
    var comment = ""
    var segments: [SegmentDraft] = []
    /// Наблюдение для поездки без разбивки на этапы.
    var tripInspection: InspectionDraft?

    init() {}

    init(_ trip: TripRecord) {
        id = trip.id
        direction = trip.direction
        startedAt = trip.startedAt
        finishedAt = trip.finishedAt ?? .now
        routeID = trip.routeID
        extraCost = Money(minorUnits: trip.extraCost)
        comment = trip.comment ?? ""
        let inspections = trip.liveInspections
        segments = trip.liveSegments.map { s in
            SegmentDraft(s, inspection: inspections.first { $0.segmentID == s.id })
        }
        tripInspection = inspections.first { $0.segmentID == nil }.map(InspectionDraft.init)
    }

    init(route: RouteRecord, startedAt: Date = .now.addingTimeInterval(-45 * 60), finishedAt: Date = .now) {
        direction = route.direction
        routeID = route.id
        self.startedAt = startedAt
        self.finishedAt = finishedAt
        segments = route.templateSegments.map(SegmentDraft.init(template:))
    }

    var totalCost: Money { segments.map(\.cost).sum() + extraCost }

    func issues(now: Date = .now) -> [TripValidation.Issue] {
        TripValidation.validate(start: startedAt, end: finishedAt,
                                segments: segments.map { .init(start: $0.startedAt, end: $0.finishedAt) },
                                now: now)
    }
}

struct PlaceDraft: Equatable {
    var id: UUID?
    var kind: PlaceKind = .other
    var name = ""
    var address = ""
    var latitude = 50.4501
    var longitude = 30.5234
    var radius = 150

    init(kind: PlaceKind = .other) {
        self.kind = kind
        name = kind == .home ? String(localized: "Дом") : kind == .work ? String(localized: "Работа") : ""
    }

    init(_ p: PlaceRecord) {
        id = p.id
        kind = p.kind
        name = p.name
        address = p.address ?? ""
        latitude = p.latitude
        longitude = p.longitude
        radius = p.radius
    }

    var isValid: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && (100...2000).contains(radius)
            && (-90...90).contains(latitude) && (-180...180).contains(longitude)
    }
}

struct RouteDraft: Equatable {
    var id: UUID?
    var name = ""
    var direction: TripDirection = .toWork
    var originID: UUID?
    var destinationID: UUID?
    var segments: [SegmentDraft] = [SegmentDraft()]

    init() {}

    init(_ r: RouteRecord) {
        id = r.id
        name = r.name
        direction = r.direction
        originID = r.originID
        destinationID = r.destinationID
        segments = r.templateSegments.map(SegmentDraft.init(template:))
    }

    var isValid: Bool { !name.trimmingCharacters(in: .whitespaces).isEmpty && !segments.isEmpty && segments.count <= 12 }
}

extension PlaceKind {
    var title: String {
        switch self {
        case .home: String(localized: "Дом")
        case .work: String(localized: "Работа")
        case .other: String(localized: "Другое место")
        }
    }
    var symbolName: String {
        switch self {
        case .home: "house.fill"
        case .work: "briefcase.fill"
        case .other: "mappin.circle.fill"
        }
    }
}

extension TripValidation.Issue {
    var message: String {
        switch self {
        case .endBeforeStart: String(localized: "Окончание должно быть позже начала.")
        case .startInFuture: String(localized: "Начало поездки в будущем.")
        case .tooLong(let h): String(localized: "Поездка дольше \(h) ч — проверьте время.")
        case .segmentEndBeforeStart(let i): String(localized: "Этап \(i + 1): прибытие раньше отправления.")
        case .segmentOutsideTrip(let i): String(localized: "Этап \(i + 1) выходит за время поездки.")
        case .segmentsOverlap(let i): String(localized: "Этап \(i + 1) начинается раньше, чем закончился предыдущий.")
        }
    }
}
