import Foundation
import Supabase

/// Конфигурация из Info.plist (подставляется из Config/Secrets.xcconfig).
/// Только публичный anon/publishable key; секретные ключи в клиенте не хранятся.
struct SupabaseConfig: Sendable {
    let url: URL
    let anonKey: String

    static func fromBundle(_ bundle: Bundle = .main) -> SupabaseConfig? {
        guard let rawURL = bundle.object(forInfoDictionaryKey: "SUPABASE_URL") as? String,
              let key = bundle.object(forInfoDictionaryKey: "SUPABASE_ANON_KEY") as? String,
              let url = URL(string: rawURL), url.scheme == "https",
              !key.isEmpty, !key.hasPrefix("your-") else { return nil }
        return SupabaseConfig(url: url, anonKey: key)
    }
}

/// Реализация облака на Supabase. Сессия хранится библиотекой в Keychain
/// и восстанавливается/обновляется автоматически при запуске.
final class SupabaseRemoteStore: RemoteStore {
    let client: SupabaseClient

    init(config: SupabaseConfig) {
        client = SupabaseClient(supabaseURL: config.url, supabaseKey: config.anonKey)
    }

    func currentUserID() async -> UUID? {
        // `session` проверяет срок действия и при необходимости обновляет токен.
        try? await client.auth.session.user.id
    }

    func upsert(_ row: RemoteRow) async throws {
        let query = client.from(row.table)
        switch row {
        case .location(let dto):   try await query.upsert(dto, onConflict: "id", returning: .minimal).execute()
        case .route(let dto):      try await query.upsert(dto, onConflict: "id", returning: .minimal).execute()
        case .trip(let dto):       try await query.upsert(dto, onConflict: "id", returning: .minimal).execute()
        case .segment(let dto):    try await query.upsert(dto, onConflict: "id", returning: .minimal).execute()
        case .inspection(let dto): try await query.upsert(dto, onConflict: "id", returning: .minimal).execute()
        }
    }
}
