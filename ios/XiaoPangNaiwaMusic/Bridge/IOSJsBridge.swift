import Foundation
import WebKit

/// iOS WKWebView <-> Swift 桥接层
/// 在文档启动前注入与 Android 完全一致的 window.AlgerAndroid 接口，使前后端双端 100% 同源共享
final class IOSJsBridge: NSObject, WKScriptMessageHandler {
    private let prefs: AppPrefs
    private let ncmClient: NeteaseApiClient
    private let unblockEngine: MusicUnblockEngine
    private let httpServer: LocalHttpServer
    private let audioManager: AudioPlayerManager
    private let storageManager: LocalMusicAndDownloadManager

    private let onStatusBarStyle: (Bool) -> Void
    private let onOpenExternalUrl: (String) -> Void
    private let onShowToast: (String) -> Void
    private let onPickTextFile: (@escaping ([String: Any]?) -> Void) -> Void
    private let onPickLocalAudioSources: (@escaping ([String: Any]) -> Void) -> Void
    private let callbackDispatcher: (String, Bool, String) -> Void

    private let asyncQueue = DispatchQueue(label: "com.alger.musicplayer.ios.bridge", attributes: .concurrent)

    init(
        prefs: AppPrefs,
        ncmClient: NeteaseApiClient,
        unblockEngine: MusicUnblockEngine,
        httpServer: LocalHttpServer,
        audioManager: AudioPlayerManager,
        storageManager: LocalMusicAndDownloadManager,
        onStatusBarStyle: @escaping (Bool) -> Void,
        onOpenExternalUrl: @escaping (String) -> Void,
        onShowToast: @escaping (String) -> Void,
        onPickTextFile: @escaping (@escaping ([String: Any]?) -> Void) -> Void,
        onPickLocalAudioSources: @escaping (@escaping ([String: Any]) -> Void) -> Void,
        callbackDispatcher: @escaping (String, Bool, String) -> Void
    ) {
        self.prefs = prefs
        self.ncmClient = ncmClient
        self.unblockEngine = unblockEngine
        self.httpServer = httpServer
        self.audioManager = audioManager
        self.storageManager = storageManager
        self.onStatusBarStyle = onStatusBarStyle
        self.onOpenExternalUrl = onOpenExternalUrl
        self.onShowToast = onShowToast
        self.onPickTextFile = onPickTextFile
        self.onPickLocalAudioSources = onPickLocalAudioSources
        self.callbackDispatcher = callbackDispatcher
        super.init()
    }

