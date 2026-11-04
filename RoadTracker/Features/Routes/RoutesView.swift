import SwiftUI
import SwiftData
import RoadTrackerCore

/// Шаблоны маршрутов: «Дом → маршрутка №720 → метро → Работа».
/// Ускоряют запись поездки и позволяют сравнивать маршруты в аналитике.
struct RoutesView: View {
    @Environment(\.tripStore) private var store
    @Query(filter: #Predicate<RouteRecord> { $0.deletedAt == nil }, sort: \RouteRecord.name)
    private var routes: [RouteRecord]

    var body: some View {
        List {
            ForEach(routes) { route in
                NavigationLink { RouteEditorView(route: route) } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(route.name)
                        Text("\(route.direction.title) · \(route.templateSegments.count) этап. · \(route.typicalCost.formatted)")
                            .font(.caption)
                            .foregroundStyle(Theme.textSecondary)
                    }
                }
            }
            .onDelete { offsets in
                for i in offsets { try? store?.delete(routes[i]) }
            }
            NavigationLink { RouteEditorView(route: nil) } label: {
                Label("Новый маршрут", systemImage: "plus.circle.fill")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle("Маршруты")
    }
}

struct RouteEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tripStore) private var store
    @Query(filter: #Predicate<PlaceRecord> { $0.deletedAt == nil }, sort: \PlaceRecord.name)
    private var places: [PlaceRecord]
    @State private var draft: RouteDraft
    @State private var message: String?
    private let isNew: Bool

    init(route: RouteRecord?) {
        _draft = State(initialValue: route.map(RouteDraft.init) ?? RouteDraft())
        isNew = route == nil
    }

    var body: some View {
        Form {
            Section {
                TextField("Название (например, «Утро: 720 + метро»)", text: $draft.name)
                Picker("Направление", selection: $draft.direction) {
                    ForEach(TripDirection.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                placePicker("Откуда", selection: $draft.originID)
                placePicker("Куда", selection: $draft.destinationID)
            }
            Section {
                ForEach($draft.segments) { $segment in
                    VStack(alignment: .leading, spacing: 8) {
                        TransportPicker(selection: $segment.transport)
                        HStack {
                            TextField("№", text: $segment.number).frame(maxWidth: 90)
                            Divider()
                            MoneyField(title: "Цена", value: $segment.cost)
                        }
                    }
                }
                .onDelete { draft.segments.remove(atOffsets: $0) }
                .onMove { draft.segments.move(fromOffsets: $0, toOffset: $1) }
                Button { draft.segments.append(SegmentDraft()) } label: {
                    Label("Добавить этап", systemImage: "plus.circle.fill")
                }
                .disabled(draft.segments.count >= 12)
            } header: {
                HStack {
                    Text("Этапы")
                    Spacer()
                    if draft.segments.count > 1 { EditButton().font(.footnote) }
                }
            } footer: {
                Text("Типичная стоимость: \(draft.segments.map(\.cost).sum().formatted). При записи поездки её можно изменить.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(isNew ? "Новый маршрут" : draft.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Сохранить") {
                    do {
                        try store?.save(draft)
                        dismiss()
                    } catch {
                        message = error.localizedDescription
                    }
                }
                .disabled(!draft.isValid)
            }
        }
        .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
            Button("OK", role: .cancel) {}
        }
    }

    private func placePicker(_ title: LocalizedStringKey, selection: Binding<UUID?>) -> some View {
        Picker(title, selection: selection) {
            Text("Не указано").tag(UUID?.none)
            ForEach(places) { Label($0.name, systemImage: $0.kind.symbolName).tag(UUID?.some($0.id)) }
        }
    }
}
