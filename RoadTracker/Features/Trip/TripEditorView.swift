import SwiftUI
import SwiftData
import RoadTrackerCore

/// Создание и редактирование поездки целиком: время, направление, этапы, стоимость, контролёры.
/// Также используется для проверки и исправления автоматически обнаруженных поездок.
struct TripEditorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.tripStore) private var store
    @Query(filter: #Predicate<RouteRecord> { $0.deletedAt == nil }, sort: \RouteRecord.name)
    private var routes: [RouteRecord]

    private let original: TripRecord?
    @State private var draft: TripDraft
    @State private var error: String?
    @State private var confirmDelete = false

    init(trip: TripRecord? = nil, template: RouteRecord? = nil) {
        original = trip
        if let trip {
            _draft = State(initialValue: TripDraft(trip))
        } else if let template {
            _draft = State(initialValue: TripDraft(route: template))
        } else {
            _draft = State(initialValue: TripDraft())
        }
    }

    private var issues: [TripValidation.Issue] { draft.issues() }
    private var canSave: Bool { !issues.contains(where: \.isBlocking) }
    private var isSuggested: Bool { original?.status == .suggested }

    var body: some View {
        Form {
            if isSuggested {
                Section {
                    Label("Поездка обнаружена автоматически по геозонам. Проверьте время и сохраните — или удалите, если поездки не было.",
                          systemImage: "sparkles")
                        .font(.footnote)
                        .foregroundStyle(Theme.warning)
                }
            }

            Section {
                Picker("Направление", selection: $draft.direction) {
                    ForEach(TripDirection.allCases, id: \.self) { Label($0.title, systemImage: $0.symbolName).tag($0) }
                }
                DatePicker("Начало", selection: $draft.startedAt)
                DatePicker("Окончание", selection: $draft.finishedAt)
                LabeledContent("В пути", value: Format.duration(max(0, draft.finishedAt.timeIntervalSince(draft.startedAt))))
            }

            if !routes.isEmpty {
                Section {
                    Picker("Шаблон маршрута", selection: $draft.routeID) {
                        Text("Без шаблона").tag(UUID?.none)
                        ForEach(routes) { Text($0.name).tag(UUID?.some($0.id)) }
                    }
                    if draft.segments.isEmpty, let route = routes.first(where: { $0.id == draft.routeID }) {
                        Button("Заполнить этапы из шаблона") {
                            draft.segments = route.templateSegments.map(SegmentDraft.init(template:))
                            draft.direction = route.direction
                        }
                    }
                }
            }

            Section {
                ForEach($draft.segments) { $segment in
                    NavigationLink {
                        SegmentEditorView(segment: $segment, tripStart: draft.startedAt)
                    } label: {
                        SegmentRow(segment: segment)
                    }
                }
                .onDelete { draft.segments.remove(atOffsets: $0) }
                .onMove { draft.segments.move(fromOffsets: $0, toOffset: $1) }
                Button {
                    var next = SegmentDraft(transport: draft.segments.last?.transport == .metro ? .walk : .minibus)
                    next.startedAt = draft.segments.last?.finishedAt
                    draft.segments.append(next)
                } label: {
                    Label("Добавить этап", systemImage: "plus.circle.fill")
                }
            } header: {
                HStack {
                    Text("Этапы маршрута")
                    Spacer()
                    if draft.segments.count > 1 { EditButton().font(.footnote) }
                }
            } footer: {
                Text("Например: маршрутка №720 → метро. Пересадок: \(max(0, draft.segments.filter { $0.transport != .walk }.count - 1)).")
            }

            Section("Стоимость") {
                MoneyField(title: "Без разбивки по этапам", value: $draft.extraCost)
                LabeledContent("Итого", value: draft.totalCost.formatted)
                    .font(.headline)
            }

            if draft.segments.isEmpty {
                Section("Контролёр") {
                    InspectionEditor(inspection: $draft.tripInspection, defaultTime: draft.startedAt)
                }
            }

            Section("Комментарий") {
                TextField("Например: пробка на мосту", text: $draft.comment, axis: .vertical)
                    .lineLimit(1...4)
            }

            if !issues.isEmpty {
                Section {
                    ForEach(Array(issues.enumerated()), id: \.offset) { _, issue in
                        Label(issue.message, systemImage: issue.isBlocking ? "xmark.octagon" : "exclamationmark.triangle")
                            .foregroundStyle(issue.isBlocking ? Theme.danger : Theme.warning)
                            .font(.footnote)
                    }
                }
            }

            if original != nil {
                Section {
                    Button("Удалить поездку", role: .destructive) { confirmDelete = true }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Theme.background)
        .navigationTitle(original == nil ? "Новая поездка" : "Поездка")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(isSuggested ? "Подтвердить" : "Сохранить", action: save).disabled(!canSave)
            }
        }
        .confirmationDialog("Удалить поездку?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Удалить", role: .destructive) {
                guard let original else { return }
                perform { try store?.delete(original) }
            }
        }
        .alert("Не удалось сохранить", isPresented: Binding(get: { error != nil }, set: { if !$0 { error = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(error ?? "")
        }
    }

    private func save() {
        perform { try store?.save(draft) }
    }

    private func perform(_ action: () throws -> Void) {
        do {
            try action()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}

struct SegmentRow: View {
    let segment: SegmentDraft

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: segment.transport.symbolName)
                .frame(width: 28)
                .foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(segment.title)
                if let start = segment.startedAt {
                    Text(timeRange(start, segment.finishedAt))
                        .font(.caption)
                        .foregroundStyle(Theme.textSecondary)
                }
            }
            Spacer()
            if let inspection = segment.inspection, inspection.outcome.controllerPresent == true {
                Image(systemName: "person.badge.shield.checkmark")
                    .foregroundStyle(Theme.warning)
                    .accessibilityLabel(inspection.outcome.title)
            }
            Text(segment.cost.formatted).monospacedDigit()
        }
    }

    private func timeRange(_ a: Date, _ b: Date?) -> String {
        let f = Date.FormatStyle(date: .omitted, time: .shortened)
        return b.map { "\(a.formatted(f)) – \($0.formatted(f))" } ?? a.formatted(f)
    }
}
