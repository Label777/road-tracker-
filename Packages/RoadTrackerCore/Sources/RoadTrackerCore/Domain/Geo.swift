import Foundation

/// Координата без зависимости от CoreLocation (ядро тестируется на Linux).
public struct GeoPoint: Hashable, Codable, Sendable {
    public var latitude: Double
    public var longitude: Double
    public init(latitude: Double, longitude: Double) {
        self.latitude = latitude
        self.longitude = longitude
    }
}

/// Отметка GPS. accuracy — горизонтальная точность, м (отрицательная = невалидная, как в CoreLocation).
public struct TrackSample: Hashable, Codable, Sendable {
    public var point: GeoPoint
    public var timestamp: Date
    public var horizontalAccuracy: Double
    /// м/с, отрицательная — неизвестна.
    public var speed: Double

    public init(point: GeoPoint, timestamp: Date, horizontalAccuracy: Double, speed: Double = -1) {
        self.point = point
        self.timestamp = timestamp
        self.horizontalAccuracy = horizontalAccuracy
        self.speed = speed
    }
}

public enum GeoMath {
    static let earthRadius = 6_371_008.8

    /// Расстояние по формуле гаверсинусов, метры.
    public static func distance(_ a: GeoPoint, _ b: GeoPoint) -> Double {
        let lat1 = a.latitude * .pi / 180, lat2 = b.latitude * .pi / 180
        let dLat = lat2 - lat1
        let dLon = (b.longitude - a.longitude) * .pi / 180
        let h = sin(dLat / 2) * sin(dLat / 2) + cos(lat1) * cos(lat2) * sin(dLon / 2) * sin(dLon / 2)
        return 2 * earthRadius * asin(min(1, sqrt(h)))
    }

    public static func isInside(_ point: GeoPoint, center: GeoPoint, radius: Double) -> Bool {
        distance(point, center) <= radius
    }
}

/// Фильтрация трека и расчёт пройденного расстояния.
/// Отбрасывает неточные отметки и физически невозможные скачки, не накапливает «дрожание» GPS на месте.
public struct TrackProcessor: Sendable {
    public var maxAccuracy: Double = 50          // м
    public var maxPlausibleSpeed: Double = 70    // м/с ≈ 250 км/ч (электричка/авто с запасом)
    public var minStep: Double = 8               // м — меньшие шаги считаем шумом

    public init() {}

    public func filter(_ samples: [TrackSample]) -> [TrackSample] {
        var accepted: [TrackSample] = []
        for s in samples.sorted(by: { $0.timestamp < $1.timestamp }) {
            guard s.horizontalAccuracy >= 0, s.horizontalAccuracy <= maxAccuracy else { continue }
            if let last = accepted.last {
                let dt = s.timestamp.timeIntervalSince(last.timestamp)
                guard dt > 0 else { continue }
                let d = GeoMath.distance(last.point, s.point)
                if d / dt > maxPlausibleSpeed { continue }
            }
            accepted.append(s)
        }
        return accepted
    }

    /// Дистанция по отфильтрованному треку. Шаг засчитывается, только если он больше
    /// шума (max(minStep, средняя точность пары)) — иначе стояние на месте «набегает» километрами.
    public func distance(of samples: [TrackSample]) -> Double {
        let clean = filter(samples)
        guard var anchor = clean.first else { return 0 }
        var total = 0.0
        for s in clean.dropFirst() {
            let d = GeoMath.distance(anchor.point, s.point)
            let noise = max(minStep, (anchor.horizontalAccuracy + s.horizontalAccuracy) / 2)
            if d >= noise {
                total += d
                anchor = s
            }
        }
        return total
    }
}

/// Остановка во время поездки (ожидание транспорта, пробка, пересадка).
public struct DetectedStop: Hashable, Sendable {
    public var center: GeoPoint
    public var interval: DateInterval
}

public struct StopDetector: Sendable {
    public var radius: Double = 40               // м
    public var minDuration: TimeInterval = 90    // с

    public init() {}

    /// Кластеризация по времени: последовательные отметки в пределах `radius` от первой отметки кластера.
    public func stops(in samples: [TrackSample]) -> [DetectedStop] {
        let sorted = samples.sorted { $0.timestamp < $1.timestamp }
        var result: [DetectedStop] = []
        var i = 0
        while i < sorted.count {
            let anchor = sorted[i]
            var j = i + 1
            while j < sorted.count, GeoMath.distance(anchor.point, sorted[j].point) <= radius { j += 1 }
            let last = sorted[j - 1]
            let duration = last.timestamp.timeIntervalSince(anchor.timestamp)
            if duration >= minDuration {
                let cluster = sorted[i..<j]
                let lat = cluster.map(\.point.latitude).reduce(0, +) / Double(cluster.count)
                let lon = cluster.map(\.point.longitude).reduce(0, +) / Double(cluster.count)
                result.append(DetectedStop(center: GeoPoint(latitude: lat, longitude: lon),
                                           interval: DateInterval(start: anchor.timestamp, end: last.timestamp)))
                i = j
            } else {
                i += 1
            }
        }
        return result
    }
}

/// Адаптивная частота GPS: точнее при движении, экономнее на остановках и при низком заряде.
/// Значения переводятся в CLLocationManager.desiredAccuracy / distanceFilter в приложении.
public struct GPSPolicy: Equatable, Sendable {
    public enum Accuracy: Sendable, Equatable { case best, nearestTenMeters, hundredMeters }
    public var accuracy: Accuracy
    public var distanceFilter: Double

    public static func recommended(speed: Double, isStationary: Bool, lowPowerMode: Bool, batteryLevel: Double?) -> GPSPolicy {
        let lowBattery = (batteryLevel ?? 1) < 0.2
        if isStationary {
            return GPSPolicy(accuracy: .hundredMeters, distanceFilter: 50)
        }
        if lowPowerMode || lowBattery {
            return GPSPolicy(accuracy: .hundredMeters, distanceFilter: 100)
        }
        switch speed {
        case ..<0:   return GPSPolicy(accuracy: .nearestTenMeters, distanceFilter: 25)   // скорость неизвестна
        case ..<2.5: return GPSPolicy(accuracy: .nearestTenMeters, distanceFilter: 15)   // пешком
        case ..<15:  return GPSPolicy(accuracy: .nearestTenMeters, distanceFilter: 40)   // город
        default:     return GPSPolicy(accuracy: .best, distanceFilter: 100)              // метро/электричка/трасса
        }
    }
}
