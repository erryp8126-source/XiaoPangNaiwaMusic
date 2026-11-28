package com.xiaopang.naiwamusic.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EmbeddedHttpServerTest {
    @Test
    fun resolveHttpStatusPreserves5xxAndCustomCodesWithoutDowngradingTo200() {
        val status502 = EmbeddedHttpServer.resolveHttpStatus(502)
        assertEquals(502, status502.requestStatus)
        assertTrue(status502.description.contains("502"))

        val status504 = EmbeddedHttpServer.resolveHttpStatus(504)
        assertEquals(504, status504.requestStatus)
        assertTrue(status504.description.contains("504"))

        val status422 = EmbeddedHttpServer.resolveHttpStatus(422)
        assertEquals(422, status422.requestStatus)
        assertTrue(status422.description.contains("422"))

        val status429 = EmbeddedHttpServer.resolveHttpStatus(429)
        assertEquals(429, status429.requestStatus)

        assertEquals(200, EmbeddedHttpServer.resolveHttpStatus(200).requestStatus)
        assertEquals(404, EmbeddedHttpServer.resolveHttpStatus(404).requestStatus)
        assertEquals(500, EmbeddedHttpServer.resolveHttpStatus(-1).requestStatus)
        assertEquals(500, EmbeddedHttpServer.resolveHttpStatus(999).requestStatus)
    }

    @Test
    fun extractRawLocalPathPreservesPlusAndPercentWithoutDoubleDecoding() {
        val path = "/storage/emulated/0/Music/A+B %20 Remix.flac"
        val extracted = EmbeddedHttpServer.extractRawLocalPath(mapOf("path" to path))
        assertEquals(path, extracted)
    }
}
