import Foundation

/// iOS 外部歌单分享链接安全解析器（汽水音乐 / QQ 音乐 / 酷狗 / 酷我 / 网易云）
/// 安全边界：
/// - 严格校验 SafeHttpGuard.externalPlaylistAllowedDomains 白名单 + POSIX 公网 IP 解析 + 最多 4 跳重定向校验
/// - 单次响应体上限 2MB，仅提取公开歌单名称与 {title, artist} 并做纯文本转义防 XSS
final class ExternalPlaylistParser {
    private static let browserUa =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
    private static let maxResponseBytes = 2 * 1024 * 1024
    private static let maxTracks = 300
    private static let maxRedirects = 4
    private static let fallbackToTextMessage =
        "该链接暂无法自动读取，可复制歌单文字使用「文本导入」"

    struct ParsedTrack {
        let title: String
        let artist: String
        let album: String
        let durationMs: Int64
        let neteaseId: Int64
    }

    private let ncmClient: NeteaseApiClient?
    private let redirectDelegate: SafeRedirectSessionDelegate
    private let session: URLSession

    init(ncmClient: NeteaseApiClient? = nil) {
        self.ncmClient = ncmClient
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 12
        cfg.timeoutIntervalForResource = 16
        cfg.httpShouldSetCookies = false
        cfg.httpCookieAcceptPolicy = .never
        let del = SafeRedirectSessionDelegate(
            allowedSuffixes: SafeHttpGuard.externalPlaylistAllowedDomains,
            maxRedirects: Self.maxRedirects
        )
        self.redirectDelegate = del
        self.session = URLSession(configuration: cfg, delegate: del, delegateQueue: nil)
    }

