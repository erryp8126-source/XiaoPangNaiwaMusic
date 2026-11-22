import AVFoundation
import XCTest
import JavaScriptCore

final class Batch3VerificationTests: XCTestCase {
    private var createdFilesToCleanup: [URL] = []

    override func tearDown() {
        for url in createdFilesToCleanup {
            try? FileManager.default.removeItem(at: url)
        }
        createdFilesToCleanup.removeAll()
        super.tearDown()
    }

    /// 验证 1：iOS 离线下载通过 URLSessionDownloadDelegate 实时上报递增进度（0% -> 20% -> 45% -> 80% -> 99% -> 100% / completed）
    func testDownloadProgressIncrementsInRealTimeAndCompletes() throws {
        var progressValues: [Int] = []
        var progressStatuses: [String] = []
        var completedPayload: [String: Any]?

        let manager = LocalMusicAndDownloadManager(
            portProvider: { 30488 },
            tokenProvider: { "test_token" }
        ) { channel, jsonStr in
            guard let data = jsonStr.data(using: .utf8),
                  let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return
            }
            if channel == "music-download-progress" {
                if let p = dict["progress"] as? Int {
                    progressValues.append(p)
                }
                if let st = dict["status"] as? String {
                    progressStatuses.append(st)
                }
            } else if channel == "music-download-complete" {
                completedPayload = dict
            }
        }

        let filename = "sim_verify_progress_\(Int(Date().timeIntervalSince1970)).mp3"
        let expectedDest = manager.getDownloadDir().appendingPathComponent(filename)
        createdFilesToCleanup.append(expectedDest)

        let (session, task) = manager.registerDownloadTaskForTesting(
            songId: "sim_track_1",
            filename: filename,
            songInfo: ["id": "sim_track_1", "name": "Simulator Progress Test"]
        )

        let totalBytes: Int64 = 200_000
        for written: Int64 in [40_000, 90_000, 160_000, 200_000] {
            manager.urlSession(
                session,
                downloadTask: task,
                didWriteData: 40_000,
                totalBytesWritten: written,
                totalBytesExpectedToWrite: totalBytes
            )
        }

        let tempFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("sim_dl_tmp_\(UUID().uuidString).mp3")
        try Data(repeating: 0x5A, count: Int(totalBytes)).write(to: tempFile)
        createdFilesToCleanup.append(tempFile)

        manager.urlSession(session, downloadTask: task, didFinishDownloadingTo: tempFile)
        task.cancel()

        XCTAssertEqual(completedPayload?["success"] as? Bool, true, "Download must succeed")
        XCTAssertTrue(FileManager.default.fileExists(atPath: expectedDest.path), "Downloaded file must exist at destination")

