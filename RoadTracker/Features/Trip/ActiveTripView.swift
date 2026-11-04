import SwiftUI
import SwiftData
import RoadTrackerCore

/// Запись поездки вручную: старт (свободный или по шаблону), этапы «сел в транспорт»,
/// отметка контролёра, пауза, завершение. Карта и GPS — этап 3.
struct ActiveTripView: View {
    @Environment(TrackingCoordinator.self) private var tracking
    @Query(filter: #Predicate<RouteRecord> { $0.deletedAt == nil }, sort: \RouteRecord.name)
    private var routes: [RouteRecord]
    @State private var direction: TripDirection = Calendar.current.component(.hour, from: .now) < 14 ? .toWork : .toHome

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.spacing) {
                    if let session = tracking.activeSession {
                        LiveTripPanel(session: session)
                    } else {
                        idle
                    }
                    if let error = tracking.lastError {
                        Text(error).font(.footnote).foregroundStyle(Theme.danger)
                    }
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Поездка")
        }
    }

    private var idle: some View {
        VStack(spacing: Theme.spacing) {
            Picker("Направление", selection: $direction) {
                ForEach(TripDirection.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            StartTripButton(session: nil) {
                tracking.send(.userStart(direction: direction, mode: .manual, at: .now))
            }
            if !routes.isEmpty {
                Card(title: "Начать по шаблону") {
                    ForEach(routes) { route in
                        Button {
                            tracking.start(template: route)
                        } label: {
                            HStack {
                                Image(systemName: route.direction.symbolName).foregroundStyle(Theme.accent)
                                VStack(alignment: .leading) {
                                    Text(route.name).foregroundStyle(Theme.textPrimary)
                                    Text(route.templateSegments.map { s in
                                        s.number.map { "\(s.transport.title) \($0)" } ?? s.transport.title
                                    }.joined(separator: " → "))
                                    .font(.caption)
                                    .foregroundStyle(Theme.textSecondary)
                                }
                                Spacer()
                                Text(route.typicalCost.formatted).monospacedDigit().foregroundStyle(Theme.textSecondary)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }
}

/// Панель идущей поездки. Читает запись поездки из базы, чтобы показывать этапы и стоимость.
private struct LiveTripPanel: View {
    let session: TripSession
    @Environment(TrackingCoordinator.self) private var tracking
    @Environment(\.tripStore) private var store
    @Query private var trips: [TripRecord]
    @Query(filter: #Predicate<RouteRecord> { $0.deletedAt == nil }) private var routes: [RouteRecord]
    @State private var showBoarding = false
    @State private var confirmCancel = false

    init(session: TripSession) {
        self.session = session
        let id = session.tripID
        _trips = Query(filter: #Predicate<TripRecord> { $0.id == id })
    }

    private var trip: TripRecord? { trips.first }
    private var template: RouteRecord? { routes.first { $0.id == trip?.routeID } }
    /// Следующий этап шаблона — подсказка в форме «Сел в транспорт».
    private var nextTemplateSegment: RouteTemplateSegment? {
        guard let template, let trip else { return nil }
        let index = trip.liveSegments.count
        return index < template.templateSegments.count ? template.templateSegments[index] : nil
    }

    var body: some View {
        VStack(spacing: Theme.spacing) {
            Card(title: LocalizedStringKey(trip?.direction.title ?? session.direction.title)) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(Format.duration(session.activeDuration(at: context.date)))
                        .font(.system(size: 48, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(session.isPaused ? Theme.textSecondary : Theme.accent)
                }
                HStack {
                    Text("Начало: \(session.startedAt.formatted(date: .omitted, time: .shortened))")
                    Spacer()
                    Text(trip?.totalCost.formatted ?? Money.zero.formatted).monospacedDigit()
                }
                .foregroundStyle(Theme.textSecondary)
                if session.isPaused {
                    Label("На паузе — время не идёт", systemImage: "pause.circle")
                        .foregroundStyle(Theme.warning)
                }
                Menu {
                    ForEach(TripDirection.allCases, id: \.self) { d in
                        Button(d.title) { tracking.perform { try store?.setDirection(tripID: session.tripID, d) } }
                    }
                } label: {
                    Label("Изменить направление", systemImage: "arrow.left.arrow.right").font(.footnote)
                }
            }

            Card(title: "Этапы") {
                if let segments = trip?.liveSegments, !segments.isEmpty {
                    ForEach(segments) { s in
                        SegmentRow(segment: SegmentDraft(s, inspection: trip?.liveInspections.first { $0.segmentID == s.id }))
                    }
                } else {
                    Text("Сели в транспорт — нажмите «Сел в транспорт», чтобы учесть этап и стоимость.")
                        .font(.footnote)
                        .foregroundStyle(Theme.textSecondary)
                }
                HStack(spacing: 10) {
                    Button { showBoarding = true } label: {
                        Label("Сел в транспорт", systemImage: "bus.fill").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                    Menu {
                        ForEach(InspectionOutcome.allCases.filter { $0 != .unknown }, id: \.self) { outcome in
                            Button(outcome.title) {
                                tracking.perform { try store?.recordInspection(tripID: session.tripID, outcome: outcome, at: .now) }
                            }
                        }
                    } label: {
                        Label("Контролёр", systemImage: "person.badge.shield.checkmark")
                            .frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                }
            }

            HStack(spacing: 12) {
                Button {
                    tracking.send(session.isPaused ? .userResume(at: .now) : .userPause(at: .now))
                } label: {
                    Label(session.isPaused ? "Продолжить" : "Пауза",
                          systemImage: session.isPaused ? "play.fill" : "pause.fill")
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.bordered)

                Button {
                    tracking.send(.userFinish(at: .now))
                } label: {
                    Label("Завершить", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity, minHeight: 52)
                }
                .buttonStyle(.borderedProminent)
            }
            Button("Отменить поездку", role: .destructive) { confirmCancel = true }
                .confirmationDialog("Удалить текущую запись?", isPresented: $confirmCancel, titleVisibility: .visible) {
                    Button("Удалить", role: .destructive) { tracking.send(.userCancel) }
                }
        }
        .sheet(isPresented: $showBoarding) {
            BoardingSheet(suggestion: nextTemplateSegment) { transport, number, cost in
                tracking.perform {
                    try store?.appendLiveSegment(tripID: session.tripID, transport: transport,
                                                 number: number, cost: cost, at: .now)
                }
            }
            .presentationDetents([.medium])
        }
    }
}

/// «Сел в транспорт»: вид, номер, стоимость. Предыдущий этап закрывается автоматически.
private struct BoardingSheet: View {
    let suggestion: RouteTemplateSegment?
    let onConfirm: (TransportType, String, Money) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var transport: TransportType
    @State private var number: String
    @State private var cost: Money

    init(suggestion: RouteTemplateSegment?, onConfirm: @escaping (TransportType, String, Money) -> Void) {
        self.suggestion = suggestion
        self.onConfirm = onConfirm
        _transport = State(initialValue: suggestion?.transport ?? .minibus)
        _number = State(initialValue: suggestion?.number ?? "")
        _cost = State(initialValue: Money(minorUnits: suggestion?.cost ?? 0))
    }

    var body: some View {
        NavigationStack {
            Form {
                TransportPicker(selection: $transport)
                TextField("Номер маршрута", text: $number)
                MoneyField(title: "Стоимость", value: $cost)
            }
            .navigationTitle("Новый этап")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Отмена") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Добавить") {
                        onConfirm(transport, number, cost)
                        dismiss()
                    }
                }
            }
        }
    }
}
