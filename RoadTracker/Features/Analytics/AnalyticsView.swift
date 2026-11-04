import SwiftUI
import SwiftData
import Charts
import RoadTrackerCore

/// Базовая финансовая аналитика на протестированном ядре. Полный набор графиков,
/// аналитика маршрутов и контролёров — этап 4.
struct AnalyticsView: View {
    enum Period: String, CaseIterable, Identifiable {
        case week, month, year
        var id: Self { self }
        var title: LocalizedStringKey {
            switch self { case .week: "Неделя"; case .month: "Месяц"; case .year: "Год" }
        }
        var component: Calendar.Component {
            switch self { case .week: .weekOfYear; case .month: .month; case .year: .year }
        }
    }

    @Query(filter: #Predicate<TripRecord> { $0.deletedAt == nil })
    private var trips: [TripRecord]
    @State private var period: Period = .month

    private var analytics: SpendingAnalytics {
        SpendingAnalytics(trips: trips.filter { $0.status == .completed }.map(\.summary))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.spacing) {
                    Picker("Период", selection: $period) {
                        ForEach(Period.allCases) { Text($0.title).tag($0) }
                    }
                    .pickerStyle(.segmented)

                    let interval = analytics.interval(for: period.component, containing: .now)
                    let totals = analytics.totals(in: interval)

                    Card(title: "Расходы") {
                        HStack {
                            Metric(value: totals.cost.formatted, label: "всего")
                            Metric(value: analytics.averageCommuteDayCost(in: interval)?.formatted ?? "—",
                                   label: "в среднем за день")
                        }
                        if period != .year {
                            chart(interval)
                        }
                    }

                    directionCard(interval)
                    transportCard(interval)
                    forecastCard
                    SavingsCalculatorCard()
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Аналитика")
        }
    }

    private func chart(_ interval: DateInterval) -> some View {
        let series = analytics.dailySeries(in: interval)
        return Chart(series, id: \.day) { point in
            BarMark(x: .value("День", point.day, unit: .day),
                    y: .value("₴", Double(point.cost.minorUnits) / 100))
                .foregroundStyle(Theme.accent)
                .cornerRadius(3)
        }
        .chartYAxis { AxisMarks(position: .leading) }
        .frame(height: 160)
    }

    private func directionCard(_ interval: DateInterval) -> some View {
        let byDirection = analytics.costByDirection(in: interval)
        return Card(title: "По направлению") {
            HStack {
                Metric(value: (byDirection[.toWork] ?? .zero).formatted, label: "на работу")
                Metric(value: (byDirection[.toHome] ?? .zero).formatted, label: "домой")
            }
        }
    }

    private func transportCard(_ interval: DateInterval) -> some View {
        let byTransport = analytics.costByTransport(in: interval).sorted { $0.value > $1.value }
        return Card(title: "По видам транспорта") {
            if byTransport.isEmpty {
                Text("Нет данных за период").foregroundStyle(Theme.textSecondary)
            }
            ForEach(byTransport, id: \.key) { item in
                HStack {
                    Label(item.key.title, systemImage: item.key.symbolName)
                    Spacer()
                    Text(item.value.formatted).monospacedDigit()
                }
            }
        }
    }

    private var forecastCard: some View {
        let month = analytics.forecast(for: .month, now: .now)
        let year = analytics.forecast(for: .year, now: .now)
        return Card(title: "Прогноз") {
            if let month, let year {
                HStack {
                    Metric(value: month.projected.formatted, label: "до конца месяца")
                    Metric(value: year.projected.formatted, label: "до конца года")
                }
                Text("Основан на \(month.basedOnDays) днях поездок за последние 8 недель: \(month.averagePerCommuteDay.formatted) в день, поездки в \(Int((month.commuteDayRate * 100).rounded())) % будних дней.")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                Text("Прогноз появится после 5 дней с поездками — иначе он был бы случайным.")
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }
}

/// «Деньги против времени»: сколько стоит каждая сэкономленная минута.
struct SavingsCalculatorCard: View {
    @State private var aMinutes = 35.0
    @State private var aCost = "30"
    @State private var bMinutes = 50.0
    @State private var bCost = "18"
    @State private var tripsPerMonth = 44

    var body: some View {
        Card(title: "Калькулятор экономии") {
            routeRow("Маршрут А", minutes: $aMinutes, cost: $aCost)
            routeRow("Маршрут Б", minutes: $bMinutes, cost: $bCost)
            Stepper("Поездок в месяц: \(tripsPerMonth)", value: $tripsPerMonth, in: 1...120)
            Divider()
            result
        }
    }

    private func routeRow(_ title: LocalizedStringKey, minutes: Binding<Double>, cost: Binding<String>) -> some View {
        HStack {
            Text(title).frame(width: 90, alignment: .leading)
            Stepper("\(Int(minutes.wrappedValue)) мин", value: minutes, in: 1...240, step: 5)
            TextField("₴", text: cost)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(width: 64)
        }
    }

    @ViewBuilder private var result: some View {
        if let a = Money(parsing: aCost), let b = Money(parsing: bCost) {
            let r = SavingsComparison.compare(RouteOption(name: "А", minutes: aMinutes, cost: a),
                                              RouteOption(name: "Б", minutes: bMinutes, cost: b))
            switch r.verdict {
            case .identical:
                Text("Маршруты равноценны.")
            case .dominates(let winner):
                Text("Маршрут \(winner) и не дороже, и не медленнее — выбор очевиден.")
            case .tradeOff:
                let month = r.projected(trips: tripsPerMonth)
                VStack(alignment: .leading, spacing: 6) {
                    Text("Маршрут \(r.cheaperName) экономит \(r.moneySaved.formatted), но дольше на \(Int(r.minutesLost)) мин.")
                    Text("Минута стоит \(r.costPerMinute?.formatted ?? "—")")
                        .font(.headline).foregroundStyle(Theme.accent)
                    Text("За месяц: \(month.money.formatted) экономии и \(month.hours.formatted(.number.precision(.fractionLength(1)))) ч в дороге дополнительно.")
                        .font(.footnote).foregroundStyle(Theme.textSecondary)
                }
            }
        } else {
            Text("Введите стоимость обоих маршрутов.").foregroundStyle(Theme.textSecondary)
        }
    }
}