        // 校验中间进度包含真实递增的 0%..99% 值，最后落到 100% / completed
        let intermediate = progressValues.filter { $0 > 0 && $0 < 100 }
        XCTAssertGreaterThanOrEqual(
            intermediate.count,
            3,
            "Expected >= 3 intermediate progress events (0 < p < 100), got: \(progressValues)"
        )
        for i in 1..<progressValues.count {
            XCTAssertGreaterThanOrEqual(
                progressValues[i],
                progressValues[i - 1],
                "Progress must be monotonically non-decreasing: \(progressValues)"
            )
        }
        XCTAssertEqual(progressValues.first, 0)
        XCTAssertEqual(progressValues.dropLast().last, 99, "In-flight progress must cap at 99% before file move")
        XCTAssertEqual(progressValues.last, 100, "Final progress event must be 100% after file move")
        XCTAssertEqual(progressStatuses.last, "completed")
    }

    /// 验证 1b：下载失败或超时时主动取消并上报 failed 状态
    func testDownloadFailureAndTimeoutReportsFailedStatus() {
        var sawFailedProgress = false
        var completeSuccess: Bool?

        let manager = LocalMusicAndDownloadManager(
            portProvider: { 30488 },
            tokenProvider: { "test_token" }
        ) { channel, jsonStr in
            guard let data = jsonStr.data(using: .utf8),
                  let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else {
                return
            }
            if channel == "music-download-progress", (dict["status"] as? String) == "failed" {
                sawFailedProgress = true
            } else if channel == "music-download-complete" {
                completeSuccess = dict["success"] as? Bool
            }
        }

        let (session, task) = manager.registerDownloadTaskForTesting(
            songId: "sim_track_timeout",
            filename: "sim_verify_timeout.mp3"
        )
        let timeoutErr = NSError(domain: NSURLErrorDomain, code: NSURLErrorTimedOut, userInfo: nil)
        manager.urlSession(session, task: task, didCompleteWithError: timeoutErr)

        XCTAssertEqual(completeSuccess, false)
        XCTAssertTrue(sawFailedProgress, "Failed/timed-out download must emit status='failed'")
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

        // 在 LocalMusic 目录放置非音频文件，验证 scanWithStats 的 totalFiles 与 supportedFiles 独立统计
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

        let metaBefore = managerBeforeRestart.parseMetadata(paths: [importedUrl.path], skipAssetProbe: true)
        let idBefore = metaBefore.first?["id"] as? String ?? ""
        XCTAssertTrue(idBefore.hasPrefix("local_"), "ID must have 'local_' prefix, got: \(idBefore)")
        XCTAssertEqual(idBefore.count, 22, "SHA-256 8-byte hex ID must be 6 + 16 = 22 chars, got: \(idBefore)")

        // 模拟 App 重启：使用全新 LocalMusicAndDownloadManager 实例重新解析
        let managerAfterRestart = LocalMusicAndDownloadManager(
            portProvider: { 30489 },
            tokenProvider: { "tok2" }
        ) { _, _ in }

        let metaAfter = managerAfterRestart.parseMetadata(paths: [importedUrl.path], skipAssetProbe: true)
        let idAfter = metaAfter.first?["id"] as? String ?? ""
        XCTAssertEqual(idBefore, idAfter, "Deterministic SHA-256 track ID must remain identical across App restarts")
    }

    /// 验证 3：在 iOS JavaScriptCore 引擎中执行真实 IOSJsBridge 注入脚本，确认能力标志为 false 且无效入口调用不触发误导动作
    func testIosCapabilitiesAndNoMisleadingEntries() {
        let prefs = AppPrefs()
        let ncm = NeteaseApiClient(prefs: prefs)
        let unblock = MusicUnblockEngine()
        let httpServer = LocalHttpServer(ncmClient: ncm, unblockEngine: unblock)
        let audio = AudioPlayerManager(ncmClient: ncm, unblockEngine: unblock, skipSystemAudioSetup: true)
        let storage = LocalMusicAndDownloadManager(portProvider: { 30488 }, tokenProvider: { "tok" }) { _, _ in }

        let bridge = IOSJsBridge(
            prefs: prefs,
            ncmClient: ncm,
            unblockEngine: unblock,
            httpServer: httpServer,
            audioManager: audio,
            storageManager: storage,
            onStatusBarStyle: { _ in },
            onOpenExternalUrl: { _ in },
            onShowToast: { _ in },
            onPickTextFile: { cb in cb(nil) },
            onPickLocalAudioSources: { cb in cb(["canceled": true, "filePaths": []]) },
            callbackDispatcher: { _, _, _ in }
        )

        let userScript = bridge.makeInjectionScript()
        let ctx = JSContext()!
        ctx.evaluateScript("""
        var window = this;
        var __postedMessages = [];
        window.webkit = {
          messageHandlers: {
            AlgerIOS: {
              postMessage: function(msg) { __postedMessages.push(msg); }
            }
          }
        };
        """)
        ctx.evaluateScript(userScript.source)

        let probe = ctx.evaluateScript("""
        (function() {
          var caps = JSON.parse(window.AlgerAndroid.getCapabilities());
          var eq1 = window.AlgerAndroid.eqSetEnabled(true);
          var eq2 = window.AlgerAndroid.eqSetBandGain(60, 3);
          var eq3 = window.AlgerAndroid.eqReset();
          var lyric = window.AlgerAndroid.setFloatingLyricEnabled(true);
          var bat = window.AlgerAndroid.requestIgnoreBatteryOptimizations();
          return JSON.stringify({
            platform: window.__ALGER_PLATFORM__,
            caps: caps,
            eq1: eq1,
            eq2: eq2,
            eq3: eq3,
            lyric: lyric,
            bat: bat,
            postedCount: __postedMessages.length
          });
        })();
        """)?.toString() ?? "{}"

        let data = probe.data(using: .utf8)!
        let dict = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        XCTAssertEqual(dict?["platform"] as? String, "ios")

        let caps = dict?["caps"] as? [String: Any]
        XCTAssertEqual(caps?["supportsEq"] as? Bool, false)
        XCTAssertEqual(caps?["supportsFloatingLyric"] as? Bool, false)
        XCTAssertEqual(caps?["supportsBatteryOptimization"] as? Bool, false)
        XCTAssertEqual(caps?["supportsAudioCache"] as? Bool, false)

        XCTAssertEqual(dict?["eq1"] as? Bool, false)
        XCTAssertEqual(dict?["eq2"] as? Bool, false)
        XCTAssertEqual(dict?["eq3"] as? Bool, false)
        XCTAssertEqual(dict?["lyric"] as? Bool, false)
        XCTAssertEqual(dict?["bat"] as? Bool, false)
        XCTAssertEqual(dict?["postedCount"] as? Int, 0, "Disabled iOS entries must not send misleading native messages")
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

    /// 验证 5（Phase 1）：iOS 原生桥接暴露 triggerHaptic 并正确派发四类触觉反馈
    func testIosBridgeTriggerHapticBridgeAndNativeFeedback() {
        let prefs = AppPrefs()
        let ncm = NeteaseApiClient(prefs: prefs)
        let unblock = MusicUnblockEngine()
        let httpServer = LocalHttpServer(ncmClient: ncm, unblockEngine: unblock)
        let audio = AudioPlayerManager(ncmClient: ncm, unblockEngine: unblock, skipSystemAudioSetup: true)
        let storage = LocalMusicAndDownloadManager(portProvider: { 30488 }, tokenProvider: { "tok" }) { _, _ in }

        let bridge = IOSJsBridge(
            prefs: prefs,
            ncmClient: ncm,
            unblockEngine: unblock,
            httpServer: httpServer,
            audioManager: audio,
            storageManager: storage,
            onStatusBarStyle: { _ in },
            onOpenExternalUrl: { _ in },
            onShowToast: { _ in },
            onPickTextFile: { cb in cb(nil) },
            onPickLocalAudioSources: { cb in cb(["canceled": true, "filePaths": []]) },
            callbackDispatcher: { _, _, _ in }
        )

        let userScript = bridge.makeInjectionScript()
        let ctx = JSContext()!
        ctx.evaluateScript("""
        var window = this;
        var __postedMessages = [];
        window.webkit = {
          messageHandlers: {
            AlgerIOS: {
              postMessage: function(msg) { __postedMessages.push(msg); }
            }
          }
        };
        """)
        ctx.evaluateScript(userScript.source)

        let probe = ctx.evaluateScript("""
        (function() {
          window.AlgerAndroid.triggerHaptic('light');
          window.AlgerAndroid.triggerHaptic('medium');
          window.AlgerAndroid.triggerHaptic('selection');
          window.AlgerAndroid.triggerHaptic('success');
          return JSON.stringify(__postedMessages);
        })();
        """)?.toString() ?? "[]"

        let data = probe.data(using: .utf8)!
        let msgs = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] ?? []
        XCTAssertEqual(msgs.count, 4, "Should post 4 triggerHaptic bridge messages")
        let styles = msgs.compactMap { ($0["payload"] as? [String: Any])?["style"] as? String }
        XCTAssertEqual(styles, ["light", "medium", "selection", "success"])
        XCTAssertTrue(msgs.allSatisfy { ($0["method"] as? String) == "triggerHaptic" })

        // 主线程直接触发系统 FeedbackGenerator，验证无崩溃
        for style in ["light", "medium", "selection", "success", "unknown"] {
            bridge.triggerNativeHaptic(style: style)
        }
    }

    /// 验证 6（Phase 2）：iOS 离线可播 ID 集合聚合（下载索引 songId + 确定性 dl_* + 本地导入 local_*）与音量平滑配置
    func testIosPhase2OfflinePlayableIdsAndAudioEnhancement() throws {
        let manager = LocalMusicAndDownloadManager(
            portProvider: { 30488 },
            tokenProvider: { "tok" }
        ) { _, _ in }

        let dlFilename = "phase2_offline_verify_\(Int(Date().timeIntervalSince1970)).mp3"
        let expectedDest = manager.getDownloadDir().appendingPathComponent(dlFilename)
        createdFilesToCleanup.append(expectedDest)

        let (session, task) = manager.registerDownloadTaskForTesting(
            songId: "99887766",
            filename: dlFilename,
            songInfo: ["id": 99887766, "name": "Offline Verify Track"]
        )
        let tempFile = FileManager.default.temporaryDirectory
            .appendingPathComponent("p2_tmp_\(UUID().uuidString).mp3")
        try Data(repeating: 0x33, count: 1024).write(to: tempFile)
        createdFilesToCleanup.append(tempFile)

        manager.urlSession(session, downloadTask: task, didFinishDownloadingTo: tempFile)
        task.cancel()

        let offline = manager.getOfflinePlayableIds()
        let downloadedIds = offline["downloadedIds"] ?? []
        XCTAssertTrue(downloadedIds.contains("99887766"), "Offline downloadedIds must include original NetEase songId")
        XCTAssertTrue(downloadedIds.contains(where: { $0.hasPrefix("dl_") }), "Offline downloadedIds must include deterministic dl_* ID")

        // 验证 AudioPlayerManager 音量平滑系数切换与恢复
        let prefs = AppPrefs()
        let ncm = NeteaseApiClient(prefs: prefs)
        let unblock = MusicUnblockEngine()
        let audio = AudioPlayerManager(ncmClient: ncm, unblockEngine: unblock, skipSystemAudioSetup: true)
        let exp = expectation(description: "audio enhancement applied")
        audio.setAudioEnhancement(crossfadeMs: 1500, volumeNormalization: true)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
            XCTAssertEqual(audio.effectiveTargetVolume(), 0.86, accuracy: 0.01)
            audio.setAudioEnhancement(crossfadeMs: 0, volumeNormalization: false)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.05) {
                XCTAssertEqual(audio.effectiveTargetVolume(), 1.0, accuracy: 0.01)
                exp.fulfill()
            }
        }
        wait(for: [exp], timeout: 2.0)
    }

    /// 验证 7：iOS 外部音频输出（耳机/蓝牙）检测逻辑与 JS 桥接注入
    func testIosExternalAudioOutputDetectionAndBridgeExposure() {
        XCTAssertFalse(IOSJsBridge.hasExternalAudioOutput([]))
        XCTAssertFalse(IOSJsBridge.hasExternalAudioOutput([.builtInSpeaker]))
        XCTAssertFalse(IOSJsBridge.hasExternalAudioOutput([.builtInReceiver]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.headphones]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.bluetoothA2DP]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.bluetoothHFP]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.bluetoothLE]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.usbAudio]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.airPlay]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.carAudio]))
        XCTAssertTrue(IOSJsBridge.hasExternalAudioOutput([.builtInSpeaker, .bluetoothA2DP]))

        let prefs = AppPrefs()
        let ncm = NeteaseApiClient(prefs: prefs)
        let unblock = MusicUnblockEngine()
        let httpServer = LocalHttpServer(ncmClient: ncm, unblockEngine: unblock)
        let audio = AudioPlayerManager(ncmClient: ncm, unblockEngine: unblock, skipSystemAudioSetup: true)
        let storage = LocalMusicAndDownloadManager(portProvider: { 30488 }, tokenProvider: { "tok" }) { _, _ in }

        let bridge = IOSJsBridge(
            prefs: prefs,
            ncmClient: ncm,
            unblockEngine: unblock,
            httpServer: httpServer,
            audioManager: audio,
            storageManager: storage,
            onStatusBarStyle: { _ in },
            onOpenExternalUrl: { _ in },
            onShowToast: { _ in },
            onPickTextFile: { cb in cb(nil) },
            onPickLocalAudioSources: { cb in cb(["canceled": true, "filePaths": []]) },
            callbackDispatcher: { _, _, _ in }
        )

        let ctx = JSContext()!
        ctx.evaluateScript("var window = this; window.webkit = { messageHandlers: { AlgerIOS: { postMessage: function() {} } } };")
        ctx.evaluateScript(bridge.makeInjectionScript().source)

        let res = ctx.evaluateScript("""
        (function() {
          var hasFn = typeof window.AlgerAndroid.isAudioOutputExternal === 'function';
          window.__algerUpdateIosAudioOutputExternal(true);
          var afterTrue = window.AlgerAndroid.isAudioOutputExternal();
          window.__algerUpdateIosAudioOutputExternal(false);
          var afterFalse = window.AlgerAndroid.isAudioOutputExternal();
          return JSON.stringify({ hasFn: hasFn, afterTrue: afterTrue, afterFalse: afterFalse });
        })();
        """)?.toString() ?? "{}"
        let dict = (try? JSONSerialization.jsonObject(with: Data(res.utf8))) as? [String: Any]
        XCTAssertEqual(dict?["hasFn"] as? Bool, true)
        XCTAssertEqual(dict?["afterTrue"] as? Bool, true)
        XCTAssertEqual(dict?["afterFalse"] as? Bool, false)
    }
}
