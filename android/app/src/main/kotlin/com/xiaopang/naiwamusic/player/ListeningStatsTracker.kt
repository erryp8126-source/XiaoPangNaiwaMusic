package com.xiaopang.naiwamusic.player

import android.content.Context
import android.os.SystemClock
import com.google.gson.Gson
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.text.SimpleDateFormat
import java.util.Calendar
import java.util.Date
import java.util.Locale

/**
 * 原生精准听歌时长统计引擎（息屏 / 后台自动切歌全程精确计秒）
 * 使用 SystemClock.elapsedRealtime() 累计真实播放耗时，不计入暂停时间，自动持久化到 SharedPreferences
 */
object ListeningStatsTracker {
    private const val PREFS_NAME = "alger_listening_stats"
    private const val KEY_JSON = "stats_v1"
    private const val FLUSH_INTERVAL_MS = 10_000L
    private const val MAX_DAILY_ENTRIES = 120
    private const val MAX_SONGS = 60
    private const val MAX_ARTISTS = 40

    private val gson = Gson()
    private val lock = Any()
    private val dateFmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)

    private data class SongStat(
        val id: String,
        var name: String,
        var artist: String,
        var cover: String,
        var seconds: Long,
        var plays: Int
    )

    private var loaded = false
    private var totalSeconds: Long = 0L
    private val dailySeconds = LinkedHashMap<String, Long>()
    private val hourlySeconds = LongArray(24)
    private val songs = LinkedHashMap<String, SongStat>()
    private val artists = LinkedHashMap<String, Long>()

    // 当前活跃播放段状态
    private var activePlaying = false
    private var sessionStartElapsedMs: Long = 0L
    private var lastFlushElapsedMs: Long = 0L
    private var activeSongId: String = ""
    private var activeTitle: String = ""
    private var activeArtist: String = ""
    private var activeCover: String = ""
    private var lastCountedPlaySongKey: String = ""

    private fun ensureLoadedLocked(context: Context) {
        if (loaded) return
        loaded = true
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val raw = prefs.getString(KEY_JSON, null) ?: return
        runCatching {
            val root = JsonParser.parseString(raw).asJsonObject
            totalSeconds = root.get("totalSeconds")?.asLong?.coerceAtLeast(0L) ?: 0L

            root.getAsJsonObject("dailySeconds")?.entrySet()?.forEach { (day, v) ->
                val sec = v.asLong.coerceAtLeast(0L)
                if (sec > 0L) dailySeconds[day] = sec
            }

            root.getAsJsonArray("hourlySeconds")?.let { arr ->
                for (i in 0 until minOf(24, arr.size())) {
                    hourlySeconds[i] = arr[i].asLong.coerceAtLeast(0L)
                }
            }

            root.getAsJsonObject("songs")?.entrySet()?.forEach { (k, v) ->
                val o = v.asJsonObject
                val id = o.get("id")?.asString ?: k
                val name = o.get("name")?.asString ?: ""
                val artist = o.get("artist")?.asString ?: ""
                val cover = o.get("cover")?.asString ?: ""
                val sec = o.get("seconds")?.asLong?.coerceAtLeast(0L) ?: 0L
                val plays = o.get("plays")?.asInt?.coerceAtLeast(0) ?: 0
                if (name.isNotBlank() && (sec > 0L || plays > 0)) {
                    songs[k] = SongStat(id, name, artist, cover, sec, plays)
                }
            }

            root.getAsJsonObject("artists")?.entrySet()?.forEach { (name, v) ->
                val sec = v.asLong.coerceAtLeast(0L)
                if (name.isNotBlank() && sec > 0L) artists[name] = sec
            }
        }
    }

    fun onPlayStateChanged(
        context: Context,
        playing: Boolean,
        songId: String,
        title: String,
        artist: String,
        cover: String
    ) {
        synchronized(lock) {
            ensureLoadedLocked(context)
            val now = SystemClock.elapsedRealtime()
            if (activePlaying) {
                commitDeltaLocked(now, context, forcePersist = !playing)
            }

            if (songId.isNotBlank() || title.isNotBlank()) {
                activeSongId = songId
                activeTitle = title
                activeArtist = artist
                activeCover = cover
            }

            activePlaying = playing
            if (playing) {
                sessionStartElapsedMs = now
                lastFlushElapsedMs = now
                recordSongPlayIfNewLocked(context)
            } else {
                sessionStartElapsedMs = 0L
            }
        }
    }

    fun onTrackChanged(
        context: Context,
        songId: String,
        title: String,
        artist: String,
        cover: String,
        playing: Boolean
    ) {
        synchronized(lock) {
            ensureLoadedLocked(context)
            val now = SystemClock.elapsedRealtime()
            if (activePlaying) {
                commitDeltaLocked(now, context, forcePersist = true)
            }

            activeSongId = songId
            activeTitle = title
            activeArtist = artist
            activeCover = cover
            lastCountedPlaySongKey = ""
            activePlaying = playing

            if (playing) {
                sessionStartElapsedMs = now
                lastFlushElapsedMs = now
                recordSongPlayIfNewLocked(context)
            } else {
                sessionStartElapsedMs = 0L
            }
        }
    }

    fun flushPeriodic(context: Context) {
        synchronized(lock) {
            if (!activePlaying) return
            val now = SystemClock.elapsedRealtime()
            if (now - lastFlushElapsedMs < FLUSH_INTERVAL_MS) return
            ensureLoadedLocked(context)
            commitDeltaLocked(now, context, forcePersist = true)
        }
    }

    fun getStatsJson(context: Context): String {
        synchronized(lock) {
            ensureLoadedLocked(context)
            if (activePlaying) {
                val now = SystemClock.elapsedRealtime()
                commitDeltaLocked(now, context, forcePersist = false)
            }
            return serializeLocked()
        }
    }

    fun resetStats(context: Context): Boolean {
        synchronized(lock) {
            loaded = true
            totalSeconds = 0L
            dailySeconds.clear()
            for (i in 0 until 24) hourlySeconds[i] = 0L
            songs.clear()
            artists.clear()
            lastCountedPlaySongKey = ""
            if (activePlaying) {
                val now = SystemClock.elapsedRealtime()
                sessionStartElapsedMs = now
                lastFlushElapsedMs = now
            }
            persistLocked(context)
            return true
        }
    }

    /**
     * 幂等合并来自云端/备份的听歌时长统计快照（各维度取最大值，多设备反复双向同步不会重复累加）
     */
    fun mergeStatsJson(context: Context, incomingJson: String): String {
        synchronized(lock) {
            ensureLoadedLocked(context)
            if (activePlaying) {
                val now = SystemClock.elapsedRealtime()
                commitDeltaLocked(now, context, forcePersist = false)
            }
            if (incomingJson.isNotBlank()) {
                runCatching {
                    val root = JsonParser.parseString(incomingJson).asJsonObject
                    val remoteTotal = root.get("totalSeconds")?.asLong?.coerceAtLeast(0L) ?: 0L

                    root.getAsJsonObject("dailySeconds")?.entrySet()?.forEach { (day, v) ->
                        val sec = v.asLong.coerceAtLeast(0L)
                        if (sec > 0L) {
                            dailySeconds[day] = maxOf(dailySeconds[day] ?: 0L, sec)
                        }
                    }

                    root.getAsJsonArray("hourlySeconds")?.let { arr ->
                        for (i in 0 until minOf(24, arr.size())) {
                            val sec = arr[i].asLong.coerceAtLeast(0L)
                            hourlySeconds[i] = maxOf(hourlySeconds[i], sec)
                        }
                    }

                    root.getAsJsonObject("songs")?.entrySet()?.forEach { (k, v) ->
                        if (!v.isJsonObject) return@forEach
                        val o = v.asJsonObject
                        val id = o.get("id")?.asString ?: k
                        val name = o.get("name")?.asString ?: ""
                        val artist = o.get("artist")?.asString ?: ""
                        val cover = o.get("cover")?.asString ?: ""
                        val sec = o.get("seconds")?.asLong?.coerceAtLeast(0L) ?: 0L
                        val plays = o.get("plays")?.asInt?.coerceAtLeast(0) ?: 0
                        if (name.isBlank() && id.isBlank()) return@forEach
                        val existing = songs[k]
                        if (existing != null) {
                            existing.seconds = maxOf(existing.seconds, sec)
                            existing.plays = maxOf(existing.plays, plays)
                            if (existing.name.isBlank() && name.isNotBlank()) existing.name = name
                            if (existing.artist.isBlank() && artist.isNotBlank()) existing.artist = artist
                            if (existing.cover.isBlank() && cover.isNotBlank()) existing.cover = cover
                        } else if (sec > 0L || plays > 0) {
                            songs[k] = SongStat(
                                id = id,
                                name = name.ifBlank { "未知歌曲" },
                                artist = artist,
                                cover = cover,
                                seconds = sec,
                                plays = plays
                            )
                        }
                    }

                    root.getAsJsonObject("artists")?.entrySet()?.forEach { (name, v) ->
                        val sec = v.asLong.coerceAtLeast(0L)
                        if (name.isNotBlank() && sec > 0L) {
                            artists[name] = maxOf(artists[name] ?: 0L, sec)
                        }
                    }

                    val dailySum = dailySeconds.values.sum()
                    totalSeconds = maxOf(totalSeconds, remoteTotal, dailySum)
                    pruneLocked()
                    persistLocked(context)
                }
            }
            return serializeLocked()
        }
    }

    private fun songKey(songId: String, title: String): String {
        return songId.ifBlank { "title:${title.trim()}" }
    }

    private fun recordSongPlayIfNewLocked(context: Context) {
        if (activeTitle.isBlank() && activeSongId.isBlank()) return
        val key = songKey(activeSongId, activeTitle)
        if (key == lastCountedPlaySongKey) return
        lastCountedPlaySongKey = key

        val existing = songs[key]
        if (existing != null) {
            existing.plays += 1
            if (activeTitle.isNotBlank()) existing.name = activeTitle
            if (activeArtist.isNotBlank()) existing.artist = activeArtist
            if (activeCover.isNotBlank()) existing.cover = activeCover
        } else {
            songs[key] = SongStat(
                id = activeSongId.ifBlank { key },
                name = activeTitle.ifBlank { "未知歌曲" },
                artist = activeArtist,
                cover = activeCover,
                seconds = 0L,
                plays = 1
            )
        }
        persistLocked(context)
    }

    private fun commitDeltaLocked(nowElapsedMs: Long, context: Context, forcePersist: Boolean) {
        if (sessionStartElapsedMs <= 0L) {
            sessionStartElapsedMs = nowElapsedMs
            return
        }
        val deltaSec = ((nowElapsedMs - sessionStartElapsedMs) / 1000L).coerceIn(0L, 4 * 3600L)
        if (deltaSec <= 0L) {
            if (forcePersist) persistLocked(context)
            return
        }
        sessionStartElapsedMs += deltaSec * 1000L
        lastFlushElapsedMs = nowElapsedMs

        totalSeconds += deltaSec

        val nowDate = Date()
        val todayKey = dateFmt.format(nowDate)
        dailySeconds[todayKey] = (dailySeconds[todayKey] ?: 0L) + deltaSec

        val hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY).coerceIn(0, 23)
        hourlySeconds[hour] += deltaSec

        if (activeTitle.isNotBlank() || activeSongId.isNotBlank()) {
            val key = songKey(activeSongId, activeTitle)
            val existing = songs[key]
            if (existing != null) {
                existing.seconds += deltaSec
                if (activeTitle.isNotBlank()) existing.name = activeTitle
                if (activeArtist.isNotBlank()) existing.artist = activeArtist
                if (activeCover.isNotBlank()) existing.cover = activeCover
            } else {
                songs[key] = SongStat(
                    id = activeSongId.ifBlank { key },
                    name = activeTitle.ifBlank { "未知歌曲" },
                    artist = activeArtist,
                    cover = activeCover,
                    seconds = deltaSec,
                    plays = 1
                )
            }
        }

        if (activeArtist.isNotBlank()) {
            val parts = activeArtist.split("/", "、", ",", "，")
                .map { it.trim() }
                .filter { it.isNotBlank() && it != "小庞奶娃音乐" && it != "未知歌手" }
            for (ar in parts) {
                artists[ar] = (artists[ar] ?: 0L) + deltaSec
            }
        }

        pruneLocked()
        if (forcePersist) {
            persistLocked(context)
        }
    }

    private fun pruneLocked() {
        if (dailySeconds.size > MAX_DAILY_ENTRIES) {
            val sortedDays = dailySeconds.keys.sorted()
            val toDrop = sortedDays.take(dailySeconds.size - MAX_DAILY_ENTRIES)
            toDrop.forEach { dailySeconds.remove(it) }
        }
        if (songs.size > MAX_SONGS) {
            val keep = songs.entries.sortedByDescending { it.value.seconds }.take(MAX_SONGS)
            songs.clear()
            keep.forEach { songs[it.key] = it.value }
        }
        if (artists.size > MAX_ARTISTS) {
            val keep = artists.entries.sortedByDescending { it.value }.take(MAX_ARTISTS)
            artists.clear()
            keep.forEach { artists[it.key] = it.value }
        }
    }

    private fun serializeLocked(): String {
        val map = LinkedHashMap<String, Any>()
        map["totalSeconds"] = totalSeconds
        map["dailySeconds"] = LinkedHashMap(dailySeconds)
        map["hourlySeconds"] = hourlySeconds.toList()
        val songsOut = LinkedHashMap<String, Any>()
        songs.forEach { (k, v) ->
            songsOut[k] = mapOf(
                "id" to v.id,
                "name" to v.name,
                "artist" to v.artist,
                "cover" to v.cover,
                "seconds" to v.seconds,
                "plays" to v.plays
            )
        }
        map["songs"] = songsOut
        map["artists"] = LinkedHashMap(artists)
        return gson.toJson(map)
    }

    private fun persistLocked(context: Context) {
        val json = serializeLocked()
        val prefs = context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        prefs.edit().putString(KEY_JSON, json).apply()
    }
}
