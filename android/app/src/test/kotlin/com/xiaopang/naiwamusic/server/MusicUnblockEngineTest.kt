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

        server.createContext("/kuwo-450kb.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            ex.responseHeaders.add("Content-Type", "audio/mpeg")
            ex.responseHeaders.add("Content-Length", "460800")
            ex.sendResponseHeaders(200, -1)
            ex.close()
        }

        server.createContext("/fallback-405-450kb.mp3") { ex ->
            probeRequests.add(ex.requestMethod to ex.requestHeaders.getFirst("Range"))
            if (ex.requestMethod.equals("HEAD", ignoreCase = true)) {
                ex.sendResponseHeaders(405, -1)
            } else {
                val payload = byteArrayOf(0x49, 0x44)
                ex.responseHeaders.add("Content-Type", "audio/mpeg")
                ex.responseHeaders.add("Content-Range", "bytes 0-1/460800")
                ex.sendResponseHeaders(206, payload.size.toLong())
                ex.responseBody.write(payload)
            }
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
    fun `rejects 80KB and 450KB kuwo prompt mp3s and accepts 3MB normal track`() {
        assertEquals(800L * 1024L, MusicUnblockEngine.MIN_VALID_AUDIO_BYTES)
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/kuwo-80kb.mp3"))
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/kuwo-450kb.mp3"))
        probeRequests.clear()
        assertFalse(engine.checkAudioUrlReachable("$baseUrl/fallback-405-450kb.mp3"))
        assertEquals(listOf("HEAD" to null, "GET" to "bytes=0-1"), probeRequests.toList())
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

    @Test
    fun `ranks studio original above live and filters out wrong song wrong artist and duration mismatch`() {
        val wrongSong = MusicUnblockEngine.TrackCandidate("世界这么大还是遇见你", "程响", 256_000L)
        val wrongArtist = MusicUnblockEngine.TrackCandidate("推开世界的门", "某翻唱歌手", 256_000L)
        val shortLiveClip = MusicUnblockEngine.TrackCandidate("推开世界的门 (Live)", "杨乃文", 120_000L)
        val accompaniment = MusicUnblockEngine.TrackCandidate("推开世界的门 (伴奏)", "杨乃文", 256_000L)
        val sameArtistFullLive = MusicUnblockEngine.TrackCandidate("推开世界的门 (Live)", "杨乃文", 256_000L)
        val studioOriginal = MusicUnblockEngine.TrackCandidate("推开世界的门", "杨乃文", 256_000L)

        assertEquals(
            MusicUnblockEngine.REJECT_CANDIDATE_SCORE,
            MusicUnblockEngine.scoreCandidateMatch(
                "推开世界的门",
                "杨乃文",
                256_000L,
                wrongSong.title,
                wrongSong.artists,
                wrongSong.durationMs
            )
        )

        assertTrue(
            MusicUnblockEngine.scoreCandidateMatch(
                "推开世界的门",
                "杨乃文",
                256_000L,
                wrongArtist.title,
                wrongArtist.artists,
                wrongArtist.durationMs
            ) < MusicUnblockEngine.MIN_CANDIDATE_PASS_SCORE
        )

        assertTrue(
            MusicUnblockEngine.scoreCandidateMatch(
                "推开世界的门",
                "杨乃文",
                256_000L,
                shortLiveClip.title,
                shortLiveClip.artists,
                shortLiveClip.durationMs
            ) < MusicUnblockEngine.MIN_CANDIDATE_PASS_SCORE
        )

        assertTrue(
            MusicUnblockEngine.scoreCandidateMatch(
                "推开世界的门",
                "杨乃文",
                256_000L,
                accompaniment.title,
                accompaniment.artists,
                accompaniment.durationMs
            ) < MusicUnblockEngine.MIN_CANDIDATE_PASS_SCORE
        )

        val ranked = MusicUnblockEngine.rankCandidates(
            items = listOf(wrongSong, wrongArtist, shortLiveClip, accompaniment, sameArtistFullLive, studioOriginal),
            targetTitle = "推开世界的门",
            targetArtists = "杨乃文",
            expectedDurationMs = 256_000L
        ) { it }

        assertEquals(listOf(studioOriginal, sameArtistFullLive), ranked.map { it.item })
        assertTrue(ranked[0].score > ranked[1].score)
    }

    @Test
    fun `preserves english words like Alive and Discover and allows explicit Live queries`() {
        val aliveScore = MusicUnblockEngine.scoreCandidateMatch(
            "Alive",
            "Daft Punk",
            210_000L,
            "Alive",
            "Daft Punk",
            210_000L
        )
        assertEquals(135, aliveScore)

        val discoverScore = MusicUnblockEngine.scoreCandidateMatch(
            "Discover",
            "Artist",
            200_000L,
            "Discover",
            "Artist",
            200_000L
        )
        assertEquals(135, discoverScore)

        val explicitLiveScore = MusicUnblockEngine.scoreCandidateMatch(
            "推开世界的门 (Live)",
            "杨乃文",
            256_000L,
            "推开世界的门 (Live)",
            "杨乃文",
            256_000L
        )
        assertTrue(explicitLiveScore >= 130)
    }

    @Test
    fun `parses candidate durations from seconds milliseconds and clock strings`() {
        assertEquals(256_000L, MusicUnblockEngine.parseDurationToMs("256"))
        assertEquals(256_000L, MusicUnblockEngine.parseDurationToMs("256000"))
        assertEquals(256_000L, MusicUnblockEngine.parseDurationToMs("04:16"))
        assertEquals(3_723_000L, MusicUnblockEngine.parseDurationToMs("01:02:03"))
    }

    @Test
    fun `strips paren square and curly bracket suffixes safely and instantiates engine without regex crash`() {
        val defaultEngine = MusicUnblockEngine()
        assertEquals(
            "推开世界的门",
            MusicUnblockEngine.stripBracketSuffixes(
                MusicUnblockEngine.normalizeTrackText("推开世界的门 (Live) [DJ] {Remix}")
            )
        )
        assertEquals(
            "推开世界的门",
            MusicUnblockEngine.stripBracketSuffixes(
                MusicUnblockEngine.normalizeTrackText("推开世界的门（《影视原声》）【VIP】")
            )
        )
        assertFalse(defaultEngine.checkAudioUrlReachable("https://other.sycdn.kuwo.cn/resource/audition/123.mp3"))
    }

    @Test
    fun `clamps proxy timeoutMs bounds caps response text size and preserves multi-value headers`() {
        assertEquals(1_000L, MusicUnblockEngine.clampProxyTimeoutMs(0L))
        assertEquals(1_000L, MusicUnblockEngine.clampProxyTimeoutMs(-500L))
        assertEquals(15_000L, MusicUnblockEngine.clampProxyTimeoutMs(15_000L))
        assertEquals(60_000L, MusicUnblockEngine.clampProxyTimeoutMs(600_000L))
        assertEquals(6 * 1024 * 1024, MusicUnblockEngine.MAX_PROXY_RESPONSE_BYTES)
        assertEquals(4 * 1024 * 1024, MusicUnblockEngine.MAX_UNBLOCK_TEXT_BYTES)

        server.createContext("/bounded-overflow") { ex ->
            val payload = ByteArray(128) { 'A'.code.toByte() }
            ex.responseHeaders.add("Content-Type", "text/plain")
            ex.sendResponseHeaders(200, payload.size.toLong())
            ex.responseBody.write(payload)
            ex.close()
        }
        server.createContext("/multi-headers") { ex ->
            val payload = "hello".toByteArray(Charsets.UTF_8)
            ex.responseHeaders.add("Set-Cookie", "sid=1; Path=/")
            ex.responseHeaders.add("Set-Cookie", "csrf=2; HttpOnly")
            ex.responseHeaders.add("X-Single", "only-one")
            ex.sendResponseHeaders(200, payload.size.toLong())
            ex.responseBody.write(payload)
            ex.close()
        }

        localClient.newCall(okhttp3.Request.Builder().url("$baseUrl/bounded-overflow").get().build()).execute().use { resp ->
            var threw = false
            try {
                MusicUnblockEngine.readBoundedResponseText(resp, maxBytes = 16, throwOnOverflow = true)
            } catch (_: IllegalStateException) {
                threw = true
            }
            assertTrue("Expected readBoundedResponseText to throw on oversized payload", threw)
        }

        localClient.newCall(okhttp3.Request.Builder().url("$baseUrl/bounded-overflow").get().build()).execute().use { resp ->
            val clipped = MusicUnblockEngine.readBoundedResponseText(resp, maxBytes = 16, throwOnOverflow = false)
            assertEquals(16, clipped.length)
        }

        localClient.newCall(okhttp3.Request.Builder().url("$baseUrl/multi-headers").get().build()).execute().use { resp ->
            val headersJson = MusicUnblockEngine.serializeResponseHeaders(resp.headers)
            assertTrue(headersJson.get("set-cookie").isJsonArray)
            val cookies = headersJson.getAsJsonArray("set-cookie")
            assertEquals(2, cookies.size())
            assertEquals("sid=1; Path=/", cookies[0].asString)
            assertEquals("csrf=2; HttpOnly", cookies[1].asString)
            assertEquals("only-one", headersJson.get("x-single").asString)
        }
    }

    @Test
    fun `parseKuwoSearchJson handles English apostrophes in both standard and single-quoted JSON`() {
        val standardJson = """{"abslist":[{"SONGNAME":"It's My Life","ARTIST":"Bon Jovi","MUSICRID":"MUSIC_101"}]}"""
        val parsedStandard = MusicUnblockEngine.parseKuwoSearchJson(standardJson)!!
        assertEquals(
            "It's My Life",
            parsedStandard.getAsJsonArray("abslist")[0].asJsonObject.get("SONGNAME").asString
        )

        val singleQuoted = "{'abslist':[{'SONGNAME':'It's My Life','ARTIST':'Bon Jovi','NOTE':'Rock \'n\' Roll','MUSICRID':'MUSIC_102'}]}"
        val parsedSingle = MusicUnblockEngine.parseKuwoSearchJson(singleQuoted)!!
        val item = parsedSingle.getAsJsonArray("abslist")[0].asJsonObject
        assertEquals("It's My Life", item.get("SONGNAME").asString)
        assertEquals("Bon Jovi", item.get("ARTIST").asString)
        assertEquals("Rock 'n' Roll", item.get("NOTE").asString)
    }
}
