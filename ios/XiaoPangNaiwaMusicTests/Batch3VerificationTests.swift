import XCTest
import WebKit
@testable import XiaoPangNaiwaMusic

/// 模拟分片流式下载的 URLProtocol，用于在 iOS 模拟器上真实触发 URLSessionDownloadDelegate 增量进度与失败回调
private final class MockStreamingAudioURLProtocol: URLProtocol {
    private static let totalBytes = 5 * 32 * 1024 // 160 KB (5 x 32 KB chunks)
    private let stateLock = NSLock()
    private var isStopped = false

    override class func canInit(with request: URLRequest) -> Bool {
        guard let host = request.url?.host?.lowercased() else { return false }
        return host == "github.com" && (request.url?.path.hasPrefix("/mock-audio/") ?? false)
    }

    override class func canonicalRequest(for request: URLRequest) -> URLRequest {
        return request
    }

    override func startLoading() {
        guard let url = request.url else { return }

        if url.path.contains("fail.mp3") {
            let resp = HTTPURLResponse(
                url: url,
                statusCode: 500,
                httpVersion: "HTTP/1.1",
                headerFields: ["Content-Type": "text/plain"]
            )!
            client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)
            client?.urlProtocol(self, didLoad: Data("Server Error".utf8))
            client?.urlProtocolDidFinishLoading(self)
            return
        }

        let resp = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": "audio/mpeg",
                "Content-Length": "\(Self.totalBytes)"
            ]
        )!
        client?.urlProtocol(self, didReceive: resp, cacheStoragePolicy: .notAllowed)

        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self = self else { return }
            let chunk = Data(repeating: 0xAA, count: 32 * 1024)
            for _ in 0..<5 {
                self.stateLock.lock()
                let stopped = self.isStopped
                self.stateLock.unlock()
                if stopped { return }

                self.client?.urlProtocol(self, didLoad: chunk)
                Thread.sleep(forTimeInterval: 0.08)
            }
            self.stateLock.lock()
            let stopped = self.isStopped
            self.stateLock.unlock()
            if !stopped {
                self.client?.urlProtocolDidFinishLoading(self)
            }
        }
    }

    override func stopLoading() {
        stateLock.lock()
        isStopped = true
        stateLock.unlock()
    }
}

final class Batch3VerificationTests: XCTestCase {
    private var createdFilesToCleanup: [URL] = []

    override func tearDown() {
        for url in createdFilesToCleanup {
            try? FileManager.default.removeItem(at: url)
        }
        createdFilesToCleanup.removeAll()
        super.tearDown()
    }

    /// 验证 1：iOS 离线下载实时上报递增进度（0% -> 中间值 -> 100% / completed），无 DispatchSemaphore 阻塞
    func testDownloadProgressIncrementsInRealTimeAndCompletes() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [MockStreamingAudioURLProtocol.self]

        let lock = NSLock()
        var progressValues: [Int] = []
        var progressStatuses: [String] = []
        var completedPayload: [String: Any]?

        let completedExp = expectation(description: "Download completes with incremental progress")

