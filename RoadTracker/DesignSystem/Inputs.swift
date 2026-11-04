import SwiftUI
import RoadTrackerCore

/// Поле суммы в гривнах. Принимает «30», «30,5», «30.50».
struct MoneyField: View {
    let title: LocalizedStringKey
    @Binding var value: Money
    @State private var text = ""
    @State private var invalid = false

    var body: some View {
        HStack {
            TextField(title, text: $text)
                .keyboardType(.decimalPad)
                .foregroundStyle(invalid ? Theme.danger : Theme.textPrimary)
            Text("₴").foregroundStyle(Theme.textSecondary)
        }
        .onAppear { text = value.editingText }
        .onChange(of: text) { _, newText in
            if let parsed = Money(parsing: newText.isEmpty ? "0" : newText) {
                value = parsed
                invalid = false
            } else {
                invalid = true
            }
        }
    }
}

/// Необязательное время: переключатель + DatePicker.
struct OptionalDatePicker: View {
    let title: LocalizedStringKey
    @Binding var date: Date?
    let fallback: Date

    var body: some View {
        Toggle(title, isOn: Binding(
            get: { date != nil },
            set: { date = $0 ? (date ?? fallback) : nil }))
        if let current = date {
            DatePicker(title, selection: Binding(get: { current }, set: { date = $0 }),
                       displayedComponents: [.date, .hourAndMinute])
                .labelsHidden()
        }
    }
}

struct TransportPicker: View {
    @Binding var selection: TransportType

    var body: some View {
        Picker("Транспорт", selection: $selection) {
            ForEach(TransportType.allCases, id: \.self) { type in
                Label(type.title, systemImage: type.symbolName).tag(type)
            }
        }
    }
}

extension Money {
    /// Для полей ввода: «30», «30,50», пусто для нуля.
    var editingText: String {
        guard minorUnits != 0 else { return "" }
        let whole = minorUnits / 100, frac = abs(minorUnits % 100)
        return frac == 0 ? "\(whole)" : "\(whole)," + (frac < 10 ? "0\(frac)" : "\(frac)")
    }
}
