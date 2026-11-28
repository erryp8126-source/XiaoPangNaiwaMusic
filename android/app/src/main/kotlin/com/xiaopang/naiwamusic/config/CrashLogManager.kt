package com.xiaopang.naiwamusic.config

import android.content.Context
import android.os.Build
import android.util.Log
import com.xiaopang.naiwamusic.BuildConfig
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * 轻量级本地崩溃日志采集与脱敏器：
 * - 捕获未处理异常并将精简上下文 + 堆栈写入私有目录 filesDir/last_crash.log（覆盖保留最近 1 次，上限 16 KB）
 * - 写入与读取阶段均对 Cookie / Token / 同步口令 / 凭据键值对自动脱敏
 * - 落盘完成后始终委托给系统原有 UncaughtExceptionHandler，绝不吞异常
 */
object CrashLogManager {
    private const val TAG = "CrashLogManager"
    const val CRASH_LOG_FILE_NAME = "last_crash.log"
    const val MAX_CRASH_LOG_BYTES = 16 * 1024
    internal const val TRUNCATION_SUFFIX = "\n...[truncated to 16KB]"

    private val COOKIE_HEADER_REGEX = Regex(
        """(?i)\b(Cookie|Set-Cookie)["']?\s*[:=]\s*["']?[^\r\n"']+"""
    )
    private val COOKIE_KV_REGEX = Regex(
        """(?i)\b(MUSIC_U|MUSIC_A|MUSIC_R_T|MUSIC_A_T|__csrf|NMTID|SESSDATA|bili_jct|DedeUserID__ckMd5|DedeUserID|qm_keyst|qqmusic_key|p_skey|skey|pt4_token|qrsig|ptsigx|p_uin|uin)["']?\s*[:=]\s*["']?[^\s;,&"'\r\n]+"""
    )
    private val AUTH_HEADER_REGEX = Regex(
        """(?i)\b(Authorization|X-Alger-Token|X-App-Api-Key|X-App-Signature)["']?\s*[:=]\s*(?:Bearer\s+|Basic\s+)?["']?[^\s,&;"'\r\n]+"""
    )
    private val SECRET_KV_REGEX = Regex(
        """(?i)\b(access_token|refresh_token|localToken|api_?key|app_?secret|sync_?code|sync_?key|token|secret|password|passwd)["']?\s*[:=]\s*["']?[^\s&;,"'\r\n]+"""
    )
    private val SYNC_CODE_REGEX = Regex(
        """(?i)\bNAIWA-[A-Z0-9]{4}-[A-Z0-9]{4,8}\b"""
    )
    private val GITHUB_TOKEN_REGEX = Regex(
        """\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{16,}\b|\bgithub_pat_[A-Za-z0-9_]{16,}\b"""
    )
    private val URL_USERINFO_REGEX = Regex(
        """(https?://)([^/\s@:]+):([^/\s@]+)@"""
    )

    internal class CrashLogUncaughtExceptionHandler(
        private val previousHandler: Thread.UncaughtExceptionHandler?,
        private val writer: (Thread, Throwable) -> Unit
    ) : Thread.UncaughtExceptionHandler {
        override fun uncaughtException(t: Thread, e: Throwable) {
            try {
                writer(t, e)
            } catch (_: Throwable) {
                // 写日志过程绝不能掩盖原始崩溃
            } finally {
                previousHandler?.uncaughtException(t, e)
            }
        }
    }

    internal fun sanitizeCrashText(raw: String): String {
        if (raw.isEmpty()) return ""
        var out = raw
        out = COOKIE_HEADER_REGEX.replace(out, "$1=[REDACTED]")
        out = COOKIE_KV_REGEX.replace(out, "$1=[REDACTED]")
        out = AUTH_HEADER_REGEX.replace(out, "$1=[REDACTED]")
        out = SECRET_KV_REGEX.replace(out, "$1=[REDACTED]")
        out = SYNC_CODE_REGEX.replace(out, "[REDACTED_SYNC_CODE]")
        out = GITHUB_TOKEN_REGEX.replace(out, "[REDACTED_TOKEN]")
        out = URL_USERINFO_REGEX.replace(out, "$1[REDACTED]:[REDACTED]@")
        return out
    }

    internal fun truncateUtf8Bytes(text: String, maxBytes: Int = MAX_CRASH_LOG_BYTES): String {
        if (maxBytes <= 0 || text.isEmpty()) return ""
        val rawBytes = text.toByteArray(Charsets.UTF_8)
        if (rawBytes.size <= maxBytes) return text

        val suffixBytes = TRUNCATION_SUFFIX.toByteArray(Charsets.UTF_8)
        if (maxBytes <= suffixBytes.size) {
            return takeUtf8Prefix(text, maxBytes)
        }
        val budget = maxBytes - suffixBytes.size
        return takeUtf8Prefix(text, budget) + TRUNCATION_SUFFIX
    }

