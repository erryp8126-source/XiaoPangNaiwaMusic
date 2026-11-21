import Foundation
import Network
import AVFoundation
import Security
import UIKit

/// iOS 内置回环 HTTP/1.1 服务器 (127.0.0.1:30488)
/// 安全边界：
/// 1. 强制校验每次启动随机生成的会话鉴权 Token（X-Alger-Token / ?token=），阻断外部越权访问
/// 2. CORS 严格仅允许本机回环同源，不再反射任意 Origin
/// 3. `/local-file` 与 `/local-cover` 严格校验音频扩展名与 Documents 规范化目录边界
final class LocalHttpServer {
    private static let allowedAudioExts: Set<String> = [
        "mp3", "flac", "m4a", "aac", "wav", "ogg", "oga", "opus", "alac"
    ]

    private let ncmClient: NeteaseApiClient
    private let unblockEngine: MusicUnblockEngine
    private let queue = DispatchQueue(label: "com.alger.musicplayer.httpserver", attributes: .concurrent)

    let authToken: String
    private var listener: NWListener?
    private(set) var port: Int = 30488
    private(set) var isRunning: Bool = false

    init(ncmClient: NeteaseApiClient, unblockEngine: MusicUnblockEngine) {
        self.ncmClient = ncmClient
        self.unblockEngine = unblockEngine
        self.authToken = Self.generateSessionToken()
    }

