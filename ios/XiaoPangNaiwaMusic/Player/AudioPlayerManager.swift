import Foundation
import AVFoundation
import MediaPlayer
import UIKit

/// iOS 原生后台音频播放引擎
/// 基于 AVAudioSession (.playback) + AVPlayer + MPRemoteCommandCenter + MPNowPlayingInfoCenter
/// 内置：
/// 1. 息屏/后台原生自动切歌队列引擎（即使 WKWebView 在后台休眠仍能自动解析并连播下一首）
/// 2. 精确 Seek 定位与真实位置回传（音画/歌词 100% 同步）
/// 3. 锁屏/控制中心/AirPods 切歌、暂停、进度拖动与封面展示
final class AudioPlayerManager: NSObject {
    struct NativeQueueItem {
        let id: String
        let name: String
        let artist: String
        let album: String
        let cover: String
        let url: String
        let source: String
        let dt: Int64
    }

    private let ncmClient: NeteaseApiClient
    private let unblockEngine: MusicUnblockEngine
    private let resolveQueue = DispatchQueue(label: "com.alger.musicplayer.ios.resolve", qos: .userInitiated)

    var eventEmitter: ((String, String) -> Void)?
    var isAppInForeground: Bool = true

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var statusObservation: NSKeyValueObservation?
    private var rateObservation: NSKeyValueObservation?
    private var endObserver: NSObjectProtocol?

    private var currentInstanceId: Int = 0
    private var nativeInstanceSeq: Int = 0
    private var currentSongId: String = ""
    private var currentTitle: String = "小庞奶娃音乐"
    private var currentArtist: String = ""
    private var currentAlbum: String = ""
    private var currentCoverUrl: String = ""
    private var currentPlayUrl: String = ""
    private var currentArtwork: MPMediaItemArtwork?
    private var desiredRate: Float = 1.0
    private var desiredVolume: Float = 1.0
    private var desiredAutoplay: Bool = false
    private var initialSeekTime: Double = 0
    private var hasNotifiedLoaded: Bool = false
    private var isNativeManagedTrack: Bool = false
    private var isTransitioningTrack: Bool = false
    private var userPaused: Bool = false
    private var nativeConsecutiveFails: Int = 0
    private var transitionBgTaskId: UIBackgroundTaskIdentifier = .invalid
    private var stopAfterCurrent: Bool = false
    private var preResolvedForInstanceId: Int = 0
    private var preResolvedItem: NativeQueueItem?
    private var preResolvedIndex: Int = 0
    private var preResolvedUrl: String = ""

    // 后台队列状态
    private var nativeQueue: [NativeQueueItem] = []
    private var nativeQueueIndex: Int = 0
    private var nativePlayMode: Int = 0 // 0=顺序, 1=单曲循环, 2=随机, 3=心动
    private var nativeMusicQuality: String = "higher"
    private var nativeUnblockSources: [String] = ["kuwo", "kugou", "migu", "gdmusic"]
    private var nativeUserCookie: String = ""
    private var nativeIsFm: Bool = false

    private var pendingAutoNextWorkItem: DispatchWorkItem?
    private var pendingTrackSyncJson: String?

    private var cachedPositionSec: Double = 0
    private var cachedDurationSec: Double = 0
    private var cachedIsPlaying: Bool = false

    init(ncmClient: NeteaseApiClient, unblockEngine: MusicUnblockEngine) {
        self.ncmClient = ncmClient
        self.unblockEngine = unblockEngine
        super.init()
        configureAudioSession()
        configureRemoteCommands()
        observeSystemAudioNotifications()
    }

    deinit {
        cancelPendingAutoNext()
        endTransitionBackgroundTask()
        cleanupCurrentPlayer()
        NotificationCenter.default.removeObserver(self)
    }

    private func configureAudioSession() {
        let session = AVAudioSession.sharedInstance()
        try? session.setCategory(.playback, mode: .default, options: [])
        try? session.setActive(true)
    }

