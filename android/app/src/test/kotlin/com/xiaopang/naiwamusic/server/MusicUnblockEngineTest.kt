package com.xiaopang.naiwamusic.server

import com.sun.net.httpserver.HttpServer
import okhttp3.OkHttpClient
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.net.InetSocketAddress
import java.util.Collections

class MusicUnblockEngineTest {
    private lateinit var server: HttpServer
    private lateinit var baseUrl: String
    private val probeRequests = Collections.synchronizedList(mutableListOf<Pair<String, String?>>())

    private val localClient = OkHttpClient.Builder()
        .followRedirects(false)
        .followSslRedirects(false)
        .build()

    private val engine = MusicUnblockEngine { req ->
        localClient.newCall(req).execute()
    }

    @Before
    fun setUp() {
        probeRequests.clear()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)

        server.createContext("/kuwo-80kb.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            ex.responseHeaders.add("Content-Type", "audio/mpeg")
            ex.responseHeaders.add("Content-Length", "81920")
            ex.sendResponseHeaders(200, -1)
            ex.close()
        }

        server.createContext("/normal-3mb.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            ex.responseHeaders.add("Content-Type", "audio/mpeg")
            ex.responseHeaders.add("Content-Length", "3145728")
            ex.sendResponseHeaders(200, -1)
            ex.close()
        }

        server.createContext("/short-120kb.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            ex.responseHeaders.add("Content-Type", "audio/mpeg")
            ex.responseHeaders.add("Content-Length", "122880")
            ex.sendResponseHeaders(200, -1)
            ex.close()
        }

        server.createContext("/short-50kb.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            ex.responseHeaders.add("Content-Type", "audio/mpeg")
            ex.responseHeaders.add("Content-Length", "51200")
            ex.sendResponseHeaders(200, -1)
            ex.close()
        }

        server.createContext("/head-no-cl-valid.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            ex.responseHeaders.add("Content-Type", "audio/mpeg")
            if (ex.requestMethod.equals("HEAD", ignoreCase = true)) {
                ex.sendResponseHeaders(200, -1)
            } else {
                val payload = byteArrayOf(0x49, 0x44)
                ex.responseHeaders.add("Content-Range", "bytes 0-1/2097152")
                ex.sendResponseHeaders(206, payload.size.toLong())
                ex.responseBody.write(payload)
            }
            ex.close()
        }

        server.createContext("/head-no-cl-80kb.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            ex.responseHeaders.add("Content-Type", "audio/mpeg")
            if (ex.requestMethod.equals("HEAD", ignoreCase = true)) {
                ex.sendResponseHeaders(200, -1)
            } else {
                val payload = byteArrayOf(0x49, 0x44)
                ex.responseHeaders.add("Content-Range", "bytes 0-1/81920")
                ex.sendResponseHeaders(206, payload.size.toLong())
                ex.responseBody.write(payload)
            }
            ex.close()
        }

        for (code in listOf(403, 405, 501)) {
            server.createContext("/fallback-$code-valid.mp3") { ex ->
                probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
                if (ex.requestMethod.equals("HEAD", ignoreCase = true)) {
                    ex.sendResponseHeaders(code, -1)
                } else {
                    val payload = byteArrayOf(0x49, 0x44)
                    ex.responseHeaders.add("Content-Type", "audio/mpeg")
                    ex.responseHeaders.add("Content-Range", "bytes 0-1/3145728")
                    ex.sendResponseHeaders(206, payload.size.toLong())
                    ex.responseBody.write(payload)
                }
                ex.close()
            }

            server.createContext("/fallback-$code-80kb.mp3") { ex ->
                probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
                if (ex.requestMethod.equals("HEAD", ignoreCase = true)) {
                    ex.sendResponseHeaders(code, -1)
                } else {
                    val payload = byteArrayOf(0x49, 0x44)
                    ex.responseHeaders.add("Content-Type", "audio/mpeg")
                    ex.responseHeaders.add("Content-Range", "bytes 0-1/81920")
                    ex.sendResponseHeaders(206, payload.size.toLong())
                    ex.responseBody.write(payload)
                }
                ex.close()
            }
        }

        server.createContext("/html-error.mp3") { ex ->
            ex.responseHeaders.add("Content-Type", "text/html; charset=utf-8")
            ex.responseHeaders.add("Content-Length", "3145728")
            ex.sendResponseHeaders(200, -1)
            ex.close()
        }

        server.start()
        baseUrl = "http://127.0.0.1:${server.address.port}"
    }

    @After
    fun tearDown() {
        server.stop(0)
    }

    @Test
    fun `rejects 80KB kuwo prompt mp3 and accepts 3MB normal track`() {
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/kuwo-80kb.mp3"))
        assertTrue(engine.checkAudioUrlReachable("$baseUrl/normal-3mb.mp3"))
    }

    @Test
    fun `relaxes size threshold only for tracks shorter than 30 seconds`() {
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/short-120kb.mp3", expectedDurationMs = 0L))
        assertTrue(engine.checkAudioUrlReachable("$baseUrl/short-120kb.mp3", expectedDurationMs = 15_000L))
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/short-50kb.mp3", expectedDurationMs = 15_000L))
    }

    @Test
    fun `falls back from HEAD 403 405 501 to Range GET and enforces total size via Content-Range`() {
        for (code in listOf(403, 405, 501)) {
            probeRequests.clear()
            assertTrue(
                "Expected HEAD $code -> Range GET 206 (3MB) to pass",
                engine.checkAudioUrlReachable("$baseUrl/fallback-$code-valid.mp3")
            )
            assertEquals(listOf("HEAD" to null, "GET" to "bytes=0-1"), probeRequests.toList())

            probeRequests.clear()
            assertFalse(
                "Expected HEAD $code -> Range GET 206 (80KB) to be rejected",
                engine.checkAudioUrlReachable("$baseUrl/fallback-$code-80kb.mp3")
            )
            assertEquals(listOf("HEAD" to null, "GET" to "bytes=0-1"), probeRequests.toList())
        }
    }

    @Test
    fun `falls back to Range GET when HEAD 200 omits Content-Length`() {
        assertTrue(engine.checkAudioUrlReachable("$baseUrl/head-no-cl-valid.mp3"))
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/head-no-cl-80kb.mp3"))
    }

    @Test
    fun `rejects html pages and suspicious kuwo prompt urls`() {
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/html-error.mp3"))
        assertTrue(engine.isSuspiciousKuwoPlaceholderUrl("https://other.sycdn.kuwo.cn/resource/audition/123456.mp3"))
        assertTrue(engine.isSuspiciousKuwoPlaceholderUrl("https://other.sycdn.kuwo.cn/resource/notice_tip.mp3"))
        assertFalse(engine.checkAudioUrlReachable("https://other.sycdn.kuwo.cn/resource/audition/123456.mp3"))
        assertFalse(engine.isSuspiciousKuwoPlaceholderUrl("https://sycdn.kuwo.cn/resource/n1/12/34/567890.mp3"))
    }

    @Test
    fun `demotes kuwo to lowest priority in default unblock sources`() {
        assertEquals(
            listOf("pyncmd", "gdmusic", "migu", "kugou", "kuwo"),
            MusicUnblockEngine.DEFAULT_ENABLED_SOURCES
        )
    }
}
