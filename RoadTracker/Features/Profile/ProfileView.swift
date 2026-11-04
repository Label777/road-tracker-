import SwiftUI
import RoadTrackerCore

/// Профиль: состояние синхронизации и приватность. Вход, места и геозоны — этапы 3 и 5.
struct ProfileView: View {
    @Environment(SyncManager.self) private var sync
    @Environment(\.tripStore) private var store
    @Environment(\.isCloudConfigured) private var isCloudConfigured
    @State private var confirmDeleteHistory = false
    @State private var message: String?

    var body: some View {
        NavigationStack {
            List {
                Section("Синхронизация") {
                    SyncStatusRow(status: sync.status, isConfigured: isCloudConfigured)
                    if sync.pendingCount > 0 {
                        LabeledContent("Ожидают отправки", value: "\(sync.pendingCount)")
                    }
                    Button("Синхронизировать сейчас") { sync.requestSync() }
                        .disabled(!isCloudConfigured)
                }
                Section {
                    Button("Удалить историю геолокации", role: .destructive) { confirmDeleteHistory = true }
                } header: {
                    Text("Приватность")
                } footer: {
                    Text("Координаты записываются только во время поездки. Треки хранятся на устройстве и автоматически удаляются через 30 дней. Поездки, расходы и время сохраняются.")
                }
                Section("О приложении") {
                    LabeledContent("Версия", value: Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Theme.background)
            .navigationTitle("Профиль")
            .confirmationDialog("Удалить все треки и координаты наблюдений?", isPresented: $confirmDeleteHistory,
                                titleVisibility: .visible) {
                Button("Удалить", role: .destructive) {
                    do {
                        try store?.deleteLocationHistory()
                        message = String(localized: "История геолокации удалена.")
                    } catch {
                        message = error.localizedDescription
                    }
                }
            }
            .alert(message ?? "", isPresented: Binding(get: { message != nil }, set: { if !$0 { message = nil } })) {
                Button("OK", role: .cancel) {}
            }
        }
    }
}

private struct SyncStatusRow: View {
    let status: SyncStatus
    let isConfigured: Bool

    var body: some View {
        HStack {
            Image(systemName: symbol).foregroundStyle(color)
            Text(text)
        }
    }

    private var symbol: String {
        guard isConfigured else { return "icloud.slash" }
        switch status {
        case .idle: return "checkmark.icloud"
        case .syncing: return "arrow.triangle.2.circlepath.icloud"
        case .offline: return "wifi.slash"
        case .failing: return "exclamationmark.icloud"
        case .signedOut: return "person.crop.circle.badge.questionmark"
        }
    }

    private var color: Color {
        guard isConfigured else { return Theme.textSecondary }
        switch status {
        case .idle, .syncing: return Theme.accent
        case .offline, .signedOut: return Theme.warning
        case .failing: return Theme.danger
        }
    }

    private var text: String {
        guard isConfigured else {
            return String(localized: "Облако не настроено — данные хранятся только на устройстве")
        }
        switch status {
        case .idle(let last):
            if let last { return String(localized: "Синхронизировано \(last.formatted(.relative(presentation: .named)))") }
            return String(localized: "Всё синхронизировано")
        case .syncing(let n): return String(localized: "Синхронизация… (\(n))")
        case .offline(let n): return String(localized: "Нет сети — \(n) изменений сохранены и уйдут позже")
        case .failing(let n, let msg): return String(localized: "Ошибка (\(n) в очереди): \(msg)")
        case .signedOut(let n): return String(localized: "Войдите в аккаунт, чтобы отправить \(n) изменений")
        }
    }
}
