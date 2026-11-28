import Foundation

/// iOS 统一外部 HTTP 安全守卫（协议/域名后缀白名单 + POSIX getaddrinfo 全量 IP 校验 + 重定向逐跳拦截）
enum SafeHttpGuard {
    static let maxRedirects = 3

    static let neteaseAllowedDomains: Set<String> = [
        "163.com",
        "126.net"
    ]

    static let bilibiliAuthAllowedDomains: Set<String> = [
        "passport.bilibili.com",
        "api.bilibili.com"
    ]

    static let qqAuthAllowedDomains: Set<String> = [
        "ssl.ptlogin2.qq.com",
        "ptlogin2.qq.com",
        "u.y.qq.com",
        "c.y.qq.com",
        "y.qq.com",
        "graph.qq.com"
    ]

    static let platformAuthAllowedDomains: Set<String> = bilibiliAuthAllowedDomains.union(qqAuthAllowedDomains)

    static let externalPlaylistAllowedDomains: Set<String> = [
        "qishui.douyin.com",
        "music.douyin.com",
        "y.qq.com",
        "c.y.qq.com",
        "i.y.qq.com",
        "kugou.com",
        "kuwo.cn",
        "music.163.com",
        "163cn.tv"
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

    /// 自定义 LX 音源仅屏蔽云同步域与本地敏感主机，放开公网第三方解析域名（仍全量强制公网 IP + 重定向 SSRF 防护）
    static let customLxBlockedDomains: Set<String> = [
        "supabase.co",
        "localhost",
        "local",
        "internal"
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

    static func isBlockedDomain(_ host: String, blockedSuffixes: Set<String> = customLxBlockedDomains) -> Bool {
        return isAllowedDomain(host, allowedSuffixes: blockedSuffixes)
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
        let h0 = (UInt16(bytes[0]) << 8) | UInt16(bytes[1])
        let h1 = (UInt16(bytes[2]) << 8) | UInt16(bytes[3])
        let h2 = (UInt16(bytes[4]) << 8) | UInt16(bytes[5])
        let h3 = (UInt16(bytes[6]) << 8) | UInt16(bytes[7])
        let h4 = (UInt16(bytes[8]) << 8) | UInt16(bytes[9])
        let h5 = (UInt16(bytes[10]) << 8) | UInt16(bytes[11])
        let h6 = (UInt16(bytes[12]) << 8) | UInt16(bytes[13])
        let h7 = (UInt16(bytes[14]) << 8) | UInt16(bytes[15])

        // Unspecified ::/128 or loopback ::1/128
        if h0 == 0 && h1 == 0 && h2 == 0 && h3 == 0 && h4 == 0 && h5 == 0 && h6 == 0 && (h7 == 0 || h7 == 1) {
            return false
        }
        // IPv4-mapped IPv6 ::ffff:0:0/96
        if h0 == 0 && h1 == 0 && h2 == 0 && h3 == 0 && h4 == 0 && h5 == 0xFFFF {
            return isPublicIPv4(bytes[12], bytes[13], bytes[14], bytes[15])
        }
        // IPv4-compatible ::/96
        if h0 == 0 && h1 == 0 && h2 == 0 && h3 == 0 && h4 == 0 && h5 == 0 { return false }
        // SIIT IPv4-translated ::ffff:0:0:0/96
        if h0 == 0 && h1 == 0 && h2 == 0 && h3 == 0 && h4 == 0xFFFF && h5 == 0 { return false }
        // Discard-Only 100::/64
        if h0 == 0x0100 && h1 == 0 && h2 == 0 && h3 == 0 { return false }
        // NAT64 well-known 64:ff9b::/96 & local-use 64:ff9b:1::/48
        if h0 == 0x0064 && h1 == 0xFF9B && h2 == 0 && h3 == 0 && h4 == 0 && h5 == 0 { return false }
        if h0 == 0x0064 && h1 == 0xFF9B && h2 == 0x0001 { return false }
        // Teredo 2001::/32, Benchmarking 2001:2::/48, Documentation 2001:db8::/32
        if h0 == 0x2001 && h1 == 0x0000 { return false }
        if h0 == 0x2001 && h1 == 0x0002 && h2 == 0x0000 { return false }
        if h0 == 0x2001 && h1 == 0x0DB8 { return false }
        // 6to4 2002::/16
        if h0 == 0x2002 { return false }
        // ULA fc00::/7
        if (h0 & 0xFE00) == 0xFC00 { return false }
        // Link-local fe80::/10
        if (h0 & 0xFFC0) == 0xFE80 { return false }
        // Site-local fec0::/10
        if (h0 & 0xFFC0) == 0xFEC0 { return false }
        // Multicast ff00::/8
        if (h0 & 0xFF00) == 0xFF00 { return false }
        return true
    }

    /// 仅校验 http/https 协议与全量公网 IP（不限制第三方 CDN 域名后缀，用于解灰音频流探测）
    static func validatePublicHttpUrlAndResolve(_ url: URL) -> Bool {
        return validateResolvedUrl(url, allowedSuffixes: nil)
    }

    /// 校验用户自主启用的自定义 LX 音源 URL：放开第三方公网域名，屏蔽云同步域与本地主机，并强制全量公网 IP 解析
    static func validateCustomLxUrlAndResolve(
        _ url: URL,
        blockedSuffixes: Set<String> = customLxBlockedDomains
    ) -> Bool {
        return validateResolvedUrl(url, allowedSuffixes: nil, blockedSuffixes: blockedSuffixes)
    }

    /// 校验协议、域名白名单，并解析该主机名对应的全部 IPv4/IPv6 地址，拒绝任意私网/回环/链路本地/组播/未指定地址
    static func validateUrlAndResolve(
        _ url: URL,
        allowedSuffixes: Set<String>,
        requireHttps: Bool = false
    ) -> Bool {
        return validateResolvedUrl(url, allowedSuffixes: allowedSuffixes, requireHttps: requireHttps)
    }

    /// 仅校验协议与域名白名单语法（不发起 DNS 查询，供单元测试与语法预检使用）
    internal static func validateUrlSyntax(
        _ url: URL,
        allowedSuffixes: Set<String>,
        requireHttps: Bool = false
    ) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              requireHttps ? (scheme == "https") : (scheme == "http" || scheme == "https") else {
            return false
        }
        guard let host = url.host?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines),
              !host.isEmpty else {
            return false
        }
        return isAllowedDomain(host, allowedSuffixes: allowedSuffixes)
    }

