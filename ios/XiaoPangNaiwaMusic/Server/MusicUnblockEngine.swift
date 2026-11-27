import Foundation

struct UnblockResult {
    let url: String
    let br: Int
    let size: Int64
    let platform: String
}

/// iOS 内置多平台音源解析与无跨域 HTTP 代理引擎（完整对齐 Android MusicUnblockEngine.kt）
final class MusicUnblockEngine {
    static let defaultUA =
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1"

    static let defaultEnabledSources = ["pyncmd", "gdmusic", "migu", "kugou", "kuwo"]
    static let minValidAudioBytes: Int64 = 400 * 1024
    static let minShortTrackAudioBytes: Int64 = 80 * 1024
    static let shortTrackDurationThresholdMs: Int64 = 30_000
    private static let headFallbackCodes: Set<Int> = [400, 403, 405, 501]
    private static let disallowedAudioContentTypes: Set<String> = [
        "text/html",
        "application/json",
        "application/xml",
        "text/plain",
        "text/xml"
    ]

    private let redirectDelegate: SafeRedirectSessionDelegate
    private let session: URLSession
    private let customLxRedirectDelegate: SafeRedirectSessionDelegate
    private let customLxSession: URLSession
    private let mediaProbeRedirectDelegate: SafeRedirectSessionDelegate
    private let mediaProbeSession: URLSession

    init() {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 12
        cfg.timeoutIntervalForResource = 18
        cfg.httpShouldSetCookies = false
        let del = SafeRedirectSessionDelegate(allowedSuffixes: SafeHttpGuard.audioAndProxyAllowedDomains)
        self.redirectDelegate = del
        self.session = URLSession(configuration: cfg, delegate: del, delegateQueue: nil)
        let lxDel = SafeRedirectSessionDelegate(
            allowedSuffixes: nil,
            blockedSuffixes: SafeHttpGuard.customLxBlockedDomains
        )
        self.customLxRedirectDelegate = lxDel
        self.customLxSession = URLSession(configuration: cfg, delegate: lxDel, delegateQueue: nil)
        let probeDel = SafeRedirectSessionDelegate(allowedSuffixes: nil)
        self.mediaProbeRedirectDelegate = probeDel
        self.mediaProbeSession = URLSession(configuration: cfg, delegate: probeDel, delegateQueue: nil)
    }

    func unblock(
        songId: String,
        songName: String,
        artists: String,
        enabledSources: [String] = MusicUnblockEngine.defaultEnabledSources,
        expectedDurationMs: Int64 = 0
    ) -> UnblockResult? {
        let keyword = "\(songName) \(artists)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty || !songId.isEmpty else { return nil }

        let ordered = enabledSources.isEmpty ? Self.defaultEnabledSources : enabledSources
        for src in ordered {
            let res: UnblockResult?
            switch src.lowercased() {
            case "pyncmd":
                res = songId.isEmpty ? nil : searchPyncmd(songId: songId, expectedDurationMs: expectedDurationMs)
            case "kuwo":
                res = keyword.isEmpty ? nil : searchKuwo(keyword: keyword, expectedDurationMs: expectedDurationMs)
            case "kugou":
                res = keyword.isEmpty ? nil : searchKugou(keyword: keyword, expectedDurationMs: expectedDurationMs)
            case "migu":
                res = keyword.isEmpty ? nil : searchMigu(keyword: keyword, expectedDurationMs: expectedDurationMs)
            case "gdmusic", "qq", "joox":
                res = keyword.isEmpty ? nil : searchGdMusic(keyword: keyword, expectedDurationMs: expectedDurationMs)
            default:
                res = nil
            }
            if let r = res, r.url.hasPrefix("http") {
                return r
            }
        }

        if !ordered.contains(where: { $0.lowercased() == "pyncmd" }), !songId.isEmpty {
            if let pyncmdFallback = searchPyncmd(songId: songId, expectedDurationMs: expectedDurationMs),
               pyncmdFallback.url.hasPrefix("http") {
                return pyncmdFallback
            }
        }
        if !ordered.contains(where: { $0.lowercased() == "gdmusic" }), !keyword.isEmpty {
            if let fallback = searchGdMusic(keyword: keyword, expectedDurationMs: expectedDurationMs),
               fallback.url.hasPrefix("http") {
                return fallback
            }
        }
        return nil
    }

