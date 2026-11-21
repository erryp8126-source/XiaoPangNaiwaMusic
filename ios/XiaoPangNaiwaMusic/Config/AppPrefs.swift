import Foundation

struct ServerConfig: Codable {
    var mode: String
    var localPort: Int
    var localToken: String
    var customApiUrl: String
    var customMusicApiUrl: String
    var floatingLyricEnabled: Bool
}

final class AppPrefs {
    private let defaults = UserDefaults.standard

    private enum Keys {
        static let mode = "alger_server_mode"
        static let customApiUrl = "alger_custom_api_url"
        static let customMusicApiUrl = "alger_custom_music_api_url"
        static let anonymousToken = "alger_anonymous_token"
        static let deviceId = "alger_device_id"
    }

    var anonymousToken: String {
        get { defaults.string(forKey: Keys.anonymousToken) ?? "" }
        set { defaults.set(newValue, forKey: Keys.anonymousToken) }
    }

    var deviceId: String {
        get { defaults.string(forKey: Keys.deviceId) ?? "" }
        set { defaults.set(newValue, forKey: Keys.deviceId) }
    }

    func getServerConfig(localPort: Int, localToken: String = "") -> ServerConfig {
        let mode = defaults.string(forKey: Keys.mode) ?? "local"
        let customApi = defaults.string(forKey: Keys.customApiUrl) ?? ""
        let customMusicApi = defaults.string(forKey: Keys.customMusicApiUrl) ?? ""
        return ServerConfig(
            mode: mode == "custom" ? "custom" : "local",
            localPort: localPort,
            localToken: localToken,
            customApiUrl: customApi,
            customMusicApiUrl: customMusicApi,
            floatingLyricEnabled: false
        )
    }

    func saveServerConfigFromJson(_ json: String, localPort: Int, localToken: String = "") -> ServerConfig {
        if let data = json.data(using: .utf8),
           let dict = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
            if let mode = dict["mode"] as? String {
                defaults.set(mode == "custom" ? "custom" : "local", forKey: Keys.mode)
            }
            if let customApi = dict["customApiUrl"] as? String {
                defaults.set(customApi.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.customApiUrl)
            }
            if let customMusic = dict["customMusicApiUrl"] as? String {
                defaults.set(customMusic.trimmingCharacters(in: .whitespacesAndNewlines), forKey: Keys.customMusicApiUrl)
            }
        }
        return getServerConfig(localPort: localPort, localToken: localToken)
    }
}