        let manager = LocalMusicAndDownloadManager(
            portProvider: { 30488 },
            tokenProvider: { "test_token" },
            sessionConfiguration: cfg
        ) { channel, jsonStr in
            guard let data = jsonStr.data(using: .utf8),
                  let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return
            }
            lock.lock()
            if channel == "music-download-progress" {
                if let p = dict["progress"] as? Int {
                    progressValues.append(p)
                }
                if let st = dict["status"] as? String {
                    progressStatuses.append(st)
                }
            } else if channel == "music-download-complete" {
                completedPayload = dict
                lock.unlock()
                completedExp.fulfill()
                return
            }
            lock.unlock()
        }

        let filename = "sim_verify_progress_\(Int(Date().timeIntervalSince1970)).mp3"
        let expectedDest = manager.getDownloadDir().appendingPathComponent(filename)
        createdFilesToCleanup.append(expectedDest)

        manager.enqueueDownload([
            "id": "sim_track_1",
            "url": "https://github.com/mock-audio/progress.mp3",
            "filename": filename,
            "songInfo": ["id": "sim_track_1", "name": "Simulator Progress Test"]
        ])

        wait(for: [completedExp], timeout: 15.0)

        lock.lock()
        let capturedProgress = progressValues
        let capturedStatuses = progressStatuses
        let capturedComplete = completedPayload
        lock.unlock()

        XCTAssertEqual(capturedComplete?["success"] as? Bool, true, "Download must succeed")
        XCTAssertTrue(FileManager.default.fileExists(atPath: expectedDest.path), "Downloaded file must exist at destination")

        let intermediateValues = capturedProgress.filter { $0 > 0 && $0 < 100 }
        XCTAssertGreaterThanOrEqual(
            intermediateValues.count,
            2,
            "Expected multiple real intermediate progress updates (0 < p < 100), got: \(capturedProgress)"
        )
        // 验证进度单调递增
        for i in 1..<capturedProgress.count {
            XCTAssertGreaterThanOrEqual(
                capturedProgress[i],
                capturedProgress[i - 1],
                "Progress values must be monotonically non-decreasing: \(capturedProgress)"
            )
        }
        XCTAssertEqual(capturedProgress.last, 100, "Final progress event must be 100")
        XCTAssertEqual(capturedStatuses.last, "completed", "Final progress status must be 'completed'")
    }

    /// 验证 1b：下载遇到异常响应（HTTP 500）时上报 failed
    func testDownloadFailureReportsFailedStatus() {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.protocolClasses = [MockStreamingAudioURLProtocol.self]

        let lock = NSLock()
        var sawFailedProgress = false
        var completeSuccess: Bool?
        let failedExp = expectation(description: "Download failure emits failed status")

        let manager = LocalMusicAndDownloadManager(
            portProvider: { 30488 },
            tokenProvider: { "test_token" },
            sessionConfiguration: cfg
        ) { channel, jsonStr in
            guard let data = jsonStr.data(using: .utf8),
                  let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return
            }
            lock.lock()
            if channel == "music-download-progress", (dict["status"] as? String) == "failed" {
                sawFailedProgress = true
            } else if channel == "music-download-complete" {
                completeSuccess = dict["success"] as? Bool
                lock.unlock()
                failedExp.fulfill()
                return
            }
            lock.unlock()
        }

        manager.enqueueDownload([
            "id": "sim_track_fail",
            "url": "https://github.com/mock-audio/fail.mp3",
            "filename": "sim_verify_fail.mp3"
        ])

        wait(for: [failedExp], timeout: 15.0)
        XCTAssertEqual(completeSuccess, false)
        XCTAssertTrue(sawFailedProgress, "Failed download must emit status='failed'")
    }

    /// 验证 2：导入本地音频到 Documents/LocalMusic/ 后，重启（重新实例化管理器）歌曲 ID 恒定不变，且 totalFiles / supportedFiles 分开统计
    func testImportLocalAudioAndDeterministicIdAcrossRestart() throws {
        let tempDir = FileManager.default.temporaryDirectory
            .appendingPathComponent("sim_import_\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
        createdFilesToCleanup.append(tempDir)

        let audioName = "sim_stable_id_song.mp3"
        let srcAudio = tempDir.appendingPathComponent(audioName)
        let srcLrc = tempDir.appendingPathComponent("sim_stable_id_song.lrc")
        try Data("ID3_MOCK_AUDIO_BYTES_FOR_SIMULATOR".utf8).write(to: srcAudio)
        try "[00:01.00]测试歌词".write(to: srcLrc, atomically: true, encoding: .utf8)

        let managerBeforeRestart = LocalMusicAndDownloadManager(
            portProvider: { 30488 },
            tokenProvider: { "tok1" }
        ) { _, _ in }

        let importedPaths = managerBeforeRestart.importPickedAudioUrls([srcAudio])
        XCTAssertEqual(importedPaths.count, 1, "Should import the selected audio file")

        let importedUrl = URL(fileURLWithPath: importedPaths[0])
        createdFilesToCleanup.append(importedUrl)
        createdFilesToCleanup.append(importedUrl.deletingPathExtension().appendingPathExtension("lrc"))

        XCTAssertTrue(
            importedUrl.path.contains("/LocalMusic/"),
            "Imported audio must live inside Documents/LocalMusic/, got: \(importedUrl.path)"
        )

        // 在 LocalMusic 目录放置一个非音频文本文件，验证 scanWithStats 的 totalFiles 与 supportedFiles 独立统计
        let nonAudioFile = managerBeforeRestart.getLocalMusicDir().appendingPathComponent("readme_non_audio.txt")
        try "not audio".write(to: nonAudioFile, atomically: true, encoding: .utf8)
        createdFilesToCleanup.append(nonAudioFile)

        let scanRes = managerBeforeRestart.scanWithStats(folderPath: managerBeforeRestart.getLocalMusicDir().path)
        let stats = scanRes["stats"] as? [String: Any]
        let totalFiles = stats?["totalFiles"] as? Int ?? 0
        let supportedFiles = stats?["supportedFiles"] as? Int ?? 0
        XCTAssertGreaterThanOrEqual(supportedFiles, 1)
        XCTAssertGreaterThan(
            totalFiles,
            supportedFiles,
            "totalFiles (\(totalFiles)) must strictly exceed supportedFiles (\(supportedFiles)) when non-audio files exist"
        )

        let metaBefore = managerBeforeRestart.parseMetadata(paths: [importedUrl.path])
        let idBefore = metaBefore.first?["id"] as? String ?? ""
        XCTAssertTrue(idBefore.hasPrefix("local_"), "ID must have 'local_' prefix, got: \(idBefore)")
        XCTAssertEqual(idBefore.count, 22, "SHA-256 8-byte hex ID must be 6 + 16 = 22 chars, got: \(idBefore)")

        // 模拟 App 重启：使用全新 LocalMusicAndDownloadManager 实例重新解析
        let managerAfterRestart = LocalMusicAndDownloadManager(
            portProvider: { 30489 },
            tokenProvider: { "tok2" }
        ) { _, _ in }

        let metaAfter = managerAfterRestart.parseMetadata(paths: [importedUrl.path])
        let idAfter = metaAfter.first?["id"] as? String ?? ""
        XCTAssertEqual(idBefore, idAfter, "Deterministic SHA-256 track ID must remain identical across App restarts")
    }

    /// 验证 3：在真实 WKWebView 中验证 iOS 能力标志显式声明，且无效入口调用不会产生误导弹窗或崩溃
    func testIosCapabilitiesAndNoMisleadingEntriesInWKWebView() {
        let prefs = AppPrefs()
        let ncm = NeteaseApiClient(prefs: prefs)
        let unblock = MusicUnblockEngine()
        let httpServer = LocalHttpServer(ncmClient: ncm, unblockEngine: unblock)
        let audio = AudioPlayerManager(ncmClient: ncm, unblockEngine: unblock)
        let storage = LocalMusicAndDownloadManager(portProvider: { 30488 }, tokenProvider: { "tok" }) { _, _ in }

        var toastMessages: [String] = []
        let bridge = IOSJsBridge(
            prefs: prefs,
            ncmClient: ncm,
            unblockEngine: unblock,
            httpServer: httpServer,
            audioManager: audio,
            storageManager: storage,
            onStatusBarStyle: { _ in },
            onOpenExternalUrl: { _ in },
            onShowToast: { msg in toastMessages.append(msg) },
            onPickTextFile: { cb in cb(nil) },
            onPickLocalAudioSources: { cb in cb(["canceled": true, "filePaths": []]) },
            callbackDispatcher: { _, _, _ in }
        )

        let ucc = WKUserContentController()
        ucc.addUserScript(bridge.makeInjectionScript())
        ucc.add(bridge, name: "AlgerIOS")

        let cfg = WKWebViewConfiguration()
        cfg.userContentController = ucc
        let webView = WKWebView(frame: CGRect(x: 0, y: 0, width: 390, height: 844), configuration: cfg)

        let navHelper = TestWebViewNavDelegate()
        let loadExp = expectation(description: "WKWebView loads HTML with injected IOSJsBridge")
        navHelper.onFinish = { loadExp.fulfill() }
        webView.navigationDelegate = navHelper
        webView.loadHTMLString("<!doctype html><html><body>ok</body></html>", baseURL: URL(string: "http://127.0.0.1:30488/"))
        wait(for: [loadExp], timeout: 10.0)
        navHelper.onFinish = nil

        let evalExp = expectation(description: "Evaluate injected capability flags in WKWebView")
        let probeJs = """
        (function() {
          var caps = JSON.parse(window.AlgerAndroid.getCapabilities());
          return {
            platform: window.__ALGER_PLATFORM__,
            globalCaps: window.__ALGER_CAPABILITIES__,
            caps: caps,
            eqRes: window.AlgerAndroid.eqSetEnabled(true),
            lyricRes: window.AlgerAndroid.setFloatingLyricEnabled(true),
            batteryRes: window.AlgerAndroid.requestIgnoreBatteryOptimizations()
          };
        })();
        """

        webView.evaluateJavaScript(probeJs) { result, error in
            XCTAssertNil(error, "JS evaluation failed: \(String(describing: error))")
            let dict = result as? [String: Any]
            XCTAssertEqual(dict?["platform"] as? String, "ios")

            let caps = dict?["caps"] as? [String: Any]
            XCTAssertEqual(caps?["supportsEq"] as? Bool, false)
            XCTAssertEqual(caps?["supportsFloatingLyric"] as? Bool, false)
            XCTAssertEqual(caps?["supportsBatteryOptimization"] as? Bool, false)
            XCTAssertEqual(caps?["supportsAudioCache"] as? Bool, false)

            XCTAssertEqual(dict?["eqRes"] as? Bool, false)
            XCTAssertEqual(dict?["lyricRes"] as? Bool, false)
            XCTAssertEqual(dict?["batteryRes"] as? Bool, false)
            evalExp.fulfill()
        }
        wait(for: [evalExp], timeout: 10.0)

        XCTAssertTrue(toastMessages.isEmpty, "Unsupported entries must not emit misleading toasts: \(toastMessages)")
    }

    /// 验证 4：SafeHttpGuard 在 iOS 运行时阻断回环与云元数据 IP
    func testSafeHttpGuardBlocksPrivateAndLoopbackTargets() {
        XCTAssertFalse(SafeHttpGuard.isPublicIPv4(127, 0, 0, 1))
        XCTAssertFalse(SafeHttpGuard.isPublicIPv4(169, 254, 169, 254))
        XCTAssertFalse(SafeHttpGuard.isPublicIPv4(10, 0, 0, 1))
        XCTAssertFalse(SafeHttpGuard.isPublicIPv4(192, 168, 1, 1))
        XCTAssertTrue(SafeHttpGuard.isPublicIPv4(8, 8, 8, 8))

        let loopbackUrl = URL(string: "http://127.0.0.1:8080/secret")!
        XCTAssertFalse(
            SafeHttpGuard.validateUrlAndResolve(loopbackUrl, allowedSuffixes: SafeHttpGuard.audioAndProxyAllowedDomains)
        )
    }
}

private final class TestWebViewNavDelegate: NSObject, WKNavigationDelegate {
    var onFinish: (() -> Void)?

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        onFinish?()
    }
}
