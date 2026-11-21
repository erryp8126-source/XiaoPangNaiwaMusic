import Foundation
import AVFoundation

/// iOS 本地音乐扫描（扫描「文件」App 共享的 Documents 目录）与离线下载管理
final class LocalMusicAndDownloadManager {
    private static let audioExtensions: Set<String> = ["mp3", "flac", "m4a", "aac", "wav", "ogg", "opus", "alac"]

    private let portProvider: () -> Int
    private let tokenProvider: () -> String
    private let eventEmitter: (String, String) -> Void
    private let downloadQueue = DispatchQueue(label: "com.alger.musicplayer.download", qos: .utility)

    init(
        portProvider: @escaping () -> Int,
        tokenProvider: @escaping () -> String = { "" },
        eventEmitter: @escaping (String, String) -> Void
    ) {
        self.portProvider = portProvider
        self.tokenProvider = tokenProvider
        self.eventEmitter = eventEmitter
        _ = getDownloadDir()
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

    func checkFileExists(_ path: String) -> Bool {
        let cleaned = path.hasPrefix("local:///")
            ? (String(path.dropFirst(9)).removingPercentEncoding ?? String(path.dropFirst(9)))
            : path
        return FileManager.default.fileExists(atPath: cleaned)
    }

    // MARK: - 离线下载

    func enqueueDownload(_ payload: [String: Any]) {
        let urlStr = (payload["url"] as? String) ?? ""
        let rawName = ((payload["filename"] as? String) ?? (payload["name"] as? String) ?? "song_\(Int(Date().timeIntervalSince1970))")
        let safeName = sanitizeFilename(rawName)
        let ext = guessExtension(from: urlStr, fallback: (payload["type"] as? String) ?? "mp3")
        let finalFilename = safeName.lowercased().hasSuffix(".\(ext)") ? safeName : "\(safeName).\(ext)"
        let songInfo = (payload["songInfo"] as? [String: Any]) ?? [:]
        let songId = "\(songInfo["id"] ?? payload["id"] ?? finalFilename)"

        guard let url = URL(string: urlStr), MusicUnblockEngine.isSafePublicHttpUrl(url) else {
            emitEvent("music-download-complete", [
                "success": false,
                "filename": finalFilename,
                "songInfo": songInfo,
                "error": "无效或不安全的音频下载链接"
            ])
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

            let sem = DispatchSemaphore(value: 0)
            var downloadedTemp: URL?
            var downloadError: Error?

            URLSession.shared.downloadTask(with: req) { tempUrl, _, err in
                downloadedTemp = tempUrl
                downloadError = err
                sem.signal()
            }.resume()
            _ = sem.wait(timeout: .now() + 120)

            if let err = downloadError {
                self.emitEvent("music-download-complete", [
                    "success": false,
                    "id": songId,
                    "filename": finalFilename,
                    "songInfo": songInfo,
                    "error": err.localizedDescription
                ])
                return
            }

            guard let tempUrl = downloadedTemp else {
                self.emitEvent("music-download-complete", [
                    "success": false,
                    "id": songId,
                    "filename": finalFilename,
                    "songInfo": songInfo,
                    "error": "下载失败"
                ])
                return
            }

            do {
                if FileManager.default.fileExists(atPath: destUrl.path) {
                    try FileManager.default.removeItem(at: destUrl)
                }
                try FileManager.default.moveItem(at: tempUrl, to: destUrl)
                let size = ((try? FileManager.default.attributesOfItem(atPath: destUrl.path)[.size]) as? NSNumber)?.int64Value ?? 0
                self.emitEvent("music-download-progress", [
                    "filename": finalFilename,
                    "progress": 100,
                    "loaded": size,
                    "total": size,
                    "path": destUrl.path,
                    "status": "completed",
                    "songInfo": songInfo
                ])
                self.emitEvent("music-download-complete", [
                    "success": true,
                    "id": songId,
                    "filename": finalFilename,
                    "path": destUrl.path,
                    "size": size,
                    "songInfo": songInfo
                ])
            } catch {
                self.emitEvent("music-download-complete", [
                    "success": false,
                    "id": songId,
                    "filename": finalFilename,
                    "songInfo": songInfo,
                    "error": error.localizedDescription
                ])
            }
        }
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
        return (try? FileManager.default.removeItem(atPath: targetPath)) != nil
    }

    func clearDownloaded() -> Bool {
        let dir = getDownloadDir()
        guard let files = try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: nil) else {
            return true
        }
        for f in files {
            try? FileManager.default.removeItem(at: f)
        }
        return true
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
        let safe = sanitizeFilename(filename)
        let name = safe.isEmpty ? "xiaopang-music-backup.json" : safe
        let dest = getDownloadDir().appendingPathComponent(name)
        do {
            try content.write(to: dest, atomically: true, encoding: .utf8)
            return ["success": true, "path": dest.path]
        } catch {
            return ["success": false, "error": error.localizedDescription]
        }
    }

    // MARK: - 本地音乐扫描

    func scanWithStats() -> [String: Any] {
        let root = getDocumentsDir()
        var foundUrls = [URL]()
        if let enumerator = FileManager.default.enumerator(
            at: root,
            includingPropertiesForKeys: [.isRegularFileKey, .fileSizeKey],
            options: [.skipsHiddenFiles]
        ) {
            for case let fileUrl as URL in enumerator {
                if Self.audioExtensions.contains(fileUrl.pathExtension.lowercased()) {
                    foundUrls.append(fileUrl)
                }
            }
        }

        let files = foundUrls.map { $0.path }
        return [
            "files": files,
            "stats": [
                "totalFiles": files.count,
                "supportedFiles": files.count,
                "folder": root.path
            ]
        ]
    }

    func parseMetadata(paths: [String]) -> [[String: Any]] {
        let port = portProvider()
        let rawToken = tokenProvider()
        let tokenParam = rawToken.isEmpty ? "" : "&token=\(rawToken)"
        return paths.compactMap { path -> [String: Any]? in
            let url = URL(fileURLWithPath: path)
            guard FileManager.default.fileExists(atPath: path) else { return nil }
            let asset = AVURLAsset(url: url)
            let durSec = CMTimeGetSeconds(asset.duration)
            let durationMs = (durSec.isFinite && durSec > 0) ? Int64(durSec * 1000.0) : 0

            var title = url.deletingPathExtension().lastPathComponent
            var artist = "未知歌手"
            var album = "本地音乐"
            var hasCover = false

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

            let encPath = path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? path
            let picUrl = hasCover ? "http://127.0.0.1:\(port)/local-cover?path=\(encPath)\(tokenParam)" : ""
            let size = ((try? FileManager.default.attributesOfItem(atPath: path)[.size]) as? NSNumber)?.int64Value ?? 0

            // 读取同名 .lrc 歌词
            let lrcUrl = url.deletingPathExtension().appendingPathExtension("lrc")
            let lrcText = (try? String(contentsOf: lrcUrl, encoding: .utf8)) ?? ""

            return [
                "id": "local_\(abs(path.hashValue))",
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
            "id": "dl_\(abs(path.hashValue))",
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
