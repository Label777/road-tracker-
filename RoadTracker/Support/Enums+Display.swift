import Foundation
import RoadTrackerCore

// Локализованные подписи живут в приложении (String Catalog), ядро остаётся без UI-строк.
// Для украинского и английского достаточно добавить языки в Localizable.xcstrings.

extension TripDirection {
    var title: String {
        switch self {
        case .toWork: String(localized: "На работу")
        case .toHome: String(localized: "Домой")
        case .other:  String(localized: "Другое")
        }
    }
    var symbolName: String {
        switch self {
        case .toWork: "briefcase.fill"
        case .toHome: "house.fill"
        case .other:  "mappin.and.ellipse"
        }
    }
}

extension TransportType {
    var title: String {
        switch self {
        case .walk:       String(localized: "Пешком")
        case .bus:        String(localized: "Автобус")
        case .minibus:    String(localized: "Маршрутка")
        case .trolleybus: String(localized: "Троллейбус")
        case .tram:       String(localized: "Трамвай")
        case .metro:      String(localized: "Метро")
        case .train:      String(localized: "Электричка")
        case .taxi:       String(localized: "Такси")
        case .car:        String(localized: "Авто")
        case .bicycle:    String(localized: "Велосипед")
        case .scooter:    String(localized: "Самокат")
        case .other:      String(localized: "Другое")
        }
    }
}

extension InspectionOutcome {
    var title: String {
        switch self {
        case .noController:      String(localized: "Контролёра не было")
        case .presentNotChecked: String(localized: "Был, но не проверял")
        case .ticketChecked:     String(localized: "Билет проверили")
        case .checkedAtTransfer: String(localized: "Проверка на пересадке")
        case .unknown:           String(localized: "Неизвестно")
        }
    }
}

extension TripStatus {
    var title: String {
        switch self {
        case .suggested: String(localized: "Не подтверждена")
        case .active:    String(localized: "Идёт запись")
        case .paused:    String(localized: "На паузе")
        case .completed: String(localized: "Завершена")
        case .discarded: String(localized: "Отклонена")
        }
    }
}

extension Reliability {
    var title: String {
        switch self {
        case .insufficient: String(localized: "Недостаточно данных")
        case .low:          String(localized: "Низкая достоверность")
        case .moderate:     String(localized: "Умеренная достоверность")
        case .good:         String(localized: "Хорошая достоверность")
        }
    }
}