    private static func validateResolvedUrl(
        _ url: URL,
        allowedSuffixes: Set<String>?,
        blockedSuffixes: Set<String>? = nil,
        requireHttps: Bool = false
    ) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              requireHttps ? (scheme == "https") : (scheme == "http" || scheme == "https") else {
            return false
        }
        guard let host = url.host?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines),
              !host.isEmpty else {
            return false
        }
        if let allowedSuffixes = allowedSuffixes, !isAllowedDomain(host, allowedSuffixes: allowedSuffixes) {
            return false
        }
        if let blockedSuffixes = blockedSuffixes, isBlockedDomain(host, blockedSuffixes: blockedSuffixes) {
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
    private let blockedSuffixes: Set<String>?
    private let maxRedirects: Int
    private let requireHttps: Bool
    private let onHopResponse: ((HTTPURLResponse) -> Void)?
    private let lock = NSLock()
    private var hopCounts: [Int: Int] = [:]

    init(
        allowedSuffixes: Set<String>?,
        blockedSuffixes: Set<String>? = nil,
        maxRedirects: Int = SafeHttpGuard.maxRedirects,
        requireHttps: Bool = false,
        onHopResponse: ((HTTPURLResponse) -> Void)? = nil
    ) {
        self.allowedSuffixes = allowedSuffixes
        self.blockedSuffixes = blockedSuffixes
        self.maxRedirects = maxRedirects
        self.requireHttps = requireHttps
        self.onHopResponse = onHopResponse
        super.init()
    }

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        onHopResponse?(response)

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

        let isAllowed: Bool
        if let allowedSuffixes = allowedSuffixes {
            isAllowed = SafeHttpGuard.validateUrlAndResolve(
                nextUrl,
                allowedSuffixes: allowedSuffixes,
                requireHttps: requireHttps
            )
        } else if requireHttps && nextUrl.scheme?.lowercased() != "https" {
            isAllowed = false
        } else if let blockedSuffixes = blockedSuffixes {
            isAllowed = SafeHttpGuard.validateCustomLxUrlAndResolve(nextUrl, blockedSuffixes: blockedSuffixes)
        } else {
            isAllowed = SafeHttpGuard.validatePublicHttpUrlAndResolve(nextUrl)
        }
        guard isAllowed else {
            completionHandler(nil)
            return
        }

        var sanitized = request
        if let prevUrl = task.currentRequest?.url {
            let prevHost = prevUrl.host?.lowercased()
            let nextHost = nextUrl.host?.lowercased()
            let prevScheme = prevUrl.scheme?.lowercased()
            let nextScheme = nextUrl.scheme?.lowercased()
            if prevHost != nextHost || prevScheme != nextScheme || prevUrl.port != nextUrl.port {
                sanitized.setValue(nil, forHTTPHeaderField: "Authorization")
                sanitized.setValue(nil, forHTTPHeaderField: "Cookie")
            }
        }
        completionHandler(sanitized)
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        hopCounts.removeValue(forKey: task.taskIdentifier)
        lock.unlock()
    }
}