    func handle(params: [String: String]) -> (status: Int, body: String) {
        let rawInput = (params["url"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if rawInput.isEmpty {
            return (400, jsonString(["code": 400, "ok": false, "message": "请输入外部歌单分享链接"]))
        }

        let candidateUrl = extractCandidateUrl(rawInput)
        guard let initialUrl = URL(string: candidateUrl),
              SafeHttpGuard.validateUrlAndResolve(initialUrl, allowedSuffixes: SafeHttpGuard.externalPlaylistAllowedDomains) else {
            return (
                403,
                jsonString([
                    "code": 403,
                    "ok": false,
                    "blocked": true,
                    "message": "暂不支持该链接域名，请使用汽水 / QQ / 酷狗 / 酷我 / 网易云分享链接或切换至「文本导入」"
                ])
            )
        }

        var platform = detectPlatform(host: initialUrl.host ?? "")

        do {
            let fetched = try fetchBoundedText(url: initialUrl, extraHeaders: [:])
            let finalUrlStr = fetched.finalUrl
            let finalHost = URL(string: finalUrlStr)?.host ?? (initialUrl.host ?? "")
            platform = detectPlatform(host: finalHost)

            var playlistName = ""
            var rawTracks = [ParsedTrack]()

            switch platform {
            case "netease":
                let playlistId = firstMatch(#"[?&]id=(\d{4,16})"#, in: finalUrlStr)
                    ?? firstMatch(#"/playlist/(\d{4,16})"#, in: finalUrlStr)
                    ?? firstMatch(#"/playlist\?[^"'\s]*id=(\d{4,16})"#, in: fetched.body)
                if let id = playlistId, let ncm = ncmClient {
                    let detail = ncm.dispatch(path: "/playlist/detail", params: ["id": id])
                    if let data = detail.body.data(using: .utf8),
                       let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                       let pl = root["playlist"] as? [String: Any] {
                        playlistName = sanitizePlainText(pl["name"] as? String ?? "", maxLen: 80)
                        var seenIds = Set<Int64>()
                        if let list = pl["tracks"] as? [[String: Any]] {
                            for t in list.prefix(Self.maxTracks) {
                                let tid = (t["id"] as? NSNumber)?.int64Value ?? 0
                                let title = (t["name"] as? String) ?? ""
                                let ar = ((t["ar"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
                                let al = ((t["al"] as? [String: Any])?["name"] as? String) ?? ""
                                let dt = (t["dt"] as? NSNumber)?.int64Value ?? 0
                                if tid > 0 { seenIds.insert(tid) }
                                rawTracks.append(ParsedTrack(title: title, artist: ar, album: al, durationMs: dt, neteaseId: tid))
                            }
                        }
                        if let trackIds = pl["trackIds"] as? [[String: Any]], rawTracks.count < Self.maxTracks {
                            let remainCap = Self.maxTracks - rawTracks.count
                            let missing = trackIds.compactMap { ($0["id"] as? NSNumber)?.int64Value }
                                .filter { $0 > 0 && !seenIds.contains($0) }
                                .prefix(remainCap)
                            if !missing.isEmpty {
                                let idsParam = missing.map { "\($0)" }.joined(separator: ",")
                                let sRes = ncm.dispatch(path: "/song/detail", params: ["ids": idsParam])
                                if let sData = sRes.body.data(using: .utf8),
                                   let sRoot = (try? JSONSerialization.jsonObject(with: sData)) as? [String: Any],
                                   let songs = sRoot["songs"] as? [[String: Any]] {
                                    for s in songs {
                                        let tid = (s["id"] as? NSNumber)?.int64Value ?? 0
                                        let title = (s["name"] as? String) ?? ""
                                        let ar = ((s["ar"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
                                        let al = ((s["al"] as? [String: Any])?["name"] as? String) ?? ""
                                        let dt = (s["dt"] as? NSNumber)?.int64Value ?? 0
                                        rawTracks.append(ParsedTrack(title: title, artist: ar, album: al, durationMs: dt, neteaseId: tid))
                                    }
                                }
                            }
                        }
                    }
                }
                if playlistName.isEmpty {
                    playlistName = extractTitleFromHtml(fetched.body)
                }

            case "qq":
                let disstid = firstMatch(#"[?&](?:id|disstid)=(\d{4,16})"#, in: finalUrlStr)
                    ?? firstMatch(#"/playlist/(\d{4,16})"#, in: finalUrlStr)
                    ?? firstMatch(#""disstid"\s*:\s*"?(\d{4,16})"?"#, in: fetched.body)
                if let id = disstid,
                   let apiUrl = URL(string: "https://c.y.qq.com/qzone/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg?type=1&json=1&utf8=1&onlysong=0&new_format=1&disstid=\(id)&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0"),
                   let apiText = try? fetchBoundedText(url: apiUrl, extraHeaders: ["Referer": "https://y.qq.com/"]).body,
                   let start = apiText.firstIndex(of: "{"),
                   let end = apiText.lastIndex(of: "}"),
                   let data = String(apiText[start...end]).data(using: .utf8),
                   let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
                   let cd = (root["cdlist"] as? [[String: Any]])?.first {
                    playlistName = sanitizePlainText(cd["dissname"] as? String ?? "", maxLen: 80)
                    if let list = cd["songlist"] as? [[String: Any]] {
                        for s in list.prefix(Self.maxTracks) {
                            let name = (s["name"] as? String) ?? (s["songname"] as? String) ?? ""
                            let ar = ((s["singer"] as? [[String: Any]]) ?? []).compactMap { $0["name"] as? String }.joined(separator: " / ")
                            let al = ((s["album"] as? [String: Any])?["name"] as? String) ?? (s["albumname"] as? String) ?? ""
                            let dt = ((s["interval"] as? NSNumber)?.int64Value ?? 0) * 1000
                            rawTracks.append(ParsedTrack(title: name, artist: ar, album: al, durationMs: dt, neteaseId: 0))
                        }
                    }
                }
                if rawTracks.isEmpty {
                    let embedded = extractTracksFromHtml(fetched.body)
                    if playlistName.isEmpty { playlistName = embedded.playlistName }
                    rawTracks.append(contentsOf: embedded.tracks)
                }

            case "kuwo":
                let pid = firstMatch(#"playlist_detail/(\d{4,16})"#, in: finalUrlStr)
                    ?? firstMatch(#"[?&](?:pid|id)=(\d{4,16})"#, in: finalUrlStr)
                    ?? firstMatch(#""id"\s*:\s*"?(\d{4,16})"?"#, in: fetched.body)
                if let id = pid,
                   let apiUrl = URL(string: "https://nplserver.kuwo.cn/pl.svc?op=getlistinfo&pid=\(id)&pn=0&rn=300&encode=utf8&keyset=pl2012&identity=kuwo&pcmp4=1&vipver=MUSIC_9.1.1.2_BCS2"),
                   let apiText = try? fetchBoundedText(url: apiUrl, extraHeaders: ["Referer": "https://kuwo.cn/"]).body,
                   let data = apiText.data(using: .utf8),
                   let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    playlistName = sanitizePlainText(root["title"] as? String ?? "", maxLen: 80)
                    if let list = root["musiclist"] as? [[String: Any]] {
                        for m in list.prefix(Self.maxTracks) {
                            let dt = ((m["duration"] as? NSNumber)?.int64Value ?? 0) * 1000
                            rawTracks.append(
                                ParsedTrack(
                                    title: (m["name"] as? String) ?? "",
                                    artist: (m["artist"] as? String) ?? "",
                                    album: (m["album"] as? String) ?? "",
                                    durationMs: dt,
                                    neteaseId: 0
                                )
                            )
                        }
                    }
                }
                if rawTracks.isEmpty {
                    let embedded = extractTracksFromHtml(fetched.body)
                    if playlistName.isEmpty { playlistName = embedded.playlistName }
                    rawTracks.append(contentsOf: embedded.tracks)
                }

            default:
                let specialId = firstMatch(#"[?&]specialid=(\d{4,16})"#, in: finalUrlStr)
                    ?? firstMatch(#"special/single/(\d{4,16})"#, in: finalUrlStr)
                if platform == "kugou", let sid = specialId,
                   let apiUrl = URL(string: "https://m.kugou.com/plist/list/\(sid)?json=true"),
                   let apiText = try? fetchBoundedText(url: apiUrl, extraHeaders: ["Referer": "https://m.kugou.com/"]).body,
                   let data = apiText.data(using: .utf8),
                   let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                    if let listMeta = (root["info"] as? [String: Any])?["list"] as? [String: Any] {
                        playlistName = sanitizePlainText(listMeta["specialname"] as? String ?? "", maxLen: 80)
                    }
                    if let items = ((root["list"] as? [String: Any])?["list"] as? [String: Any])?["info"] as? [[String: Any]] {
                        for item in items.prefix(Self.maxTracks) {
                            let filename = (item["filename"] as? String) ?? ""
                            let dt = ((item["duration"] as? NSNumber)?.int64Value ?? 0) * 1000
                            if let range = filename.range(of: " - ") {
                                let ar = String(filename[..<range.lowerBound]).trimmingCharacters(in: .whitespaces)
                                let title = String(filename[range.upperBound...]).trimmingCharacters(in: .whitespaces)
                                rawTracks.append(ParsedTrack(title: title, artist: ar, album: "", durationMs: dt, neteaseId: 0))
                            } else if !filename.isEmpty {
                                rawTracks.append(ParsedTrack(title: filename, artist: "", album: "", durationMs: dt, neteaseId: 0))
                            }
                        }
                    }
                }
                if rawTracks.isEmpty {
                    let embedded = extractTracksFromHtml(fetched.body)
                    if playlistName.isEmpty { playlistName = embedded.playlistName }
                    rawTracks.append(contentsOf: embedded.tracks)
                }
            }

            let cleanTracks = dedupeTracks(rawTracks)
            if cleanTracks.isEmpty {
                return (
                    200,
                    jsonString([
                        "code": 200,
                        "ok": false,
                        "fallbackToText": true,
                        "platform": platform,
                        "playlistName": playlistName,
                        "message": Self.fallbackToTextMessage
                    ])
                )
            }

            let trackDicts: [[String: Any]] = cleanTracks.map { t in
                var dict: [String: Any] = ["title": t.title, "artist": t.artist]
                if !t.album.isEmpty { dict["album"] = t.album }
                if t.durationMs > 0 { dict["durationMs"] = t.durationMs }
                if t.neteaseId > 0 { dict["neteaseId"] = t.neteaseId }
                return dict
            }
            return (
                200,
                jsonString([
                    "code": 200,
                    "ok": true,
                    "platform": platform,
                    "playlistName": playlistName.isEmpty ? "导入外部歌单" : playlistName,
                    "tracks": trackDicts
                ])
            )
        } catch {
            return (
                200,
                jsonString([
                    "code": 200,
                    "ok": false,
                    "fallbackToText": true,
                    "platform": platform,
                    "message": Self.fallbackToTextMessage
                ])
            )
        }
    }

    private func fetchBoundedText(url: URL, extraHeaders: [String: String]) throws -> (finalUrl: String, body: String) {
        var req = URLRequest(url: url)
        req.httpMethod = "GET"
        req.setValue(Self.browserUa, forHTTPHeaderField: "User-Agent")
        req.setValue("zh-CN,zh;q=0.9,en;q=0.8", forHTTPHeaderField: "Accept-Language")
        for (k, v) in extraHeaders {
            req.setValue(v, forHTTPHeaderField: k)
        }

        let sem = DispatchSemaphore(value: 0)
        var resultData = Data()
        var finalUrl = url.absoluteString
        var outError: Error?

        let task = session.dataTask(with: req) { data, resp, error in
            if let error = error {
                outError = error
            } else {
                if let respUrl = resp?.url?.absoluteString {
                    finalUrl = respUrl
                }
                if let d = data {
                    resultData = d.prefix(Self.maxResponseBytes)
                }
            }
            sem.signal()
        }
        task.resume()
        _ = sem.wait(timeout: .now() + 14.0)
        if let err = outError {
            throw err
        }
        let bodyText = String(data: resultData, encoding: .utf8) ?? ""
        return (finalUrl, bodyText)
    }

    private func extractCandidateUrl(_ rawInput: String) -> String {
        guard let regex = try? NSRegularExpression(pattern: #"https?://[^\s"'<>]+"#, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: rawInput, range: NSRange(rawInput.startIndex..., in: rawInput)),
              let range = Range(match.range, in: rawInput) else {
            return rawInput
        }
        let raw = String(rawInput[range])
        return raw.replacingOccurrences(of: #"[】》）」』”’，。！？、；：.,!?;:'")\]]+$"#, with: "", options: .regularExpression)
    }

    private func detectPlatform(host: String) -> String {
        let h = host.lowercased()
        if h.contains("douyin.com") { return "qishui" }
        if h == "y.qq.com" || h.hasSuffix(".y.qq.com") { return "qq" }
        if h == "kugou.com" || h.hasSuffix(".kugou.com") { return "kugou" }
        if h == "kuwo.cn" || h.hasSuffix(".kuwo.cn") { return "kuwo" }
        if h == "163cn.tv" || h == "music.163.com" || h.hasSuffix(".music.163.com") { return "netease" }
        return "unknown"
    }

    private func sanitizePlainText(_ raw: String, maxLen: Int = 160) -> String {
        guard !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return "" }
        var s = raw
        s = s.replacingOccurrences(of: #"<script\b[^>]*>[\s\S]*?</script>"#, with: " ", options: [.regularExpression, .caseInsensitive])
        s = s.replacingOccurrences(of: #"<style\b[^>]*>[\s\S]*?</style>"#, with: " ", options: [.regularExpression, .caseInsensitive])
        s = s.replacingOccurrences(of: #"<[^>]*>"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: "&amp;", with: "&", options: .caseInsensitive)
            .replacingOccurrences(of: "&lt;", with: "<", options: .caseInsensitive)
            .replacingOccurrences(of: "&gt;", with: ">", options: .caseInsensitive)
            .replacingOccurrences(of: "&quot;", with: "\"", options: .caseInsensitive)
            .replacingOccurrences(of: "&apos;", with: "'", options: .caseInsensitive)
            .replacingOccurrences(of: "&#39;", with: "'")
            .replacingOccurrences(of: "&nbsp;", with: " ", options: .caseInsensitive)
        s = s.replacingOccurrences(of: #"<[^>]*>"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"[\u{0000}-\u{001F}\u{007F}\u{200B}-\u{200F}\u{FEFF}]"#, with: " ", options: .regularExpression)
        s = s.replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression).trimmingCharacters(in: .whitespacesAndNewlines)
        if maxLen > 0 && s.count > maxLen {
            s = String(s.prefix(maxLen)).trimmingCharacters(in: .whitespacesAndNewlines)
        }
        return s
    }

    private func extractTitleFromHtml(_ html: String) -> String {
        let raw = firstMatch(#"<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{1,160})["']"#, in: html)
            ?? firstMatch(#"<title[^>]*>([^<]{1,160})</title>"#, in: html)
            ?? ""
        let stripped = raw.replacingOccurrences(
            of: #"[-_|\s]*(?:QQ音乐|酷狗音乐|酷我音乐|网易云音乐|汽水音乐).*$"#,
            with: "",
            options: [.regularExpression, .caseInsensitive]
        )
        return sanitizePlainText(stripped, maxLen: 80)
    }

    private func extractTracksFromHtml(_ html: String) -> (playlistName: String, tracks: [ParsedTrack]) {
        var playlistName = extractTitleFromHtml(html)
        var tracks = [ParsedTrack]()

        if let regex = try? NSRegularExpression(pattern: #""filename"\s*:\s*"([^"]{2,160})""#) {
            let matches = regex.matches(in: html, range: NSRange(html.startIndex..., in: html))
            for m in matches.prefix(Self.maxTracks) {
                if let r = Range(m.range(at: 1), in: html) {
                    let raw = sanitizePlainText(String(html[r]), maxLen: 140)
                    if let dash = raw.range(of: " - ") {
                        let ar = String(raw[..<dash.lowerBound]).trimmingCharacters(in: .whitespaces)
                        let title = String(raw[dash.upperBound...]).trimmingCharacters(in: .whitespaces)
                        tracks.append(ParsedTrack(title: title, artist: ar, album: "", durationMs: 0, neteaseId: 0))
                    } else if !raw.isEmpty {
                        tracks.append(ParsedTrack(title: raw, artist: "", album: "", durationMs: 0, neteaseId: 0))
                    }
                }
            }
        }

        for jsonBlock in extractAssignedJsonObjects(html) {
            guard let d = jsonBlock.data(using: .utf8),
                  let root = try? JSONSerialization.jsonObject(with: d) else { continue }
            var stack: [Any] = [root]
            var visited = 0
            while !stack.isEmpty && visited < 4000 {
                visited += 1
                let node = stack.removeLast()
                if let arr = node as? [Any] {
                    stack.append(contentsOf: arr.reversed())
                    continue
                }
                guard let dict = node as? [String: Any] else { continue }
                let candTitle = (dict["songname"] as? String)
                    ?? (dict["songName"] as? String)
                    ?? (dict["track_name"] as? String)
                    ?? ((dict["singer"] != nil || dict["artists"] != nil || dict["artist"] != nil || dict["author"] != nil)
                        ? ((dict["name"] as? String) ?? (dict["title"] as? String))
                        : nil)
                if let title = candTitle, !title.isEmpty {
                    let artist = extractArtist(from: dict)
                    tracks.append(ParsedTrack(title: title, artist: artist, album: "", durationMs: 0, neteaseId: 0))
                }
                if playlistName.isEmpty {
                    let pl = (dict["dissname"] as? String) ?? (dict["specialname"] as? String) ?? (dict["playlist_name"] as? String)
                    if let pl = pl, !pl.isEmpty {
                        playlistName = sanitizePlainText(pl, maxLen: 80)
                    }
                }
                let childValues = dict.values.filter { $0 is [String: Any] || $0 is [Any] }
                stack.append(contentsOf: childValues.reversed())
            }
        }

        return (playlistName, dedupeTracks(tracks))
    }

    private func extractAssignedJsonObjects(_ html: String) -> [String] {
        guard let regex = try? NSRegularExpression(pattern: #"(?:window\.__INITIAL_STATE__|window\._ROUTER_DATA|window\.__DATA__|dataFromSmarty)\s*="#) else {
            return []
        }
        var results = [String]()
        let nsRange = NSRange(html.startIndex..., in: html)
        for match in regex.matches(in: html, range: nsRange) {
            guard let assignEnd = Range(match.range, in: html)?.upperBound else { continue }
            var idx = assignEnd
            while idx < html.endIndex && html[idx].isWhitespace {
                idx = html.index(after: idx)
            }
            guard idx < html.endIndex, html[idx] == "{" else { continue }
            let start = idx
            var depth = 0
            var inStr = false
            var escaped = false
            var steps = 0
            while idx < html.endIndex && steps < 250_000 {
                let ch = html[idx]
                if inStr {
                    if escaped {
                        escaped = false
                    } else if ch == "\\" {
                        escaped = true
                    } else if ch == "\"" {
                        inStr = false
                    }
                } else {
                    if ch == "\"" {
                        inStr = true
                    } else if ch == "{" {
                        depth += 1
                    } else if ch == "}" {
                        depth -= 1
                        if depth == 0 {
                            results.append(String(html[start...idx]))
                            break
                        }
                    }
                }
                idx = html.index(after: idx)
                steps += 1
            }
        }
        return results
    }

    private func extractArtist(from dict: [String: Any]) -> String {
        for key in ["singer", "artists", "artist_list", "artist", "author"] {
            guard let val = dict[key] else { continue }
            if let s = val as? String { return s }
            if let arr = val as? [Any] {
                let names = arr.compactMap { item -> String? in
                    if let str = item as? String { return str }
                    if let obj = item as? [String: Any] {
                        return (obj["name"] as? String) ?? (obj["singer_name"] as? String)
                    }
                    return nil
                }.filter { !$0.isEmpty }
                if !names.isEmpty { return names.joined(separator: " / ") }
            }
            if let obj = val as? [String: Any] {
                if let n = (obj["name"] as? String) ?? (obj["singer_name"] as? String), !n.isEmpty {
                    return n
                }
            }
        }
        return ""
    }

    private func dedupeTracks(_ tracks: [ParsedTrack]) -> [ParsedTrack] {
        var seen = Set<String>()
        var out = [ParsedTrack]()
        for t in tracks {
            let cleanTitle = sanitizePlainText(t.title, maxLen: 120)
            let cleanArtist = sanitizePlainText(t.artist, maxLen: 80)
            guard !cleanTitle.isEmpty else { continue }
            let key = "\(cleanTitle.lowercased())::\(cleanArtist.lowercased())"
            if seen.contains(key) { continue }
            seen.insert(key)
            out.append(
                ParsedTrack(
                    title: cleanTitle,
                    artist: cleanArtist,
                    album: sanitizePlainText(t.album, maxLen: 100),
                    durationMs: max(0, t.durationMs),
                    neteaseId: max(0, t.neteaseId)
                )
            )
            if out.count >= Self.maxTracks { break }
        }
        return out
    }

    private func firstMatch(_ pattern: String, in text: String) -> String? {
        guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              match.numberOfRanges > 1,
              let range = Range(match.range(at: 1), in: text) else {
            return nil
        }
        return String(text[range])
    }

    private func jsonString(_ obj: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: obj, options: []),
              let str = String(data: data, encoding: .utf8) else {
            return "{}"
        }
        return str
    }
}
