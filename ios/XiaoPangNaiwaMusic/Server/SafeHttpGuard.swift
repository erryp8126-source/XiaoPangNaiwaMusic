import Foundation

/// iOS 统一外部 HTTP 安全守卫（协议/域名后缀白名单 + POSIX getaddrinfo 全量 IP 校验 + 重定向逐跳拦截）
enum SafeHttpGuard {
    static let maxRedirects = 3

    static let neteaseAllowedDomains: Set<String> = [
        "163.com",
        "126.net"
    ]

    static let audioAndProxyAllowedDomains: Set<String> = [
        // 网易云与主流音乐解灰/音频 CDN 域名
        "163.com",
        "126.net",
        "gdstudio.xyz",
        "kuwo.cn",
        "kugou.com",
        "migu.cn",
        "qq.com",
        "gtimg.cn",
        "joox.com",
        "tidal.com",
        "bilibili.com",
        "bilivideo.com",
        "bilivideo.cn",
        "hdslb.com",
        // 云同步与官方服务域名
        "supabase.co",
        "github.com",
        "githubusercontent.com",
        "jianguoyun.com",
        "infini-cloud.net",
        "teracloud.jp",
        "netlify.app"
    ]

    static func isAllowedDomain(_ host: String, allowedSuffixes: Set<String>) -> Bool {
        let clean = host.lowercased()
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !clean.isEmpty else { return false }
        return allowedSuffixes.contains { suffix in
            clean == suffix || clean.hasSuffix(".\(suffix)")
        }
    }

    static func isPublicIPv4(_ b0: UInt8, _ b1: UInt8, _ b2: UInt8, _ b3: UInt8) -> Bool {
        _ = b3
        // 0.0.0.0/8 (unspecified), 10.0.0.0/8 (private), 127.0.0.0/8 (loopback)
        if b0 == 0 || b0 == 10 || b0 == 127 { return false }
        // 100.64.0.0/10 (CGNAT)
        if b0 == 100 && b1 >= 64 && b1 <= 127 { return false }
        // 169.254.0.0/16 (link-local & cloud metadata 169.254.169.254)
        if b0 == 169 && b1 == 254 { return false }
        // 172.16.0.0/12 (private)
        if b0 == 172 && b1 >= 16 && b1 <= 31 { return false }
        // 192.0.0.0/24 & 192.168.0.0/16
        if b0 == 192 && b1 == 0 && b2 == 0 { return false }
        if b0 == 192 && b1 == 168 { return false }
        // Note: 198.18.0.0/15 is intentionally allowed for VPN FakeIP / TUN virtual routing compatibility
        // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)
        if b0 >= 224 { return false }
        return true
    }

    static func isPublicIPv6(_ bytes: [UInt8]) -> Bool {
        guard bytes.count == 16 else { return false }
        // Unspecified :: or loopback ::1
        if bytes[0..<15].allSatisfy({ $0 == 0 }) && (bytes[15] == 0 || bytes[15] == 1) {
            return false
        }
        // ULA fc00::/7
        if (bytes[0] & 0xFE) == 0xFC { return false }
        // Link-local fe80::/10
        if bytes[0] == 0xFE && (bytes[1] & 0xC0) == 0x80 { return false }
        // Multicast ff00::/8
        if bytes[0] == 0xFF { return false }
        // IPv4-mapped IPv6 ::ffff:0:0/96
        if bytes[0..<10].allSatisfy({ $0 == 0 }) && bytes[10] == 0xFF && bytes[11] == 0xFF {
            return isPublicIPv4(bytes[12], bytes[13], bytes[14], bytes[15])
        }
        return true
    }

    /// 仅校验 http/https 协议与全量公网 IP（不限制第三方 CDN 域名后缀，用于解灰音频流探测）
    static func validatePublicHttpUrlAndResolve(_ url: URL) -> Bool {
        return validateResolvedUrl(url, allowedSuffixes: nil)
    }

