package com.xiaopang.naiwamusic.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ExternalPlaylistParserTest {

    @Test
    fun `allowlist accepts all 5 platforms and rejects arbitrary or internal hosts`() {
        val allowed = listOf(
            "https://qishui.douyin.com/s/abcdefg/",
            "https://music.douyin.com/qishui/share/playlist?id=123",
            "https://y.qq.com/n/ryqq/playlist/9087654321",
            "https://i.y.qq.com/n2/m/share/details/taoge.html?id=123456",
            "https://t1.kugou.com/song.html?id=abc",
            "https://m.kuwo.cn/newh5app/playlist_detail/55667788",
            "https://music.163.com/playlist?id=12345678",
            "https://163cn.tv/xyz123"
        )
        for (url in allowed) {
            assertNotNull("Expected allowlisted URL to pass: $url", ExternalPlaylistParser.isAllowedUrl(url))
        }

        val blocked = listOf(
            "https://evil.example.com/playlist?id=1",
            "https://evil-kuwo.cn/playlist/1",
            "http://127.0.0.1:8080/admin",
            "http://169.254.169.254/latest/meta-data/",
            "http://192.168.1.1/router",
            "http://localhost:30488/__alger_health",
            "file:///etc/passwd"
        )
        for (url in blocked) {
            assertNull("Expected blocked/SSRF URL to fail: $url", ExternalPlaylistParser.isAllowedUrl(url))
        }
    }

    @Test
    fun `handle rejects disallowed and SSRF URLs with 403 before making network calls`() {
        val parser = ExternalPlaylistParser()
        for (blockedUrl in listOf(
            "http://127.0.0.1/secret",
            "http://169.254.169.254/latest/meta-data/",
            "https://evil.example.com/share"
        )) {
            val (status, body) = parser.handle(mapOf("url" to blockedUrl))
            assertEquals("Expected 403 for $blockedUrl", 403, status)
            assertTrue(body.contains("\"blocked\":true"))
        }
    }

    @Test
    fun `sanitizePlainText strips XSS payloads and decodes safe HTML entities`() {
        val dirty = "<script>alert(1)</script>晴天 &amp; <b>七里香</b> &lt;img src=x onerror=alert(1)&gt;"
        val cleaned = ExternalPlaylistParser.sanitizePlainText(dirty)
        assertFalse(cleaned.contains("<script", ignoreCase = true))
        assertFalse(cleaned.contains("<img", ignoreCase = true))
        assertFalse(cleaned.contains("<b>", ignoreCase = true))
        assertTrue(cleaned.contains("晴天 & 七里香"))
    }

    @Test
    fun `extractTracksFromHtmlJson parses embedded track lists and deduplicates`() {
        val html = """
            <html>
              <body>
                <script>
                  window.__INITIAL_STATE__ = {
                    "dissname": "深夜单曲<b>循环</b>",
                    "songlist": [
                      {"songname": "晴天", "singer": [{"name": "周杰伦"}]},
                      {"songname": "晴天", "singer": [{"name": "周杰伦"}]},
                      {"songname": "江南", "singer": [{"name": "林俊杰"}]}
                    ]
                  };
                </script>
              </body>
            </html>
        """.trimIndent()
        val result = ExternalPlaylistParser.extractTracksFromHtmlJson(html)
        assertEquals("深夜单曲 循环", result.playlistName)
        assertEquals(2, result.tracks.size)
        assertEquals("晴天", result.tracks[0].title)
        assertEquals("周杰伦", result.tracks[0].artist)
        assertEquals("江南", result.tracks[1].title)
        assertEquals("林俊杰", result.tracks[1].artist)
    }
}
