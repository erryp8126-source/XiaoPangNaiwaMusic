package com.xiaopang.naiwamusic.server

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NeteaseApiClientTest {
    @Test
    fun slicePlaylistTrackIdsClampsNegativeOffsetOverflowAndSkipsNullIds() {
        val trackIds = JsonParser.parseString(
            """
            [
              {"id": 101},
              {"id": null},
              {"id": "202"},
              {"id": "bad_id"},
              {"id": 303}
            ]
            """.trimIndent()
        ).asJsonArray

        val negativeOffsetSlice = NeteaseApiClient.slicePlaylistTrackIds(trackIds, rawOffset = -10, rawLimit = 2)
        assertEquals(listOf("{\"id\":101}"), negativeOffsetSlice)

        val overflowOffsetSlice = NeteaseApiClient.slicePlaylistTrackIds(trackIds, rawOffset = Int.MAX_VALUE, rawLimit = 10)
        assertTrue(overflowOffsetSlice.isEmpty())

        val overflowLimitSlice = NeteaseApiClient.slicePlaylistTrackIds(trackIds, rawOffset = 2, rawLimit = Int.MAX_VALUE)
        assertEquals(listOf("{\"id\":202}", "{\"id\":303}"), overflowLimitSlice)

        val negativeLimitSlice = NeteaseApiClient.slicePlaylistTrackIds(trackIds, rawOffset = 0, rawLimit = -5)
        assertTrue(negativeLimitSlice.isEmpty())
    }
}
