import Foundation

/// iOS 第三方平台（B 站 / QQ 音乐）安全绑定与资源读取代理（对齐 Android PlatformAuthProxy.kt）
/// - 拆分独立的 B 站 / QQ 域名白名单与 HTTPS-only 安全重定向守卫，禁止跨平台共享状态或凭据
/// - 所有外发 URL 强制经过 SafeHttpGuard 域名 + HTTPS + 公网 IP 校验，禁止日志/错误回显敏感凭据
final class PlatformAuthProxy {
    private static let browserUA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    private static let bilibiliReferer = "https://www.bilibili.com/"
    private static let qqReferer = "https://y.qq.com/"
    private static let qqPtloginReferer = "https://xui.ptlogin2.qq.com/"
    private static let maxQqSigHops = 5
    private static let maxResponseBytes = 4 * 1024 * 1024
    private static let rfc3986Unreserved = CharacterSet(
        charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"
    )

    private static let bilibiliKeys = ["SESSDATA", "bili_jct", "DedeUserID", "DedeUserID__ckMd5"]
    private static let qqCookieKeys = [
        "uin",
        "p_uin",
        "qm_keyst",
        "qqmusic_key",
        "p_skey",
        "skey",
        "pt4_token",
        "tmeLoginType",
        "euin"
    ]
    private static let qqAuthKeys: Set<String> = [
        "qm_keyst",
        "qqmusic_key",
        "p_skey",
        "skey",
        "pt4_token"
    ]

    struct QqPtuiResult: Equatable {
        let status: String
        let code: String
        let redirectUrl: String
        let nickname: String
        let message: String
    }

    private enum ProxyError: Error {
        case securityBlocked(String)
        case oversizedResponse
        case transportFailed(String)
    }

    private let bilibiliDelegate: SafeRedirectSessionDelegate
    private let qqDelegate: SafeRedirectSessionDelegate
    private let bilibiliSession: URLSession
    private let qqSession: URLSession

    init() {
        self.bilibiliDelegate = SafeRedirectSessionDelegate(
            allowedSuffixes: SafeHttpGuard.bilibiliAuthAllowedDomains,
            requireHttps: true
        )
        self.qqDelegate = SafeRedirectSessionDelegate(
            allowedSuffixes: SafeHttpGuard.qqAuthAllowedDomains,
            requireHttps: true
        )

        let biliCfg = URLSessionConfiguration.ephemeral
        biliCfg.timeoutIntervalForRequest = 15
        biliCfg.timeoutIntervalForResource = 25
        biliCfg.httpShouldSetCookies = false
        biliCfg.httpCookieStorage = nil
        biliCfg.httpCookieAcceptPolicy = .never
        self.bilibiliSession = URLSession(configuration: biliCfg, delegate: bilibiliDelegate, delegateQueue: nil)

        let qqCfg = URLSessionConfiguration.ephemeral
        qqCfg.timeoutIntervalForRequest = 15
        qqCfg.timeoutIntervalForResource = 25
        qqCfg.httpShouldSetCookies = false
        qqCfg.httpCookieStorage = nil
        qqCfg.httpCookieAcceptPolicy = .never
        self.qqSession = URLSession(configuration: qqCfg, delegate: qqDelegate, delegateQueue: nil)
    }

    deinit {
        bilibiliSession.invalidateAndCancel()
        qqSession.invalidateAndCancel()
    }

    func handle(path: String, params: [String: String]) -> (status: Int, body: String) {
        do {
            switch path {
            case "/bind/bilibili/qr/generate":
                return (200, try generateBilibiliQr())
            case "/bind/bilibili/qr/poll":
                return (200, try pollBilibiliQr(params))
            case "/bind/bilibili/nav":
                return try handleBilibiliNav(params)
            case "/bind/bilibili/fav/folders":
                return (200, try fetchBilibiliFavFolders(params))
            case "/bind/bilibili/fav/resources":
                return (200, try fetchBilibiliFavResources(params))
            case "/bind/bilibili/audio/resolve":
                return (200, try resolveBilibiliAudio(params))
            case "/bind/qq/qr/generate":
                return (200, try generateQqQr())
            case "/bind/qq/qr/poll":
                return (200, try pollQqQr(params))
            case "/bind/qq/profile":
                return try handleQqProfile(params)
            case "/bind/qq/playlists":
                return (200, try fetchQqPlaylists(params))
            case "/bind/qq/playlist/detail":
                return (200, try fetchQqPlaylistDetail(params))
            case "/bind/qq/unblock":
                return (200, try resolveQqBoundUnblock(params))
            default:
                return (404, jsonString(["code": 404, "message": "Unknown bind endpoint"]))
            }
        } catch ProxyError.securityBlocked(let msg) {
            return (403, jsonString(["code": 403, "message": msg]))
        } catch {
            return (502, jsonString(["code": 502, "message": "平台认证请求失败，请稍后重试"]))
        }
    }

    // MARK: - Pure Helpers (Testable)

    internal static func computeQqPtqrToken(_ qrsig: String) -> Int {
        var e: Int32 = 0
        for scalar in qrsig.utf16 {
            e = e &+ (e &<< 5) &+ Int32(scalar)
        }
        return Int(e & 0x7fffffff)
    }

    internal static func isValidQrsig(_ qrsig: String) -> Bool {
        let trimmed = qrsig.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        for scalar in trimmed.unicodeScalars {
            if scalar.value < 0x20 || scalar.value == 0x7F { return false }
            if scalar.value == 0x3B { return false }
            if CharacterSet.whitespacesAndNewlines.contains(scalar) { return false }
        }
        return true
    }

