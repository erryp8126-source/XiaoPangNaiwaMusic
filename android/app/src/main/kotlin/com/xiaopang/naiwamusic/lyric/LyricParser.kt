package com.xiaopang.naiwamusic.lyric

import com.google.gson.JsonParser
import kotlin.math.abs

internal data class WordSegment(
    val startMs: Long,
    val durationMs: Long,
    val endCharIndex: Int
)

internal data class LyricLine(
    val startMs: Long,
    val durationMs: Long,
    val text: String,
    val translation: String = "",
    val words: List<WordSegment> = emptyList()
)

/**
 * 原生 YRC / LRC 歌词解析、翻译对齐、时长补全与逐字扫色进度计算
 */
internal object LyricParser {
    private val yrcLineRegex = Regex("""^\[(\d+),(\d+)](.*)$""")
    private val yrcWordRegex = Regex("""\((\d+),(\d+),\d+\)([^(]*)""")
    private val lrcTagRegex = Regex("""\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?]""")

    fun parseJsLyricLines(linesJson: String): List<LyricLine> {
        return runCatching {
            val arr = JsonParser.parseString(linesJson).asJsonArray
            val list = mutableListOf<LyricLine>()
            for (i in 0 until arr.size()) {
                val obj = arr[i].asJsonObject
                val text = obj.get("text")?.asString?.trim() ?: ""
                if (text.isBlank()) continue
                val startMs = obj.get("t")?.asLong ?: continue
                val durMs = obj.get("d")?.asLong ?: 0L
                val tr = obj.get("tr")?.asString?.trim() ?: ""
                list.add(LyricLine(startMs = startMs, durationMs = durMs, text = text, translation = tr))
            }
            fillMissingDurations(list)
        }.getOrElse { emptyList() }
    }

    fun parseYrc(raw: String): List<LyricLine> {
        val result = mutableListOf<LyricLine>()
        for (rawLine in raw.lines()) {
            val trimmed = rawLine.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("{")) continue
            val m = yrcLineRegex.matchEntire(trimmed) ?: continue
            val startMs = m.groupValues[1].toLongOrNull() ?: continue
            val durMs = m.groupValues[2].toLongOrNull() ?: 3000L
            val body = m.groupValues[3]

            val sb = StringBuilder()
            val words = mutableListOf<WordSegment>()
            for (wm in yrcWordRegex.findAll(body)) {
                val ws = wm.groupValues[1].toLongOrNull() ?: startMs
                val wd = wm.groupValues[2].toLongOrNull() ?: 200L
                val token = wm.groupValues[3]
                if (token.isNotEmpty()) {
                    sb.append(token)
                    words.add(WordSegment(ws, wd, sb.length))
                }
            }
            val fullText = sb.toString().trim()
            if (fullText.isNotEmpty()) {
                result.add(LyricLine(startMs, durMs.coerceAtLeast(400L), fullText, "", words))
            }
        }
        result.sortBy { it.startMs }
        return result
    }

    fun parseLrc(raw: String): List<LyricLine> {
        val temp = mutableListOf<Pair<Long, String>>()
        for (rawLine in raw.lines()) {
            val trimmed = rawLine.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("{")) continue
            val matches = lrcTagRegex.findAll(trimmed).toList()
            if (matches.isEmpty()) continue
            val text = lrcTagRegex.replace(trimmed, "").trim()
            if (text.isEmpty()) continue

            for (m in matches) {
                val min = m.groupValues[1].toLongOrNull() ?: continue
                val sec = m.groupValues[2].toLongOrNull() ?: continue
                val fracStr = m.groupValues[3]
                val ms = when (fracStr.length) {
                    0 -> 0L
                    1 -> (fracStr.toLongOrNull() ?: 0L) * 100L
                    2 -> (fracStr.toLongOrNull() ?: 0L) * 10L
                    else -> fracStr.take(3).toLongOrNull() ?: 0L
                }
                temp.add((min * 60_000L + sec * 1_000L + ms) to text)
            }
        }
        temp.sortBy { it.first }
        val lines = temp.map { LyricLine(it.first, 0L, it.second) }
        return fillMissingDurations(lines)
    }

    fun mergeTranslations(baseLines: List<LyricLine>, transLines: List<LyricLine>): List<LyricLine> {
        if (transLines.isEmpty()) return baseLines
        return baseLines.map { line ->
            val best = transLines.minByOrNull { abs(it.startMs - line.startMs) }
            if (best != null && abs(best.startMs - line.startMs) <= 1200L) {
                line.copy(translation = best.text)
            } else {
                line
            }
        }
    }

    fun fillMissingDurations(lines: List<LyricLine>): List<LyricLine> {
        if (lines.isEmpty()) return emptyList()
        return lines.mapIndexed { idx, item ->
            val nextStart = lines.getOrNull(idx + 1)?.startMs
            val spanMs = if (nextStart != null && nextStart > item.startMs) {
                (nextStart - item.startMs).coerceIn(500L, 12_000L)
            } else {
                4500L
            }
            val dur = if (item.durationMs in 300L..20_000L) {
                item.durationMs
            } else {
                spanMs
            }
            item.copy(durationMs = dur)
        }
    }

    fun findLineIndex(lines: List<LyricLine>, posMs: Long): Int {
        var idx = -1
        var lo = 0
        var hi = lines.size - 1
        while (lo <= hi) {
            val mid = (lo + hi) ushr 1
            if (lines[mid].startMs <= posMs) {
                idx = mid
                lo = mid + 1
            } else {
                hi = mid - 1
            }
        }
        return idx
    }

    fun computeLineProgress(line: LyricLine, posMs: Long): Float {
        if (line.text.isEmpty()) return 0f
        if (line.words.isNotEmpty()) {
            val totalChars = line.text.length.toFloat()
            var prevChars = 0
            for (w in line.words) {
                if (posMs < w.startMs) {
                    return (prevChars / totalChars).coerceIn(0f, 1f)
                }
                val endMs = w.startMs + w.durationMs.coerceAtLeast(1L)
                if (posMs <= endMs) {
                    val frac = ((posMs - w.startMs).toFloat() / w.durationMs.coerceAtLeast(1L).toFloat()).coerceIn(0f, 1f)
                    val curChars = prevChars + (w.endCharIndex - prevChars) * frac
                    return (curChars / totalChars).coerceIn(0f, 1f)
                }
                prevChars = w.endCharIndex
            }
            return 1f
        }

        val dur = line.durationMs.coerceAtLeast(400L)
        return ((posMs - line.startMs).toFloat() / dur.toFloat()).coerceIn(0f, 1f)
    }
}