    /// 校验协议、域名白名单，并解析该主机名对应的全部 IPv4/IPv6 地址，拒绝任意私网/回环/链路本地/组播/未指定地址
    static func validateUrlAndResolve(_ url: URL, allowedSuffixes: Set<String>) -> Bool {
        return validateResolvedUrl(url, allowedSuffixes: allowedSuffixes)
    }

    private static func validateResolvedUrl(_ url: URL, allowedSuffixes: Set<String>?) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return false
        }
        guard let host = url.host?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines),
              !host.isEmpty else {
            return false
        }
        if let allowedSuffixes = allowedSuffixes, !isAllowedDomain(host, allowedSuffixes: allowedSuffixes) {
            return false
        }

        var hints = addrinfo()
        hints.ai_family = AF_UNSPEC
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        let status = getaddrinfo(host, nil, &hints, &result)
        guard status == 0, let first = result else {
            return false
        }
        defer { freeaddrinfo(first) }

        var count = 0
        var ptr: UnsafeMutablePointer<addrinfo>? = first
        while let current = ptr {
            if let sa = current.pointee.ai_addr {
                let family = Int32(sa.pointee.sa_family)
                if family == AF_INET {
                    var sin = sa.withMemoryRebound(to: sockaddr_in.self, capacity: 1) { $0.pointee }
                    let v4Bytes = withUnsafeBytes(of: &sin.sin_addr) { Array($0) }
                    guard v4Bytes.count == 4, isPublicIPv4(v4Bytes[0], v4Bytes[1], v4Bytes[2], v4Bytes[3]) else {
                        return false
                    }
                    count += 1
                } else if family == AF_INET6 {
                    var sin6 = sa.withMemoryRebound(to: sockaddr_in6.self, capacity: 1) { $0.pointee }
                    let v6Bytes = withUnsafeBytes(of: &sin6.sin6_addr) { Array($0) }
                    guard isPublicIPv6(v6Bytes) else { return false }
                    count += 1
                }
            }
            ptr = current.pointee.ai_next
        }
        return count > 0
    }
}

/// URLSession 逐跳重定向安全拦截代理（拦截 301/302/307/308，超 3 跳或目标域名/IP 不合规直接取消跳转）
final class SafeRedirectSessionDelegate: NSObject, URLSessionTaskDelegate {
    private static let allowedRedirectCodes: Set<Int> = [301, 302, 307, 308]

    private let allowedSuffixes: Set<String>?
    private let maxRedirects: Int
    private let lock = NSLock()
    private var hopCounts: [Int: Int] = [:]

    init(allowedSuffixes: Set<String>?, maxRedirects: Int = SafeHttpGuard.maxRedirects) {
        self.allowedSuffixes = allowedSuffixes
        self.maxRedirects = maxRedirects
        super.init()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        guard Self.allowedRedirectCodes.contains(response.statusCode),
              let nextUrl = request.url else {
            completionHandler(nil)
            return
        }

        lock.lock()
        let nextCount = (hopCounts[task.taskIdentifier] ?? 0) + 1
        hopCounts[task.taskIdentifier] = nextCount
        lock.unlock()

        guard nextCount <= maxRedirects else {
            completionHandler(nil)
            return
        }

        let isAllowed = allowedSuffixes.map {
            SafeHttpGuard.validateUrlAndResolve(nextUrl, allowedSuffixes: $0)
        } ?? SafeHttpGuard.validatePublicHttpUrlAndResolve(nextUrl)
        guard isAllowed else {
            completionHandler(nil)
            return
        }

        var sanitized = request
        if let prevHost = task.currentRequest?.url?.host?.lowercased(),
           let nextHost = nextUrl.host?.lowercased(),
           prevHost != nextHost {
            sanitized.setValue(nil, forHTTPHeaderField: "Authorization")
            sanitized.setValue(nil, forHTTPHeaderField: "Cookie")
        }
        completionHandler(sanitized)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        hopCounts.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
    }
}