    internal static func parseQqPtuiCB(_ rawText: String) -> QqPtuiResult {
        guard let outerRegex = try? NSRegularExpression(pattern: #"ptuiCB\(([^)]*)\)"#),
              let argRegex = try? NSRegularExpression(pattern: #"'((?:\\.|[^'\\])*)'"#) else {
            return QqPtuiResult(
                status: "risk_control",
                code: "invalid",
                redirectUrl: "",
                nickname: "",
                message: "QQ 安全校验暂未放行扫码，建议使用下方「手动粘贴 QQ 音乐 Cookie」完成绑定"
            )
        }

        let nsRaw = rawText as NSString
        guard let match = outerRegex.firstMatch(in: rawText, range: NSRange(location: 0, length: nsRaw.length)),
              match.numberOfRanges > 1 else {
            return QqPtuiResult(
                status: "risk_control",
                code: "invalid",
                redirectUrl: "",
                nickname: "",
                message: "QQ 安全校验暂未放行扫码，建议使用下方「手动粘贴 QQ 音乐 Cookie」完成绑定"
            )
        }

        let innerStr = nsRaw.substring(with: match.range(at: 1))
        let nsInner = innerStr as NSString
        let argMatches = argRegex.matches(in: innerStr, range: NSRange(location: 0, length: nsInner.length))
        let args = argMatches.map { m -> String in
            let rawArg = m.numberOfRanges > 1 ? nsInner.substring(with: m.range(at: 1)) : ""
            return rawArg.replacingOccurrences(of: "\\'", with: "'")
        }

        let code = (args.indices.contains(0) ? args[0] : "").trimmingCharacters(in: .whitespacesAndNewlines)
        let redirectUrl = (args.indices.contains(2) ? args[2] : "").trimmingCharacters(in: .whitespacesAndNewlines)
        let msg = (args.indices.contains(4) ? args[4] : "").trimmingCharacters(in: .whitespacesAndNewlines)
        let nickname = (args.indices.contains(5) ? args[5] : "").trimmingCharacters(in: .whitespacesAndNewlines)

        switch code {
        case "66":
            return QqPtuiResult(status: "waiting", code: code, redirectUrl: "", nickname: "", message: "等待使用手机 QQ 扫码")
        case "67":
            return QqPtuiResult(status: "scanned", code: code, redirectUrl: "", nickname: nickname, message: "已扫码，请在手机 QQ 上确认授权")
        case "65":
            return QqPtuiResult(status: "expired", code: code, redirectUrl: "", nickname: "", message: "二维码已失效，请点击刷新")
        case "68":
            return QqPtuiResult(status: "rejected", code: code, redirectUrl: "", nickname: "", message: "您已在手机 QQ 中取消授权")
        case "0":
            return QqPtuiResult(status: "confirmed", code: code, redirectUrl: redirectUrl, nickname: nickname, message: "QQ 扫码成功，正在完成凭据授权")
        default:
            let finalMsg = msg.isEmpty
                ? "QQ 安全校验暂未放行扫码，建议使用下方「手动粘贴 Cookie」完成绑定"
                : "QQ 登录暂受风控限制（\(msg)），建议使用下方「手动粘贴 Cookie」完成绑定"
            return QqPtuiResult(
                status: "risk_control",
                code: code.isEmpty ? "unknown" : code,
                redirectUrl: "",
                nickname: "",
                message: finalMsg
            )
        }
    }

    internal static func extractBilibiliCookieMap(setCookies: [String], redirectUrl: String?) -> [String: String] {
        var jar = [String: String]()
        parseSetCookiesInto(setCookies, jar: &jar)

        if let redirectUrl = redirectUrl, !redirectUrl.isEmpty,
           let qIdx = redirectUrl.firstIndex(of: "?") {
            let afterQ = String(redirectUrl[redirectUrl.index(after: qIdx)...])
            let query = afterQ.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? afterQ
            for pair in query.split(separator: "&") {
                guard let eq = pair.firstIndex(of: "=") else { continue }
                let rawK = String(pair[..<eq]).replacingOccurrences(of: "+", with: " ")
                let rawV = String(pair[pair.index(after: eq)...]).replacingOccurrences(of: "+", with: " ")
                let k = rawK.removingPercentEncoding ?? rawK
                let v = rawV.removingPercentEncoding ?? rawV
                if bilibiliKeys.contains(k) && !v.isEmpty && jar[k] == nil {
                    jar[k] = v
                }
            }
        }

        var filtered = [String: String]()
        for k in bilibiliKeys {
            if let v = jar[k], !v.isEmpty {
                filtered[k] = v
            }
        }
        return filtered
    }

    internal static func extractQqCookieMap(setCookies: [String], existingCookie: String? = nil) -> [String: String] {
        var rawJar = [String: String]()
        if let existing = existingCookie, !existing.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            for part in existing.split(separator: ";") {
                let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
                guard let eq = trimmed.firstIndex(of: "="), eq > trimmed.startIndex else { continue }
                let k = String(trimmed[..<eq]).trimmingCharacters(in: .whitespaces)
                let v = String(trimmed[trimmed.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
                if !k.isEmpty && !v.isEmpty {
                    rawJar[k] = v
                }
            }
        }

        parseSetCookiesInto(setCookies, jar: &rawJar)

        var filtered = [String: String]()
        for key in qqCookieKeys {
            if let matched = rawJar.first(where: { $0.key.caseInsensitiveCompare(key) == .orderedSame }) {
                let val = matched.value.trimmingCharacters(in: .whitespacesAndNewlines)
                if !val.isEmpty {
                    filtered[key] = val
                }
            }
        }
        return filtered
    }

    internal static func normalizeQqUin(_ rawUin: String?) -> String {
        var clean = (rawUin ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        while let first = clean.first, first == "o" || first == "O" || first == "q" || first == "Q" {
            clean.removeFirst()
        }
        while clean.first == "0" {
            clean.removeFirst()
        }
        guard (5...15).contains(clean.count), clean.allSatisfy({ $0.isASCII && $0.isNumber }) else {
            return ""
        }
        return clean
    }

    private static func parseSetCookiesInto(_ setCookies: [String], jar: inout [String: String]) {
        for raw in setCookies {
            let first = raw.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let eq = trimmed.firstIndex(of: "="), eq > trimmed.startIndex else { continue }
            let k = String(trimmed[..<eq]).trimmingCharacters(in: .whitespaces)
            let v = String(trimmed[trimmed.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            if !k.isEmpty && !v.isEmpty && v.caseInsensitiveCompare("deleted") != .orderedSame {
                jar[k] = v
            }
        }
    }

    private static func formatCookieMap(_ map: [String: String], orderedKeys: [String]) -> String {
        return orderedKeys.compactMap { k in
            guard let v = map[k], !v.isEmpty else { return nil }
            return "\(k)=\(v)"
        }.joined(separator: "; ")
    }

    private static func upgradeHttps(_ raw: String?) -> String {
        let trimmed = (raw ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.hasPrefix("http://") {
            return "https://" + String(trimmed.dropFirst(7))
        }
        if trimmed.hasPrefix("//") {
            return "https:" + trimmed
        }
        return trimmed
    }

    private static func encodeQuery(_ value: String) -> String {
        return value.addingPercentEncoding(withAllowedCharacters: rfc3986Unreserved) ?? value
    }

    private static func extractSetCookiePairs(from response: HTTPURLResponse, url: URL?) -> [String] {
        var out = [String]()
        var headerFields = [String: String]()
        for (k, v) in response.allHeaderFields {
            headerFields["\(k)"] = "\(v)"
        }
        if let targetUrl = url {
            let parsedCookies = HTTPCookie.cookies(withResponseHeaderFields: headerFields, for: targetUrl)
            for cookie in parsedCookies {
                out.append("\(cookie.name)=\(cookie.value)")
            }
        }
        if let rawHeader = response.value(forHTTPHeaderField: "Set-Cookie"), !rawHeader.isEmpty {
            let splitter = try? NSRegularExpression(pattern: #",\s*(?=[A-Za-z0-9_\-]+=)"#)
            let ns = rawHeader as NSString
            if let regex = splitter {
                let matches = regex.matches(in: rawHeader, range: NSRange(location: 0, length: ns.length))
                var lastLoc = 0
                for m in matches {
                    let piece = ns.substring(with: NSRange(location: lastLoc, length: m.range.location - lastLoc))
                    if !piece.isEmpty { out.append(piece) }
                    lastLoc = m.range.location + m.range.length
                }
                if lastLoc <= ns.length {
                    let tail = ns.substring(from: lastLoc)
                    if !tail.isEmpty { out.append(tail) }
                }
            } else {
                out.append(rawHeader)
            }
        }
        return out
    }

    // MARK: - HTTP Execution with Fail-Closed Domain + IPv4/IPv6 SSRF & HTTPS Guards

    private func performRequest(
        urlStr: String,
        method: String = "GET",
        headers: [String: String] = [:],
        bodyData: Data? = nil,
        session: URLSession,
        allowedDomains: Set<String>
    ) throws -> (data: Data, setCookies: [String], statusCode: Int) {
        guard let url = URL(string: urlStr),
              SafeHttpGuard.validateUrlAndResolve(url, allowedSuffixes: allowedDomains, requireHttps: true) else {
            throw ProxyError.securityBlocked("Blocked unsafe platform auth request")
        }

        var req = URLRequest(url: url, timeoutInterval: 15)
        req.httpMethod = method
        req.setValue(Self.browserUA, forHTTPHeaderField: "User-Agent")
        for (k, v) in headers {
            req.setValue(v, forHTTPHeaderField: k)
        }
        if let bodyData = bodyData {
            req.httpBody = bodyData
        }

        let sem = DispatchSemaphore(value: 0)
        var outData = Data()
        var outCookies = [String]()
        var outStatus = 502
        var outError: Error?

        let task = session.dataTask(with: req) { data, response, err in
            if let err = err {
                outError = err
            } else if let http = response as? HTTPURLResponse {
                outStatus = http.statusCode
                outCookies = Self.extractSetCookiePairs(from: http, url: http.url ?? url)
                if let d = data {
                    if d.count > Self.maxResponseBytes {
                        outError = ProxyError.oversizedResponse
                    } else {
                        outData = d
                    }
                }
            } else if let d = data {
                if d.count > Self.maxResponseBytes {
                    outError = ProxyError.oversizedResponse
                } else {
                    outData = d
                }
            }
            sem.signal()
        }
        task.resume()

        if sem.wait(timeout: .now() + 25) == .timedOut {
            task.cancel()
            throw ProxyError.transportFailed("Request timeout")
        }
        if let err = outError {
            throw err
        }
        return (outData, outCookies, outStatus)
    }

    private func executeGetText(
        urlStr: String,
        headers: [String: String],
        session: URLSession,
        allowedDomains: Set<String>
    ) throws -> String {
        let res = try performRequest(
            urlStr: urlStr,
            method: "GET",
            headers: headers,
            session: session,
            allowedDomains: allowedDomains
        )
        return String(data: res.data, encoding: .utf8) ?? "{}"
    }

    private func executePostJson(
        urlStr: String,
        jsonObject: Any,
        headers: [String: String],
        session: URLSession,
        allowedDomains: Set<String>
    ) throws -> String {
        let body = try JSONSerialization.data(withJSONObject: jsonObject, options: [])
        var reqHeaders = headers
        reqHeaders["Content-Type"] = "application/json; charset=utf-8"
        let res = try performRequest(
            urlStr: urlStr,
            method: "POST",
            headers: reqHeaders,
            bodyData: body,
            session: session,
            allowedDomains: allowedDomains
        )
        return String(data: res.data, encoding: .utf8) ?? "{}"
    }

    // MARK: - Bilibili Handlers

    private func generateBilibiliQr() throws -> String {
        let raw = try executeGetText(
            urlStr: "https://passport.bilibili.com/x/passport-login/web/qrcode/generate",
            headers: ["Referer": Self.bilibiliReferer],
            session: bilibiliSession,
            allowedDomains: SafeHttpGuard.bilibiliAuthAllowedDomains
        )
        let root = parseJsonDict(raw)
        let dataObj = root["data"] as? [String: Any]
        let qrKey = ((dataObj?["qrcode_key"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let qrUrl = ((dataObj?["url"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if qrKey.isEmpty || qrUrl.isEmpty {
            return jsonString(["code": 502, "message": "获取 B 站登录二维码失败"])
        }
        let qrImg = NeteaseCrypto.generateQrPngDataUrl(qrUrl)
        return jsonString([
            "code": 200,
            "data": [
                "qrcode_key": qrKey,
                "url": qrUrl,
                "qrImg": qrImg
            ]
        ])
    }

    private func pollBilibiliQr(_ params: [String: String]) throws -> String {
        let qrKey = (params["qrcode_key"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if qrKey.isEmpty {
            return jsonString(["code": 400, "status": "error", "message": "缺少 qrcode_key"])
        }
        let pollUrl = "https://passport.bilibili.com/x/passport-login/web/qrcode/poll?qrcode_key=\(Self.encodeQuery(qrKey))"
        let res = try performRequest(
            urlStr: pollUrl,
            method: "GET",
            headers: ["Referer": Self.bilibiliReferer],
            session: bilibiliSession,
            allowedDomains: SafeHttpGuard.bilibiliAuthAllowedDomains
        )
        let bodyText = String(data: res.data, encoding: .utf8) ?? "{}"
        let root = parseJsonDict(bodyText)
        let dataObj = (root["data"] as? [String: Any]) ?? root
        let pollCode = (dataObj["code"] as? NSNumber)?.intValue ?? -1

        switch pollCode {
        case 86101:
            return jsonString(["code": 200, "status": "waiting", "message": "等待使用哔哩哔哩 App 扫码"])
        case 86090:
            return jsonString(["code": 200, "status": "scanned", "message": "已扫码，请在手机 B 站确认登录"])
        case 86038:
            return jsonString(["code": 200, "status": "expired", "message": "二维码已过期，请点击刷新"])
        case 0:
            let redirectUrl = dataObj["url"] as? String
            let cookieMap = Self.extractBilibiliCookieMap(setCookies: res.setCookies, redirectUrl: redirectUrl)
            guard let sess = cookieMap["SESSDATA"], !sess.isEmpty else {
                return jsonString(["code": 200, "status": "error", "message": "未获取到 B 站登录凭据，请刷新重试"])
            }
            let cookieStr = Self.formatCookieMap(cookieMap, orderedKeys: Self.bilibiliKeys)
            let profile = fetchBilibiliProfileInternal(cookie: cookieStr, fallbackUid: cookieMap["DedeUserID"])
            return jsonString([
                "code": 200,
                "status": "confirmed",
                "message": "B 站绑定成功",
                "profile": profile,
                "cookie": cookieStr
            ])
        default:
            let msg = (dataObj["message"] as? String) ?? "获取 B 站扫码状态失败"
            return jsonString(["code": 200, "status": "error", "message": msg])
        }
    }

    private func fetchBilibiliProfileInternal(cookie: String, fallbackUid: String?) -> [String: Any] {
        let raw = try? executeGetText(
            urlStr: "https://api.bilibili.com/x/web-interface/nav",
            headers: ["Referer": Self.bilibiliReferer, "Cookie": cookie],
            session: bilibiliSession,
            allowedDomains: SafeHttpGuard.bilibiliAuthAllowedDomains
        )
        let root = raw.map(parseJsonDict) ?? [:]
        let dataObj = root["data"] as? [String: Any]
        let isLogin = (dataObj?["isLogin"] as? Bool) ?? false
        var mid = ""
        if let rawMid = dataObj?["mid"], !(rawMid is NSNull) {
            mid = "\(rawMid)"
        }
        if mid.isEmpty {
            mid = fallbackUid ?? ""
        }
        let unameRaw = (dataObj?["uname"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let uname = !unameRaw.isEmpty ? unameRaw : (!mid.isEmpty ? "B站用户 \(mid)" : "哔哩哔哩用户")
        let face = Self.upgradeHttps(dataObj?["face"] as? String)
        let vipStatus = (dataObj?["vipStatus"] as? NSNumber)?.intValue ?? 0
        return [
            "isLogin": isLogin,
            "uid": mid,
            "nickname": uname,
            "avatar": face,
            "isVip": vipStatus == 1
        ]
    }

    private func handleBilibiliNav(_ params: [String: String]) throws -> (Int, String) {
        let cookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if cookie.isEmpty {
            return (401, jsonString(["code": 401, "message": "B 站尚未绑定"]))
        }
        let profile = fetchBilibiliProfileInternal(cookie: cookie, fallbackUid: nil)
        if (profile["isLogin"] as? Bool) != true {
            return (401, jsonString(["code": 401, "message": "B 站登录状态已过期，请重新扫码绑定"]))
        }
        return (200, jsonString(["code": 200, "profile": profile]))
    }

    private func fetchBilibiliFavFolders(_ params: [String: String]) throws -> String {
        let cookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var uid = (params["uid"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if uid.isEmpty && !cookie.isEmpty {
            for part in cookie.split(separator: ";") {
                let trimmed = part.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.hasPrefix("DedeUserID=") {
                    uid = String(trimmed.dropFirst("DedeUserID=".count)).trimmingCharacters(in: .whitespacesAndNewlines)
                    break
                }
            }
        }
        if uid.isEmpty && !cookie.isEmpty {
            let profile = fetchBilibiliProfileInternal(cookie: cookie, fallbackUid: nil)
            uid = (profile["uid"] as? String) ?? ""
        }
        if uid.isEmpty {
            return jsonString(["code": 400, "folders": [Any](), "message": "缺少 B 站用户 UID"])
        }
        let raw = try executeGetText(
            urlStr: "https://api.bilibili.com/x/v3/fav/folder/created/list-all?up_mid=\(Self.encodeQuery(uid))&type=2",
            headers: ["Referer": Self.bilibiliReferer, "Cookie": cookie],
            session: bilibiliSession,
            allowedDomains: SafeHttpGuard.bilibiliAuthAllowedDomains
        )
        let root = parseJsonDict(raw)
        let list = ((root["data"] as? [String: Any])?["list"] as? [[String: Any]]) ?? []
        let folders: [[String: Any]] = list.map { o in
            [
                "id": (o["id"] as? NSNumber)?.int64Value ?? 0,
                "title": (o["title"] as? String) ?? "默认收藏夹",
                "mediaCount": (o["media_count"] as? NSNumber)?.intValue ?? 0
            ]
        }
        return jsonString(["code": 200, "folders": folders])
    }

    private func fetchBilibiliFavResources(_ params: [String: String]) throws -> String {
        let mediaId = (params["mediaId"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let pn = max(1, Int((params["pn"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 1)
        let psRaw = Int((params["ps"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 20
        let ps = min(20, max(1, psRaw))
        let cookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if mediaId.isEmpty {
            return jsonString(["code": 400, "items": [Any](), "message": "缺少收藏夹 ID"])
        }
        let raw = try executeGetText(
            urlStr: "https://api.bilibili.com/x/v3/fav/resource/list?media_id=\(Self.encodeQuery(mediaId))&pn=\(pn)&ps=\(ps)&platform=web",
            headers: ["Referer": Self.bilibiliReferer, "Cookie": cookie],
            session: bilibiliSession,
            allowedDomains: SafeHttpGuard.bilibiliAuthAllowedDomains
        )
        let root = parseJsonDict(raw)
        let dataObj = root["data"] as? [String: Any]
        let hasMore = (dataObj?["has_more"] as? Bool) ?? false
        let medias = (dataObj?["medias"] as? [[String: Any]]) ?? []
        var items = [[String: Any]]()
        for o in medias {
            let bvid = ((o["bvid"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard !bvid.isEmpty else { continue }
            let ugc = o["ugc"] as? [String: Any]
            let firstPage = (ugc?["first_cid"] as? NSNumber)?.int64Value ?? 0
            let upper = o["upper"] as? [String: Any]
            let upperName = (upper?["name"] as? String) ?? "UP主"
            items.append([
                "id": (o["id"] as? NSNumber)?.int64Value ?? 0,
                "bvid": bvid,
                "cid": firstPage,
                "title": (o["title"] as? String) ?? bvid,
                "cover": Self.upgradeHttps(o["cover"] as? String),
                "durationSec": (o["duration"] as? NSNumber)?.int64Value ?? 0,
                "authorName": upperName
            ])
        }
        return jsonString(["code": 200, "hasMore": hasMore, "items": items])
    }

    private func resolveBilibiliAudio(_ params: [String: String]) throws -> String {
        let bvid = (params["bvid"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        var cid = Int64((params["cid"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)) ?? 0
        let cookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if bvid.isEmpty {
            return jsonString(["code": 400, "message": "缺少 bvid"])
        }
        var headers = ["Referer": Self.bilibiliReferer]
        if !cookie.isEmpty { headers["Cookie"] = cookie }

        if cid <= 0 {
            let viewRaw = try executeGetText(
                urlStr: "https://api.bilibili.com/x/web-interface/view?bvid=\(Self.encodeQuery(bvid))",
                headers: headers,
                session: bilibiliSession,
                allowedDomains: SafeHttpGuard.bilibiliAuthAllowedDomains
            )
            let viewObj = parseJsonDict(viewRaw)
            let viewData = viewObj["data"] as? [String: Any]
            cid = (viewData?["cid"] as? NSNumber)?.int64Value
                ?? ((viewData?["pages"] as? [[String: Any]])?.first?["cid"] as? NSNumber)?.int64Value
                ?? 0
        }
        if cid <= 0 {
            return jsonString(["code": 404, "message": "未找到 B 站音频分 P 信息"])
        }

        let playRaw = try executeGetText(
            urlStr: "https://api.bilibili.com/x/player/playurl?bvid=\(Self.encodeQuery(bvid))&cid=\(cid)&qn=80&fnval=16&fourk=1",
            headers: headers,
            session: bilibiliSession,
            allowedDomains: SafeHttpGuard.bilibiliAuthAllowedDomains
        )
        let playObj = parseJsonDict(playRaw)
        let dataObj = playObj["data"] as? [String: Any]
        let dashAudio = ((dataObj?["dash"] as? [String: Any])?["audio"] as? [[String: Any]]) ?? []
        var bestUrl = ""
        var bestBw: Int64 = 0
        for a in dashAudio {
            let bw = (a["bandwidth"] as? NSNumber)?.int64Value ?? 0
            let base = (a["baseUrl"] as? String) ?? (a["base_url"] as? String) ?? ""
            if !base.isEmpty && bw >= bestBw {
                bestBw = bw
                bestUrl = base
            }
        }
        if bestUrl.isEmpty {
            bestUrl = ((dataObj?["durl"] as? [[String: Any]])?.first?["url"] as? String) ?? ""
        }
        let safeUrl = Self.upgradeHttps(bestUrl)
        if safeUrl.isEmpty {
            return jsonString(["code": 404, "message": "未能提取该 B 站音频播放地址"])
        }
        return jsonString([
            "code": 200,
            "data": [
                "url": safeUrl,
                "br": bestBw > 0 ? bestBw : 192000,
                "bvid": bvid,
                "cid": cid
            ]
        ])
    }

    // MARK: - QQ Music Handlers

    private func generateQqQr() throws -> String {
        let rand = Double.random(in: 0..<1)
        let urlStr = "https://ssl.ptlogin2.qq.com/ptqrshow?appid=716027609&e=2&l=M&s=3&d=72&v=4&t=\(rand)&daid=383&pt_3rd_aid=100497308"
        let res = try performRequest(
            urlStr: urlStr,
            method: "GET",
            headers: ["Referer": Self.qqPtloginReferer],
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        )
        var qrsig = ""
        for rawCookie in res.setCookies {
            let first = rawCookie.split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? ""
            let trimmed = first.trimmingCharacters(in: .whitespacesAndNewlines)
            if trimmed.hasPrefix("qrsig=") {
                qrsig = String(trimmed.dropFirst("qrsig=".count)).trimmingCharacters(in: .whitespacesAndNewlines)
            }
        }
        if qrsig.isEmpty || res.data.isEmpty {
            return jsonString(["code": 502, "message": "获取 QQ 登录二维码失败，建议尝试手动粘贴 Cookie"])
        }
        let b64 = res.data.base64EncodedString()
        return jsonString([
            "code": 200,
            "data": [
                "qrsig": qrsig,
                "qrImg": "data:image/png;base64,\(b64)"
            ]
        ])
    }

    private func pollQqQr(_ params: [String: String]) throws -> String {
        let qrsig = (params["qrsig"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        guard Self.isValidQrsig(qrsig) else {
            return jsonString(["code": 400, "status": "error", "message": "缺少或非法的 qrsig"])
        }
        let ptqrtoken = Self.computeQqPtqrToken(qrsig)
        let u1 = Self.encodeQuery("https://y.qq.com/n/ryqq/profile")
        let tsMs = Int64(Date().timeIntervalSince1970 * 1000)
        let pollUrl =
            "https://ssl.ptlogin2.qq.com/ptqrlogin?u1=\(u1)&ptqrtoken=\(ptqrtoken)&ptredirect=1&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-\(tsMs)&js_ver=23090814&js_type=1&login_sig=&pt_uistyle=40&aid=716027609&daid=383&pt_3rd_aid=100497308&"

        let pollRes = try performRequest(
            urlStr: pollUrl,
            method: "GET",
            headers: [
                "Referer": Self.qqPtloginReferer,
                "Cookie": "qrsig=\(qrsig)"
            ],
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        )
        var collectedCookies = pollRes.setCookies
        let bodyText = String(data: pollRes.data, encoding: .utf8) ?? ""
        let parsed = Self.parseQqPtuiCB(bodyText)

        if parsed.status != "confirmed" {
            return jsonString([
                "code": 200,
                "status": parsed.status,
                "ptCode": parsed.code,
                "message": parsed.message
            ])
        }

        // 手动沿 QQ_AUTH_ALLOWED_DOMAINS 强制 HTTPS 安全跟随 check_sig 跳转，跨 Host 自动剥离 Cookie
        if !parsed.redirectUrl.isEmpty,
           let sigUrl = URL(string: parsed.redirectUrl),
           SafeHttpGuard.validateUrlAndResolve(sigUrl, allowedSuffixes: SafeHttpGuard.qqAuthAllowedDomains, requireHttps: true) {
            let currentJar = Self.extractQqCookieMap(setCookies: collectedCookies)
            let initialHost = sigUrl.host ?? ""
            var hopHeaders: [String: String] = ["Referer": Self.qqReferer]
            if initialHost.caseInsensitiveCompare("ssl.ptlogin2.qq.com") == .orderedSame && !currentJar.isEmpty {
                hopHeaders["Cookie"] = Self.formatCookieMap(currentJar, orderedKeys: Self.qqCookieKeys)
            }

            let hopLock = NSLock()
            let hopDelegate = SafeRedirectSessionDelegate(
                allowedSuffixes: SafeHttpGuard.qqAuthAllowedDomains,
                maxRedirects: Self.maxQqSigHops,
                requireHttps: true,
                onHopResponse: { resp in
                    let hopCookies = Self.extractSetCookiePairs(from: resp, url: resp.url)
                    hopLock.lock()
                    collectedCookies.append(contentsOf: hopCookies)
                    hopLock.unlock()
                }
            )
            let hopCfg = URLSessionConfiguration.ephemeral
            hopCfg.timeoutIntervalForRequest = 15
            hopCfg.timeoutIntervalForResource = 25
            hopCfg.httpShouldSetCookies = false
            hopCfg.httpCookieStorage = nil
            hopCfg.httpCookieAcceptPolicy = .never
            let hopSession = URLSession(configuration: hopCfg, delegate: hopDelegate, delegateQueue: nil)
            defer { hopSession.invalidateAndCancel() }

            if let finalHop = try? performRequest(
                urlStr: parsed.redirectUrl,
                method: "GET",
                headers: hopHeaders,
                session: hopSession,
                allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
            ) {
                hopLock.lock()
                collectedCookies.append(contentsOf: finalHop.setCookies)
                hopLock.unlock()
            }
        }

        let cookieMap = Self.extractQqCookieMap(setCookies: collectedCookies)
        let hasAuth = Self.qqAuthKeys.contains { !(cookieMap[$0] ?? "").isEmpty }
        let uid = Self.normalizeQqUin(cookieMap["uin"] ?? cookieMap["p_uin"])
        if !hasAuth || uid.isEmpty {
            return jsonString([
                "code": 200,
                "status": "risk_control",
                "message": "QQ 授权回调受风控限制未能自动提取音乐凭据，请展开下方「手动粘贴 QQ 音乐 Cookie」完成绑定"
            ])
        }

        let cookieStr = Self.formatCookieMap(cookieMap, orderedKeys: Self.qqCookieKeys)
        let profile = fetchQqProfileInternal(uid: uid, cookie: cookieStr, fallbackNick: parsed.nickname)
        return jsonString([
            "code": 200,
            "status": "confirmed",
            "message": "QQ 音乐绑定成功",
            "profile": profile,
            "cookie": cookieStr
        ])
    }

    private func fetchQqProfileInternal(uid: String, cookie: String, fallbackNick: String = "") -> [String: Any] {
        let fallbackTrimmed = fallbackNick.trimmingCharacters(in: .whitespacesAndNewlines)
        var nickname = fallbackTrimmed.isEmpty ? "QQ 音乐用户 \(uid)" : fallbackTrimmed
        var avatar = "https://q1.qlogo.cn/g?b=qq&nk=\(uid)&s=140"

        if let raw = try? executeGetText(
            urlStr: "https://c.y.qq.com/rsc/fcgi-bin/fcg_get_profile_homepage.fcg?cid=205360838&ct=20&userid=\(Self.encodeQuery(uid))&reqfrom=1&format=json&inCharset=utf8&outCharset=utf-8",
            headers: ["Referer": Self.qqReferer, "Cookie": cookie],
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        ) {
            let root = parseJsonDict(raw)
            let creator = (root["data"] as? [String: Any])?["creator"] as? [String: Any]
            let nick = (creator?["nick"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let head = Self.upgradeHttps(creator?["headpic"] as? String)
            if !nick.isEmpty { nickname = nick }
            if !head.isEmpty { avatar = head }
        }
        return [
            "uid": uid,
            "nickname": nickname,
            "avatar": avatar
        ]
    }

    private func handleQqProfile(_ params: [String: String]) throws -> (Int, String) {
        let rawCookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cookieMap = Self.extractQqCookieMap(setCookies: [], existingCookie: rawCookie)
        let uid = Self.normalizeQqUin(cookieMap["uin"] ?? cookieMap["p_uin"])
        let hasAuth = Self.qqAuthKeys.contains { !(cookieMap[$0] ?? "").isEmpty }
        if uid.isEmpty || !hasAuth {
            return (400, jsonString([
                "code": 400,
                "message": "Cookie 缺少 uin 或 qm_keyst / qqmusic_key / p_skey 等鉴权字段"
            ]))
        }
        let normalizedCookie = Self.formatCookieMap(cookieMap, orderedKeys: Self.qqCookieKeys)
        let tsMs = Int64(Date().timeIntervalSince1970 * 1000)
        if let checkRaw = try? executeGetText(
            urlStr: "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=\(Self.encodeQuery(uid))&sin=0&size=5&r=\(tsMs)&g_tk=5381&loginUin=\(Self.encodeQuery(uid))&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
            headers: ["Referer": Self.qqReferer, "Cookie": normalizedCookie],
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        ) {
            let checkRoot = parseJsonDict(checkRaw)
            if let codeNum = (checkRoot["code"] as? NSNumber)?.intValue,
               codeNum == 1000 || codeNum == 400001 {
                return (401, jsonString([
                    "code": 401,
                    "message": "QQ 音乐 Cookie 已过期，请重新扫码或粘贴新 Cookie"
                ]))
            }
        }
        let profile = fetchQqProfileInternal(uid: uid, cookie: normalizedCookie)
        return (200, jsonString(["code": 200, "profile": profile, "cookie": normalizedCookie]))
    }

    private func fetchQqPlaylists(_ params: [String: String]) throws -> String {
        let rawCookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cookieMap = Self.extractQqCookieMap(setCookies: [], existingCookie: rawCookie)
        let explicitUid = (params["uid"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let uid = !explicitUid.isEmpty ? explicitUid : Self.normalizeQqUin(cookieMap["uin"] ?? cookieMap["p_uin"])
        let normalizedCookie = Self.formatCookieMap(cookieMap, orderedKeys: Self.qqCookieKeys)
        if uid.isEmpty || normalizedCookie.isEmpty {
            return jsonString(["code": 401, "playlists": [Any](), "message": "QQ 音乐尚未绑定"])
        }
        let tsMs = Int64(Date().timeIntervalSince1970 * 1000)
        let raw = try executeGetText(
            urlStr: "https://c.y.qq.com/rsc/fcgi-bin/fcg_user_created_diss?hostuin=\(Self.encodeQuery(uid))&sin=0&size=50&r=\(tsMs)&g_tk=5381&loginUin=\(Self.encodeQuery(uid))&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
            headers: ["Referer": Self.qqReferer, "Cookie": normalizedCookie],
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        )
        let root = parseJsonDict(raw)
        let dissList = ((root["data"] as? [String: Any])?["disslist"] as? [[String: Any]]) ?? []
        var playlists = [[String: Any]]()
        for o in dissList {
            let tid = (o["tid"] as? NSNumber)?.int64Value ?? 0
            let name = (o["diss_name"] as? String) ?? ""
            if tid > 0 && !name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                playlists.append([
                    "tid": "\(tid)",
                    "name": name,
                    "cover": Self.upgradeHttps(o["diss_cover"] as? String),
                    "songCount": (o["song_cnt"] as? NSNumber)?.intValue ?? 0
                ])
            }
        }
        return jsonString(["code": 200, "playlists": playlists])
    }

    private func fetchQqPlaylistDetail(_ params: [String: String]) throws -> String {
        let tid = (params["tid"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawCookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cookieMap = Self.extractQqCookieMap(setCookies: [], existingCookie: rawCookie)
        let uidRaw = Self.normalizeQqUin(cookieMap["uin"] ?? cookieMap["p_uin"])
        let uid = uidRaw.isEmpty ? "0" : uidRaw
        let normalizedCookie = Self.formatCookieMap(cookieMap, orderedKeys: Self.qqCookieKeys)
        if tid.isEmpty {
            return jsonString(["code": 400, "message": "缺少歌单 ID"])
        }
        let raw = try executeGetText(
            urlStr: "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=\(Self.encodeQuery(tid))&g_tk=5381&loginUin=\(Self.encodeQuery(uid))&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0",
            headers: ["Referer": Self.qqReferer, "Cookie": normalizedCookie],
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        )
        let root = parseJsonDict(raw)
        guard let cd = (root["cdlist"] as? [[String: Any]])?.first else {
            return jsonString(["code": 404, "message": "未找到 QQ 音乐歌单详情"])
        }
        var tracks = [[String: Any]]()
        if let songlist = cd["songlist"] as? [[String: Any]] {
            for s in songlist {
                let mid = (s["mid"] as? String) ?? ""
                let albumObj = s["album"] as? [String: Any]
                let albumMid = (albumObj?["mid"] as? String) ?? ""
                let cover = !albumMid.isEmpty
                    ? "https://y.qq.com/music/photo_new/T002R300x300M000\(albumMid).jpg"
                    : ""
                let rawSingers = (s["singer"] as? [[String: Any]]) ?? []
                let singers: [[String: Any]] = rawSingers.map { ao in
                    [
                        "id": (ao["id"] as? NSNumber)?.int64Value ?? 0,
                        "name": (ao["name"] as? String) ?? ""
                    ]
                }
                tracks.append([
                    "id": (s["id"] as? NSNumber)?.int64Value ?? 0,
                    "mid": mid,
                    "name": (s["name"] as? String) ?? "未知歌曲",
                    "artists": singers,
                    "albumName": (albumObj?["name"] as? String) ?? "",
                    "albumMid": albumMid,
                    "durationMs": ((s["interval"] as? NSNumber)?.int64Value ?? 0) * 1000,
                    "picUrl": cover
                ])
            }
        }
        return jsonString([
            "code": 200,
            "playlist": [
                "tid": tid,
                "name": (cd["dissname"] as? String) ?? "QQ 音乐歌单",
                "cover": Self.upgradeHttps(cd["logo"] as? String),
                "tracks": tracks
            ]
        ])
    }

    private func resolveQqBoundUnblock(_ params: [String: String]) throws -> String {
        let songName = (params["name"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let artist = (params["artist"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let rawCookie = (params["cookie"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let cookieMap = Self.extractQqCookieMap(setCookies: [], existingCookie: rawCookie)
        let uid = Self.normalizeQqUin(cookieMap["uin"] ?? cookieMap["p_uin"])
        let normalizedCookie = Self.formatCookieMap(cookieMap, orderedKeys: Self.qqCookieKeys)
        if songName.isEmpty || uid.isEmpty || normalizedCookie.isEmpty {
            return jsonString(["code": 404, "message": "缺少歌曲名或 QQ 音乐凭据"])
        }

        let keyword = "\(songName) \(artist)".trimmingCharacters(in: .whitespacesAndNewlines)
        let uinNum = Int64(uid) ?? 0
        let searchPayload: [String: Any] = [
            "comm": ["uin": uinNum, "format": "json", "ct": 24, "cv": 0],
            "req_0": [
                "module": "music.search.SearchCgiService",
                "method": "DoSearchForQQMusicDesktop",
                "param": [
                    "query": keyword,
                    "page_num": 1,
                    "num_per_page": 5,
                    "search_type": 0
                ]
            ]
        ]
        let postHeaders = [
            "Referer": Self.qqReferer,
            "Origin": "https://y.qq.com",
            "Cookie": normalizedCookie
        ]
        let searchRaw = try executePostJson(
            urlStr: "https://u.y.qq.com/cgi-bin/musicu.fcg",
            jsonObject: searchPayload,
            headers: postHeaders,
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        )
        let searchRoot = parseJsonDict(searchRaw)
        let req0 = searchRoot["req_0"] as? [String: Any]
        let songList = (((req0?["data"] as? [String: Any])?["body"] as? [String: Any])?["song"] as? [String: Any])?["list"] as? [[String: Any]]
        let firstMid = (songList?.first?["mid"] as? String) ?? ""
        if firstMid.isEmpty {
            return jsonString(["code": 404, "message": "QQ 音乐未匹配到可用曲目"])
        }

        let vkeyPayload: [String: Any] = [
            "comm": ["uin": uinNum, "format": "json", "ct": 24, "cv": 0],
            "req_vkey": [
                "module": "music.vkey.GetVkey",
                "method": "CgiGetVkey",
                "param": [
                    "guid": "8912432100",
                    "songmid": [firstMid],
                    "songtype": [0],
                    "uin": uid,
                    "loginflag": 1,
                    "platform": "20"
                ]
            ]
        ]
        let vkeyRaw = try executePostJson(
            urlStr: "https://u.y.qq.com/cgi-bin/musicu.fcg",
            jsonObject: vkeyPayload,
            headers: postHeaders,
            session: qqSession,
            allowedDomains: SafeHttpGuard.qqAuthAllowedDomains
        )
        let vkeyRoot = parseJsonDict(vkeyRaw)
        let vkeyData = (vkeyRoot["req_vkey"] as? [String: Any])?["data"] as? [String: Any]
        let purl = ((vkeyData?["midurlinfo"] as? [[String: Any]])?.first?["purl"] as? String) ?? ""
        if purl.isEmpty {
            return jsonString(["code": 404, "message": "当前 QQ 凭据未能取得该曲目播放链接"])
        }
        let sipRaw = (vkeyData?["sip"] as? [String])?.first ?? "https://ws.stream.qqmusic.qq.com/"
        var baseSip = Self.upgradeHttps(sipRaw)
        while baseSip.hasSuffix("/") { baseSip.removeLast() }
        baseSip += "/"
        let finalUrl = Self.upgradeHttps("\(baseSip)\(purl)")
        return jsonString([
            "code": 200,
            "message": "success",
            "data": [
                "url": finalUrl,
                "br": 320000,
                "size": 0,
                "platform": "qq-bound",
                "gain": 0
            ]
        ])
    }

    // MARK: - JSON Helpers

    private func parseJsonDict(_ text: String) -> [String: Any] {
        guard let data = text.data(using: .utf8),
              let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
            return [:]
        }
        return obj
    }

    private func jsonString(_ obj: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }
}
