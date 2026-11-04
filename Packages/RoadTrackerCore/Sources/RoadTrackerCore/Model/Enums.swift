import Foundation

// rawValue совпадают с enum-типами PostgreSQL (supabase/migrations).
// Ядро не содержит локализованных строк: подписи для UI — в приложении (Enums+Display.swift).

public enum TripDirection: String, Codable, CaseIterable, Sendable {
    case toWork = "to_work"
    case toHome = "to_home"
    case other

}

public enum TrackingMode: String, Codable, CaseIterable, Sendable {
    case manual, gps, auto
}

public enum TripStatus: String, Codable, CaseIterable, Sendable {
    /// Предложена автоопределением, пользователь ещё не подтвердил.
    case suggested
    case active
    case paused
    case completed
    /// Пользователь отклонил предложенную поездку.
    case discarded

    public var isOngoing: Bool { self == .active || self == .paused }
}

public enum TransportType: String, Codable, CaseIterable, Sendable {
    case walk, bus, minibus, trolleybus, tram, metro, train, taxi, car, bicycle, scooter, other

    /// SF Symbol для UI.
    public var symbolName: String {
        switch self {
        case .walk: "figure.walk"
        case .bus, .minibus: "bus"
        case .trolleybus: "bus.doubledecker"
        case .tram: "tram"
        case .metro: "tram.fill.tunnel"
        case .train: "train.side.front.car"
        case .taxi, .car: "car"
        case .bicycle: "bicycle"
        case .scooter: "scooter"
        case .other: "ellipsis.circle"
        }
    }

    /// Виды транспорта, где бывают контролёры.
    public var hasTicketInspection: Bool {
        switch self {
        case .bus, .minibus, .trolleybus, .tram, .metro, .train: true
        default: false
        }
    }
}

public enum InspectionOutcome: String, Codable, CaseIterable, Sendable {
    case noController = "no_controller"
    case presentNotChecked = "present_not_checked"
    case ticketChecked = "ticket_checked"
    case checkedAtTransfer = "checked_at_transfer"
    case unknown

    /// nil — неизвестно.
    public var controllerPresent: Bool? {
        switch self {
        case .noController: false
        case .unknown: nil
        default: true
        }
    }

    public var ticketChecked: Bool? {
        switch self {
        case .ticketChecked, .checkedAtTransfer: true
        case .unknown: nil
        default: false
        }
    }
}
