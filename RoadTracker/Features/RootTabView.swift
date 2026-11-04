import SwiftUI

struct RootTabView: View {
    enum Tab: Hashable { case home, trip, history, analytics, profile }
    @State private var selection: Tab = .home

    var body: some View {
        TabView(selection: $selection) {
            DashboardView(openTrip: { selection = .trip })
                .tabItem { Label("Главная", systemImage: "gauge.with.dots.needle.33percent") }
                .tag(Tab.home)
            ActiveTripView()
                .tabItem { Label("Поездка", systemImage: "location.north.circle.fill") }
                .tag(Tab.trip)
            HistoryView()
                .tabItem { Label("История", systemImage: "calendar") }
                .tag(Tab.history)
            AnalyticsView()
                .tabItem { Label("Аналитика", systemImage: "chart.xyaxis.line") }
                .tag(Tab.analytics)
            ProfileView()
                .tabItem { Label("Профиль", systemImage: "person.crop.circle") }
                .tag(Tab.profile)
        }
        .toolbarBackground(Theme.surface, for: .tabBar)
        .toolbarBackground(.visible, for: .tabBar)
    }
}
