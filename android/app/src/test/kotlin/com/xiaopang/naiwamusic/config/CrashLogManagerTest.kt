package com.xiaopang.naiwamusic.config

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.nio.file.Files

class CrashLogManagerTest {

    @Test
    fun redactsCookiesTokensSyncCodesAndPasswordsWhileKeepingStackTrace() {
        val raw = """
            java.lang.IllegalStateException: Request failed
            Cookie: MUSIC_U=super_secret_cookie_value; __csrf=csrf_secret_123
            Set-Cookie: MUSIC_A=anon_secret_abc; Path=/
            Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.secret
            X-Alger-Token: 0123456789abcdef
            SyncCode=NAIWA-7392-K8M4AB sync_failed_id NAIWA-8888-ABCDEF token=ghp_1234567890abcdefghij123456
            url=https://alice:myS3cretPass@dav.example.com/music/backup.json password=hunter2
                at com.xiaopang.naiwamusic.player.MusicPlaybackService.play(MusicPlaybackService.kt:2008)
        """.trimIndent()

        val sanitized = CrashLogManager.sanitizeCrashText(raw)
        assertFalse(sanitized.contains("super_secret_cookie_value"))
        assertFalse(sanitized.contains("csrf_secret_123"))
        assertFalse(sanitized.contains("anon_secret_abc"))
        assertFalse(sanitized.contains("eyJhbGciOiJIUzI1NiJ9"))
        assertFalse(sanitized.contains("0123456789abcdef"))
        assertFalse(sanitized.contains("NAIWA-7392-K8M4AB"))
        assertFalse(sanitized.contains("NAIWA-8888-ABCDEF"))
        assertFalse(sanitized.contains("ghp_1234567890abcdefghij123456"))
        assertFalse(sanitized.contains("myS3cretPass"))
        assertFalse(sanitized.contains("hunter2"))

        assertTrue(sanitized.contains("IllegalStateException: Request failed"))
        assertTrue(sanitized.contains("MusicPlaybackService.kt:2008"))
        assertTrue(sanitized.contains("[REDACTED]"))
        assertTrue(sanitized.contains("[REDACTED_SYNC_CODE]"))
    }

    @Test
    fun truncatesOversizedMultiByteLogsStrictlyWithin16KbAndOverwritesLatestCrash() {
        val tempDir = Files.createTempDirectory("naiwa-crash-log-test").toFile()
        try {
            val logFile = File(tempDir, CrashLogManager.CRASH_LOG_FILE_NAME)
            val hugeBody = buildString {
                repeat(2000) { idx ->
                    append("第").append(idx).append("行异常堆栈 at com.xiaopang.naiwamusic.Foo(Foo.kt:42)\n")
                }
            }
            val truncated = CrashLogManager.truncateUtf8Bytes(hugeBody)
            val utf8Bytes = truncated.toByteArray(Charsets.UTF_8)
            assertTrue(utf8Bytes.size <= CrashLogManager.MAX_CRASH_LOG_BYTES)
            assertTrue(truncated.endsWith(CrashLogManager.TRUNCATION_SUFFIX))
            // 不包含 U+FFFD 替换字符，确保未切断多字节 UTF-8 字符
            assertFalse(truncated.contains('\uFFFD'))

            assertTrue(CrashLogManager.writeCrashReport(logFile, "FIRST_OLD_CRASH_LINE"))
            assertTrue(CrashLogManager.writeCrashReport(logFile, hugeBody))
            val savedText = logFile.readText(Charsets.UTF_8)
            assertFalse(savedText.contains("FIRST_OLD_CRASH_LINE"))
            assertTrue(logFile.length() <= CrashLogManager.MAX_CRASH_LOG_BYTES.toLong())
        } finally {
            tempDir.deleteRecursively()
        }
    }

    @Test
    fun uncaughtHandlerAlwaysDelegatesToPreviousHandlerEvenWhenWriterFails() {
        var delegatedThread: Thread? = null
        var delegatedThrowable: Throwable? = null
        val previous = Thread.UncaughtExceptionHandler { t, e ->
            delegatedThread = t
            delegatedThrowable = e
        }

        val handler = CrashLogManager.CrashLogUncaughtExceptionHandler(previous) { _, _ ->
            error("disk full")
        }
        val boom = RuntimeException("fatal crash")
        handler.uncaughtException(Thread.currentThread(), boom)

        assertEquals(Thread.currentThread(), delegatedThread)
        assertEquals(boom, delegatedThrowable)
    }
}
