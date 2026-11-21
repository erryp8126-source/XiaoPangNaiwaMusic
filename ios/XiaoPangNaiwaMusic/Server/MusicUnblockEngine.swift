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

    private let session: URLSession

    init() {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 12
        cfg.timeoutIntervalForResource = 18
        cfg.httpShouldSetCookies = false
        self.session = URLSession(configuration: cfg)
    }

    func unblock(
        songId: String,
        songName: String,
        artists: String,
        enabledSources: [String] = ["kuwo", "kugou", "migu", "gdmusic"]
    ) -> UnblockResult? {
        let keyword = "\(songName) \(artists)".trimmingCharacters(in: .whitespacesAndNewlines)
        guard !keyword.isEmpty else { return nil }

        let ordered = enabledSources.isEmpty ? ["kuwo", "kugou", "migu", "gdmusic"] : enabledSources
        for src in ordered {
            let res: UnblockResult?
            switch src.lowercased() {
            case "kuwo":
                res = searchKuwo(keyword: keyword)
            case "kugou":
                res = searchKugou(keyword: keyword)
            case "migu":
                res = searchMigu(keyword: keyword)
            case "gdmusic", "pyncmd", "qq", "joox":
                res = searchGdMusic(keyword: keyword)
            default:
                res = nil
            }
            if let r = res, r.url.hasPrefix("http") {
                return r
            }
        }

        if !ordered.contains(where: { $0.lowercased() == "gdmusic" }) {
            if let fallback = searchGdMusic(keyword: keyword), fallback.url.hasPrefix("http") {
                return fallback
            }
        }
        return nil
    }

    private func searchKuwo(keyword: String) -> UnblockResult? {
        let q = enc(keyword)
        let searchUrl = "http://search.kuwo.cn/r.s?all=\(q)&ft=music&rformat=json&encoding=utf8&pcjson=1&vipver=1&pn=0&rn=5"
        guard let body = httpGetText(searchUrl, headers: ["User-Agent": Self.defaultUA]),
              let root = parseJsonObject(body.replacingOccurrences(of: "'", with: "\"")),
              let list = root["abslist"] as? [[String: Any]], !list.isEmpty else {
            return nil
        }

        for obj in list {
            guard let rawRid = obj["MUSICRID"] as? String else { continue }
            let rid = rawRid.hasPrefix("MUSIC_") ? String(rawRid.dropFirst(6)) : rawRid
            let urlApi = "https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=\(rid)&format=mp3"
            if let urlBody = httpGetText(urlApi, headers: ["User-Agent": Self.defaultUA]),
               let urlJson = parseJsonObject(urlBody),
               let playUrl = urlJson["url"] as? String, playUrl.hasPrefix("http") {
                return UnblockResult(url: playUrl, br: 320000, size: 0, platform: "kuwo")
            }

            let altApi = "http://www.kuwo.cn/api/v1/www/music/playUrl?mid=\(rid)&type=music&httpsStatus=1&br=320kmp3"
            if let altBody = httpGetText(altApi, headers: ["User-Agent": Self.defaultUA, "Referer": "http://www.kuwo.cn/"]),
               let altJson = parseJsonObject(altBody),
               let data = altJson["data"] as? [String: Any],
               let altUrl = data["url"] as? String, altUrl.hasPrefix("http") {
                return UnblockResult(url: altUrl, br: 320000, size: 0, platform: "kuwo")
            }
        }
        return nil
    }

    private func searchKugou(keyword: String) -> UnblockResult? {
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
            if !chosen.isEmpty {
                return UnblockResult(url: chosen, br: 320000, size: 0, platform: "kugou")
            }
        }
        return nil
    }

    private func searchMigu(keyword: String) -> UnblockResult? {
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
                    if finalUrl.hasPrefix("http") {
                        return UnblockResult(url: finalUrl, br: 320000, size: 0, platform: "migu")
                    }
                }
            }
            let direct = "https://app.pd.nf.migu.cn/MIGUM3.0/v1.0/content/sub/listenSong.do?channel=mx&copyrightId=\(copyrightId)&contentId=\(contentId)&toneFlag=HQ&resourceType=2&userId=15548614588710179085069&netType=00"
            if checkAudioUrlReachable(direct) {
                return UnblockResult(url: direct, br: 320000, size: 0, platform: "migu")
            }
        }
        return nil
    }

    private func searchGdMusic(keyword: String) -> UnblockResult? {
        let sources = ["joox", "kuwo", "kugou", "netease", "tidal"]
        let baseUrl = "https://music-api.gdstudio.xyz/api.php"
        for source in sources {
            let searchUrl = "\(baseUrl)?types=search&source=\(source)&name=\(enc(keyword))&count=3&pages=1"
            guard let body = httpGetText(searchUrl, headers: ["User-Agent": Self.defaultUA]),
                  let data = body.data(using: .utf8),
                  let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]],
                  let first = arr.first else { continue }
            let trackId = "\(first["id"] ?? "")"
            if trackId.isEmpty { continue }
            let trackSource = (first["source"] as? String) ?? source
            let urlEndpoint = "\(baseUrl)?types=url&source=\(trackSource)&id=\(trackId)&br=999"
            guard let urlBody = httpGetText(urlEndpoint, headers: ["User-Agent": Self.defaultUA]),
                  let urlObj = parseJsonObject(urlBody),
                  let rawUrl = urlObj["url"] as? String else { continue }
            let playUrl = rawUrl.replacingOccurrences(of: "\\", with: "")
            if playUrl.hasPrefix("http") {
                let br = ((urlObj["br"] as? Int) ?? 320) * 1000
                let size = (urlObj["size"] as? NSNumber)?.int64Value ?? 0
                return UnblockResult(url: playUrl, br: br, size: size, platform: "gdmusic:\(trackSource)")
            }
        }
        return nil
    }

    static func isSafePublicHttpUrl(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else {
            return false
        }
        guard let host = url.host?.lowercased().trimmingCharacters(in: .whitespacesAndNewlines), !host.isEmpty else {
            return false
        }
        if host == "localhost" || host == "127.0.0.1" || host == "0.0.0.0" || host == "::1" || host.hasSuffix(".local") {
            return false
        }
        if host.hasPrefix("127.") || host.hasPrefix("10.") || host.hasPrefix("192.168.") || host.hasPrefix("169.254.") {
            return false
        }
        if host.range(of: #"^172\.(1[6-9]|2[0-9]|3[0-1])\."#, options: .regularExpression) != nil {
            return false
        }
        return true
    }

    func proxyHttpRequest(
        url: String,
        method: String = "GET",
        headers: [String: String] = [:],
        body: String? = nil,
        form: [String: String]? = nil,
        timeoutMs: Double = 15000
    ) -> [String: Any] {
        guard let nsUrl = URL(string: url), Self.isSafePublicHttpUrl(nsUrl) else {
            return ["statusCode": 403, "headers": [:], "body": "Blocked non-public or invalid URL", "finalUrl": url]
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

        let task = session.dataTask(with: req) { data, response, _ in
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

    private func checkAudioUrlReachable(_ url: String) -> Bool {
        guard let u = URL(string: url) else { return false }
        var req = URLRequest(url: u, timeoutInterval: 8)
        req.httpMethod = "HEAD"
        req.setValue(Self.defaultUA, forHTTPHeaderField: "User-Agent")
        let sem = DispatchSemaphore(value: 0)
        var ok = false
        session.dataTask(with: req) { _, resp, _ in
            if let http = resp as? HTTPURLResponse, (200...299).contains(http.statusCode) {
                let ct = (http.value(forHTTPHeaderField: "Content-Type") ?? "").lowercased()
                ok = !ct.contains("text/html")
            }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 9)
        return ok
    }

    private func httpGetText(_ url: String, headers: [String: String]) -> String? {
        guard let u = URL(string: url) else { return nil }
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
