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
    internal static let maxHeaderBytes = 16 * 1024
    internal static let maxBodyBytes = 16 * 1024 * 1024
    internal static let connectionReceiveTimeoutSec: TimeInterval = 15.0
    private static let fileStreamChunkBytes = 256 * 1024
    private static let allowedAudioExts: Set<String> = [
        "mp3", "flac", "m4a", "aac", "wav", "ogg", "oga", "opus", "alac"
    ]

    internal enum RequestFrameEvaluation: Equatable {
        case needMoreHeaders
        case needMoreBody(expectedTotal: Int)
        case complete(expectedTotal: Int)
        case reject(status: Int, message: String)
    }

    internal enum ByteRangeResult: Equatable {
        case full
        case partial(start: Int64, end: Int64)
        case unsatisfiable
    }

    private final class ConnectionReceiveGuard {
        private let lock = NSLock()
        private var finished = false
        private var timeoutWork: DispatchWorkItem?

        func attachTimeout(_ work: DispatchWorkItem) {
            lock.lock()
            if finished {
                lock.unlock()
                work.cancel()
                return
            }
            timeoutWork = work
            lock.unlock()
        }

        func markFinished() -> Bool {
            lock.lock()
            if finished {
                lock.unlock()
                return false
            }
            finished = true
            let work = timeoutWork
            timeoutWork = nil
            lock.unlock()
            work?.cancel()
            return true
        }
    }

    private let ncmClient: NeteaseApiClient
    private let unblockEngine: MusicUnblockEngine
    private let externalPlaylistParser: ExternalPlaylistParser
    private let platformAuthProxy = PlatformAuthProxy()
    private let connectionQueue = DispatchQueue(label: "com.xiaopang.naiwamusic.httpserver", attributes: .concurrent)
    private let lifecycleQueue = DispatchQueue(label: "com.xiaopang.naiwamusic.httpserver.lifecycle")
    private let stateLock = NSLock()
    private let lifecycleLock = NSLock()

    let authToken: String
    private var _listener: NWListener?
    private var _port: Int = 30488
    private var _isRunning: Bool = false

    var port: Int {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _port
    }

    var isRunning: Bool {
        stateLock.lock()
        defer { stateLock.unlock() }
        return _isRunning
    }

    init(ncmClient: NeteaseApiClient, unblockEngine: MusicUnblockEngine) {
        self.ncmClient = ncmClient
        self.unblockEngine = unblockEngine
        self.externalPlaylistParser = ExternalPlaylistParser(ncmClient: ncmClient)
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
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        return startLocked(preferredPort: preferredPort)
    }

    func ensureAlive() {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        stateLock.lock()
        let alive = _isRunning && _listener != nil
        let currentPort = _port
        stateLock.unlock()
        if !alive {
            _ = startLocked(preferredPort: currentPort)
        }
    }

    func stop() {
        lifecycleLock.lock()
        defer { lifecycleLock.unlock() }
        stopLocked()
    }

    private func stopLocked() {
        stateLock.lock()
        let prevListener = _listener
        _listener = nil
        _isRunning = false
        stateLock.unlock()
        prevListener?.cancel()
    }

    private func startLocked(preferredPort: Int) -> Int {
        let totalBudgetDeadline = Date().addingTimeInterval(3.0)
        for candidate in preferredPort...(preferredPort + 10) {
            let remaining = totalBudgetDeadline.timeIntervalSinceNow
            if remaining <= 0.05 { break }
            let perPortTimeout = min(0.5, remaining)
            if tryStart(on: UInt16(candidate), timeoutSeconds: perPortTimeout) {
                stateLock.lock()
                _port = candidate
                _isRunning = true
                stateLock.unlock()
                return candidate
            }
        }
        stateLock.lock()
        _isRunning = false
        stateLock.unlock()
        return -1
    }

    private func tryStart(on portValue: UInt16, timeoutSeconds: TimeInterval) -> Bool {
        guard let nwPort = NWEndpoint.Port(rawValue: portValue) else { return false }
        stopLocked()

        let params = NWParameters.tcp
        params.allowLocalEndpointReuse = true
        params.requiredLocalEndpoint = NWEndpoint.hostPort(host: .ipv4(.loopback), port: nwPort)

        guard let newListener = try? NWListener(using: params) else { return false }

        stateLock.lock()
        _listener = newListener
        stateLock.unlock()

        let sem = DispatchSemaphore(value: 0)
        let attemptLock = NSLock()
        var started = false
        var resolved = false

        newListener.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                if let self = self {
                    self.stateLock.lock()
                    if self._listener === newListener {
                        self._isRunning = true
                    }
                    self.stateLock.unlock()
                }
                attemptLock.lock()
                if !resolved {
                    resolved = true
                    started = true
                    attemptLock.unlock()
                    sem.signal()
                } else {
                    attemptLock.unlock()
                }
            case .failed, .cancelled:
                if let self = self {
                    self.stateLock.lock()
                    if self._listener === newListener {
                        self._isRunning = false
                        self._listener = nil
                    }
                    self.stateLock.unlock()
                }
                attemptLock.lock()
                if !resolved {
                    resolved = true
                    started = false
                    attemptLock.unlock()
                    sem.signal()
                } else {
                    attemptLock.unlock()
                }
            default:
                break
            }
        }

        newListener.newConnectionHandler = { [weak self] conn in
            self?.handleConnection(conn)
        }

        newListener.start(queue: lifecycleQueue)
        _ = sem.wait(timeout: .now() + max(0.1, timeoutSeconds))

        attemptLock.lock()
        let didStart = started
        if !resolved {
            resolved = true
        }
        attemptLock.unlock()

        if didStart {
            return true
        } else {
            stateLock.lock()
            if _listener === newListener {
                _listener = nil
                _isRunning = false
            }
            stateLock.unlock()
            newListener.cancel()
            return false
        }
    }

    // MARK: - Connection & HTTP/1.1 Parsing

    private struct FileStreamDescriptor {
        let fileUrl: URL
        let offset: Int64
        let length: Int64
    }

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
        var streamFile: FileStreamDescriptor? = nil
    }

    internal static func evaluateIncomingRequestFrame(
        buffer: Data,
        maxHeaderBytes: Int = LocalHttpServer.maxHeaderBytes,
        maxBodyBytes: Int = LocalHttpServer.maxBodyBytes
    ) -> RequestFrameEvaluation {
        let sep = Data("\r\n\r\n".utf8)
        guard let range = buffer.range(of: sep) else {
            if buffer.count > maxHeaderBytes {
                return .reject(status: 431, message: "Request Header Fields Too Large")
            }
            return .needMoreHeaders
        }

        let headerByteCount = buffer.distance(from: buffer.startIndex, to: range.lowerBound)
        if headerByteCount > maxHeaderBytes {
            return .reject(status: 431, message: "Request Header Fields Too Large")
        }

        guard let headerStr = String(data: buffer[..<range.lowerBound], encoding: .utf8) else {
            return .reject(status: 400, message: "Malformed HTTP Headers")
        }

        var declaredContentLength: Int?
        for line in headerStr.components(separatedBy: "\r\n").dropFirst() {
            if line.isEmpty { continue }
            guard let colon = line.firstIndex(of: ":") else { continue }
            let k = line[..<colon].trimmingCharacters(in: .whitespaces).lowercased()
            let v = line[line.index(after: colon)...].trimmingCharacters(in: .whitespaces)
            if k == "transfer-encoding" {
                if !v.isEmpty {
                    return .reject(status: 501, message: "Transfer-Encoding Not Supported")
                }
            } else if k == "content-length" {
                guard !v.isEmpty, v.allSatisfy({ $0.isASCII && $0.isNumber }) else {
                    return .reject(status: 400, message: "Invalid Content-Length")
                }
                guard let parsedLen = Int(v), parsedLen <= maxBodyBytes else {
                    return .reject(status: 413, message: "Payload Too Large")
                }
                if let existing = declaredContentLength, existing != parsedLen {
                    return .reject(status: 400, message: "Conflicting Content-Length")
                }
                declaredContentLength = parsedLen
            }
        }

        let contentLength = declaredContentLength ?? 0
        let headerEndOffset = buffer.distance(from: buffer.startIndex, to: range.upperBound)
        let (total, overflow) = headerEndOffset.addingReportingOverflow(contentLength)
        guard !overflow, total >= headerEndOffset else {
            return .reject(status: 413, message: "Payload Too Large")
        }
        if buffer.count >= total {
            return .complete(expectedTotal: total)
        }
        return .needMoreBody(expectedTotal: total)
    }

    internal static func parseByteRange(header: String?, totalLength: Int64) -> ByteRangeResult {
        guard totalLength > 0 else {
            return header == nil ? .full : .unsatisfiable
        }
        guard let rawHeader = header?.trimmingCharacters(in: .whitespacesAndNewlines), !rawHeader.isEmpty else {
            return .full
        }
        guard rawHeader.lowercased().hasPrefix("bytes=") else {
            return .full
        }
        let spec = String(rawHeader.dropFirst(6))
            .split(separator: ",", maxSplits: 1, omittingEmptySubsequences: false)
            .first
            .map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
        let parts = spec.split(separator: "-", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2 else { return .unsatisfiable }

        let startStr = String(parts[0]).trimmingCharacters(in: .whitespaces)
        let endStr = String(parts[1]).trimmingCharacters(in: .whitespaces)

        if startStr.isEmpty {
            guard !endStr.isEmpty,
                  endStr.allSatisfy({ $0.isASCII && $0.isNumber }),
                  let suffixLen = Int64(endStr),
                  suffixLen > 0 else {
                return .unsatisfiable
            }
            let start = max(0, totalLength - suffixLen)
            return .partial(start: start, end: totalLength - 1)
        }

        guard startStr.allSatisfy({ $0.isASCII && $0.isNumber }),
              let start = Int64(startStr),
              start >= 0,
              start < totalLength else {
            return .unsatisfiable
        }

        if endStr.isEmpty {
            return .partial(start: start, end: totalLength - 1)
        }

        guard endStr.allSatisfy({ $0.isASCII && $0.isNumber }),
              let rawEnd = Int64(endStr),
              rawEnd >= start else {
            return .unsatisfiable
        }
        let end = min(rawEnd, totalLength - 1)
        return .partial(start: start, end: end)
    }

    private func handleConnection(_ conn: NWConnection) {
        let receiveGuard = ConnectionReceiveGuard()
        let timeoutWork = DispatchWorkItem { [weak conn] in
            if receiveGuard.markFinished() {
                conn?.cancel()
            }
        }
        receiveGuard.attachTimeout(timeoutWork)
        connectionQueue.asyncAfter(deadline: .now() + Self.connectionReceiveTimeoutSec, execute: timeoutWork)
        conn.start(queue: connectionQueue)
        receiveFullRequest(conn: conn, accumulated: Data(), receiveGuard: receiveGuard)
    }

    private func receiveFullRequest(conn: NWConnection, accumulated: Data, receiveGuard: ConnectionReceiveGuard) {
        conn.receive(minimumIncompleteLength: 1, maximumLength: 65536) { [weak self] data, _, isComplete, error in
            guard let self = self else {
                if receiveGuard.markFinished() { conn.cancel() }
                return
            }
            if error != nil {
                if receiveGuard.markFinished() { conn.cancel() }
                return
            }

            var buf = accumulated
            if let chunk = data, !chunk.isEmpty {
                buf.append(chunk)
            }

            if buf.count > Self.maxHeaderBytes + 4 + Self.maxBodyBytes {
                if receiveGuard.markFinished() {
                    let resp = self.jsonResponse(status: 413, obj: ["code": 413, "msg": "Payload Too Large"])
                    self.sendHttpResponse(resp, conn: conn)
                }
                return
            }

            switch Self.evaluateIncomingRequestFrame(buffer: buf) {
            case .reject(let status, let message):
                if receiveGuard.markFinished() {
                    let resp = self.jsonResponse(status: status, obj: ["code": status, "msg": message])
                    self.sendHttpResponse(resp, conn: conn)
                }
                return
            case .complete(let expectedTotal):
                if receiveGuard.markFinished() {
                    let exact = Data(buf.prefix(expectedTotal))
                    self.processHttpBuffer(exact, conn: conn)
                }
                return
            case .needMoreHeaders, .needMoreBody:
                if isComplete {
                    if receiveGuard.markFinished() {
                        if buf.isEmpty {
                            conn.cancel()
                        } else {
                            let resp = self.jsonResponse(status: 400, obj: ["code": 400, "msg": "Incomplete HTTP Request"])
                            self.sendHttpResponse(resp, conn: conn)
                        }
                    }
                    return
                }
                self.receiveFullRequest(conn: conn, accumulated: buf, receiveGuard: receiveGuard)
            }
        }
    }

    private func isTrustedOrigin(_ origin: String) -> Bool {
        let normalized = origin.trimmingCharacters(in: .whitespacesAndNewlines)
            .trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            .lowercased()
        return normalized == "http://127.0.0.1:\(port)" || normalized == "http://localhost:\(port)"
    }

    private func isAuthorized(_ req: HttpRequest) -> Bool {
        guard !authToken.isEmpty else { return false }
        let candidate = (req.headers["x-alger-token"] ?? req.query["token"] ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidate.isEmpty, candidate.count == authToken.count else { return false }
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
        resp.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With, Cookie, X-Netease-Cookie, Range, X-Alger-Token"
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
        if let stream = resp.streamFile {
            let fh: FileHandle
            do {
                fh = try FileHandle(forReadingFrom: stream.fileUrl)
                if #available(iOS 13.0, *) {
                    try fh.seek(toOffset: UInt64(max(0, stream.offset)))
                } else {
                    fh.seek(toFileOffset: UInt64(max(0, stream.offset)))
                }
            } catch {
                let notFound = HttpResponse(
                    status: 404,
                    statusText: httpStatusText(404),
                    contentType: "text/plain",
                    body: Data("File not found".utf8)
                )
                sendHttpResponse(notFound, conn: conn)
                return
            }

            var headerStr = "HTTP/1.1 \(resp.status) \(resp.statusText)\r\n"
            headerStr += "Content-Type: \(resp.contentType)\r\n"
            headerStr += "Content-Length: \(stream.length)\r\n"
            headerStr += "Connection: close\r\n"
            for (k, v) in resp.headers {
                headerStr += "\(k): \(v)\r\n"
            }
            for (k, v) in resp.multiHeaders {
                headerStr += "\(k): \(v)\r\n"
            }
            headerStr += "\r\n"

            let headerData = Data(headerStr.utf8)
            conn.send(content: headerData, completion: .contentProcessed { [weak self] err in
                guard err == nil, let self = self else {
                    try? fh.close()
                    conn.cancel()
                    return
                }
                self.streamFileChunks(fh: fh, remaining: stream.length, conn: conn)
            })
            return
        }

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

    private func streamFileChunks(fh: FileHandle, remaining: Int64, conn: NWConnection) {
        guard remaining > 0 else {
            try? fh.close()
            conn.cancel()
            return
        }
        let chunkSize = Int(min(Int64(Self.fileStreamChunkBytes), remaining))
        var chunk = Data()
        autoreleasepool {
            if #available(iOS 13.4, *) {
                chunk = (try? fh.read(upToCount: chunkSize)) ?? Data()
            } else {
                chunk = fh.readData(ofLength: chunkSize)
            }
        }
        guard !chunk.isEmpty else {
            try? fh.close()
            conn.cancel()
            return
        }
        let nextRemaining = remaining - Int64(chunk.count)
        if nextRemaining <= 0 {
            try? fh.close()
        }
        conn.send(content: chunk, completion: .contentProcessed { [weak self] err in
            guard err == nil, let self = self, nextRemaining > 0 else {
                if err != nil || nextRemaining > 0 {
                    try? fh.close()
                }
                conn.cancel()
                return
            }
            self.streamFileChunks(fh: fh, remaining: nextRemaining, conn: conn)
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
        if path == "/playlist/import/external" {
            return handleExternalPlaylistImport(req)
        }
        if path.hasPrefix("/bind/") {
            return handlePlatformBind(req)
        }
        return handleNeteaseApi(req)
    }

    private func handlePlatformBind(_ req: HttpRequest) -> HttpResponse {
        var params = collectParams(req)
        params.removeValue(forKey: "token")
        let res = platformAuthProxy.handle(path: req.path, params: params)
        return HttpResponse(
            status: res.status,
            statusText: httpStatusText(res.status),
            contentType: "application/json; charset=utf-8",
            body: Data(res.body.utf8)
        )
    }

    internal func dispatchBindForTesting(path: String, params: [String: String]) -> (status: Int, body: String) {
        var clean = params
        clean.removeValue(forKey: "token")
        return platformAuthProxy.handle(path: path, params: clean)
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
           params["noCookie"] != "true" {
            if let xCookie = req.headers["x-netease-cookie"], !xCookie.isEmpty {
                params["cookie"] = xCookie
            } else if let headerCookie = req.headers["cookie"], !headerCookie.isEmpty {
                params["cookie"] = headerCookie
            }
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
        var durationMs = Int64(params["dt"] ?? params["duration"] ?? "") ?? 0

        if (songName.isEmpty || durationMs <= 0) && !songId.isEmpty {
            let detailRes = ncmClient.dispatch(path: "/song/detail", params: ["ids": songId])
            if let d = detailRes.body.data(using: .utf8),
               let root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
               let songs = root["songs"] as? [[String: Any]],
               let s = songs.first {
                if songName.isEmpty {
                    songName = (s["name"] as? String) ?? ""
                }
                if artists.isEmpty, let ar = s["ar"] as? [[String: Any]] {
                    artists = ar.compactMap { $0["name"] as? String }.joined(separator: " ")
                }
                if durationMs <= 0 {
                    durationMs = (s["dt"] as? NSNumber)?.int64Value ?? 0
                }
            }
        }

        let sources = params["sources"]?
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty } ?? MusicUnblockEngine.defaultEnabledSources

        if let res = unblockEngine.unblock(
            songId: songId,
            songName: songName,
            artists: artists,
            enabledSources: sources,
            expectedDurationMs: durationMs
        ) {
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

    private func handleExternalPlaylistImport(_ req: HttpRequest) -> HttpResponse {
        var params = collectParams(req)
        params.removeValue(forKey: "token")
        let res = externalPlaylistParser.handle(params: params)
        return HttpResponse(
            status: res.status,
            statusText: httpStatusText(res.status),
            contentType: "application/json; charset=utf-8",
            body: Data(res.body.utf8)
        )
    }

    private func handleLocalFile(_ req: HttpRequest) -> HttpResponse {
        let params = collectParams(req)
        guard let decoded = params["path"], !decoded.isEmpty else {
            return HttpResponse(status: 400, statusText: httpStatusText(400), contentType: "text/plain", body: Data("Missing path".utf8))
        }
        let fileUrl = URL(fileURLWithPath: decoded)
        guard isAllowedAudioFile(fileUrl) else {
            return HttpResponse(status: 403, statusText: httpStatusText(403), contentType: "text/plain", body: Data("Forbidden file".utf8))
        }
        let canonicalUrl = fileUrl.standardizedFileURL.resolvingSymlinksInPath()
        guard FileManager.default.fileExists(atPath: canonicalUrl.path),
              let attrs = try? FileManager.default.attributesOfItem(atPath: canonicalUrl.path),
              let totalLen = (attrs[.size] as? NSNumber)?.int64Value, totalLen > 0 else {
            return HttpResponse(status: 404, statusText: httpStatusText(404), contentType: "text/plain", body: Data("File not found".utf8))
        }

        let mime = guessAudioMime(decoded)
        switch Self.parseByteRange(header: req.headers["range"], totalLength: totalLen) {
        case .partial(let start, let end):
            let len = end - start + 1
            var resp = HttpResponse(
                status: 206,
                statusText: httpStatusText(206),
                contentType: mime,
                body: Data(),
                streamFile: FileStreamDescriptor(fileUrl: canonicalUrl, offset: start, length: len)
            )
            resp.headers["Accept-Ranges"] = "bytes"
            resp.headers["Content-Range"] = "bytes \(start)-\(end)/\(totalLen)"
            return resp

        case .unsatisfiable:
            var resp = HttpResponse(
                status: 416,
                statusText: httpStatusText(416),
                contentType: "text/plain",
                body: Data("Range Not Satisfiable".utf8)
            )
            resp.headers["Accept-Ranges"] = "bytes"
            resp.headers["Content-Range"] = "bytes */\(totalLen)"
            return resp

        case .full:
            var resp = HttpResponse(
                status: 200,
                statusText: httpStatusText(200),
                contentType: mime,
                body: Data(),
                streamFile: FileStreamDescriptor(fileUrl: canonicalUrl, offset: 0, length: totalLen)
            )
            resp.headers["Accept-Ranges"] = "bytes"
            return resp
        }
    }

    private func handleLocalCover(_ req: HttpRequest) -> HttpResponse {
        let params = collectParams(req)
        guard let decoded = params["path"], !decoded.isEmpty else {
            return HttpResponse(status: 404, statusText: httpStatusText(404), contentType: "text/plain", body: Data("No cover".utf8))
        }
        let fileUrl = URL(fileURLWithPath: decoded)
        guard isAllowedAudioFile(fileUrl) else {
            return HttpResponse(status: 403, statusText: httpStatusText(403), contentType: "text/plain", body: Data("Forbidden path".utf8))
        }
        guard FileManager.default.fileExists(atPath: fileUrl.path) else {
            return HttpResponse(status: 404, statusText: httpStatusText(404), contentType: "text/plain", body: Data("No cover".utf8))
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
        case 204: return "No Content"
        case 206: return "Partial Content"
        case 400: return "Bad Request"
        case 401: return "Unauthorized"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 413: return "Payload Too Large"
        case 416: return "Range Not Satisfiable"
        case 422: return "Unprocessable Entity"
        case 429: return "Too Many Requests"
        case 431: return "Request Header Fields Too Large"
        case 500: return "Internal Server Error"
        case 501: return "Not Implemented"
        case 502: return "Bad Gateway"
        case 503: return "Service Unavailable"
        case 504: return "Gateway Timeout"
        default: return "Status \(code)"
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
