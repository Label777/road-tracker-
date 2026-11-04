import SwiftUI
import SwiftData

@main
struct RoadTrackerApp: App {
    @Environment(\.scenePhase) private var scenePhase
    @State private var bootstrap = Bootstrap()

    var body: some Scene {
        WindowGroup {
            Group {
                switch bootstrap.result {
                case .success(let env):
                    RootTabView()
                        .environment(env.tracking)
                        .environment(env.sync)
                        .environment(\.tripStore, env.store)
                        .environment(\.isCloudConfigured, env.isCloudConfigured)
                        .modelContainer(env.container)
                        .onChange(of: scenePhase) { _, phase in
                            if phase == .active { env.onBecameActive() }
                        }
                case .failure(let error):
                    StorageErrorView(message: error.localizedDescription)
                }
            }
            .preferredColorScheme(.dark)
            .tint(Theme.accent)
        }
    }
}

/// Ошибка открытия базы показывается явно, а не прячется за пустым экраном.
@MainActor
@Observable
final class Bootstrap {
    let result: Result<AppEnvironment, Error>
    init() {
        result = Result { try AppEnvironment() }
    }
}

private struct StorageErrorView: View {
    let message: String
    var body: some View {
        ContentUnavailableView {
            Label("Не удалось открыть базу данных", systemImage: "externaldrive.badge.exclamationmark")
        } description: {
            Text(message)
        }
        .background(Theme.background)
    }
}

// MARK: - Environment keys

extension EnvironmentValues {
    @Entry var tripStore: TripStore? = nil
    @Entry var isCloudConfigured: Bool = false
}