    private static func generateSessionToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        let status = SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes)
        if status == errSecSuccess {
            return bytes.map { String(format: "%02x", $0) }.joined()
        }
        return UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
            + UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
    }

    @discardableResult
    func start(preferredPort: Int = 30488) -> Int {
        for candidate in preferredPort...(preferredPort + 10) {
            if tryStart(on: UInt16(candidate)) {
                self.port = candidate
                self.isRunning = true
                return candidate
            }
        }
        self.isRunning = false
        return -1
    }

    func ensureAlive() {
        if !isRunning || listener == nil {
            _ = start(preferredPort: port)
        }
    }

    func stop() {
        listener?.cancel()
        listener = nil
        isRunning = false
    }

    private func tryStart(on portValue: UInt16) -> Bool {
        guard let nwPort = NWEndpoint.Port(rawValue: portValue) else { return false }
        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: nwPort)

        guard let newListener = try? NWListener(using: params) else { return false }

        let sem = DispatchSemaphore(value: 0)
        var started = false
        var resolved = false

        newListener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if !resolved {
                    resolved = true
                    started = true
                    sem.signal()
                }
                self?.isRunning = true
            case .failed, .cancelled:
                self?.isRunning = false
                if !resolved {
                    resolved = true
                    started = false
                    sem.signal()
                }
            default:
                break
            }
        }

        newListener.newConnectionHandler = { [weak self] conn in
            self?.handleConnection(conn)
        }

        newListener.start(queue: queue)
        _ = sem.wait(timeout: .now() + 2.0)

        if started {
            self.listener = newListener
            return true
        } else {
            newListener.cancel()
            return false
        }
    }

    // MARK: - Connection & HTTP/1.1 Parsing

    private struct HttpRequest {
        let method: String
        let path: String
        let query: [String: String]
        let headers: [String: String]
        let body: Data
    }

    private struct HttpResponse {
        let status: Int
        let statusText: String
        let contentType: String
        var headers: [String: String] = [:]
        var multiHeaders: [(String, String)] = []
        let body: Data
    }

    private func handleConnection(_ conn: NWConnection) {
        conn.start(queue: queue)
        receiveFullRequest(conn: conn, accumulated: Data(), expectedTotal: nil)
    }

    private func receiveFullRequest(conn: NWConnection, accumulated: Data, expectedTotal: Int?) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else {
                conn.cancel()
                return
            }
            if error != nil {
                conn.cancel()
                return
            }

            var buf = accumulated
            if let chunk = data, !chunk.isEmpty {
                buf.append(chunk)
            }

            let sep = Data("\r\n\r\n".utf8)
            var targetLen = expectedTotal
            if targetLen == nil, let range = buf.range(of: sep) {
                let headerStr = String(data: buf[..<range.lowerBound], encoding: .utf8) ?? ""
                var contentLength = 0
                for line in headerStr.components(separatedBy: "\r\n").dropFirst() {
                    if let colon = line.firstIndex(of: ":") {
                        let k = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                        if k == "content-length" {
                            let v = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                            contentLength = Int(v) ?? 0
                        }
                    }
                }
                targetLen = range.upperBound + contentLength
            }

            if let total = targetLen, buf.count >= total {
                self.processHttpBuffer(buf, conn: conn)
                return
            }

            if isComplete {
                if !buf.isEmpty {
                    self.processHttpBuffer(buf, conn: conn)
                } else {
                    conn.cancel()
                }
                return
            }

            self.receiveFullRequest(conn: conn, accumulated: buf, expectedTotal: targetLen)
        }
    }

    private func isTrustedOrigin(_ origin: String) -> Bool {
        let normalized = origin.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .lowercased()
        return normalized == "http://127.0.0.1:\(port)" || normalized == "http://localhost:\(port)"
    }

    private func isAuthorized(_ req: HttpRequest) -> Bool {
        if authToken.isEmpty { return true }
        let candidate = (req.headers["x-alger-token"] ?? req.query["token"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard candidate.count == authToken.count else { return false }
        var diff: UInt8 = 0
        for (a, b) in zip(candidate.utf8, authToken.utf8) {
            diff |= (a ^ b)
        }
        return diff == 0
    }

    private func isAllowedAudioFile(_ fileUrl: URL) -> Bool {
        let ext = fileUrl.pathExtension.lowercased()
        guard Self.allowedAudioExts.contains(ext) else { return false }
        guard let docsDir = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first else {
            return false
        }
        let docsRoot = docsDir.standardizedFileURL.resolvingSymlinksInPath().path
        let targetPath = fileUrl.standardizedFileURL.resolvingSymlinksInPath().path
        return targetPath.hasPrefix(docsRoot + "/")
    }

    private func processHttpBuffer(_ raw: Data, conn: NWConnection) {
        guard let req = parseHttpRequest(raw) else {
            conn.cancel()
            return
        }

        let origin = req.headers["origin"]
        if let origin = origin, !isTrustedOrigin(origin) {
            let forbidden = jsonResponse(status: 403, obj: ["code": 403, "msg": "Forbidden Origin"])
            sendHttpResponse(forbidden, conn: conn)
            return
        }

        var resp: HttpResponse
        if req.method == "OPTIONS" {
            resp = HttpResponse(status: 200, statusText: "OK", contentType: "text/plain", body: Data())
        } else {
            let isStaticAppAsset = req.path == "/__app" || req.path == "/__app/" || req.path.hasPrefix("/__app/")
            if !isStaticAppAsset && !isAuthorized(req) {
                resp = jsonResponse(status: 401, obj: ["code": 401, "msg": "Unauthorized"])
            } else {
                resp = routeRequest(req)
            }
        }

        if let origin = origin, isTrustedOrigin(origin), req.path != "/local-file" {
            resp.headers["Access-Control-Allow-Origin"] = origin
            resp.headers["Access-Control-Allow-Credentials"] = "true"
            resp.headers["Vary"] = "Origin"
        }
        resp.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, Cookie, Range, X-Alger-Token"
        if resp.headers["Cache-Control"] == nil {
            resp.headers["Cache-Control"] = "no-store"
        }

        sendHttpResponse(resp, conn: conn)
    }

    private func parseHttpRequest(_ data: Data) -> HttpRequest? {
        let sep = Data("\r\n\r\n".utf8)
        guard let range = data.range(of: sep) else { return nil }
        guard let headerText = String(data: data[..<range.lowerBound], encoding: .utf8) else { return nil }
        let lines = headerText.components(separatedBy: "\r\n")
        guard let firstLine = lines.first else { return nil }
        let parts = firstLine.split(separator: " ", maxSplits: 2)
        guard parts.count >= 2 else { return nil }

        let method = String(parts[0]).uppercased()
        let rawTarget = String(parts[1])

        var path = rawTarget
        var query = [String: String]()
        if let qIdx = rawTarget.firstIndex(of: "?") {
            path = String(rawTarget[..<qIdx])
            let qStr = String(rawTarget[rawTarget.index(after: qIdx)...])
            query = parseQueryString(qStr)
        }
        path = path.removingPercentEncoding ?? path

        var headers = [String: String]()
        for line in lines.dropFirst() {
            if let colon = line.firstIndex(of: ":") {
                let k = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
                let v = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
                headers[k] = v
            }
        }

        let body = Data(data[range.upperBound...])
        return HttpRequest(method: method, path: path, query: query, headers: headers, body: body)
    }

    private func sendHttpResponse(_ resp: HttpResponse, conn: NWConnection) {
        var headerStr = "HTTP/1.1 \(resp.status) \(resp.statusText)\r\n"
        headerStr += "Content-Type: \(resp.contentType)\r\n"
        headerStr += "Content-Length: \(resp.body.count)\r\n"
        headerStr += "Connection: close\r\n"
        for (k, v) in resp.headers {
            headerStr += "\(k): \(v)\r\n"
        }
        for (k, v) in resp.multiHeaders {
            headerStr += "\(k): \(v)\r\n"
        }
        headerStr += "\r\n"

        var out = Data(headerStr.utf8)
        out.append(resp.body)

        conn.send(content: out, completion: .contentProcessed { _ in
            conn.cancel()
        })
    }

    // MARK: - Router

    private func routeRequest(_ req: HttpRequest) -> HttpResponse {
        let path = req.path

        if path == "/__alger_health" {
            return handleHealth()
        }
        if path == "/__app" || path == "/__app/" || path.hasPrefix("/__app/") {
            return handleStaticAsset(path: path)
        }
        if path == "/local-file" {
            return handleLocalFile(req)
        }
        if path == "/local-cover" {
            return handleLocalCover(req)
        }
        if path == "/music" || path == "/unblock" {
            return handleMusicUnblock(req)
        }
        return handleNeteaseApi(req)
    }

    private func handleHealth() -> HttpResponse {
        let appVer = (Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String) ?? "5.1.3"
        let obj: [String: Any] = [
            "status": "ok",
            "port": port,
            "hasAnonToken": ncmClient.hasAnonymousToken(),
            "platform": "ios",
            "version": "\(appVer)-ios"
        ]
        return jsonResponse(status: 200, obj: obj)
    }

    private func handleStaticAsset(path: String) -> HttpResponse {
        guard let wwwDir = Bundle.main.resourceURL?.appendingPathComponent("www", isDirectory: true) else {
            return HttpResponse(status: 404, statusText: "Not Found", contentType: "text/plain", body: Data("www bundle missing".utf8))
        }

        var relPath = path.hasPrefix("/__app/") ? String(path.dropFirst(7)) : ""
        if relPath.isEmpty || relPath.hasSuffix("/") {
            relPath += "index.html"
        }
        // 防止路径穿越
        let cleaned = relPath.replacingOccurrences(of: "..", with: "")
        var fileUrl = wwwDir.appendingPathComponent(cleaned)
        if !FileManager.default.fileExists(atPath: fileUrl.path) {
            fileUrl = wwwDir.appendingPathComponent("index.html")
        }

        guard let data = try? Data(contentsOf: fileUrl) else {
            return HttpResponse(status: 404, statusText: "Not Found", contentType: "text/plain", body: Data("Asset not found".utf8))
        }

        var resp = HttpResponse(status: 200, statusText: "OK", contentType: guessStaticMime(fileUrl.path), body: data)
        if cleaned.hasPrefix("assets/") {
            resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        } else {
            resp.headers["Cache-Control"] = "no-cache"
        }
        return resp
    }

    private func handleNeteaseApi(_ req: HttpRequest) -> HttpResponse {
        var params = collectParams(req)
        params.removeValue(forKey: "token")
        if (params["cookie"] ?? "").isEmpty,
           let headerCookie = req.headers["cookie"], !headerCookie.isEmpty,
           params["noCookie"] != "true" {
            params["cookie"] = headerCookie
        }

        let apiRes = ncmClient.dispatch(path: req.path, params: params)
        var resp = HttpResponse(
            status: apiRes.status,
            statusText: httpStatusText(apiRes.status),
            contentType: "application/json; charset=utf-8",
            body: Data(apiRes.body.utf8)
        )
        for c in apiRes.cookies {
            resp.multiHeaders.append(("Set-Cookie", c))
        }
        return resp
    }

    private func handleMusicUnblock(_ req: HttpRequest) -> HttpResponse {
        let params = collectParams(req)
        let songId = params["id"] ?? ""
        var songName = params["name"] ?? ""
        var artists = params["artist"] ?? ""

        if songName.isEmpty && !songId.isEmpty {
            let detailRes = ncmClient.dispatch(path: "/song/detail", params: ["ids": songId])
            if let d = detailRes.body.data(using: .utf8),
               let root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
               let songs = root["songs"] as? [[String: Any]],
               let s = songs.first {
                songName = (s["name"] as? String) ?? ""
                if let ar = s["ar"] as? [[String: Any]] {
                    artists = ar.compactMap { $0["name"] as? String }.joined(separator: " ")
                }
            }
        }

        let sources = params["sources"]?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty } ?? ["kuwo", "kugou", "migu", "gdmusic"]

        if let res = unblockEngine.unblock(songId: songId, songName: songName, artists: artists, enabledSources: sources) {
            return jsonResponse(status: 200, obj: [
                "code": 200,
                "message": "success",
                "data": [
                    "url": res.url,
                    "br": res.br,
                    "size": res.size,
                    "platform": res.platform,
                    "gain": 0
                ]
            ])
        }
        return jsonResponse(status: 200, obj: ["code": 404, "message": "未能解析到可用音源"])
    }

    private func handleLocalFile(_ req: HttpRequest) -> HttpResponse {
        let params = collectParams(req)
        guard let rawPath = params["path"], !rawPath.isEmpty else {
            return HttpResponse(status: 400, statusText: "Bad Request", contentType: "text/plain", body: Data("Missing path".utf8))
        }
        let decoded = rawPath.removingPercentEncoding ?? rawPath
        let fileUrl = URL(fileURLWithPath: decoded)
        guard isAllowedAudioFile(fileUrl) else {
            return HttpResponse(status: 403, statusText: "Forbidden", contentType: "text/plain", body: Data("Forbidden file".utf8))
        }
        guard FileManager.default.fileExists(atPath: fileUrl.path),
              let attrs = try? FileManager.default.attributesOfItem(atPath: fileUrl.path),
              let totalLen = (attrs[.size] as? NSNumber)?.int64Value, totalLen > 0 else {
            return HttpResponse(status: 404, statusText: "Not Found", contentType: "text/plain", body: Data("File not found".utf8))
        }

        let mime = guessAudioMime(decoded)
        if let rangeHeader = req.headers["range"], rangeHeader.hasPrefix("bytes=") {
            let spec = rangeHeader.dropFirst(6).split(separator: ",").first.map(String.init) ?? ""
            let parts = spec.split(separator: "-", omittingEmptySubsequences: false)
            let start = Int64(parts.first ?? "") ?? 0
            let endRaw = parts.count > 1 ? Int64(parts[1]) : nil
            let end = min(endRaw ?? (totalLen - 1), totalLen - 1)
            if start >= 0 && start <= end && end < totalLen,
               let fh = try? FileHandle(forReadingFrom: fileUrl) {
                defer { try? fh.close() }
                try? fh.seek(toOffset: UInt64(start))
                let chunkLen = Int(end - start + 1)
                let chunkData = fh.readData(ofLength: chunkLen)
                var resp = HttpResponse(status: 206, statusText: "Partial Content", contentType: mime, body: chunkData)
                resp.headers["Accept-Ranges"] = "bytes"
                resp.headers["Content-Range"] = "bytes \(start)-\(end)/\(totalLen)"
                return resp
            }
        }

        let fullData = (try? Data(contentsOf: fileUrl)) ?? Data()
        var resp = HttpResponse(status: 200, statusText: "OK", contentType: mime, body: fullData)
        resp.headers["Accept-Ranges"] = "bytes"
        return resp
    }

    private func handleLocalCover(_ req: HttpRequest) -> HttpResponse {
        let params = collectParams(req)
        guard let rawPath = params["path"], !rawPath.isEmpty else {
            return HttpResponse(status: 404, statusText: "Not Found", contentType: "text/plain", body: Data("No cover".utf8))
        }
        let decoded = rawPath.removingPercentEncoding ?? rawPath
        let fileUrl = URL(fileURLWithPath: decoded)
        guard isAllowedAudioFile(fileUrl) else {
            return HttpResponse(status: 403, statusText: "Forbidden", contentType: "text/plain", body: Data("Forbidden path".utf8))
        }
        guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            return HttpResponse(status: 404, statusText: "Not Found", contentType: "text/plain", body: Data("No cover".utf8))
        }

        let asset = AVURLAsset(url: fileUrl)
        for item in asset.commonMetadata where item.commonKey == .commonKeyArtwork {
            if let imgData = item.dataValue, !imgData.isEmpty {
                if let img = UIImage(data: imgData), let jpg = img.jpegData(compressionQuality: 0.82) {
                    return HttpResponse(status: 200, statusText: "OK", contentType: "image/jpeg", body: jpg)
                }
                return HttpResponse(status: 200, statusText: "OK", contentType: "image/jpeg", body: imgData)
            }
        }
        return HttpResponse(status: 404, statusText: "Not Found", contentType: "text/plain", body: Data("No cover".utf8))
    }

    // MARK: - Helpers

    private func collectParams(_ req: HttpRequest) -> [String: String] {
        var result = req.query
        if (req.method == "POST" || req.method == "PUT") && !req.body.isEmpty {
            if let bodyStr = String(data: req.body, encoding: .utf8) {
                let trimmed = bodyStr.trimmingCharacters(in: .whitespacesAndNewlines)
                if trimmed.hasPrefix("{"),
                   let obj = (try? JSONSerialization.jsonObject(with: req.body)) as? [String: Any] {
                    for (k, v) in obj {
                        if v is NSNull { continue }
                        if let s = v as? String {
                            result[k] = s
                        } else if let n = v as? NSNumber {
                            result[k] = "\(n)"
                        } else if JSONSerialization.isValidJSONObject(v),
                                  let d = try? JSONSerialization.data(withJSONObject: v),
                                  let s = String(data: d, encoding: .utf8) {
                            result[k] = s
                        }
                    }
                } else {
                    for (k, v) in parseQueryString(trimmed) {
                        result[k] = v
                    }
                }
            }
        }
        return result
    }

    private func parseQueryString(_ q: String) -> [String: String] {
        var map = [String: String]()
        for pair in q.split(separator: "&") {
            guard let eq = pair.firstIndex(of: "=") else { continue }
            let rawK = String(pair[..<eq]).replacingOccurrences(of: "+", with: " ")
            let rawV = String(pair[pair.index(after: eq)...]).replacingOccurrences(of: "+", with: " ")
            let k = rawK.removingPercentEncoding ?? rawK
            let v = rawV.removingPercentEncoding ?? rawV
            if !k.isEmpty { map[k] = v }
        }
        return map
    }

    private func jsonResponse(status: Int, obj: Any) -> HttpResponse {
        let data = (try? JSONSerialization.data(withJSONObject: obj, options: [])) ?? Data("{}".utf8)
        return HttpResponse(status: status, statusText: httpStatusText(status), contentType: "application/json; charset=utf-8", body: data)
    }

    private func httpStatusText(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 206: return "Partial Content"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 500: return "Internal Server Error"
        case 502: return "Bad Gateway"
        default: return "OK"
        }
    }

    private func guessStaticMime(_ path: String) -> String {
        let lower = path.lowercased()
        if lower.hasSuffix(".html") { return "text/html; charset=utf-8" }
        if lower.hasSuffix(".js") || lower.hasSuffix(".mjs") { return "application/javascript; charset=utf-8" }
        if lower.hasSuffix(".css") { return "text/css; charset=utf-8" }
        if lower.hasSuffix(".json") || lower.hasSuffix(".webmanifest") { return "application/json; charset=utf-8" }
        if lower.hasSuffix(".png") { return "image/png" }
        if lower.hasSuffix(".jpg") || lower.hasSuffix(".jpeg") { return "image/jpeg" }
        if lower.hasSuffix(".svg") { return "image/svg+xml" }
        if lower.hasSuffix(".ico") { return "image/x-icon" }
        if lower.hasSuffix(".woff2") { return "font/woff2" }
        if lower.hasSuffix(".woff") { return "font/woff" }
        if lower.hasSuffix(".ttf") { return "font/ttf" }
        if lower.hasSuffix(".webp") { return "image/webp" }
        return "application/octet-stream"
    }

    private func guessAudioMime(_ path: String) -> String {
        let lower = path.lowercased()
        if lower.hasSuffix(".flac") { return "audio/flac" }
        if lower.hasSuffix(".wav") { return "audio/wav" }
        if lower.hasSuffix(".ogg") || lower.hasSuffix(".oga") { return "audio/ogg" }
        if lower.hasSuffix(".m4a") || lower.hasSuffix(".aac") { return "audio/mp4" }
        if lower.hasSuffix(".opus") { return "audio/opus" }
        return "audio/mpeg"
    }
}
