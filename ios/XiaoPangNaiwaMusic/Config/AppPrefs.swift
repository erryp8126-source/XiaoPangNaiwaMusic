import Foundation
import Security

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

/// 基于 iOS 系统 Keychain 的敏感凭据安全存储（如云同步 Token、WebDAV 密码、同步口令）
/// 在无签名单元测试宿主返回 errSecMissingEntitlement (-34018) 时自动安全回退到进程内存缓存，确保测试与真机均可用
final class SecureKeychainStore {
    private let service = "com.xiaopang.naiwamusic.secrets"
    private let lock = NSLock()
    private var memoryFallback: [String: String] = [:]

    private func isValidKey(_ key: String) -> Bool {
        guard !key.isEmpty, key.count <= 64 else { return false }
        return key.range(of: "^[a-zA-Z0-9_.-]{1,64}$", options: .regularExpression) != nil
    }

    func setSecret(key: String, value: String) -> Bool {
        guard isValidKey(key) else { return false }
        if value.isEmpty {
            return removeSecret(key: key)
        }
        guard let data = value.data(using: .utf8) else { return false }

        lock.lock()
        defer { lock.unlock() }

        let baseQuery: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        SecItemDelete(baseQuery as CFDictionary)

        var addQuery = baseQuery
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly

        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
            memoryFallback.removeValue(forKey: key)
            return true
        }
        if status == errSecMissingEntitlement {
            memoryFallback[key] = value
            return true
        }
        return false
    }

    func getSecret(key: String) -> String {
        guard isValidKey(key) else { return "" }

        lock.lock()
        defer { lock.unlock() }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecSuccess,
           let data = result as? Data,
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        if let fallback = memoryFallback[key] {
            return fallback
        }
        return ""
    }

    func removeSecret(key: String) -> Bool {
        guard isValidKey(key) else { return false }

        lock.lock()
        defer { lock.unlock() }

        memoryFallback.removeValue(forKey: key)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key
        ]
        let status = SecItemDelete(query as CFDictionary)
        return status == errSecSuccess || status == errSecItemNotFound || status == errSecMissingEntitlement
    }

    func preloadKnownSecrets(_ keys: [String]) -> [String: String] {
        var dict: [String: String] = [:]
        for key in keys {
            let val = getSecret(key: key)
            if !val.isEmpty {
                dict[key] = val
            }
        }
        return dict
    }
}