    /// 精准网易云 ID 无损解析（对齐 @unblockneteasemusic/server pyncmd 通道）
    private func searchPyncmd(songId: String, expectedDurationMs: Int64 = 0) -> UnblockResult? {
        let cleanId = songId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanId.isEmpty, cleanId.allSatisfy({ $0.isNumber }) else { return nil }
        let baseUrl = "https://music-api.gdstudio.xyz/api.php"
        for br in ["999", "320"] {
            let urlEndpoint = "\(baseUrl)?types=url&source=netease&id=\(cleanId)&br=\(br)"
            guard let urlBody = httpGetText(urlEndpoint, headers: ["User-Agent": Self.defaultUA]),
                  let urlObj = parseJsonObject(urlBody),
                  let rawUrl = urlObj["url"] as? String else { continue }
            let cleaned = rawUrl.replacingOccurrences(of: "\\", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
            if cleaned.hasPrefix("http") {
                let playUrl = cleaned.replacingOccurrences(
                    of: #"^http://([^/]*\.126\.net/)"#,
                    with: "https://$1",
                    options: [.regularExpression, .caseInsensitive]
                )
                guard checkAudioUrlReachable(playUrl, expectedDurationMs: expectedDurationMs) else { continue }
                let bitrate = ((urlObj["br"] as? Int) ?? 320) * 1000
                let size = (urlObj["size"] as? NSNumber)?.int64Value ?? 0
                return UnblockResult(url: playUrl, br: bitrate, size: size, platform: "pyncmd")
            }
        }
        return nil
    }

    private func searchKuwo(keyword: String, expectedDurationMs: Int64 = 0) -> UnblockResult? {
        let q = enc(keyword)
        let searchUrl = "http://search.kuwo.cn/r.s?all=\(q)&ft=music&rformat=json&encoding=utf8&pcjson=1&vipver=1&pn=0&rn=5"
        guard let body = httpGetText(searchUrl, headers: ["User-Agent": Self.defaultUA]),
              let root = parseJsonObject(body.replacingOccurrences(of: "'", with: "\"")),
              let list = root["abslist"] as? [[String: Any]], !list.isEmpty else {
            return nil
        }

        for obj in list.prefix(3) {
            guard let rawRid = obj["MUSICRID"] as? String else { continue }
            let rid = rawRid.hasPrefix("MUSIC_") ? String(rawRid.dropFirst(6)) : rawRid
            let urlApi = "https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=\(rid)&format=mp3"
            if let urlBody = httpGetText(urlApi, headers: ["User-Agent": Self.defaultUA]),
               let urlJson = parseJsonObject(urlBody),
               let playUrl = (urlJson["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
               playUrl.hasPrefix("http"),
               checkAudioUrlReachable(playUrl, expectedDurationMs: expectedDurationMs) {
                return UnblockResult(url: playUrl, br: 320000, size: 0, platform: "kuwo")
            }

            let altApi = "http://www.kuwo.cn/api/v1/www/music/playUrl?mid=\(rid)&type=music&httpsStatus=1&br=320kmp3"
            if let altBody = httpGetText(altApi, headers: ["User-Agent": Self.defaultUA, "Referer": "http://www.kuwo.cn/"]),
               let altJson = parseJsonObject(altBody),
               let data = altJson["data"] as? [String: Any],
               let altUrl = (data["url"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
               altUrl.hasPrefix("http"),
               checkAudioUrlReachable(altUrl, expectedDurationMs: expectedDurationMs) {
                return UnblockResult(url: altUrl, br: 320000, size: 0, platform: "kuwo")
            }
        }
        return nil
    }

    private func searchKugou(keyword: String, expectedDurationMs: Int64 = 0) -> UnblockResult? {
        let q = enc(keyword)
        let searchUrl = "http://mobilecdn.kugou.com/api/v3/search/song?format=json&keyword=\(q)&page=1&pagesize=5&showtype=1"
        guard let body = httpGetText(searchUrl, headers: ["User-Agent": Self.defaultUA]),
              let root = parseJsonObject(body),
              let data = root["data"] as? [String: Any],
              let info = data["info"] as? [[String: Any]] else {
            return nil
        }

        for obj in info {
            let h320 = (obj["320hash"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let hStd = (obj["hash"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let hash = !h320.isEmpty ? h320 : hStd
            if hash.isEmpty { continue }
            let albumId = "\(obj["album_id"] ?? "")"
            let playApi = "https://wwwapi.kugou.com/yy/index.php?r=play/getdata&hash=\(hash)&album_id=\(albumId)&mid=1"
            guard let playBody = httpGetText(playApi, headers: [
                "User-Agent": Self.defaultUA,
                "Cookie": "kg_mid=2333; kg_dfid=2333"
            ]),
            let playJson = parseJsonObject(playBody),
            let pData = playJson["data"] as? [String: Any] else { continue }

            let primary = (pData["play_url"] as? String) ?? ""
            let backup = (pData["play_backup_url"] as? String) ?? ""
            let chosen = primary.hasPrefix("http") ? primary : (backup.hasPrefix("http") ? backup : "")
            if !chosen.isEmpty, checkAudioUrlReachable(chosen, expectedDurationMs: expectedDurationMs) {
                return UnblockResult(url: chosen, br: 320000, size: 0, platform: "kugou")
            }
        }
        return nil
    }

    private func searchMigu(keyword: String, expectedDurationMs: Int64 = 0) -> UnblockResult? {
        let q = enc(keyword)
        let searchUrl = "https://pd.musicapp.migu.cn/MIGUM3.0/v1.0/content/search_all.do?text=\(q)&pageNo=1&pageSize=5&searchSwitch=%7B%22song%22%3A1%7D"
        guard let body = httpGetText(searchUrl, headers: [
            "User-Agent": Self.defaultUA,
            "Referer": "https://m.music.migu.cn/",
            "channel": "0140210"
        ]),
        let root = parseJsonObject(body),
        let songRes = root["songResultData"] as? [String: Any],
        let resultList = songRes["result"] as? [[String: Any]] else {
            return nil
        }

        for obj in resultList {
            guard let contentId = obj["contentId"] as? String,
                  let copyrightId = obj["copyrightId"] as? String else { continue }
            let urlApi = "https://c.musicapp.migu.cn/MIGUM2.0/v1.0/content/resourceinfo.do?copyrightId=\(copyrightId)&resourceType=2"
            if let urlBody = httpGetText(urlApi, headers: ["User-Agent": Self.defaultUA]),
               let uRoot = parseJsonObject(urlBody),
               let resArr = uRoot["resource"] as? [[String: Any]],
               let first = resArr.first {
                let formats = (first["newRateFormats"] as? [[String: Any]]) ?? (first["rateFormats"] as? [[String: Any]]) ?? []
                for f in formats.reversed() {
                    guard let rawPath = (f["androidUrl"] as? String) ?? (f["url"] as? String) else { continue }
                    let finalUrl = rawPath.replacingOccurrences(
                        of: #"ftp://[^/]+"#,
                        with: "https://freetyst.nf.migu.cn",
                        options: .regularExpression
                    )
                    if finalUrl.hasPrefix("http"), checkAudioUrlReachable(finalUrl, expectedDurationMs: expectedDurationMs) {
                        return UnblockResult(url: finalUrl, br: 320000, size: 0, platform: "migu")
                    }
                }
            }
            let direct = "https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?channel=mx&copyrightId=\(copyrightId)&contentId=\(contentId)&toneFlag=HQ&resourceType=2&userId=15548614588710179085069&netType=00"
            if checkAudioUrlReachable(direct, expectedDurationMs: expectedDurationMs) {
                return UnblockResult(url: direct, br: 320000, size: 0, platform: "migu")
            }
        }
        return nil
    }

    private func searchGdMusic(keyword: String, expectedDurationMs: Int64 = 0) -> UnblockResult? {
        let sources = ["joox", "netease", "kugou", "tidal", "kuwo"]
        let baseUrl = "https://music-api.gdstudio.xyz/api.php"
        for source in sources {
            let searchUrl = "\(baseUrl)?types=search&source=\(source)&name=\(enc(keyword))&count=3&pages=1"
            guard let body = httpGetText(searchUrl, headers: ["User-Agent": Self.defaultUA]),
                  let data = body.data(using: .utf8),
                  let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { continue }
            for item in arr.prefix(2) {
                let trackId = "\(item["id"] ?? "")"
                if trackId.isEmpty { continue }
                let trackSource = (item["source"] as? String) ?? source
                let urlEndpoint = "\(baseUrl)?types=url&source=\(trackSource)&id=\(trackId)&br=999"
                guard let urlBody = httpGetText(urlEndpoint, headers: ["User-Agent": Self.defaultUA]),
                      let urlObj = parseJsonObject(urlBody),
                      let rawUrl = urlObj["url"] as? String else { continue }
                let playUrl = rawUrl.replacingOccurrences(of: "\\", with: "").trimmingCharacters(in: .whitespacesAndNewlines)
                if playUrl.hasPrefix("http"), checkAudioUrlReachable(playUrl, expectedDurationMs: expectedDurationMs) {
                    let br = ((urlObj["br"] as? Int) ?? 320) * 1000
                    let size = (urlObj["size"] as? NSNumber)?.int64Value ?? 0
                    return UnblockResult(url: playUrl, br: br, size: size, platform: "gdmusic:\(trackSource)")
                }
            }
        }
        return nil
    }

    static func isSafePublicHttpUrl(_ url: URL) -> Bool {
        return SafeHttpGuard.validateUrlAndResolve(url, allowedSuffixes: SafeHttpGuard.audioAndProxyAllowedDomains)
    }

    func proxyHttpRequest(
        url: String,
        method: String = "GET",
        headers: [String: String] = [:],
        body: String? = nil,
        form: [String: String]? = nil,
        timeoutMs: Double = 15000,
        isCustomLx: Bool = false
    ) -> [String: Any] {
        guard let nsUrl = URL(string: url) else {
            return ["statusCode": 403, "headers": [:], "body": "Blocked non-allowlisted or unsafe URL", "finalUrl": url]
        }
        let isAllowed = isCustomLx
            ? SafeHttpGuard.validateCustomLxUrlAndResolve(nsUrl)
            : Self.isSafePublicHttpUrl(nsUrl)
        guard isAllowed else {
            return [
                "statusCode": 403,
                "headers": [:],
                "body": isCustomLx ? "Blocked unsafe or restricted LX URL" : "Blocked non-allowlisted or unsafe URL",
                "finalUrl": url
            ]
        }

        var req = URLRequest(url: nsUrl, timeoutInterval: max(3.0, timeoutMs / 1000.0))
        let upper = method.uppercased()
        req.httpMethod = upper

        var hasUa = false
        var contentType: String?
        for (k, v) in headers {
            if k.lowercased() == "user-agent" { hasUa = true }
            if k.lowercased() == "content-type" { contentType = v }
            req.setValue(v, forHTTPHeaderField: k)
        }
        if !hasUa {
            req.setValue(Self.defaultUA, forHTTPHeaderField: "User-Agent")
        }

        if upper != "GET" && upper != "HEAD" {
            if let form = form {
                let formStr = form.map { "\(enc($0.key))=\(enc($0.value))" }.joined(separator: "&")
                req.httpBody = formStr.data(using: .utf8)
                if contentType == nil {
                    req.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                }
            } else if let body = body {
                req.httpBody = body.data(using: .utf8)
                if contentType == nil {
                    req.setValue("application/json; charset=utf-8", forHTTPHeaderField: "Content-Type")
                }
            }
        }

        let sem = DispatchSemaphore(value: 0)
        var respData: Data?
        var httpResp: HTTPURLResponse?
        var finalUrl = url

        let targetSession = isCustomLx ? customLxSession : session
        let task = targetSession.dataTask(with: req) { data, response, _ in
            respData = data
            httpResp = response as? HTTPURLResponse
            if let u = response?.url?.absoluteString { finalUrl = u }
            sem.signal()
        }
        task.resume()
        _ = sem.wait(timeout: .now() + max(5.0, timeoutMs / 1000.0 + 2.0))

        let rawText = respData.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        var respHeaders = [String: String]()
        if let all = httpResp?.allHeaderFields {
            for (k, v) in all {
                respHeaders["\(k)".lowercased()] = "\(v)"
            }
        }

        var parsedBody: Any = rawText
        let trimmed = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        if (trimmed.hasPrefix("{") || trimmed.hasPrefix("[")),
           let d = trimmed.data(using: .utf8),
           let obj = try? JSONSerialization.jsonObject(with: d) {
            parsedBody = obj
        }

        return [
            "statusCode": httpResp?.statusCode ?? 502,
            "headers": respHeaders,
            "body": parsedBody,
            "finalUrl": finalUrl
        ]
    }

    private func resolveMinValidAudioBytes(_ expectedDurationMs: Int64) -> Int64 {
        if expectedDurationMs > 0 && expectedDurationMs < Self.shortTrackDurationThresholdMs {
            return Self.minShortTrackAudioBytes
        }
        return Self.minValidAudioBytes
    }

    private func isSuspiciousKuwoPlaceholderUrl(_ url: String) -> Bool {
        let lower = url.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard lower.contains("kuwo") || lower.contains("kwcdn") else { return false }
        let comps = URLComponents(string: lower)
        let target = "\(comps?.path ?? "")?\(comps?.query ?? "")"
        let checkStr = target == "?" ? lower : target
        let pattern = #"(^|[/?&_=-])(audition|shiting|tishi|viptip|vip[_-]?tip|free[_-]?tip|notice|prompt|trylisten|try[_-]?listen|preview)([/?&_=.-]|$)"#
        return checkStr.range(of: pattern, options: [.regularExpression, .caseInsensitive]) != nil
    }

    private func parseTotalBytesFromHeaders(
        statusCode: Int,
        contentLengthHeader: String?,
        contentRangeHeader: String?
    ) -> Int64? {
        if statusCode == 206 {
            let range = (contentRangeHeader ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            guard let regex = try? NSRegularExpression(pattern: #"bytes\s+\d+-\d+/(\d+)"#, options: [.caseInsensitive]),
                  let match = regex.firstMatch(in: range, range: NSRange(range.startIndex..., in: range)),
                  match.numberOfRanges > 1,
                  let totalRange = Range(match.range(at: 1), in: range) else {
                return nil
            }
            return Int64(range[totalRange])
        }
        guard let cl = contentLengthHeader?.trimmingCharacters(in: .whitespacesAndNewlines) else {
            return nil
        }
        return Int64(cl)
    }

    private func isDisallowedAudioContentType(_ contentType: String?) -> Bool {
        let normalized = (contentType ?? "")
            .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)
            .first?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        if normalized.isEmpty { return false }
        return Self.disallowedAudioContentTypes.contains(normalized)
    }

    func checkAudioUrlReachable(_ url: String, expectedDurationMs: Int64 = 0) -> Bool {
        if isSuspiciousKuwoPlaceholderUrl(url) { return false }
        guard let u = URL(string: url), SafeHttpGuard.validatePublicHttpUrlAndResolve(u) else { return false }
        let minValidBytes = resolveMinValidAudioBytes(expectedDurationMs)

        var headReq = URLRequest(url: u, timeoutInterval: 8)
        headReq.httpMethod = "HEAD"
        headReq.setValue(Self.defaultUA, forHTTPHeaderField: "User-Agent")
        let headSem = DispatchSemaphore(value: 0)
        var headOk = false
        var shouldFallbackToRangeGet = false

        mediaProbeSession.dataTask(with: headReq) { _, resp, _ in
            if let http = resp as? HTTPURLResponse {
                let ct = http.value(forHTTPHeaderField: "Content-Type")
                if !self.isDisallowedAudioContentType(ct) {
                    if (200...299).contains(http.statusCode) {
                        if let totalBytes = self.parseTotalBytesFromHeaders(
                            statusCode: http.statusCode,
                            contentLengthHeader: http.value(forHTTPHeaderField: "Content-Length"),
                            contentRangeHeader: http.value(forHTTPHeaderField: "Content-Range")
                        ), totalBytes > 0 {
                            headOk = totalBytes >= minValidBytes
                        } else {
                            shouldFallbackToRangeGet = true
                        }
                    } else if Self.headFallbackCodes.contains(http.statusCode) {
                        shouldFallbackToRangeGet = true
                    }
                }
            }
            headSem.signal()
        }.resume()
        _ = headSem.wait(timeout: .now() + 9)

        if headOk { return true }
        if !shouldFallbackToRangeGet { return false }

        var rangeReq = URLRequest(url: u, timeoutInterval: 8)
        rangeReq.httpMethod = "GET"
        rangeReq.setValue(Self.defaultUA, forHTTPHeaderField: "User-Agent")
        rangeReq.setValue("bytes=0-1", forHTTPHeaderField: "Range")
        let rangeSem = DispatchSemaphore(value: 0)
        var rangeOk = false

        mediaProbeSession.dataTask(with: rangeReq) { _, resp, _ in
            if let http = resp as? HTTPURLResponse,
               http.statusCode == 200 || http.statusCode == 206 {
                let ct = http.value(forHTTPHeaderField: "Content-Type")
                if !self.isDisallowedAudioContentType(ct) {
                    if let totalBytes = self.parseTotalBytesFromHeaders(
                        statusCode: http.statusCode,
                        contentLengthHeader: http.value(forHTTPHeaderField: "Content-Length"),
                        contentRangeHeader: http.value(forHTTPHeaderField: "Content-Range")
                    ) {
                        rangeOk = totalBytes >= minValidBytes
                    } else {
                        rangeOk = true
                    }
                }
            }
            rangeSem.signal()
        }.resume()
        _ = rangeSem.wait(timeout: .now() + 9)
        return rangeOk
    }

    private func httpGetText(_ url: String, headers: [String: String]) -> String? {
        guard let u = URL(string: url), Self.isSafePublicHttpUrl(u) else { return nil }
        var req = URLRequest(url: u, timeoutInterval: 10)
        req.httpMethod = "GET"
        for (k, v) in headers { req.setValue(v, forHTTPHeaderField: k) }
        let sem = DispatchSemaphore(value: 0)
        var result: String?
        session.dataTask(with: req) { data, resp, _ in
            if let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode),
               let d = data {
                result = String(data: d, encoding: .utf8)
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 12)
        return result
    }

    private func parseJsonObject(_ text: String) -> [String: Any]? {
        guard let d = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    private func enc(_ value: String) -> String {
        var allowed = CharacterSet.alphanumerics
        allowed.insert(charactersIn: "-_.~")
        return value.addingPercentEncoding(withAllowedCharacters: allowed) ?? value
    }
}
