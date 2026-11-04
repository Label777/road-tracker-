import SwiftUI
import RoadTrackerCore

/// Ручной режим записи. Этапы маршрута, стоимость и контролёры добавляются на этапе 2,
/// карта и GPS — на этапе 3.
struct ActiveTripView: View {
    @Environment(TrackingCoordinator.self) private var tracking
    @State private var direction: TripDirection = .toWork
    @State private var confirmCancel = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 20) {
                if let session = tracking.activeSession {
                    recording(session)
                } else {
                    idle
                }
                if let error = tracking.lastError {
                    Text(error).font(.footnote).foregroundStyle(Theme.danger)
                }
                Spacer()
            }
            .padding(16)
            .frame(maxWidth: .infinity)
            .background(Theme.background)
            .navigationTitle("Поездка")
        }
    }

    private var idle: some View {
        VStack(spacing: 16) {
            Picker("Направление", selection: $direction) {
                ForEach(TripDirection.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            StartTripButton(session: nil) {
                tracking.send(.userStart(direction: direction, mode: .manual, at: .now))
            }
        }
    }

    private func recording(_ session: TripSession) -> some View {
        VStack(spacing: 16) {
            Card(title: LocalizedStringKey(session.direction.title)) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    Text(Format.duration(session.activeDuration(at: context.date)))
                        .font(.system(size: 48, weight: .bold, design: .rounded).monospacedDigit())
                        .foregroundStyle(session.isPaused ? Theme.textSecondary : Theme.accent)
                }
                Text("Начало: \(session.startedAt.formatted(date: .omitted, time: .shortened))")
                    .foregroundStyle(Theme.textSecondary)
                if session.isPaused {
                    Label("На паузе — время не идёт", systemImage: "pause.circle")
                        .foregroundStyle(Theme.warning)
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
    }
}
