import Foundation
import AVFoundation
import CryptoKit

/// iOS 本地音乐扫描（扫描「文件」App 共享的 Documents 目录及导入的 Documents/LocalMusic 目录）与离线下载管理
final class LocalMusicAndDownloadManager: NSObject, URLSessionDownloadDelegate {
    private static let audioExtensions: Set<String> = ["mp3", "flac", "m4a", "aac", "wav", "ogg", "opus", "alac"]
    private static let downloadTimeoutSeconds: TimeInterval = 120
    private static let progressThrottleInterval: TimeInterval = 0.25

    private final class DownloadTaskContext {
        let songId: String
        let finalFilename: String
        let destUrl: URL
        let songInfo: [String: Any]
        var lastProgressEmitTime: TimeInterval = 0
        var lastReportedPercent: Int = -1
        var didFinishOrFail: Bool = false
        var timeoutWorkItem: DispatchWorkItem?
        weak var task: URLSessionDownloadTask?

        init(songId: String, finalFilename: String, destUrl: URL, songInfo: [String: Any]) {
            self.songId = songId
            self.finalFilename = finalFilename
            self.destUrl = destUrl
            self.songInfo = songInfo
        }
    }

    private let portProvider: () -> Int
    private let tokenProvider: () -> String
    private let eventEmitter: (String, String) -> Void
    private let downloadQueue = DispatchQueue(label: "com.xiaopang.naiwamusic.download", qos: .utility)
    private let delegateQueue: OperationQueue
    private let redirectDelegate: SafeRedirectSessionDelegate
    private var downloadSession: URLSession!
    private let tasksLock = NSLock()
    private var activeDownloads: [Int: DownloadTaskContext] = [:]

    init(
        portProvider: @escaping () -> Int,
        tokenProvider: @escaping () -> String = { "" },
        sessionConfiguration: URLSessionConfiguration? = nil,
        eventEmitter: @escaping (String, String) -> Void
    ) {
        self.portProvider = portProvider
        self.tokenProvider = tokenProvider
        self.eventEmitter = eventEmitter
        let opQueue = OperationQueue()
        opQueue.name = "com.xiaopang.naiwamusic.download.delegate"
        opQueue.maxConcurrentOperationCount = 1
        opQueue.qualityOfService = .utility
        self.delegateQueue = opQueue
        self.redirectDelegate = SafeRedirectSessionDelegate(allowedSuffixes: SafeHttpGuard.audioAndProxyAllowedDomains)
        super.init()

        let cfg = sessionConfiguration ?? URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 60
        cfg.timeoutIntervalForResource = Self.downloadTimeoutSeconds
        cfg.httpShouldSetCookies = false
        self.downloadSession = URLSession(configuration: cfg, delegate: self, delegateQueue: opQueue)
        _ = getDownloadDir()
        _ = getLocalMusicDir()
    }

    deinit {
        tasksLock.lock()
        let pending = Array(activeDownloads.values)
        activeDownloads.removeAll()
        tasksLock.unlock()
        for ctx in pending {
            ctx.timeoutWorkItem?.cancel()
            ctx.task?.cancel()
        }
        downloadSession?.invalidateAndCancel()
    }

    func getDocumentsDir() -> URL {
        let url = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }

    func getDownloadDir() -> URL {
        let dir = getDocumentsDir().appendingPathComponent("Downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func getLocalMusicDir() -> URL {
        let dir = getDocumentsDir().appendingPathComponent("LocalMusic", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    func checkFileExists(_ path: String) -> Bool {
        let cleaned = path.hasPrefix("local:///")
            ? (String(path.dropFirst(9)).removingPercentEncoding ?? String(path.dropFirst(9)))
            : path
        return FileManager.default.fileExists(atPath: cleaned)
    }

    // MARK: - 离线下载（异步 URLSessionDownloadDelegate + 真实节流进度 + 超时取消 + SSRF 逐跳拦截）

    func enqueueDownload(_ payload: [String: Any]) {
        let urlStr = (payload["url"] as? String) ?? ""
        let rawName = ((payload["filename"] as? String) ?? (payload["name"] as? String) ?? "song_\(Int(Date().timeIntervalSince1970))")
        let safeName = sanitizeFilename(rawName)
        let ext = guessExtension(from: urlStr, fallback: (payload["type"] as? String) ?? "mp3")
        let finalFilename = safeName.lowercased().hasSuffix(".\(ext)") ? safeName : "\(safeName).\(ext)"
        let songInfo = (payload["songInfo"] as? [String: Any]) ?? [:]
        let songId = "\(songInfo["id"] ?? payload["id"] ?? finalFilename)"

        guard let url = URL(string: urlStr), MusicUnblockEngine.isSafePublicHttpUrl(url) else {
            emitDownloadFailed(
                songId: songId,
                filename: finalFilename,
                songInfo: songInfo,
                error: "无效或不安全的音频下载链接"
            )
            return
        }

        downloadQueue.async { [weak self] in
            guard let self = self else { return }
            let destUrl = self.getDownloadDir().appendingPathComponent(finalFilename)
            var req = URLRequest(url: url, timeoutInterval: 60)
            req.setValue(MusicUnblockEngine.defaultUA, forHTTPHeaderField: "User-Agent")
            if urlStr.contains("bilivideo") || urlStr.contains("bilibili") {
                req.setValue("https://www.bilibili.com/", forHTTPHeaderField: "Referer")
            } else if urlStr.contains("music.126.net") {
                req.setValue("https://music.163.com/", forHTTPHeaderField: "Referer")
            }

            let ctx = DownloadTaskContext(
                songId: songId,
                finalFilename: finalFilename,
                destUrl: destUrl,
                songInfo: songInfo
            )
            let task = self.downloadSession.downloadTask(with: req)
            ctx.task = task

            let timeoutWork = DispatchWorkItem { [weak self, weak task] in
                guard let self = self else { return }
                let taskId = task?.taskIdentifier ?? -1
                guard let timedOutCtx = self.claimContextForTermination(taskId: taskId) else { return }
                task?.cancel()
                self.emitDownloadFailed(
                    songId: timedOutCtx.songId,
                    filename: timedOutCtx.finalFilename,
                    songInfo: timedOutCtx.songInfo,
                    error: "下载超时，已取消任务"
                )
            }
            ctx.timeoutWorkItem = timeoutWork

            self.tasksLock.lock()
            self.activeDownloads[task.taskIdentifier] = ctx
            self.tasksLock.unlock()

            self.emitEvent("music-download-queued", [
                "id": songId,
                "filename": finalFilename,
                "songInfo": songInfo
            ])
            self.emitEvent("music-download-progress", [
                "filename": finalFilename,
                "progress": 0,
                "loaded": 0,
                "total": 0,
                "path": "",
                "status": "downloading",
                "songInfo": songInfo
            ])

            self.downloadQueue.asyncAfter(deadline: .now() + Self.downloadTimeoutSeconds, execute: timeoutWork)
            task.resume()
        }
    }

    /// 供 XCTest 在模拟器内直接驱动 URLSessionDownloadDelegate 真实回调链（不发起外部网络请求）
    @discardableResult
    func registerDownloadTaskForTesting(
        songId: String,
        filename: String,
        songInfo: [String: Any] = [:]
    ) -> (session: URLSession, task: URLSessionDownloadTask) {
        let safeName = sanitizeFilename(filename)
        let finalFilename = safeName.isEmpty ? "test_song.mp3" : safeName
        let destUrl = getDownloadDir().appendingPathComponent(finalFilename)
        let req = URLRequest(url: URL(string: "about:blank")!)
        let task = URLSession.shared.downloadTask(with: req)
        let ctx = DownloadTaskContext(
            songId: songId,
            finalFilename: finalFilename,
            destUrl: destUrl,
            songInfo: songInfo
        )
        ctx.task = task
        tasksLock.lock()
        activeDownloads[task.taskIdentifier] = ctx
        tasksLock.unlock()

        emitEvent("music-download-queued", [
            "id": songId,
            "filename": finalFilename,
            "songInfo": songInfo
        ])
        emitEvent("music-download-progress", [
            "filename": finalFilename,
            "progress": 0,
            "loaded": 0,
            "total": 0,
            "path": "",
            "status": "downloading",
            "songInfo": songInfo
        ])
        return (downloadSession, task)
    }

    // MARK: - URLSessionTaskDelegate / URLSessionDownloadDelegate

    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest,
        completionHandler: @escaping (URLRequest?) -> Void
    ) {
        redirectDelegate.urlSession(
            session,
            task: task,
            willPerformHTTPRedirection: response,
            newRequest: request,
            completionHandler: completionHandler
        )
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didWriteData bytesWritten: Int64,
        totalBytesWritten: Int64,
        totalBytesExpectedToWrite: Int64
    ) {
        let now = Date().timeIntervalSince1970
        var shouldEmit = false
        var percent = 0
        var filename = ""
        var songInfo: [String: Any] = [:]

        tasksLock.lock()
        if let ctx = activeDownloads[downloadTask.taskIdentifier], !ctx.didFinishOrFail {
            if totalBytesExpectedToWrite > 0 {
                let ratio = Double(totalBytesWritten) / Double(totalBytesExpectedToWrite)
                percent = min(99, max(0, Int((ratio * 100.0).rounded(.down))))
            } else if totalBytesWritten > 0 {
                percent = min(95, max(1, Int(totalBytesWritten / (128 * 1024))))
            } else {
                percent = 0
            }

            let elapsed = now - ctx.lastProgressEmitTime
            let percentDelta = percent - ctx.lastReportedPercent
            if ctx.lastReportedPercent < 0 || elapsed >= Self.progressThrottleInterval || percentDelta >= 5 {
                ctx.lastProgressEmitTime = now
                ctx.lastReportedPercent = percent
                filename = ctx.finalFilename
                songInfo = ctx.songInfo
                shouldEmit = true
            }
        }
        tasksLock.unlock()

        guard shouldEmit else { return }
        emitEvent("music-download-progress", [
            "filename": filename,
            "progress": percent,
            "loaded": totalBytesWritten,
            "total": max(0, totalBytesExpectedToWrite),
            "path": "",
            "status": "downloading",
            "songInfo": songInfo
        ])
    }

    func urlSession(
        _ session: URLSession,
        downloadTask: URLSessionDownloadTask,
        didFinishDownloadingTo location: URL
    ) {
        guard let ctx = claimContextForTermination(taskId: downloadTask.taskIdentifier) else {
            return
        }

        if let httpResp = downloadTask.response as? HTTPURLResponse,
           !(200...299).contains(httpResp.statusCode) {
            emitDownloadFailed(
                songId: ctx.songId,
                filename: ctx.finalFilename,
                songInfo: ctx.songInfo,
                error: "下载响应异常 (HTTP \(httpResp.statusCode))"
            )
            return
        }

        do {
            let destUrl = ctx.destUrl
            let parentDir = destUrl.deletingLastPathComponent()
            try FileManager.default.createDirectory(at: parentDir, withIntermediateDirectories: true)
            if FileManager.default.fileExists(atPath: destUrl.path) {
                try FileManager.default.removeItem(at: destUrl)
            }
            try FileManager.default.moveItem(at: location, to: destUrl)
            recordDownloadedSongIndex(filename: destUrl.lastPathComponent, songId: ctx.songId)
            let size = ((try? FileManager.default.attributesOfItem(atPath: destUrl.path)[.size]) as? NSNumber)?.int64Value ?? 0
            emitEvent("music-download-progress", [
                "filename": ctx.finalFilename,
                "progress": 100,
                "loaded": size,
                "total": size,
                "path": destUrl.path,
                "status": "completed",
                "songInfo": ctx.songInfo
            ])
            emitEvent("music-download-complete", [
                "success": true,
                "id": ctx.songId,
                "filename": ctx.finalFilename,
                "path": destUrl.path,
                "size": size,
                "songInfo": ctx.songInfo
            ])
        } catch {
            emitDownloadFailed(
                songId: ctx.songId,
                filename: ctx.finalFilename,
                songInfo: ctx.songInfo,
                error: error.localizedDescription
            )
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        redirectDelegate.urlSession(session, task: task, didCompleteWithError: error)

        guard let ctx = claimContextForTermination(taskId: task.taskIdentifier) else {
            return
        }
        let message: String
        if let err = error {
            let nsErr = err as NSError
            if nsErr.domain == NSURLErrorDomain && nsErr.code == NSURLErrorTimedOut {
                task.cancel()
                message = "下载超时，已取消任务"
            } else {
                message = err.localizedDescription
            }
        } else {
            message = "下载未能完成"
        }
        emitDownloadFailed(
            songId: ctx.songId,
            filename: ctx.finalFilename,
            songInfo: ctx.songInfo,
            error: message
        )
    }

    private func claimContextForTermination(taskId: Int) -> DownloadTaskContext? {
        tasksLock.lock()
        guard let ctx = activeDownloads.removeValue(forKey: taskId), !ctx.didFinishOrFail else {
            tasksLock.unlock()
            return nil
        }
        ctx.didFinishOrFail = true
        let timeoutWork = ctx.timeoutWorkItem
        ctx.timeoutWorkItem = nil
        tasksLock.unlock()
        timeoutWork?.cancel()
        return ctx
    }

    private func emitDownloadFailed(songId: String, filename: String, songInfo: [String: Any], error: String) {
        emitEvent("music-download-progress", [
            "filename": filename,
            "progress": 0,
            "loaded": 0,
            "total": 0,
            "path": "",
            "status": "failed",
            "error": error,
            "songInfo": songInfo
        ])
        emitEvent("music-download-complete", [
            "success": false,
            "id": songId,
            "filename": filename,
            "songInfo": songInfo,
            "error": error
        ])
    }

    func getDownloadedList() -> [[String: Any]] {
        let dir = getDownloadDir()
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: [.fileSizeKey, .contentModificationDateKey], options: .skipsHiddenFiles) else {
            return []
        }
        return files
            .filter { Self.audioExtensions.contains($0.pathExtension.lowercased()) }
            .sorted { a, b in
                let da = (try? a.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                let db = (try? b.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
                return da > db
            }
            .map { buildDownloadedItem(url: $0) }
    }

    func deleteDownloaded(_ path: String) -> Bool {
        let cleaned = path.hasPrefix("local:///")
            ? (String(path.dropFirst(9)).removingPercentEncoding ?? String(path.dropFirst(9)))
            : path
        let targetPath = URL(fileURLWithPath: cleaned).standardizedFileURL.resolvingSymlinksInPath().path
        let downloadRoot = getDownloadDir().standardizedFileURL.resolvingSymlinksInPath().path
        guard targetPath.hasPrefix(downloadRoot + "/") else { return false }
        guard FileManager.default.fileExists(atPath: targetPath) else { return false }
        let removed = (try? FileManager.default.removeItem(atPath: targetPath)) != nil
        if removed {
            removeDownloadedSongIndex(filename: URL(fileURLWithPath: targetPath).lastPathComponent)
        }
        return removed
    }

    func clearDownloaded() -> Bool {
        let dir = getDownloadDir()
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
            return true
        }
        for f in files {
            try? FileManager.default.removeItem(at: f)
        }
        try? FileManager.default.removeItem(at: getDownloadIndexFile())
        return true
    }

    /// 聚合 iOS Documents 下已下载曲目（含原始 songId 与确定性 dl_* ID）和已导入本地曲目 ID
    func getOfflinePlayableIds() -> [String: [String]] {
        var downloadedIdSet = Set<String>()
        var localIdSet = Set<String>()

        let downloadDir = getDownloadDir()
        tasksLock.lock()
        let indexMap = loadDownloadIndexMap()
        tasksLock.unlock()
        if let files = try? FileManager.default.contentsOfDirectory(
            at: downloadDir,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: .skipsHiddenFiles
        ) {
            var existingFilenames = Set<String>()
            for file in files where Self.audioExtensions.contains(file.pathExtension.lowercased()) {
                existingFilenames.insert(file.lastPathComponent)
                downloadedIdSet.insert(deterministicTrackId(prefix: "dl", path: file.path))
                if let mappedSongId = indexMap[file.lastPathComponent], !mappedSongId.isEmpty {
                    downloadedIdSet.insert(mappedSongId)
                }
            }
            if existingFilenames.count < indexMap.count {
                tasksLock.lock()
                let latestMap = loadDownloadIndexMap()
                let pruned = latestMap.filter { existingFilenames.contains($0.key) }
                if pruned.count != latestMap.count {
                    saveDownloadIndexMap(pruned)
                }
                tasksLock.unlock()
            }
        }

        let localDir = getLocalMusicDir()
        if let enumerator = FileManager.default.enumerator(
            at: localDir,
            includingPropertiesForKeys: [.isRegularFileKey],
            options: .skipsHiddenFiles
        ) {
            for case let file as URL in enumerator {
                let isRegular = (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
                if isRegular && Self.audioExtensions.contains(file.pathExtension.lowercased()) {
                    localIdSet.insert(deterministicTrackId(prefix: "local", path: file.path))
                }
            }
        }

        return [
            "cachedIds": [],
            "downloadedIds": Array(downloadedIdSet),
            "localIds": Array(localIdSet)
        ]
    }

    private func getDownloadIndexFile() -> URL {
        return getDownloadDir().appendingPathComponent(".xiaopang_downloads_index.json")
    }

    private func loadDownloadIndexMap() -> [String: String] {
        guard let data = try? Data(contentsOf: getDownloadIndexFile()),
              let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: String] else {
            return [:]
        }
        return dict
    }

    private func saveDownloadIndexMap(_ map: [String: String]) {
        guard let data = try? JSONSerialization.data(withJSONObject: map) else { return }
        try? data.write(to: getDownloadIndexFile(), options: .atomic)
    }

    private func recordDownloadedSongIndex(filename: String, songId: String) {
        let trimmedId = songId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !filename.isEmpty, !trimmedId.isEmpty else { return }
        tasksLock.lock()
        var map = loadDownloadIndexMap()
        map[filename] = trimmedId
        saveDownloadIndexMap(map)
        tasksLock.unlock()
    }

    private func removeDownloadedSongIndex(filename: String) {
        guard !filename.isEmpty else { return }
        tasksLock.lock()
        var map = loadDownloadIndexMap()
        if map.removeValue(forKey: filename) != nil {
            saveDownloadIndexMap(map)
        }
        tasksLock.unlock()
    }

    func saveLyricFile(filename: String, lrcContent: String) -> [String: Any] {
        let safe = sanitizeFilename(filename)
        let name = safe.lowercased().hasSuffix(".lrc") ? safe : "\(safe).lrc"
        let dest = getDownloadDir().appendingPathComponent(name)
        do {
            try lrcContent.write(to: dest, atomically: true, encoding: .utf8)
            return ["success": true, "path": dest.path]
        } catch {
            return ["success": false, "error": error.localizedDescription]
        }
    }

    func saveTextFile(filename: String, content: String) -> [String: Any] {
        let sanitized = sanitizeFilename(filename).trimmingCharacters(in: CharacterSet(charactersIn: "."))
        let rawSafe = sanitized.isEmpty ? "xiaopang-music-backup.json" : sanitized
        let lower = rawSafe.lowercased()
        let name = (lower.hasSuffix(".json") || lower.hasSuffix(".txt")) ? rawSafe : "\(rawSafe).json"
        let backupDir = getDownloadDir().appendingPathComponent("Backups", isDirectory: true)
        do {
            try FileManager.default.createDirectory(at: backupDir, withIntermediateDirectories: true)
            let dest = backupDir.appendingPathComponent(name)
            try content.write(to: dest, atomically: true, encoding: .utf8)
            return ["success": true, "path": dest.path]
        } catch {
            return ["success": false, "error": error.localizedDescription]
        }
    }

    // MARK: - 本地音乐导入与扫描

    /// 将用户通过 UIDocumentPickerViewController 选中的音频文件或目录安全拷贝至沙盒 Documents/LocalMusic/
    func importPickedAudioUrls(_ urls: [URL]) -> [String] {
        let targetRoot = getLocalMusicDir()
        var importedPaths: [String] = []
        let fm = FileManager.default

        for pickedUrl in urls {
            let accessing = pickedUrl.startAccessingSecurityScopedResource()
            defer {
                if accessing {
                    pickedUrl.stopAccessingSecurityScopedResource()
                }
            }

            let isDir = (try? pickedUrl.resourceValues(forKeys: [.isDirectoryKey]).isDirectory) ?? false
            if isDir {
                if let enumerator = fm.enumerator(
                    at: pickedUrl,
                    includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
                    options: [.skipsHiddenFiles]
                ) {
                    for case let childUrl as URL in enumerator {
                        let isRegular = (try? childUrl.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
                        guard isRegular, Self.audioExtensions.contains(childUrl.pathExtension.lowercased()) else {
                            continue
                        }
                        if let imported = copyAudioFileSafely(from: childUrl, into: targetRoot) {
                            importedPaths.append(imported)
                        }
                    }
                }
            } else {
                guard Self.audioExtensions.contains(pickedUrl.pathExtension.lowercased()) else {
                    continue
                }
                if let imported = copyAudioFileSafely(from: pickedUrl, into: targetRoot) {
                    importedPaths.append(imported)
                }
            }
        }
        return importedPaths
    }

    private func copyAudioFileSafely(from sourceUrl: URL, into targetRoot: URL) -> String? {
        let fm = FileManager.default
        let ext = sourceUrl.pathExtension.lowercased()
        let rawBase = sourceUrl.deletingPathExtension().lastPathComponent
        let safeBase = sanitizeFilename(rawBase).isEmpty ? "audio" : sanitizeFilename(rawBase)
        let candidateName = "\(safeBase).\(ext)"
        let canonicalTargetRoot = targetRoot.standardizedFileURL.resolvingSymlinksInPath().path
        var destUrl = targetRoot.appendingPathComponent(candidateName)

        // 若源文件已在目标目录内则无需重复拷贝
        let canonicalSrc = sourceUrl.standardizedFileURL.resolvingSymlinksInPath().path
        if canonicalSrc.hasPrefix(canonicalTargetRoot + "/") {
            return canonicalSrc
        }

        // 若存在同名文件但体积不同，追加基于源路径的确定性短后缀避免覆盖
        if fm.fileExists(atPath: destUrl.path) {
            let srcSize = ((try? fm.attributesOfItem(atPath: sourceUrl.path)[.size]) as? NSNumber)?.int64Value ?? -1
            let dstSize = ((try? fm.attributesOfItem(atPath: destUrl.path)[.size]) as? NSNumber)?.int64Value ?? -2
            if srcSize == dstSize && srcSize > 0 {
                return destUrl.path
            }
            let suffix = sha256PrefixHex(sourceUrl.path, byteCount: 4)
            destUrl = targetRoot.appendingPathComponent("\(safeBase)_\(suffix).\(ext)")
        }

        let canonicalDest = destUrl.standardizedFileURL.resolvingSymlinksInPath().path
        guard canonicalDest.hasPrefix(canonicalTargetRoot + "/") else { return nil }

        do {
            if fm.fileExists(atPath: destUrl.path) {
                try fm.removeItem(at: destUrl)
            }
            try fm.copyItem(at: sourceUrl, to: destUrl)
            // 同步尝试拷贝同名 .lrc 歌词
            let srcLrc = sourceUrl.deletingPathExtension().appendingPathExtension("lrc")
            if fm.fileExists(atPath: srcLrc.path) {
                let dstLrc = destUrl.deletingPathExtension().appendingPathExtension("lrc")
                if !fm.fileExists(atPath: dstLrc.path) {
                    try? fm.copyItem(at: srcLrc, to: dstLrc)
                }
            }
            return destUrl.path
        } catch {
            return nil
        }
    }

    func scanWithStats(folderPath: String? = nil) -> [String: Any] {
        let docsRoot = getDocumentsDir()
        let canonicalDocs = docsRoot.standardizedFileURL.resolvingSymlinksInPath().path
        var scanRoot = docsRoot
        if let custom = folderPath, !custom.isEmpty {
            let candidate = URL(fileURLWithPath: custom).standardizedFileURL.resolvingSymlinksInPath()
            if candidate.path == canonicalDocs || candidate.path.hasPrefix(canonicalDocs + "/") {
                var isDir: ObjCBool = false
                if FileManager.default.fileExists(atPath: candidate.path, isDirectory: &isDir), isDir.boolValue {
                    scanRoot = candidate
                }
            }
        }

        var totalFiles = 0
        var foundUrls = [URL]()
        if let enumerator = FileManager.default.enumerator(
            at: scanRoot,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) {
            for case let fileUrl as URL in enumerator {
                let isRegular = (try? fileUrl.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) ?? false
                guard isRegular else { continue }
                totalFiles += 1
                if Self.audioExtensions.contains(fileUrl.pathExtension.lowercased()) {
                    foundUrls.append(fileUrl)
                }
            }
        }

        let files = foundUrls.map { $0.path }
        return [
            "files": files,
            "stats": [
                "totalFiles": totalFiles,
                "supportedFiles": files.count,
                "folder": scanRoot.path
            ]
        ]
    }

    func parseMetadata(paths: [String], skipAssetProbe: Bool = false) -> [[String: Any]] {
        let port = portProvider()
        let rawToken = tokenProvider()
        let tokenParam = rawToken.isEmpty ? "" : "&token=\(rawToken)"
        return paths.compactMap { path -> [String: Any]? in
            let url = URL(fileURLWithPath: path)
            guard FileManager.default.fileExists(atPath: path) else { return nil }

            var durationMs: Int64 = 0
            var title = url.deletingPathExtension().lastPathComponent
            var artist = "未知歌手"
            var album = "本地音乐"
            var hasCover = false

            if !skipAssetProbe {
                let asset = AVURLAsset(url: url)
                let durSec = CMTimeGetSeconds(asset.duration)
                durationMs = (durSec.isFinite && durSec > 0) ? Int64(durSec * 1000.0) : 0

                for item in asset.commonMetadata {
                    if item.commonKey == .commonKeyTitle, let s = item.stringValue, !s.isEmpty {
                        title = s
                    } else if item.commonKey == .commonKeyArtist, let s = item.stringValue, !s.isEmpty {
                        artist = s
                    } else if item.commonKey == .commonKeyAlbumName, let s = item.stringValue, !s.isEmpty {
                        album = s
                    } else if item.commonKey == .commonKeyArtwork, let d = item.dataValue, !d.isEmpty {
                        hasCover = true
                    }
                }
            }

            let encPath = path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? path
            let picUrl = hasCover ? "http://127.0.0.1:\(port)/local-cover?path=\(encPath)\(tokenParam)" : ""
            let size = ((try? FileManager.default.attributesOfItem(atPath: path)[.size]) as? NSNumber)?.int64Value ?? 0

            // 读取同名 .lrc 歌词
            let lrcUrl = url.deletingPathExtension().appendingPathExtension("lrc")
            let lrcText = (try? String(contentsOf: lrcUrl, encoding: .utf8)) ?? ""

            return [
                "id": deterministicTrackId(prefix: "local", path: path),
                "name": title,
                "title": title,
                "artist": artist,
                "artists": [["id": 0, "name": artist]],
                "ar": [["id": 0, "name": artist]],
                "album": album,
                "al": ["id": 0, "name": album, "picUrl": picUrl],
                "picUrl": picUrl,
                "duration": durationMs,
                "dt": durationMs,
                "size": size,
                "filePath": path,
                "playMusicUrl": "local:///\(encPath)",
                "source": "local",
                "lyric": lrcText
            ]
        }
    }

    private func buildDownloadedItem(url: URL) -> [String: Any] {
        let path = url.path
        let attrs = try? FileManager.default.attributesOfItem(atPath: path)
        let size = (attrs?[.size] as? NSNumber)?.int64Value ?? 0
        let modMs = Int64(((attrs?[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0) * 1000)
        let baseName = url.deletingPathExtension().lastPathComponent
        let encPath = path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? path

        return [
            "id": deterministicTrackId(prefix: "dl", path: path),
            "filename": url.lastPathComponent,
            "name": baseName,
            "path": path,
            "filePath": path,
            "playMusicUrl": "local:///\(encPath)",
            "size": size,
            "downloadTime": modMs,
            "artist": "已下载音乐",
            "album": "小庞奶娃音乐"
        ]
    }

    /// 基于沙盒 Documents 相对路径计算确定性 SHA-256 前 8 字节十六进制 ID，确保 App 重启或容器 UUID 变化后 ID 恒定不变
    private func deterministicTrackId(prefix: String, path: String) -> String {
        let docsRoot = getDocumentsDir().standardizedFileURL.resolvingSymlinksInPath().path
        let canonical = URL(fileURLWithPath: path).standardizedFileURL.resolvingSymlinksInPath().path
        let relativeKey: String
        if canonical.hasPrefix(docsRoot + "/") {
            relativeKey = String(canonical.dropFirst(docsRoot.count + 1))
        } else {
            relativeKey = URL(fileURLWithPath: path).lastPathComponent
        }
        let hashHex = sha256PrefixHex(relativeKey, byteCount: 8)
        return "\(prefix)_\(hashHex)"
    }

    private func sha256PrefixHex(_ input: String, byteCount: Int) -> String {
        let digest = SHA256.hash(data: Data(input.utf8))
        return digest.prefix(byteCount).map { String(format: "%02x", $0) }.joined()
    }

    private func sanitizeFilename(_ name: String) -> String {
        let illegal = CharacterSet(charactersIn: "/\\:*?\"<>|\n\r")
        return name.components(separatedBy: illegal).joined(separator: "_").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func guessExtension(from urlStr: String, fallback: String) -> String {
        let lower = urlStr.lowercased()
        for ext in ["flac", "m4a", "aac", "wav", "ogg", "mp3"] {
            if lower.contains(".\(ext)") { return ext }
        }
        return fallback.isEmpty ? "mp3" : fallback.lowercased()
    }

    private func emitEvent(_ channel: String, _ dict: [String: Any]) {
        guard let d = try? JSONSerialization.data(withJSONObject: dict),
              let json = String(data: d, encoding: .utf8) else { return }
        eventEmitter(channel, json)
    }
}