    func makeInjectionScript() -> WKUserScript {
        let cfg = prefs.getServerConfig(localPort: httpServer.port, localToken: httpServer.authToken)
        let cfgData = (try? JSONEncoder().encode(cfg)) ?? Data("{}".utf8)
        let cfgJson = String(data: cfgData, encoding: .utf8) ?? "{}"

        let statusDict: [String: Any] = [
            "running": httpServer.isRunning,
            "port": httpServer.port,
            "hasAnonToken": ncmClient.hasAnonymousToken()
        ]
        let statusData = (try? JSONSerialization.data(withJSONObject: statusDict)) ?? Data("{}".utf8)
        let statusJson = String(data: statusData, encoding: .utf8) ?? "{}"
        let activeTrackJson = audioManager.getActiveTrackJson()

        let js = """
        (function() {
          if (window.AlgerAndroid) return;
          window.__ALGER_PLATFORM__ = 'ios';
          var _capabilities = {
            supportsEq: false,
            supportsFloatingLyric: false,
            supportsBatteryOptimization: false,
            supportsAudioCache: false
          };
          window.__ALGER_CAPABILITIES__ = _capabilities;
          var _serverCfg = \(cfgJson);
          var _localStatus = \(statusJson);
          var _audioState = { instanceId: 0, position: 0, duration: 0, playing: false };
          var _activeTrack = \(activeTrackJson);

          function post(method, payload) {
            try {
              window.webkit.messageHandlers.AlgerIOS.postMessage({ method: method, payload: payload });
            } catch (e) {
              console.error('[AlgerIOS] postMessage error:', method, e);
            }
          }

          window.AlgerAndroid = {
            getCapabilities: function() {
              return JSON.stringify(_capabilities);
            },
            getServerConfig: function() {
              return JSON.stringify(_serverCfg);
            },
            setServerConfig: function(jsonStr) {
              try {
                var parsed = JSON.parse(jsonStr);
                _serverCfg = Object.assign({}, _serverCfg, parsed, { localPort: _localStatus.port, localToken: _serverCfg.localToken, floatingLyricEnabled: false });
              } catch (e) {}
              post('setServerConfig', { json: jsonStr });
              return JSON.stringify(_serverCfg);
            },
            getLocalServerStatus: function() {
              return JSON.stringify(_localStatus);
            },
            invokeAsync: function(callbackId, action, payloadJson) {
              post('invokeAsync', { callbackId: callbackId, action: action, payloadJson: payloadJson });
            },
            audioLoad: function(payloadJson) {
              post('audioLoad', { json: payloadJson });
            },
            audioPlay: function() {
              post('audioPlay', {});
            },
            audioPause: function() {
              post('audioPause', {});
            },
            audioStop: function() {
              post('audioStop', {});
            },
            audioSeek: function(posSec) {
              post('audioSeek', { position: Number(posSec) || 0 });
            },
            audioSetVolume: function(vol) {
              post('audioSetVolume', { volume: Number(vol) });
            },
            audioSetRate: function(rate) {
              post('audioSetRate', { rate: Number(rate) || 1.0 });
            },
            audioGetState: function() {
              return JSON.stringify(_audioState);
            },
            audioGetActiveTrack: function() {
              return JSON.stringify(_activeTrack);
            },
            audioSyncQueue: function(queueJson) {
              post('audioSyncQueue', { json: queueJson });
            },
            // iOS AVPlayer 未接入 AVAudioEngine + AVAudioUnitEQ，能力标志 supportsEq=false，前端应隐藏或置灰入口
            eqSetEnabled: function(_enabled) { return false; },
            eqSetBandGain: function(_freqHz, _gainDb) { return false; },
            eqReset: function() { return false; },
            // iOS 系统不支持全局悬浮窗桌面歌词（supportsFloatingLyric=false）
            setFloatingLyricEnabled: function(_enabled) { return false; },
            isFloatingLyricEnabled: function() { return false; },
            updateFloatingLyric: function() {},
            setStatusBarStyle: function(isDark) {
              post('setStatusBarStyle', { isDark: Boolean(isDark) });
            },
            // iOS 后台播放由 AVAudioSession 托管，无 Android 电池优化白名单概念（supportsBatteryOptimization=false）
            isIgnoringBatteryOptimizations: function() { return true; },
            requestIgnoreBatteryOptimizations: function() { return false; },
            openExternalUrl: function(url) {
              post('openExternalUrl', { url: String(url || '') });
            },
            showToast: function(msg) {
              post('showToast', { msg: String(msg || '') });
            }
          };

          window.__algerUpdateIosStateCache = function(stateObj) {
            if (stateObj) _audioState = Object.assign(_audioState, stateObj);
          };
        })();
        """

        return WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let method = body["method"] as? String else { return }
        let payload = (body["payload"] as? [String: Any]) ?? [:]

        switch method {
        case "setServerConfig":
            if let json = payload["json"] as? String {
                _ = prefs.saveServerConfigFromJson(json, localPort: httpServer.port, localToken: httpServer.authToken)
            }
        case "invokeAsync":
            let callbackId = (payload["callbackId"] as? String) ?? ""
            let action = (payload["action"] as? String) ?? ""
            let payloadJson = (payload["payloadJson"] as? String) ?? "{}"
            handleInvokeAsync(callbackId: callbackId, action: action, payloadJson: payloadJson)
        case "audioLoad":
            if let json = payload["json"] as? String,
               let obj = parseJsonDict(json) {
                audioManager.loadAndPrepare(payload: obj)
            }
        case "audioPlay":
            audioManager.play()
        case "audioPause":
            audioManager.pause()
        case "audioStop":
            audioManager.stop()
        case "audioSeek":
            let pos = (payload["position"] as? Double) ?? 0
            audioManager.seekTo(seconds: pos)
        case "audioSetVolume":
            let vol = Float((payload["volume"] as? Double) ?? 1.0)
            audioManager.setVolume(vol)
        case "audioSetRate":
            let rate = Float((payload["rate"] as? Double) ?? 1.0)
            audioManager.setPlaybackRate(rate)
        case "audioSyncQueue":
            if let json = payload["json"] as? String,
               let obj = parseJsonDict(json) {
                audioManager.syncQueue(payload: obj)
            }
        case "setStatusBarStyle":
            let isDark = (payload["isDark"] as? Bool) ?? false
            DispatchQueue.main.async { self.onStatusBarStyle(isDark) }
        case "openExternalUrl":
            if let url = payload["url"] as? String {
                DispatchQueue.main.async { self.onOpenExternalUrl(url) }
            }
        case "showToast":
            if let msg = payload["msg"] as? String {
                DispatchQueue.main.async { self.onShowToast(msg) }
            }
        default:
            break
        }
    }

