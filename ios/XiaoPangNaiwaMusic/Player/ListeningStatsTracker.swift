import Foundation
import QuartzCore

/// iOS 原生听歌时长统计引擎（息屏 / 后台自动切歌全程精确计秒，与 Android JSON 结构完全一致）
final class ListeningStatsTracker {
    static let shared = ListeningStatsTracker()

    private struct SongStat: Codable {
        var id: String
        var name: String
        var artist: String
        var cover: String
        var seconds: Int64
        var plays: Int
    }

    private struct StatsPayload: Codable {
        var totalSeconds: Int64
        var dailySeconds: [String: Int64]
        var hourlySeconds: [Int64]
        var songs: [String: SongStat]
        var artists: [String: Int64]
    }

    private let defaultsKey = "alger_listening_stats_v1"
    private let lock = NSLock()
    private let dateFormatter: DateFormatter = {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        return f
    }()

    private var payload: StatsPayload
    private var activePlaying = false
    private var sessionStartMono: Double = 0
    private var lastFlushMono: Double = 0
    private var activeSongId = ""
    private var activeTitle = ""
    private var activeArtist = ""
    private var activeCover = ""
    private var lastCountedKey = ""

    private init() {
        if let raw = UserDefaults.standard.string(forKey: defaultsKey),
           let data = raw.data(using: .utf8),
           var decoded = try? JSONDecoder().decode(StatsPayload.self, from: data) {
            if decoded.hourlySeconds.count < 24 {
                decoded.hourlySeconds.append(contentsOf: Array(repeating: 0, count: 24 - decoded.hourlySeconds.count))
            }
            self.payload = decoded
        } else {
            self.payload = StatsPayload(
                totalSeconds: 0,
                dailySeconds: [:],
                hourlySeconds: Array(repeating: 0, count: 24),
                songs: [:],
                artists: [:]
            )
        }
    }

    func onPlayStateChanged(playing: Bool, songId: String, title: String, artist: String, cover: String) {
        lock.lock()
        defer { lock.unlock() }

        let now = CACurrentMediaTime()
        if activePlaying {
            commitDeltaLocked(nowMono: now, persist: !playing)
        }
        if !songId.isEmpty || !title.isEmpty {
            activeSongId = songId
            activeTitle = title
            activeArtist = artist
            activeCover = cover
        }
        activePlaying = playing
        if playing {
            sessionStartMono = now
            lastFlushMono = now
            recordPlayLocked()
        } else {
            sessionStartMono = 0
        }
    }

    func onTrackChanged(songId: String, title: String, artist: String, cover: String, playing: Bool) {
        lock.lock()
        defer { lock.unlock() }

        let now = CACurrentMediaTime()
        if activePlaying {
            commitDeltaLocked(nowMono: now, persist: true)
        }
        activeSongId = songId
        activeTitle = title
        activeArtist = artist
        activeCover = cover
        lastCountedKey = ""
        activePlaying = playing
        if playing {
            sessionStartMono = now
            lastFlushMono = now
            recordPlayLocked()
        } else {
            sessionStartMono = 0
        }
    }

    func flushPeriodic() {
        lock.lock()
        defer { lock.unlock() }

        guard activePlaying else { return }
        let now = CACurrentMediaTime()
        if now - lastFlushMono < 10.0 { return }
        commitDeltaLocked(nowMono: now, persist: true)
    }

    func getStatsJson() -> String {
        lock.lock()
        defer { lock.unlock() }

        if activePlaying {
            commitDeltaLocked(nowMono: CACurrentMediaTime(), persist: false)
        }
        return serializeLocked()
    }

    func resetStats() -> Bool {
        lock.lock()
        defer { lock.unlock() }

        payload = StatsPayload(
            totalSeconds: 0,
            dailySeconds: [:],
            hourlySeconds: Array(repeating: 0, count: 24),
            songs: [:],
            artists: [:]
        )
        lastCountedKey = ""
        if activePlaying {
            let now = CACurrentMediaTime()
            sessionStartMono = now
            lastFlushMono = now
        }
        persistLocked()
        return true
    }