    private fun takeUtf8Prefix(text: String, maxBytes: Int): String {
        if (maxBytes <= 0 || text.isEmpty()) return ""
        val sb = StringBuilder()
        var usedBytes = 0
        var idx = 0
        while (idx < text.length) {
            val codePoint = text.codePointAt(idx)
            val charCount = Character.charCount(codePoint)
            val cpBytes = when {
                codePoint <= 0x7F -> 1
                codePoint <= 0x7FF -> 2
                codePoint <= 0xFFFF -> 3
                else -> 4
            }
            if (usedBytes + cpBytes > maxBytes) break
            sb.append(text, idx, idx + charCount)
            usedBytes += cpBytes
            idx += charCount
        }
        return sb.toString()
    }

    private fun formatUtcTimestamp(nowMs: Long = System.currentTimeMillis()): String {
        return SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("UTC")
        }.format(Date(nowMs))
    }

    internal fun formatCrashReport(
        appVersionName: String,
        appVersionCode: Int,
        androidRelease: String,
        sdkInt: Int,
        deviceLabel: String,
        threadName: String,
        throwable: Throwable,
        timestampText: String = formatUtcTimestamp()
    ): String {
        val rawReport = buildString {
            append("Time: ").append(timestampText).append('\n')
            append("AppVersion: ").append(appVersionName).append(" (").append(appVersionCode).append(")\n")
            append("Android: ").append(androidRelease).append(" (API ").append(sdkInt).append(")\n")
            if (deviceLabel.isNotBlank()) {
                append("Device: ").append(deviceLabel).append('\n')
            }
            append("Thread: ").append(threadName).append("\n\n")
            append(throwable.stackTraceToString())
        }
        return truncateUtf8Bytes(sanitizeCrashText(rawReport), MAX_CRASH_LOG_BYTES)
    }

    internal fun writeCrashReport(
        file: File,
        report: String,
        maxBytes: Int = MAX_CRASH_LOG_BYTES
    ): Boolean {
        return runCatching {
            file.parentFile?.let { parent ->
                if (!parent.exists()) parent.mkdirs()
            }
            val safePayload = truncateUtf8Bytes(sanitizeCrashText(report), maxBytes)
            file.writeBytes(safePayload.toByteArray(Charsets.UTF_8))
            true
        }.getOrDefault(false)
    }

    fun install(context: Context) {
        val current = Thread.getDefaultUncaughtExceptionHandler()
        if (current is CrashLogUncaughtExceptionHandler) return

        val appCtx = context.applicationContext
        val filesDir = appCtx.filesDir
        val versionName = BuildConfig.VERSION_NAME
        val versionCode = BuildConfig.VERSION_CODE
        val androidRelease = Build.VERSION.RELEASE ?: "unknown"
        val sdkInt = Build.VERSION.SDK_INT
        val deviceLabel = listOfNotNull(
            Build.MANUFACTURER?.takeIf { it.isNotBlank() },
            Build.MODEL?.takeIf { it.isNotBlank() }
        ).joinToString(" ")

        val handler = CrashLogUncaughtExceptionHandler(current) { thread, throwable ->
            val report = formatCrashReport(
                appVersionName = versionName,
                appVersionCode = versionCode,
                androidRelease = androidRelease,
                sdkInt = sdkInt,
                deviceLabel = deviceLabel,
                threadName = thread.name,
                throwable = throwable
            )
            writeCrashReport(File(filesDir, CRASH_LOG_FILE_NAME), report, MAX_CRASH_LOG_BYTES)
        }
        Thread.setDefaultUncaughtExceptionHandler(handler)
        runCatching { Log.i(TAG, "Global uncaught crash logger installed") }
    }

    fun getLastCrashLog(context: Context): String {
        return runCatching {
            val file = File(context.applicationContext.filesDir, CRASH_LOG_FILE_NAME)
            if (!file.exists() || !file.isFile) return@runCatching ""
            val bytes = file.readBytes()
            val text = String(bytes, Charsets.UTF_8)
            truncateUtf8Bytes(sanitizeCrashText(text), MAX_CRASH_LOG_BYTES)
        }.getOrDefault("")
    }

    fun clearLastCrashLog(context: Context): Boolean {
        return runCatching {
            val file = File(context.applicationContext.filesDir, CRASH_LOG_FILE_NAME)
            !file.exists() || file.delete()
        }.getOrDefault(false)
    }
}
