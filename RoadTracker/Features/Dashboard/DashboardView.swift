import SwiftUI
import SwiftData
import RoadTrackerCore

struct DashboardView: View {
    var openTrip: () -> Void

    @Environment(TrackingCoordinator.self) private var tracking
    @Query(filter: #Predicate<TripRecord> { $0.deletedAt == nil },
           sort: \TripRecord.startedAt, order: .reverse)
    private var trips: [TripRecord]

    private var analytics: SpendingAnalytics {
        SpendingAnalytics(trips: trips.filter { $0.status == .completed }.map(\.summary))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: Theme.spacing) {
                    StartTripButton(session: tracking.activeSession) {
                        if tracking.activeSession == nil {
                            tracking.send(.userStart(direction: suggestedDirection, mode: .manual, at: .now))
                        }
                        openTrip()
                    }
                    todayCard
                    monthCard
                    recentCard
                }
                .padding(16)
            }
            .background(Theme.background)
            .navigationTitle("Road Tracker")
        }
    }

    /// До 14:00 обычно едут на работу, после — домой. Пользователь может поменять направление в поездке.
    private var suggestedDirection: TripDirection {
        Calendar.current.component(.hour, from: .now) < 14 ? .toWork : .toHome
    }

    private var todayCard: some View {
        let t = analytics.totals(in: analytics.interval(for: .day, containing: .now))
        return Card(title: "Сегодня") {
            HStack {
                Metric(value: Format.duration(t.activeSeconds), label: "в пути")
                Metric(value: t.cost.formatted, label: "потрачено")
            }
            HStack {
                Metric(value: "\(t.trips)", label: "поездок")
                Metric(value: "\(t.transfers)", label: "пересадок")
            }
            if !t.transports.isEmpty {
                HStack(spacing: 8) {
                    ForEach(t.transports.sorted { $0.rawValue < $1.rawValue }, id: \.self) { type in
                        Image(systemName: type.symbolName)
                            .accessibilityLabel(type.title)
                    }
                }
                .foregroundStyle(Theme.accent)
            }
        }
    }

    private var monthCard: some View {
        let cmp = analytics.monthComparison(containing: .now)
        let m = cmp.current
        return Card(title: "Этот месяц") {
            HStack {
                Metric(value: m.cost.formatted, label: "расходы")
                Metric(value: Format.hours(m.activeSeconds), label: "в дороге")
            }
            HStack {
                Metric(value: m.averageTripSeconds.map(Format.duration) ?? "—", label: "средняя поездка")
                Metric(value: m.averageTripCost?.formatted ?? "—", label: "средняя стоимость")
            }
            if let change = Format.percentChange(cmp.costChange) {
                Text("Расходы к прошлому месяцу: \(change)")
                    .font(.footnote)
                    .foregroundStyle(Theme.textSecondary)
            }
        }
    }

    private var recentCard: some View {
        Card(title: "Последние поездки") {
            if trips.isEmpty {
                Text("Пока нет поездок. Нажмите «Начать поездку» — или добавьте её вручную во вкладке «История» (кнопка «+»).")
                    .font(.subheadline)
                    .foregroundStyle(Theme.textSecondary)
            } else {
                ForEach(trips.prefix(5)) { trip in
                    NavigationLink { TripEditorView(trip: trip) } label: { TripRow(trip: trip) }
                        .buttonStyle(.plain)
                }
            }
        }
    }
}

struct StartTripButton: View {
    let session: TripSession?
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: session == nil ? "play.fill" : "record.circle")
                    .font(.title2.weight(.bold))
                    .symbolEffect(.pulse, isActive: session != nil)
                VStack(alignment: .leading, spacing: 2) {
                    Text(session == nil ? "Начать поездку" : "Идёт запись поездки")
                        .font(.title3.weight(.bold))
                    if let session {
                        Text(session.startedAt, style: .timer)
                            .font(.subheadline.monospacedDigit())
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.headline)
            }
            .foregroundStyle(Theme.background)
            .padding(.horizontal, 20)
            .frame(maxWidth: .infinity, minHeight: 84)
            .background(Theme.accent, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
        .sensoryFeedback(.impact, trigger: session?.tripID)
    }
}

struct TripRow: View {
    let trip: TripRecord

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: trip.direction.symbolName)
                .frame(width: 32, height: 32)
                .background(Theme.accentDim, in: Circle())
                .foregroundStyle(Theme.accent)
            VStack(alignment: .leading, spacing: 2) {
                Text(trip.direction.title).font(.subheadline.weight(.semibold))
                Text(trip.startedAt.formatted(date: .abbreviated, time: .shortened))
                    .font(.caption)
                    .foregroundStyle(Theme.textSecondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 2) {
                Text(trip.totalCost.formatted).font(.subheadline.monospacedDigit())
                Text(trip.status == .completed ? Format.duration(trip.activeSeconds) : trip.status.title)
                    .font(.caption)
                    .foregroundStyle(trip.status == .suggested ? Theme.warning : Theme.textSecondary)
            }
        }
        .padding(.vertical, 4)
    }
}