    /// 幂等合并来自云端/备份的听歌时长统计快照（各维度取最大值，反复双向同步不会重复累加）
    func mergeStatsJson(_ incomingJson: String) -> String {
        lock.lock()
        defer { lock.unlock() }

        if activePlaying {
            commitDeltaLocked(nowMono: CACurrentMediaTime(), persist: false)
        }
        if let data = incomingJson.data(using: .utf8),
           let root = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
            let remoteTotal = max(0, (root["totalSeconds"] as? NSNumber)?.int64Value ?? 0)

            if let remoteDaily = root["dailySeconds"] as? [String: Any] {
                for (day, rawVal) in remoteDaily {
                    let sec = max(0, (rawVal as? NSNumber)?.int64Value ?? 0)
                    if sec > 0 {
                        payload.dailySeconds[day] = max(payload.dailySeconds[day] ?? 0, sec)
                    }
                }
            }

            if let remoteHourly = root["hourlySeconds"] as? [Any] {
                if payload.hourlySeconds.count < 24 {
                    payload.hourlySeconds.append(contentsOf: Array(repeating: 0, count: 24 - payload.hourlySeconds.count))
                }
                for i in 0..<min(24, remoteHourly.count) {
                    let sec = max(0, (remoteHourly[i] as? NSNumber)?.int64Value ?? 0)
                    payload.hourlySeconds[i] = max(payload.hourlySeconds[i], sec)
                }
            }

            if let remoteSongs = root["songs"] as? [String: Any] {
                for (key, rawSong) in remoteSongs {
                    guard let obj = rawSong as? [String: Any] else { continue }
                    let id = (obj["id"] as? String) ?? key
                    let name = (obj["name"] as? String) ?? ""
                    let artist = (obj["artist"] as? String) ?? ""
                    let cover = (obj["cover"] as? String) ?? ""
                    let sec = max(0, (obj["seconds"] as? NSNumber)?.int64Value ?? 0)
                    let plays = max(0, (obj["plays"] as? NSNumber)?.intValue ?? 0)
                    if name.isEmpty && id.isEmpty { continue }

                    if var existing = payload.songs[key] {
                        existing.seconds = max(existing.seconds, sec)
                        existing.plays = max(existing.plays, plays)
                        if existing.name.isEmpty && !name.isEmpty { existing.name = name }
                        if existing.artist.isEmpty && !artist.isEmpty { existing.artist = artist }
                        if existing.cover.isEmpty && !cover.isEmpty { existing.cover = cover }
                        payload.songs[key] = existing
                    } else if sec > 0 || plays > 0 {
                        payload.songs[key] = SongStat(
                            id: id,
                            name: name.isEmpty ? "未知歌曲" : name,
                            artist: artist,
                            cover: cover,
                            seconds: sec,
                            plays: plays
                        )
                    }
                }
            }

            if let remoteArtists = root["artists"] as? [String: Any] {
                for (artist, rawVal) in remoteArtists {
                    let sec = max(0, (rawVal as? NSNumber)?.int64Value ?? 0)
                    if !artist.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && sec > 0 {
                        payload.artists[artist] = max(payload.artists[artist] ?? 0, sec)
                    }
                }
            }

            let dailySum = payload.dailySeconds.values.reduce(0, +)
            payload.totalSeconds = max(payload.totalSeconds, remoteTotal, dailySum)
            pruneLocked()
            persistLocked()
        }
        return serializeLocked()
    }

    private func songKey() -> String {
        return activeSongId.isEmpty ? "title:\(activeTitle.trimmingCharacters(in: .whitespacesAndNewlines))" : activeSongId
    }

    private func recordPlayLocked() {
        guard !activeTitle.isEmpty || !activeSongId.isEmpty else { return }
        let key = songKey()
        if key == lastCountedKey { return }
        lastCountedKey = key

        if var existing = payload.songs[key] {
            existing.plays += 1
            if !activeTitle.isEmpty { existing.name = activeTitle }
            if !activeArtist.isEmpty { existing.artist = activeArtist }
            if !activeCover.isEmpty { existing.cover = activeCover }
            payload.songs[key] = existing
        } else {
            payload.songs[key] = SongStat(
                id: activeSongId.isEmpty ? key : activeSongId,
                name: activeTitle.isEmpty ? "未知歌曲" : activeTitle,
                artist: activeArtist,
                cover: activeCover,
                seconds: 0,
                plays: 1
            )
        }
        persistLocked()
    }

    private func commitDeltaLocked(nowMono: Double, persist: Bool) {
        if sessionStartMono <= 0 {
            sessionStartMono = nowMono
            return
        }
        let delta = min(max(Int64(nowMono - sessionStartMono), 0), 4 * 3600)
        if delta <= 0 {
            if persist { persistLocked() }
            return
        }
        sessionStartMono += Double(delta)
        lastFlushMono = nowMono

        payload.totalSeconds += delta
        let nowDate = Date()
        let dayKey = dateFormatter.string(from: nowDate)
        payload.dailySeconds[dayKey] = (payload.dailySeconds[dayKey] ?? 0) + delta

        let hour = min(max(Calendar.current.component(.hour, from: nowDate), 0), 23)
        payload.hourlySeconds[hour] += delta

        if !activeTitle.isEmpty || !activeSongId.isEmpty {
            let key = songKey()
            if var existing = payload.songs[key] {
                existing.seconds += delta
                if !activeTitle.isEmpty { existing.name = activeTitle }
                if !activeArtist.isEmpty { existing.artist = activeArtist }
                if !activeCover.isEmpty { existing.cover = activeCover }
                payload.songs[key] = existing
            } else {
                payload.songs[key] = SongStat(
                    id: activeSongId.isEmpty ? key : activeSongId,
                    name: activeTitle.isEmpty ? "未知歌曲" : activeTitle,
                    artist: activeArtist,
                    cover: activeCover,
                    seconds: delta,
                    plays: 1
                )
            }
        }

        if !activeArtist.isEmpty {
            let separators = CharacterSet(charactersIn: "/、,，")
            let parts = activeArtist.components(separatedBy: separators)
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty && $0 != "小庞奶娃音乐" && $0 != "未知歌手" }
            for ar in parts {
                payload.artists[ar] = (payload.artists[ar] ?? 0) + delta
            }
        }

        pruneLocked()
        if persist { persistLocked() }
    }

    private func pruneLocked() {
        if payload.dailySeconds.count > 120 {
            let sortedDays = payload.dailySeconds.keys.sorted()
            for day in sortedDays.prefix(payload.dailySeconds.count - 120) {
                payload.dailySeconds.removeValue(forKey: day)
            }
        }
        if payload.songs.count > 60 {
            let keep = payload.songs.sorted { $0.value.seconds > $1.value.seconds }.prefix(60)
            payload.songs = Dictionary(uniqueKeysWithValues: keep.map { ($0.key, $0.value) })
        }
        if payload.artists.count > 40 {
            let keep = payload.artists.sorted { $0.value > $1.value }.prefix(40)
            payload.artists = Dictionary(uniqueKeysWithValues: keep.map { ($0.key, $0.value) })
        }
    }

    private func serializeLocked() -> String {
        if let data = try? JSONEncoder().encode(payload),
           let str = String(data: data, encoding: .utf8) {
            return str
        }
        return "{\"totalSeconds\":0,\"dailySeconds\":{},\"hourlySeconds\":[],\"songs\":{},\"artists\":{}}"
    }

    private func persistLocked() {
        UserDefaults.standard.set(serializeLocked(), forKey: defaultsKey)
    }
}