    private func handleInvokeAsync(callbackId: String, action: String, payloadJson: String) {
        let payload = parseJsonDict(payloadJson) ?? [:]

        asyncQueue.async { [weak self] in
            guard let self = self else { return }
            switch action {
            case "unblock-music":
                self.handleUnblockMusic(callbackId: callbackId, payload: payload)
            case "http-request":
                self.handleHttpRequest(callbackId: callbackId, payload: payload)
            case "scan-local-music":
                let folderPath = payload["folderPath"] as? String
                let res = self.storageManager.scanWithStats(folderPath: folderPath)
                self.callbackDispatcher(callbackId, true, self.jsonString(res))
            case "parse-local-music-metadata":
                let paths = (payload["filePaths"] as? [String]) ?? []
                let metas = self.storageManager.parseMetadata(paths: paths)
                self.callbackDispatcher(callbackId, true, self.jsonString(metas))
            case "download-music":
                self.storageManager.enqueueDownload(payload)
                self.callbackDispatcher(callbackId, true, "{\"queued\":true}")
            case "get-downloaded-music":
                let list = self.storageManager.getDownloadedList()
                self.callbackDispatcher(callbackId, true, self.jsonString(list))
            case "check-file-exists":
                let path = (payload["path"] as? String) ?? ""
                self.callbackDispatcher(callbackId, true, self.storageManager.checkFileExists(path) ? "true" : "false")
            case "delete-downloaded-music":
                let path = (payload["path"] as? String) ?? ""
                self.callbackDispatcher(callbackId, true, self.storageManager.deleteDownloaded(path) ? "true" : "false")
            case "clear-downloaded-music":
                self.callbackDispatcher(callbackId, true, self.storageManager.clearDownloaded() ? "true" : "false")
            case "save-lyric-file":
                let fn = (payload["filename"] as? String) ?? "lyric"
                let content = (payload["lrcContent"] as? String) ?? ""
                let res = self.storageManager.saveLyricFile(filename: fn, lrcContent: content)
                self.callbackDispatcher(callbackId, true, self.jsonString(res))
            case "save-text-file":
                let fn = (payload["filename"] as? String) ?? "xiaopang-music-backup.json"
                let content = (payload["content"] as? String) ?? ""
                let res = self.storageManager.saveTextFile(filename: fn, content: content)
                self.callbackDispatcher(callbackId, true, self.jsonString(res))
            case "get-downloads-path":
                self.callbackDispatcher(callbackId, true, self.jsonQuote(self.storageManager.getDownloadDir().path))
            case "get-listening-stats":
                self.callbackDispatcher(callbackId, true, ListeningStatsTracker.shared.getStatsJson())
            case "reset-listening-stats":
                let ok = ListeningStatsTracker.shared.resetStats()
                self.callbackDispatcher(callbackId, true, ok ? "true" : "false")
            case "merge-listening-stats":
                let incomingStr: String
                if let s = payload["stats"] as? String {
                    incomingStr = s
                } else if let obj = payload["stats"], JSONSerialization.isValidJSONObject(obj) {
                    incomingStr = self.jsonString(obj)
                } else {
                    incomingStr = "{}"
                }
                let merged = ListeningStatsTracker.shared.mergeStatsJson(incomingStr)
                self.callbackDispatcher(callbackId, true, merged)
            case "select-local-music-source":
                DispatchQueue.main.async {
                    self.onPickLocalAudioSources { result in
                        self.callbackDispatcher(callbackId, true, self.jsonString(result))
                    }
                }
            case "pick-text-file":
                DispatchQueue.main.async {
                    self.onPickTextFile { result in
                        if let r = result {
                            self.callbackDispatcher(callbackId, true, self.jsonString(r))
                        } else {
                            self.callbackDispatcher(callbackId, true, "null")
                        }
                    }
                }
            default:
                self.callbackDispatcher(callbackId, true, "null")
            }
        }
    }