    private func configureRemoteCommands() {
        let center = MPRemoteCommandCenter.shared()
        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak self] _ in
            self?.play()
            return .success
        }

        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak self] _ in
            self?.pause()
            return .success
        }

        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak self] _ in
            guard let self = self else { return .commandFailed }
            if self.cachedIsPlaying { self.pause() } else { self.play() }
            return .success
        }

        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak self] _ in
            self?.handleExternalTrackCommand("nexttrack", delta: 1)
            return .success
        }

        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak self] _ in
            self?.handleExternalTrackCommand("previoustrack", delta: -1)
            return .success
        }

        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak self] evt in
            guard let posEvt = evt as? MPChangePlaybackPositionCommandEvent else { return .commandFailed }
            self?.seekTo(seconds: posEvt.positionTime)
            return .success
        }
    }

    private func observeSystemAudioNotifications() {
        NotificationCenter.default.addObserver(
            forName: AVAudioSession.interruptionNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let self = self,
                  let info = note.userInfo,
                  let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
                  let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
            if type == .began {
                self.pause()
            } else if type == .ended {
                let optRaw = (info[AVAudioSessionInterruptionOptionKey] as? UInt) ?? 0
                let opts = AVAudioSession.InterruptionOptions(rawValue: optRaw)
                if opts.contains(.shouldResume) {
                    self.play()
                }
            }
        }

        NotificationCenter.default.addObserver(
            forName: AVAudioSession.routeChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let self = self,
                  let info = note.userInfo,
                  let reasonRaw = info[AVAudioSessionRouteChangeReasonKey] as? UInt,
                  let reason = AVAudioSession.RouteChangeReason(rawValue: reasonRaw) else { return }
            if reason == .oldDeviceUnavailable {
                self.pause()
            }
        }
    }

    // MARK: - 播放控制接口

    func loadAndPrepare(payload: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.cancelPendingAutoNext()
            self.pendingTrackSyncJson = nil
            self.isNativeManagedTrack = false
            self.nativeConsecutiveFails = 0

            let urlStr = (payload["url"] as? String) ?? ""
            if urlStr.isEmpty {
                self.emitAudioEvent(type: "loaderror", errorMsg: "Empty URL")
                return
            }

            if let reqId = payload["instanceId"] as? Int {
                self.currentInstanceId = reqId
            } else {
                self.currentInstanceId += 1
            }

            self.currentSongId = "\(payload["songId"] ?? "")"
            let rawTitle = (payload["title"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            self.currentTitle = rawTitle.isEmpty ? "未知歌曲" : rawTitle
            self.currentArtist = (payload["artist"] as? String) ?? ""
            self.currentAlbum = (payload["album"] as? String) ?? ""
            self.currentCoverUrl = (payload["cover"] as? String) ?? ""
            self.currentPlayUrl = urlStr
            ListeningStatsTracker.shared.onTrackChanged(
                songId: self.currentSongId,
                title: self.currentTitle,
                artist: self.currentArtist,
                cover: self.currentCoverUrl,
                playing: false
            )
            self.preResolvedForInstanceId = 0
            self.preResolvedItem = nil
            self.preResolvedUrl = ""
            self.desiredAutoplay = (payload["autoplay"] as? Bool) ?? false
            self.userPaused = !self.desiredAutoplay
            self.isTransitioningTrack = self.desiredAutoplay
            if self.desiredAutoplay {
                self.beginTransitionBackgroundTask()
            }
            if !self.currentSongId.isEmpty,
               let matchedIdx = self.nativeQueue.firstIndex(where: { $0.id == self.currentSongId }) {
                self.nativeQueueIndex = matchedIdx
            }
            self.desiredVolume = Float((payload["volume"] as? Double) ?? 1.0)
            self.desiredRate = Float((payload["rate"] as? Double) ?? 1.0)
            self.initialSeekTime = (payload["seekTime"] as? Double) ?? 0
            let expectedDur = (payload["durationSec"] as? Double) ?? 0
            if expectedDur > 0 { self.cachedDurationSec = expectedDur }

            self.startPlayerWithUrl(urlStr)
        }
    }

    private func startPlayerWithUrl(_ urlStr: String) {
        cleanupCurrentPlayer()
        configureAudioSession()

        guard let targetUrl = resolvePlayableUrl(urlStr) else {
            emitAudioEvent(type: "loaderror", errorMsg: "Invalid media URL")
            return
        }

        hasNotifiedLoaded = false
        cachedPositionSec = max(0, initialSeekTime)
        cachedIsPlaying = false

        var httpHeaders: [String: String] = [
            "User-Agent": MusicUnblockEngine.defaultUA,
            "Accept-Encoding": "identity"
        ]
        let host = (targetUrl.host ?? "").lowercased()
        if host.contains("bilivideo") || host.contains("bilibili") || host.contains("akamaized") {
            httpHeaders["Referer"] = "https://www.bilibili.com/"
        } else if host.contains("music.126.net") {
            httpHeaders["Referer"] = "https://music.163.com/"
        }

        let asset = targetUrl.isFileURL
            ? AVURLAsset(url: targetUrl)
            : AVURLAsset(url: targetUrl, options: ["AVURLAssetHTTPHeaderFieldsKey": httpHeaders])

        let item = AVPlayerItem(asset: asset)
        let newPlayer = AVPlayer(playerItem: item)
        newPlayer.volume = max(0, min(1, desiredVolume))
        newPlayer.automaticallyWaitsToMinimizeStalling = true
        self.player = newPlayer

        let instanceForCallbacks = currentInstanceId

        statusObservation = item.observe(\.status, options: [.new]) { [weak self] playerItem, _ in
            DispatchQueue.main.async {
                guard let self = self, self.currentInstanceId == instanceForCallbacks else { return }
                switch playerItem.status {
                case .readyToPlay:
                    self.nativeConsecutiveFails = 0
                    self.isTransitioningTrack = false
                    self.endTransitionBackgroundTask()
                    self.updateCachedMetrics()
                    if self.initialSeekTime > 0 {
                        let t = CMTime(seconds: self.initialSeekTime, preferredTimescale: 1000)
                        self.initialSeekTime = 0
                        self.player?.seek(to: t, toleranceBefore: .zero, toleranceAfter: .zero)
                    }
                    if !self.hasNotifiedLoaded {
                        self.hasNotifiedLoaded = true
                        self.emitAudioEvent(type: "loaded")
                    }
                    if self.desiredAutoplay {
                        self.player?.playImmediately(atRate: max(0.25, min(4.0, self.desiredRate)))
                    }
                    if !self.userPaused {
                        self.preResolveNextTrackIfNeeded(force: false)
                    }
                    self.updateNowPlayingInfo()
                case .failed:
                    let msg = playerItem.error?.localizedDescription ?? "AVPlayer load failed"
                    self.emitAudioEvent(type: self.hasNotifiedLoaded ? "playerror" : "loaderror", errorMsg: msg)
                    if !self.userPaused && (!self.isAppInForeground || self.isNativeManagedTrack) && self.nativeConsecutiveFails < 8 {
                        self.nativeConsecutiveFails += 1
                        self.isTransitioningTrack = true
                        self.beginTransitionBackgroundTask()
                        self.advanceNativeQueue(delta: 1, fromEnded: false)
                    } else {
                        self.isTransitioningTrack = false
                        self.endTransitionBackgroundTask()
                    }
                default:
                    break
                }
            }
        }

        rateObservation = newPlayer.observe(\.timeControlStatus, options: [.new]) { [weak self] p, _ in
            DispatchQueue.main.async {
                guard let self = self, self.currentInstanceId == instanceForCallbacks else { return }
                let playingNow = (p.timeControlStatus == .playing)
                if playingNow != self.cachedIsPlaying {
                    self.cachedIsPlaying = playingNow
                    ListeningStatsTracker.shared.onPlayStateChanged(
                        playing: playingNow,
                        songId: self.currentSongId,
                        title: self.currentTitle,
                        artist: self.currentArtist,
                        cover: self.currentCoverUrl
                    )
                    self.updateCachedMetrics()
                    self.emitAudioEvent(type: playingNow ? "play" : "pause")
                    self.updateNowPlayingInfo()
                }
            }
        }

        endObserver = NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: item,
            queue: .main
        ) { [weak self] _ in
            guard let self = self, self.currentInstanceId == instanceForCallbacks else { return }
            self.cachedIsPlaying = false
            self.updateCachedMetrics()
            self.handleTrackEnded()
        }

        let interval = CMTime(seconds: 0.2, preferredTimescale: 600)
        timeObserver = newPlayer.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] _ in
            guard let self = self, self.currentInstanceId == instanceForCallbacks else { return }
            self.updateCachedMetrics()
            if self.cachedIsPlaying {
                ListeningStatsTracker.shared.flushPeriodic()
                self.emitAudioEvent(type: "timeupdate")
            }
        }

        updateNowPlayingInfo()
        fetchCoverArtworkAsync(urlStr: currentCoverUrl, instanceId: instanceForCallbacks)
    }

    func play() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let p = self.player else { return }
            self.configureAudioSession()
            self.userPaused = false
            self.desiredAutoplay = true
            // 如果已播到结尾，回到起点重播
            if self.cachedDurationSec > 0 && self.cachedPositionSec >= self.cachedDurationSec - 0.5 {
                p.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
            }
            p.playImmediately(atRate: max(0.25, min(4.0, self.desiredRate)))
            self.updateNowPlayingInfo()
        }
    }

    func pause() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.userPaused = true
            self.isTransitioningTrack = false
            self.cancelPendingAutoNext()
            self.endTransitionBackgroundTask()
            self.desiredAutoplay = false
            self.player?.pause()
            self.cachedIsPlaying = false
            ListeningStatsTracker.shared.onPlayStateChanged(
                playing: false,
                songId: self.currentSongId,
                title: self.currentTitle,
                artist: self.currentArtist,
                cover: self.currentCoverUrl
            )
            self.updateCachedMetrics()
            self.emitAudioEvent(type: "pause")
            self.updateNowPlayingInfo()
        }
    }

    func stop() {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.userPaused = true
            self.isTransitioningTrack = false
            self.cancelPendingAutoNext()
            self.endTransitionBackgroundTask()
            self.cleanupCurrentPlayer()
            self.cachedIsPlaying = false
            ListeningStatsTracker.shared.onPlayStateChanged(
                playing: false,
                songId: self.currentSongId,
                title: self.currentTitle,
                artist: self.currentArtist,
                cover: self.currentCoverUrl
            )
            self.cachedPositionSec = 0
            self.updateNowPlayingInfo()
        }
    }

    func seekTo(seconds: Double) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self, let p = self.player else { return }
            let clamped = self.cachedDurationSec > 0
                ? max(0, min(seconds, max(0, self.cachedDurationSec - 0.25)))
                : max(0, seconds)
            let target = CMTime(seconds: clamped, preferredTimescale: 1000)
            p.seek(to: target, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self = self else { return }
                    self.updateCachedMetrics()
                    self.emitAudioEvent(type: "seek")
                    self.updateNowPlayingInfo()
                }
            }
        }
    }

    func setVolume(_ volume: Float) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.desiredVolume = max(0, min(1, volume))
            self.player?.volume = self.desiredVolume
        }
    }

    func setPlaybackRate(_ rate: Float) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.desiredRate = max(0.25, min(4.0, rate))
            if self.cachedIsPlaying {
                self.player?.rate = self.desiredRate
            }
            self.updateNowPlayingInfo()
        }
    }

    func getStateJson() -> String {
        let dict: [String: Any] = [
            "instanceId": currentInstanceId,
            "position": cachedPositionSec,
            "duration": cachedDurationSec,
            "playing": cachedIsPlaying
        ]
        guard let d = try? JSONSerialization.data(withJSONObject: dict),
              let s = String(data: d, encoding: .utf8) else {
            return "{\"instanceId\":0,\"position\":0,\"duration\":0,\"playing\":false}"
        }
        return s
    }

    func getActiveTrackJson() -> String {
        guard !currentSongId.isEmpty, !currentPlayUrl.isEmpty, currentInstanceId != 0 else {
            return "{\"hasActiveTrack\":false}"
        }
        let dict: [String: Any] = [
            "hasActiveTrack": true,
            "instanceId": currentInstanceId,
            "index": nativeQueueIndex,
            "songId": currentSongId,
            "url": currentPlayUrl,
            "title": currentTitle,
            "artist": currentArtist,
            "album": currentAlbum,
            "cover": currentCoverUrl,
            "position": cachedPositionSec,
            "duration": cachedDurationSec,
            "playing": cachedIsPlaying || isTransitioningTrack,
            "isFm": nativeIsFm
        ]
        guard let d = try? JSONSerialization.data(withJSONObject: dict),
              let s = String(data: d, encoding: .utf8) else {
            return "{\"hasActiveTrack\":false}"
        }
        return s
    }

    // MARK: - 后台原生自动切歌队列

    func syncQueue(payload: [String: Any]) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            if let mode = payload["playMode"] as? Int { self.nativePlayMode = mode }
            let incomingIdx = (payload["currentIndex"] as? Int) ?? self.nativeQueueIndex
            if let q = payload["musicQuality"] as? String, !q.isEmpty { self.nativeMusicQuality = q }
            if let fm = payload["isFm"] as? Bool { self.nativeIsFm = fm }
            if let stop = payload["stopAfterCurrent"] as? Bool { self.stopAfterCurrent = stop }
            if let c = payload["cookie"] as? String { self.nativeUserCookie = c }
            if let srcs = payload["unblockSources"] as? [String], !srcs.isEmpty {
                self.nativeUnblockSources = srcs
            }
            if let items = payload["items"] as? [[String: Any]] {
                let parsed = items.map { o in
                    NativeQueueItem(
                        id: "\(o["id"] ?? "")",
                        name: (o["name"] as? String) ?? "",
                        artist: (o["artist"] as? String) ?? "",
                        album: (o["album"] as? String) ?? "",
                        cover: (o["cover"] as? String) ?? "",
                        url: (o["url"] as? String) ?? "",
                        source: (o["source"] as? String) ?? "netease",
                        dt: (o["dt"] as? NSNumber)?.int64Value ?? 0
                    )
                }
                if self.pendingTrackSyncJson != nil && self.isNativeManagedTrack && !self.currentSongId.isEmpty {
                    if let idx = parsed.firstIndex(where: { $0.id == self.currentSongId }) {
                        self.nativeQueue = parsed
                        self.nativeQueueIndex = idx
                    }
                    return
                }
                self.nativeQueue = parsed
                if !self.currentSongId.isEmpty && !parsed.isEmpty {
                    let safeIdx = max(0, min(incomingIdx, parsed.count - 1))
                    if parsed[safeIdx].id == self.currentSongId {
                        self.nativeQueueIndex = safeIdx
                    } else if let matchedIdx = parsed.firstIndex(where: { $0.id == self.currentSongId }) {
                        self.nativeQueueIndex = matchedIdx
                    } else {
                        self.nativeQueueIndex = safeIdx
                    }
                } else {
                    self.nativeQueueIndex = max(0, incomingIdx)
                }
            }
        }
    }

    func onAppForegroundChanged(_ inForeground: Bool) {
        DispatchQueue.main.async { [weak self] in
            guard let self = self else { return }
            self.isAppInForeground = inForeground
            if inForeground {
                self.syncStateToWebView()
            } else if !self.userPaused && self.isTransitioningTrack && self.pendingAutoNextWorkItem != nil && !self.cachedIsPlaying {
                self.cancelPendingAutoNext()
                let tokenId = self.currentInstanceId
                let fastWork = DispatchWorkItem { [weak self] in
                    guard let self = self, !self.userPaused, self.currentInstanceId == tokenId, !self.cachedIsPlaying else { return }
                    self.advanceNativeQueue(delta: 1, fromEnded: true)
                }
                self.pendingAutoNextWorkItem = fastWork
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: fastWork)
            }
        }
    }

    private func beginTransitionBackgroundTask() {
        if transitionBgTaskId != .invalid { return }
        transitionBgTaskId = UIApplication.shared.beginBackgroundTask(withName: "XiaoPangTrackTransition") { [weak self] in
            self?.endTransitionBackgroundTask()
        }
    }

    private func endTransitionBackgroundTask() {
        if transitionBgTaskId != .invalid {
            let id = transitionBgTaskId
            transitionBgTaskId = .invalid
            UIApplication.shared.endBackgroundTask(id)
        }
    }

    func syncStateToWebView() {
        updateCachedMetrics()
        if let pending = pendingTrackSyncJson {
            pendingTrackSyncJson = nil
            if let d = pending.data(using: .utf8),
               var dict = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any] {
                dict["position"] = cachedPositionSec
                if cachedDurationSec > 0 { dict["duration"] = cachedDurationSec }
                dict["playing"] = cachedIsPlaying
                if let out = try? JSONSerialization.data(withJSONObject: dict),
                   let s = String(data: out, encoding: .utf8) {
                    eventEmitter?("audio-event", s)
                }
            } else {
                eventEmitter?("audio-event", pending)
            }
        }
        emitAudioEvent(type: "sync-state")
    }

    private func cancelPendingAutoNext() {
        pendingAutoNextWorkItem?.cancel()
        pendingAutoNextWorkItem = nil
    }

    private func preResolveNextTrackIfNeeded(force: Bool) {
        if userPaused || stopAfterCurrent || nativePlayMode == 1 { return }
        if !force && preResolvedForInstanceId == currentInstanceId && preResolvedItem != nil && !preResolvedUrl.isEmpty {
            return
        }
        let tokenId = currentInstanceId
        let queueSnapshot = nativeQueue
        let indexSnapshot = nativeQueueIndex
        let qualitySnapshot = nativeMusicQuality
        let sourcesSnapshot = nativeUnblockSources
        let cookieSnapshot = nativeUserCookie
        let isFmSnapshot = nativeIsFm
        let songIdSnapshot = currentSongId

        resolveQueue.async { [weak self] in
            guard let self = self else { return }
            if isFmSnapshot {
                var fmItems = self.fetchNativeFmSongs(excludeId: songIdSnapshot, cookie: cookieSnapshot)
                if fmItems.isEmpty {
                    fmItems = self.fetchNativeRecommendedSongs(excludeId: songIdSnapshot, cookie: cookieSnapshot)
                }
                for item in fmItems.prefix(6) {
                    if let resolved = self.resolveItemUrlNatively(item: item, quality: qualitySnapshot, sources: sourcesSnapshot, cookie: cookieSnapshot) {
                        DispatchQueue.main.async {
                            guard !self.userPaused, self.currentInstanceId == tokenId else { return }
                            self.preResolvedForInstanceId = tokenId
                            self.preResolvedItem = item
                            self.preResolvedIndex = 0
                            self.preResolvedUrl = resolved
                        }
                        return
                    }
                }
                return
            }

            var workingQueue = queueSnapshot
            var workingIndex = indexSnapshot
            if workingQueue.count <= 1 {
                let existingIds = Set(workingQueue.map { $0.id })
                let rec = self.fetchNativeRecommendedSongs(excludeId: songIdSnapshot, cookie: cookieSnapshot)
                    .filter { !existingIds.contains($0.id) }
                if !rec.isEmpty {
                    workingQueue.append(contentsOf: rec)
                    if workingQueue.count == rec.count { workingIndex = -1 }
                    let updated = workingQueue
                    DispatchQueue.main.async {
                        if !self.userPaused && self.currentInstanceId == tokenId {
                            self.nativeQueue = updated
                        }
                    }
                }
            }
            guard !workingQueue.isEmpty else { return }
            let count = workingQueue.count
            let safeIdx = workingIndex < 0 ? -1 : max(0, min(workingIndex, count - 1))
            let candidateIndices: [Int]
            if self.nativePlayMode == 2 && count > 1 {
                // 真随机模式：打乱候选索引并排除当前曲目
                candidateIndices = (0..<count).filter { $0 != safeIdx }.shuffled()
            } else {
                let startIdx = safeIdx < 0 ? 0 : (safeIdx + 1) % count
                candidateIndices = (0..<count).map { (startIdx + $0) % count }
            }
            for idx in candidateIndices.prefix(6) {
                let item = workingQueue[idx]
                if count > 1 && item.id == songIdSnapshot { continue }
                if let resolved = self.resolveItemUrlNatively(item: item, quality: qualitySnapshot, sources: sourcesSnapshot, cookie: cookieSnapshot) {
                    DispatchQueue.main.async {
                        guard !self.userPaused, self.currentInstanceId == tokenId else { return }
                        self.preResolvedForInstanceId = tokenId
                        self.preResolvedItem = item
                        self.preResolvedIndex = idx
                        self.preResolvedUrl = resolved
                    }
                    return
                }
            }
        }
    }

    private func handleTrackEnded() {
        if userPaused || stopAfterCurrent {
            isTransitioningTrack = false
            endTransitionBackgroundTask()
            if stopAfterCurrent {
                emitAudioEvent(type: "end")
            }
            return
        }

        beginTransitionBackgroundTask()
        isTransitioningTrack = true

        // 1. 单曲循环：直接在 iOS 原生层瞬时重播
        if nativePlayMode == 1, let p = player {
            p.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self] _ in
                DispatchQueue.main.async {
                    guard let self = self, !self.userPaused else { return }
                    self.desiredAutoplay = true
                    self.isTransitioningTrack = false
                    self.endTransitionBackgroundTask()
                    p.playImmediately(atRate: max(0.25, min(4.0, self.desiredRate)))
                    self.cachedPositionSec = 0
                    self.cachedIsPlaying = true
                    self.emitAudioEvent(type: "replayed")
                    self.updateNowPlayingInfo()
                }
            }
            return
        }

        // 2. 优先使用已提前在播放期解析好的下一首（0ms 无冷网络延迟，息屏/锁屏 100% 必连播）
        if preResolvedForInstanceId == currentInstanceId,
           let nextItem = preResolvedItem,
           !preResolvedUrl.isEmpty {
            let nextIdx = preResolvedIndex
            let nextUrl = preResolvedUrl
            preResolvedForInstanceId = 0
            preResolvedItem = nil
            preResolvedUrl = ""
            if nativeIsFm { nativeQueue = [nextItem] }
            playNativeQueueItem(index: nextIdx, item: nextItem, url: nextUrl)
            return
        }

        // 3. 无论前后台，均由原生层立即解析并拉起下一首（不再等待休眠 WebView）
        cancelPendingAutoNext()
        advanceNativeQueue(delta: 1, fromEnded: true)
    }

    private func handleExternalTrackCommand(_ cmd: String, delta: Int) {
        userPaused = false
        beginTransitionBackgroundTask()
        isTransitioningTrack = true
        if !isAppInForeground {
            cancelPendingAutoNext()
            advanceNativeQueue(delta: delta, fromEnded: false)
            return
        }
        let prevId = currentInstanceId
        emitMediaControl(cmd)
        cancelPendingAutoNext()
        let work = DispatchWorkItem { [weak self] in
            guard let self = self, !self.userPaused, self.currentInstanceId == prevId else { return }
            self.advanceNativeQueue(delta: delta, fromEnded: false)
        }
        pendingAutoNextWorkItem = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.5, execute: work)
    }

    private func fetchNativeRecommendedSongs(excludeId: String, cookie: String) -> [NativeQueueItem] {
        var params: [String: String] = ["limit": "20"]
        if !cookie.isEmpty { params["cookie"] = cookie }
        let res = ncmClient.dispatch(path: "/personalized/newsong", params: params)
        guard let d = res.body.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let arr = root["result"] as? [[String: Any]] else { return [] }
        return arr.compactMap { o in
            let id = "\(o["id"] ?? "")"
            guard !id.isEmpty, id != excludeId else { return nil }
            let name = (o["name"] as? String) ?? ""
            let songObj = o["song"] as? [String: Any]
            let albumObj = songObj?["album"] as? [String: Any]
            let artistsArr = songObj?["artists"] as? [[String: Any]]
            let artistStr = artistsArr?.compactMap { $0["name"] as? String }.joined(separator: " / ") ?? ""
            let cover = (o["picUrl"] as? String) ?? (albumObj?["picUrl"] as? String) ?? ""
            let albumName = (albumObj?["name"] as? String) ?? ""
            let dt = (songObj?["duration"] as? NSNumber)?.int64Value ?? 0
            return NativeQueueItem(id: id, name: name, artist: artistStr, album: albumName, cover: cover, url: "", source: "netease", dt: dt)
        }
    }

    private func fetchNativeFmSongs(excludeId: String, cookie: String) -> [NativeQueueItem] {
        var params: [String: String] = [:]
        if !cookie.isEmpty { params["cookie"] = cookie }
        let res = ncmClient.dispatch(path: "/personal_fm", params: params)
        guard let d = res.body.data(using: .utf8),
              let root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
              let arr = root["data"] as? [[String: Any]] else { return [] }
        return arr.compactMap { o in
            let id = "\(o["id"] ?? "")"
            guard !id.isEmpty, id != excludeId else { return nil }
            let name = (o["name"] as? String) ?? ""
            let albumObj = (o["album"] as? [String: Any]) ?? (o["al"] as? [String: Any])
            let artistsArr = (o["artists"] as? [[String: Any]]) ?? (o["ar"] as? [[String: Any]])
            let artistStr = artistsArr?.compactMap { $0["name"] as? String }.joined(separator: " / ") ?? ""
            let cover = (albumObj?["picUrl"] as? String) ?? ""
            let albumName = (albumObj?["name"] as? String) ?? ""
            let dt = ((o["duration"] ?? o["dt"]) as? NSNumber)?.int64Value ?? 0
            return NativeQueueItem(id: id, name: name, artist: artistStr, album: albumName, cover: cover, url: "", source: "netease", dt: dt)
        }
    }

    private func advanceNativeQueue(delta: Int, fromEnded: Bool) {
        let queueSnapshot = nativeQueue
        let indexSnapshot = nativeQueueIndex
        let qualitySnapshot = nativeMusicQuality
        let sourcesSnapshot = nativeUnblockSources
        let cookieSnapshot = nativeUserCookie
        let isFmSnapshot = nativeIsFm
        let songIdSnapshot = currentSongId
        let tokenId = currentInstanceId

        resolveQueue.async { [weak self] in
            guard let self = self else { return }

            // 1. 私人漫游 FM 后台原生续播
            if isFmSnapshot {
                var fmItems = self.fetchNativeFmSongs(excludeId: songIdSnapshot, cookie: cookieSnapshot)
                if fmItems.isEmpty {
                    fmItems = self.fetchNativeRecommendedSongs(excludeId: songIdSnapshot, cookie: cookieSnapshot)
                }
                for item in fmItems.prefix(8) {
                    if let resolved = self.resolveItemUrlNatively(
                        item: item,
                        quality: qualitySnapshot,
                        sources: sourcesSnapshot,
                        cookie: cookieSnapshot
                    ) {
                        DispatchQueue.main.async {
                            guard !self.userPaused, self.currentInstanceId == tokenId else { return }
                            self.nativeQueue = [item]
                            self.playNativeQueueItem(index: 0, item: item, url: resolved)
                        }
                        return
                    }
                }
            }

            // 2. 普通队列：不点暂停永远不中断（末尾自动循环，空/单曲队列自动拉取推荐新歌续播）
            var workingQueue = queueSnapshot
            var workingIndex = indexSnapshot
            if workingQueue.count <= 1 {
                let existingIds = Set(workingQueue.map { $0.id })
                let rec = self.fetchNativeRecommendedSongs(excludeId: songIdSnapshot, cookie: cookieSnapshot)
                    .filter { !existingIds.contains($0.id) }
                if !rec.isEmpty {
                    workingQueue.append(contentsOf: rec)
                    if workingQueue.count == rec.count {
                        workingIndex = -1
                    }
                    let updated = workingQueue
                    DispatchQueue.main.async {
                        if !self.userPaused && self.currentInstanceId == tokenId {
                            self.nativeQueue = updated
                        }
                    }
                }
            }

            guard !workingQueue.isEmpty else {
                DispatchQueue.main.async {
                    if !self.userPaused && self.currentInstanceId == tokenId, let p = self.player {
                        p.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
                        p.playImmediately(atRate: max(0.25, min(4.0, self.desiredRate)))
                        self.cachedPositionSec = 0
                        self.cachedIsPlaying = true
                        self.isTransitioningTrack = false
                        self.endTransitionBackgroundTask()
                        self.emitAudioEvent(type: "replayed")
                        self.updateNowPlayingInfo()
                    } else {
                        self.isTransitioningTrack = false
                        self.endTransitionBackgroundTask()
                    }
                }
                return
            }

            let count = workingQueue.count
            let safeIdx = workingIndex < 0 ? -1 : max(0, min(workingIndex, count - 1))
            let candidateIndices: [Int]
            if self.nativePlayMode == 2 && count > 1 {
                candidateIndices = (0..<count).filter { $0 != safeIdx }.shuffled()
            } else {
                let startIdx = safeIdx < 0 ? 0 : ((safeIdx + delta) % count + count) % count
                let step = delta >= 0 ? 1 : -1
                candidateIndices = (0..<count).map { ((startIdx + $0 * step) % count + count) % count }
            }

            for idx in candidateIndices.prefix(8) {
                let item = workingQueue[idx]
                if let resolved = self.resolveItemUrlNatively(
                    item: item,
                    quality: qualitySnapshot,
                    sources: sourcesSnapshot,
                    cookie: cookieSnapshot
                ) {
                    DispatchQueue.main.async {
                        guard !self.userPaused, self.currentInstanceId == tokenId else { return }
                        self.playNativeQueueItem(index: idx, item: item, url: resolved)
                    }
                    return
                }
            }

            DispatchQueue.main.async {
                if !self.userPaused && self.currentInstanceId == tokenId && count == 1, let p = self.player {
                    p.seek(to: .zero, toleranceBefore: .zero, toleranceAfter: .zero)
                    p.playImmediately(atRate: max(0.25, min(4.0, self.desiredRate)))
                    self.cachedPositionSec = 0
                    self.cachedIsPlaying = true
                    self.isTransitioningTrack = false
                    self.endTransitionBackgroundTask()
                    self.emitAudioEvent(type: "replayed")
                    self.updateNowPlayingInfo()
                } else {
                    self.isTransitioningTrack = false
                    self.endTransitionBackgroundTask()
                }
            }
        }
    }

    private func resolveItemUrlNatively(
        item: NativeQueueItem,
        quality: String,
        sources: [String],
        cookie: String
    ) -> String? {
        if item.url.hasPrefix("local:///") {
            return item.url
        }

        if item.source.isEmpty || item.source == "netease" {
            if !item.id.isEmpty {
                var params: [String: String] = ["id": item.id, "level": quality]
                if !cookie.isEmpty { params["cookie"] = cookie }
                let res = ncmClient.dispatch(path: "/song/url/v1", params: params)
                if let d = res.body.data(using: .utf8),
                   let root = (try? JSONSerialization.jsonObject(with: d)) as? [String: Any],
                   let arr = root["data"] as? [[String: Any]],
                   let first = arr.first,
                   let url = first["url"] as? String, url.hasPrefix("http") {
                    let isTrial = (first["freeTrialInfo"] != nil && !(first["freeTrialInfo"] is NSNull))
                    if !isTrial { return url }
                }
            }
            if let unblocked = unblockEngine.unblock(songId: item.id, songName: item.name, artists: item.artist, enabledSources: sources),
               unblocked.url.hasPrefix("http") {
                return unblocked.url
            }
        }

        if item.url.hasPrefix("http") {
            return item.url
        }
        return nil
    }

    private func playNativeQueueItem(index: Int, item: NativeQueueItem, url: String) {
        nativeInstanceSeq -= 1
        currentInstanceId = nativeInstanceSeq
        nativeQueueIndex = index
        currentSongId = item.id
        isNativeManagedTrack = true
        isTransitioningTrack = true
        userPaused = false
        currentTitle = item.name.isEmpty ? "未知歌曲" : item.name
        currentArtist = item.artist
        currentAlbum = item.album
        currentCoverUrl = item.cover
        currentPlayUrl = url
        ListeningStatsTracker.shared.onTrackChanged(
            songId: currentSongId,
            title: currentTitle,
            artist: currentArtist,
            cover: currentCoverUrl,
            playing: false
        )
        preResolvedForInstanceId = 0
        preResolvedItem = nil
        preResolvedUrl = ""
        desiredAutoplay = true
        initialSeekTime = 0
        cachedDurationSec = Double(item.dt) / 1000.0

        startPlayerWithUrl(url)

        let payload: [String: Any] = [
            "type": "native-track-changed",
            "instanceId": currentInstanceId,
            "index": index,
            "songId": item.id,
            "url": url,
            "title": currentTitle,
            "artist": currentArtist,
            "album": currentAlbum,
            "cover": currentCoverUrl,
            "duration": cachedDurationSec,
            "position": 0.0,
            "playing": true,
            "isFm": nativeIsFm
        ]
        if let d = try? JSONSerialization.data(withJSONObject: payload),
           let s = String(data: d, encoding: .utf8) {
            pendingTrackSyncJson = s
            eventEmitter?("audio-event", s)
        }
    }

    // MARK: - Helpers

    private func resolvePlayableUrl(_ raw: String) -> URL? {
        if raw.hasPrefix("local:///") {
            let stripped = String(raw.dropFirst(9))
            let decoded = stripped.removingPercentEncoding ?? stripped
            return URL(fileURLWithPath: decoded)
        }
        return URL(string: raw)
    }

    private func updateCachedMetrics() {
        guard let p = player else { return }
        let pos = CMTimeGetSeconds(p.currentTime())
        if pos.isFinite && pos >= 0 {
            cachedPositionSec = pos
        }
        if let item = p.currentItem {
            let dur = CMTimeGetSeconds(item.duration)
            if dur.isFinite && dur > 0 {
                cachedDurationSec = dur
            }
        }
        cachedIsPlaying = (p.timeControlStatus == .playing)
    }

    private func updateNowPlayingInfo() {
        var info = [String: Any]()
        info[MPMediaItemPropertyTitle] = currentTitle
        info[MPMediaItemPropertyArtist] = currentArtist.isEmpty ? "小庞奶娃音乐" : currentArtist
        if !currentAlbum.isEmpty {
            info[MPMediaItemPropertyAlbumTitle] = currentAlbum
        }
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = cachedPositionSec
        if cachedDurationSec > 0 {
            info[MPMediaItemPropertyPlaybackDuration] = cachedDurationSec
        }
        info[MPNowPlayingInfoPropertyPlaybackRate] = cachedIsPlaying ? Double(desiredRate) : 0.0
        if let art = currentArtwork {
            info[MPMediaItemPropertyArtwork] = art
        }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    private func fetchCoverArtworkAsync(urlStr: String, instanceId: Int) {
        currentArtwork = nil
        guard !urlStr.isEmpty, !urlStr.hasPrefix("/images/") else { return }
        let finalStr = (urlStr.hasPrefix("http") && !urlStr.contains("127.0.0.1") && !urlStr.contains("param="))
            ? "\(urlStr)?param=300y300"
            : urlStr
        guard let url = URL(string: finalStr) else { return }

        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self, let d = data, let img = UIImage(data: d) else { return }
            DispatchQueue.main.async {
                guard self.currentInstanceId == instanceId else { return }
                self.currentArtwork = MPMediaItemArtwork(boundsSize: img.size) { _ in img }
                self.updateNowPlayingInfo()
            }
        }.resume()
    }

    private func cleanupCurrentPlayer() {
        if let obs = timeObserver, let p = player {
            p.removeTimeObserver(obs)
        }
        timeObserver = nil
        statusObservation?.invalidate()
        statusObservation = nil
        rateObservation?.invalidate()
        rateObservation = nil
        if let eo = endObserver {
            NotificationCenter.default.removeObserver(eo)
            endObserver = nil
        }
        player?.pause()
        player = nil
    }

    private func emitAudioEvent(type: String, errorMsg: String? = nullString) {
        var dict: [String: Any] = [
            "type": type,
            "instanceId": currentInstanceId,
            "position": cachedPositionSec,
            "duration": cachedDurationSec,
            "playing": cachedIsPlaying
        ]
        if let err = errorMsg { dict["error"] = err }
        if let d = try? JSONSerialization.data(withJSONObject: dict),
           let s = String(data: d, encoding: .utf8) {
            eventEmitter?("audio-event", s)
        }
    }

    private func emitMediaControl(_ cmd: String) {
        if let d = try? JSONSerialization.data(withJSONObject: ["type": cmd]),
           let s = String(data: d, encoding: .utf8) {
            eventEmitter?("audio-event", s)
        }
    }
}

private let nullString: String? = nil
