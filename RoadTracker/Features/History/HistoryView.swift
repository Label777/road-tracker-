import SwiftUI
import SwiftData
import RoadTrackerCore

/// История: неподтверждённые поездки сверху, затем по дням. Календарь и фильтры — этап 2.
struct HistoryView: View {
    @Environment(\.tripStore) private var store
    @Query(filter: #Predicate<TripRecord> { $0.deletedAt == nil },
           sort: \TripRecord.startedAt, order: .reverse)
    private var trips: [TripRecord]
    @State private var showManualEntry = false
    @State private var errorMessage: String?

    private var unconfirmed: [TripRecord] { trips.filter { $0.status == .suggested } }
    private var days: [(day: Date, trips: [TripRecord])] {
        let grouped = Dictionary(grouping: trips.filter { $0.status != .suggested }) {
            TripTiming.calendar(forTimeZoneIdentifier: $0.timeZoneIdentifier).startOfDay(for: $0.startedAt)
        }
        return grouped.keys.sorted(by: >).map { (day: $0, trips: grouped[$0] ?? []) }
    }

    var body: some View {
        NavigationStack {
            List {
                if !unconfirmed.isEmpty {
                    Section {
                        ForEach(unconfirmed) { trip in
                            TripRow(trip: trip)
                                .swipeActions(edge: .leading) {
                                    Button("Подтвердить") { perform { try store?.confirm(trip) } }.tint(Theme.accent)
                                }
                                .swipeActions(edge: .trailing) {
                                    Button("Удалить", role: .destructive) { perform { try store?.delete(trip) } }
                                }
                        }
                    } header: {
                        Text("Обнаружены автоматически — проверьте")
                    } footer: {
                        Text("Свайп вправо — подтвердить, влево — удалить.")
                    }
                }
                ForEach(days, id: \.day) { group in
                    Section {
                        ForEach(group.trips) { trip in
                            TripRow(trip: trip)
                        }
                        .onDelete { offsets in
                            let toDelete = offsets.map { group.trips[$0] }
                            perform { for trip in toDelete { try store?.delete(trip) } }
                        }
                    } header: {
                        DayHeader(day: group.day, trips: group.trips)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .overlay {
                if trips.isEmpty {
                    ContentUnavailableView("Нет поездок", systemImage: "road.lanes",
                                           description: Text("Записанные поездки появятся здесь."))
                }
            }
            .navigationTitle("История")
            .toolbar {
                Button { showManualEntry = true } label: { Label("Добавить", systemImage: "plus") }
            }
            .sheet(isPresented: $showManualEntry) { ManualTripForm() }
            .alert("Ошибка", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(errorMessage ?? "")
            }
        }
    }

    private func perform(_ action: () throws -> Void) {
        do { try action() } catch { errorMessage = error.localizedDescription }
    }
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
            Text("\(Format.duration(seconds)) · \(cost.formatted)")
                .monospacedDigit()
        }
    }
}

/// Быстрый ручной ввод поездки задним числом. Полный редактор этапов — этап 2.
struct ManualTripForm: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tripStore) private var store

    @State private var direction: TripDirection = .toWork
    @State private var start = Date.now.addingTimeInterval(-45 * 60)
    @State private var end = Date.now
    @State private var transport: TransportType = .minibus
    @State private var number = ""
    @State private var costText = ""
    @State private var error: String?

    private var cost: Money? { costText.isEmpty ? .zero : Money(parsing: costText) }

    var body: some View {
        NavigationStack {
            Form {
                Picker("Направление", selection: $direction) {
                    ForEach(TripDirection.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                DatePicker("Начало", selection: $start)
                DatePicker("Окончание", selection: $end, in: start...)
                Section("Транспорт") {
                    Picker("Вид", selection: $transport) {
                        ForEach(TransportType.allCases, id: \.self) { Label($0.title, systemImage: $0.symbolName).tag($0) }
                    }
                    TextField("Номер маршрута (например, 720)", text: $number)
                    TextField("Стоимость, ₴", text: $costText)
                        .keyboardType(.decimalPad)
                    if cost == nil {
                        Text("Введите сумму, например 30 или 30,50").font(.caption).foregroundStyle(Theme.danger)
                    }
                }
                if let error {
                    Text(error).foregroundStyle(Theme.danger)
                }
            }
            .navigationTitle("Новая поездка")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Сохранить", action: save).disabled(cost == nil || end <= start)
                }
            }
        }
    }

    private func save() {
        guard let cost, let store else { return }
        do {
            try store.createManualTrip(direction: direction, start: start, end: end,
                                       segments: [(transport: transport,
                                                   number: number.isEmpty ? nil : number,
                                                   cost: cost)])
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
