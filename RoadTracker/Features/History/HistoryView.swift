import SwiftUI
import SwiftData
import RoadTrackerCore

/// История: календарь месяца с итогами по дням, список с фильтрами,
/// неподтверждённые автопоездки — сверху.
struct HistoryView: View {
    enum Mode: Hashable { case calendar, list }

    @Environment(\.tripStore) private var store
    @Query(filter: #Predicate<TripRecord> { $0.deletedAt == nil },
           sort: \TripRecord.startedAt, order: .reverse)
    private var trips: [TripRecord]
    @Query(filter: #Predicate<RouteRecord> { $0.deletedAt == nil }, sort: \RouteRecord.name)
    private var routes: [RouteRecord]

    @State private var mode: Mode = .calendar
    @State private var month = Date.now
    @State private var selectedDay: Date? = Calendar.current.startOfDay(for: .now)
    @State private var filter = TripFilter()
    @State private var showFilters = false
    @State private var newTrip: NewTripRequest?

    private var calendar: Calendar { TripTiming.calendar(forTimeZoneIdentifier: nil) }
    private var completed: [TripRecord] { trips.filter { $0.status == .completed } }
    private var unconfirmed: [TripRecord] { trips.filter { $0.status == .suggested } }
    private var filtered: [TripRecord] {
        guard filter.isActive else { return completed }
        return completed.filter { filter.matches($0.summary) }
    }

    var body: some View {
        NavigationStack {
            List {
                if !unconfirmed.isEmpty {
                    Section {
                        ForEach(unconfirmed) { trip in
                            NavigationLink { TripEditorView(trip: trip) } label: { TripRow(trip: trip) }
                        }
                    } header: {
                        Text("Обнаружены автоматически — проверьте")
                    }
                }

                Section {
                    Picker("Вид", selection: $mode) {
                        Text("Календарь").tag(Mode.calendar)
                        Text("Список").tag(Mode.list)
                    }
                    .pickerStyle(.segmented)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets())
                }

                switch mode {
                case .calendar: calendarSections
                case .list: listSections
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("История")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button { showFilters = true } label: {
                        Label("Фильтры", systemImage: filter.isActive
                              ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Menu {
                        Button("Пустая поездка") { newTrip = NewTripRequest(template: nil) }
                        if !routes.isEmpty {
                            Section("По шаблону") {
                                ForEach(routes) { r in Button(r.name) { newTrip = NewTripRequest(template: r) } }
                            }
                        }
                    } label: {
                        Label("Добавить", systemImage: "plus")
                    }
                }
            }
            .sheet(isPresented: $showFilters) {
                FilterSheet(filter: $filter, routes: routes)
            }
            .sheet(item: $newTrip) { request in
                NavigationStack {
                    TripEditorView(template: request.template)
                        .toolbar {
                            ToolbarItem(placement: .cancellationAction) { Button("Отмена") { newTrip = nil } }
                        }
                }
            }
        }
    }

    // MARK: Календарь

    @ViewBuilder private var calendarSections: some View {
        let analytics = SpendingAnalytics(trips: filtered.map(\.summary), calendar: calendar)
        let monthInterval = analytics.interval(for: .month, containing: month)
        let daily = analytics.dailyTotals(in: monthInterval)
        let monthTotals = analytics.totals(in: monthInterval)

        Section {
            MonthCalendar(month: $month, selectedDay: $selectedDay, daily: daily, calendar: calendar)
            HStack {
                Metric(value: "\(monthTotals.trips)", label: "поездок")
                Metric(value: Format.hours(monthTotals.activeSeconds), label: "в пути")
                Metric(value: monthTotals.cost.formatted, label: "расходы")
            }
        }

        if let day = selectedDay {
            let dayTrips = filtered.filter { calendar.isDate($0.startedAt, inSameDayAs: day) }
            Section {
                if dayTrips.isEmpty {
                    Text("Поездок нет").foregroundStyle(Theme.textSecondary)
                }
                ForEach(dayTrips) { trip in
                    NavigationLink { TripEditorView(trip: trip) } label: { TripRow(trip: trip) }
                }
                .onDelete { offsets in
                    for i in offsets { try? store?.delete(dayTrips[i]) }
                }
            } header: {
                DayHeader(day: day, trips: dayTrips)
            }
        }
    }

    // MARK: Список

    @ViewBuilder private var listSections: some View {
        let groups = Dictionary(grouping: filtered) { calendar.startOfDay(for: $0.startedAt) }
        if groups.isEmpty {
            Section {
                Text(filter.isActive ? "Нет поездок по выбранным фильтрам." : "Записанные поездки появятся здесь.")
                    .foregroundStyle(Theme.textSecondary)
            }
        }
        ForEach(groups.keys.sorted(by: >), id: \.self) { day in
            let dayTrips = groups[day] ?? []
            Section {
                ForEach(dayTrips) { trip in
                    NavigationLink { TripEditorView(trip: trip) } label: { TripRow(trip: trip) }
                }
                .onDelete { offsets in
                    for i in offsets { try? store?.delete(dayTrips[i]) }
                }
            } header: {
                DayHeader(day: day, trips: dayTrips)
            }
        }
    }
}

struct NewTripRequest: Identifiable {
    let id = UUID()
    let template: RouteRecord?
}

private struct DayHeader: View {
    let day: Date
    let trips: [TripRecord]

    var body: some View {
        let cost = trips.map(\.totalCost).sum()
        let seconds = trips.reduce(0) { $0 + $1.activeSeconds }
        HStack {
            Text(day.formatted(.dateTime.weekday(.wide).day().month(.wide)))
            Spacer()
            Text("\(Format.duration(seconds)) · \(cost.formatted)").monospacedDigit()
        }
    }
}

/// Сетка месяца: в каждой ячейке — число поездок (точки), расходы и отметка контролёров.
private struct MonthCalendar: View {
    @Binding var month: Date
    @Binding var selectedDay: Date?
    let daily: [Date: PeriodTotals]
    let calendar: Calendar

    var body: some View {
        let grid = MonthGrid(containing: month, calendar: calendar)
        VStack(spacing: 6) {
            HStack {
                Button { shift(-1) } label: { Image(systemName: "chevron.left") }
                Spacer()
                Text(grid.monthStart.formatted(.dateTime.month(.wide).year())).font(.headline)
                Spacer()
                Button { shift(1) } label: { Image(systemName: "chevron.right") }
            }
            .buttonStyle(.borderless)
            .padding(.bottom, 4)

            HStack(spacing: 0) {
                ForEach(Array(weekdaySymbols.enumerated()), id: \.offset) { _, s in
                    Text(s).font(.caption2).foregroundStyle(Theme.textSecondary).frame(maxWidth: .infinity)
                }
            }
            ForEach(Array(grid.weeks.enumerated()), id: \.offset) { _, week in
                HStack(spacing: 4) {
                    ForEach(Array(week.enumerated()), id: \.offset) { _, day in
                        if let day {
                            DayCell(day: day, totals: daily[day], isSelected: selectedDay == day,
                                    isToday: calendar.isDateInToday(day))
                                .onTapGesture { selectedDay = day }
                        } else {
                            Color.clear.frame(maxWidth: .infinity, minHeight: 48)
                        }
                    }
                }
            }
        }
    }

    private var weekdaySymbols: [String] {
        let symbols = calendar.veryShortStandaloneWeekdaySymbols
        let first = calendar.firstWeekday - 1
        return Array(symbols[first...] + symbols[..<first])
    }

    private func shift(_ months: Int) {
        if let m = calendar.date(byAdding: .month, value: months, to: month) {
            month = m
            selectedDay = nil
        }
    }
}

private struct DayCell: View {
    let day: Date
    let totals: PeriodTotals?
    let isSelected: Bool
    let isToday: Bool

    var body: some View {
        VStack(spacing: 2) {
            Text(day.formatted(.dateTime.day()))
                .font(.callout.weight(isToday ? .bold : .regular))
                .foregroundStyle(isToday ? Theme.accent : Theme.textPrimary)
            if let totals, totals.trips > 0 {
                HStack(spacing: 2) {
                    ForEach(0..<min(totals.trips, 3), id: \.self) { _ in
                        Circle().fill(Theme.accent).frame(width: 4, height: 4)
                    }
                    if totals.controllers > 0 {
                        Circle().fill(Theme.warning).frame(width: 4, height: 4)
                    }
                }
                Text(totals.cost.minorUnits > 0 ? "\(totals.cost.minorUnits / 100)" : " ")
                    .font(.system(size: 9).monospacedDigit())
                    .foregroundStyle(Theme.textSecondary)
            } else {
                Spacer().frame(height: 15)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 48)
        .background(isSelected ? Theme.accentDim : Color.clear, in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(accessibility)
    }

    private var accessibility: String {
        let date = day.formatted(date: .complete, time: .omitted)
        guard let totals, totals.trips > 0 else { return date }
        return String(localized: "\(date): поездок \(totals.trips), \(Format.duration(totals.activeSeconds)), \(totals.cost.formatted), контролёров \(totals.controllers)")
    }
}

/// Фильтры: дата, направление, транспорт, стоимость, контролёры, маршрут.
private struct FilterSheet: View {
    @Binding var filter: TripFilter
    let routes: [RouteRecord]
    @Environment(\.dismiss) private var dismiss
    @State private var minCost: Money
    @State private var maxCost: Money
    @State private var from: Date
    @State private var to: Date

    init(filter: Binding<TripFilter>, routes: [RouteRecord]) {
        _filter = filter
        self.routes = routes
        let f = filter.wrappedValue
        _minCost = State(initialValue: f.minCost ?? .zero)
        _maxCost = State(initialValue: f.maxCost ?? .zero)
        let cal = Calendar.current
        _from = State(initialValue: f.dateRange?.start ?? cal.date(byAdding: .month, value: -1, to: .now) ?? .now)
        _to = State(initialValue: f.dateRange.flatMap { cal.date(byAdding: .day, value: -1, to: $0.end) } ?? .now)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Период") {
                    Toggle("Ограничить датами", isOn: Binding(
                        get: { filter.dateRange != nil },
                        set: { filter.dateRange = $0 ? range : nil }))
                    if filter.dateRange != nil {
                        DatePicker("С", selection: $from, displayedComponents: .date)
                            .onChange(of: from) { filter.dateRange = range }
                        DatePicker("По", selection: $to, in: from..., displayedComponents: .date)
                            .onChange(of: to) { filter.dateRange = range }
                    }
                }
                Section("Направление") {
                    ForEach(TripDirection.allCases, id: \.self) { d in
                        membershipToggle(d.title, d, in: $filter.directions)
                    }
                }
                Section("Транспорт") {
                    ForEach(TransportType.allCases, id: \.self) { t in
                        membershipToggle(t.title, t, in: $filter.transports)
                    }
                }
                Section("Стоимость поездки") {
                    MoneyField(title: "От", value: $minCost)
                        .onChange(of: minCost) { filter.minCost = minCost.minorUnits > 0 ? minCost : nil }
                    MoneyField(title: "До", value: $maxCost)
                        .onChange(of: maxCost) { filter.maxCost = maxCost.minorUnits > 0 ? maxCost : nil }
                }
                Section("Контролёры") {
                    Picker("Контролёры", selection: $filter.controllers) {
                        Text("Все поездки").tag(TripFilter.Controllers.any)
                        Text("Был контролёр").tag(TripFilter.Controllers.met)
                        Text("Без контролёра").tag(TripFilter.Controllers.notMet)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
                Section("Маршрут") {
                    TextField("Номер маршрута (например, 720)", text: $filter.routeNumber)
                    if !routes.isEmpty {
                        Picker("Шаблон", selection: $filter.routeID) {
                            Text("Любой").tag(UUID?.none)
                            ForEach(routes) { Text($0.name).tag(UUID?.some($0.id)) }
                        }
                    }
                }
            }
            .navigationTitle("Фильтры")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Сбросить") {
                        filter = TripFilter()
                        minCost = .zero
                        maxCost = .zero
                    }
                    .disabled(!filter.isActive)
                }
                ToolbarItem(placement: .confirmationAction) { Button("Готово") { dismiss() } }
            }
        }
    }

    private var range: DateInterval {
        let cal = Calendar.current
        let start = cal.startOfDay(for: from)
        let end = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: max(from, to))) ?? to
        return DateInterval(start: start, end: end)
    }

    /// Переключатель «входит ли значение в множество». Binding — Sendable, поэтому
    /// замыкания не захватывают неизолированное состояние (чисто для Swift 6).
    private func membershipToggle<T: Hashable & Sendable>(_ title: String, _ value: T,
                                                          in set: Binding<Set<T>>) -> some View {
        Toggle(title, isOn: Binding(
            get: { set.wrappedValue.contains(value) },
            set: { on in
                if on { set.wrappedValue.insert(value) } else { set.wrappedValue.remove(value) }
            }))
    }
}
