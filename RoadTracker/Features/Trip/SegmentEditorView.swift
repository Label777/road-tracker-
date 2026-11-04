import SwiftUI
import RoadTrackerCore

/// Один этап маршрута: транспорт, номер, время, стоимость, расстояние, контролёр.
struct SegmentEditorView: View {
    @Binding var segment: SegmentDraft
    let tripStart: Date

    var body: some View {
        Form {
            Section {
                TransportPicker(selection: $segment.transport)
                TextField("Номер маршрута (например, 720)", text: $segment.number)
                TextField("Название линии или направление", text: $segment.routeName)
            }
            Section("Время") {
                OptionalDatePicker(title: "Отправление", date: $segment.startedAt, fallback: tripStart)
                OptionalDatePicker(title: "Прибытие", date: $segment.finishedAt,
                                   fallback: segment.startedAt ?? tripStart)
            }
            Section("Стоимость и расстояние") {
                MoneyField(title: "Стоимость", value: $segment.cost)
                HStack {
                    TextField("Расстояние", value: distanceKm, format: .number.precision(.fractionLength(0...1)))
                        .keyboardType(.decimalPad)
                    Text("км").foregroundStyle(Theme.textSecondary)
                }
            }
            if segment.transport.hasTicketInspection {
                Section {
                    InspectionEditor(inspection: $segment.inspection,
                                     defaultTime: segment.startedAt ?? tripStart)
                } header: {
                    Text("Контролёр")
                } footer: {
                    Text("Отмечайте и поездки без контролёра — иначе статистика будет завышена.")
                }
            }
            Section("Комментарий") {
                TextField("Комментарий", text: $segment.comment, axis: .vertical)
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(segment.title)
        .navigationBarTitleDisplayMode(.inline)
    }

    private var distanceKm: Binding<Double?> {
        Binding(
            get: { segment.distanceMeters.map { Double($0) / 1000 } },
            set: { segment.distanceMeters = $0.map { Int(($0 * 1000).rounded()) } })
    }
}

/// Наблюдение контролёра: пять вариантов из ТЗ + время + комментарий.
struct InspectionEditor: View {
    @Binding var inspection: InspectionDraft?
    let defaultTime: Date

    var body: some View {
        Toggle("Отметить наблюдение", isOn: Binding(
            get: { inspection != nil },
            set: { inspection = $0 ? (inspection ?? InspectionDraft(observedAt: defaultTime)) : nil }))
        if let current = inspection {
            Picker("Что было", selection: Binding(
                get: { current.outcome },
                set: { inspection?.outcome = $0 })) {
                ForEach(InspectionOutcome.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.inline)
            .labelsHidden()
            if current.outcome != .noController {
                DatePicker("Время", selection: Binding(
                    get: { current.observedAt },
                    set: { inspection?.observedAt = $0 }), displayedComponents: .hourAndMinute)
                TextField("Где (станция, остановка)", text: Binding(
                    get: { current.comment },
                    set: { inspection?.comment = $0 }))
            }
        }
    }
}