    private func handleUnblockMusic(callbackId: String, payload: [String: Any]) {
        let songId = "\(payload["id"] ?? "")"
        let songData = payload["songData"] as? [String: Any]
        let songName = (songData?["name"] as? String) ?? ""
        var artistNames = [String]()
        let arList = (songData?["ar"] as? [[String: Any]]) ?? (songData?["artists"] as? [[String: Any]]) ?? []
        for item in arList {
            if let name = item["name"] as? String, !name.isEmpty {
                artistNames.append(name)
            }
        }
        let artists = artistNames.joined(separator: " ")
        let sources = (payload["enabledSources"] as? [String]) ?? ["pyncmd", "kuwo", "kugou", "migu", "gdmusic"]

        if let res = unblockEngine.unblock(songId: songId, songName: songName, artists: artists, enabledSources: sources) {
            let wrapped: [String: Any] = [
                "data": [
                    "data": [
                        "url": res.url,
                        "br": res.br,
                        "size": res.size,
                        "platform": res.platform,
                        "gain": 0
                    ],
                    "params": ["id": Int64(songId) ?? 0, "type": "song"]
                ]
            ]
            callbackDispatcher(callbackId, true, jsonString(wrapped))
        } else {
            callbackDispatcher(callbackId, false, jsonString(["error": "多音源解析未找到可用链接"]))
        }
    }

    private func handleHttpRequest(callbackId: String, payload: [String: Any]) {
        guard let url = payload["url"] as? String, !url.isEmpty else {
            callbackDispatcher(callbackId, false, jsonString(["error": "Missing URL"]))
            return
        }
        let method = (payload["method"] as? String) ?? "GET"
        let timeout = (payload["timeout"] as? Double) ?? 15000
        var headers = [String: String]()
        if let rawH = payload["headers"] as? [String: Any] {
            for (k, v) in rawH where !(v is NSNull) {
                headers[k] = "\(v)"
            }
        }
        var bodyStr: String?
        if let rawBody = payload["body"], !(rawBody is NSNull) {
            if let s = rawBody as? String {
                bodyStr = s
            } else if JSONSerialization.isValidJSONObject(rawBody) {
                bodyStr = jsonString(rawBody)
            }
        }
        var formMap: [String: String]?
        if let rawForm = payload["form"] as? [String: Any] {
            var fm = [String: String]()
            for (k, v) in rawForm where !(v is NSNull) {
                fm[k] = "\(v)"
            }
            formMap = fm
        }

        let resp = unblockEngine.proxyHttpRequest(
            url: url,
            method: method,
            headers: headers,
            body: bodyStr,
            form: formMap,
            timeoutMs: timeout
        )
        callbackDispatcher(callbackId, true, jsonString(resp))
    }

    private func parseJsonDict(_ text: String) -> [String: Any]? {
        guard let d = text.data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: d)) as? [String: Any]
    }

    private func jsonString(_ obj: Any) -> String {
        guard JSONSerialization.isValidJSONObject(obj),
              let d = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: d, encoding: .utf8) else {
            return "{}"
        }
        return s
    }

    private func jsonQuote(_ str: String) -> String {
        guard let d = try? JSONSerialization.data(withJSONObject: [str]),
              let arr = String(data: d, encoding: .utf8),
              arr.count >= 2 else { return "\"\"" }
        return String(arr.dropFirst().dropLast())
    }
}
