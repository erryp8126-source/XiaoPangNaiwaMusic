package com.xiaopang.naiwamusic.download

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test
import java.io.File

class NativeDownloadManagerRecordTest {
    @Test
    fun buildDownloadRecordHandlesStringIdsAndJsonNullSafely() {
        val dummyFile = File("dummy_track.mp3")

        val biliSongInfo = JsonParser.parseString(
            """
            {
              "id": "BV1xx411c7mD",
              "name": null,
              "picUrl": null,
              "ar": null
            }
            """.trimIndent()
        ).asJsonObject
        val biliRecord = NativeDownloadManager.buildDownloadRecord("B站音频", dummyFile, biliSongInfo)
        assertEquals("BV1xx411c7mD", biliRecord.get("id").asString)
        assertEquals("B站音频", biliRecord.get("name").asString)
        assertEquals("", biliRecord.get("picUrl").asString)
        assertFalse(biliRecord.has("ar"))

        val ncmSongInfo = JsonParser.parseString(
            """
            {
              "id": 186016,
              "name": "晴天",
              "picUrl": "https://p1.music.126.net/cover.jpg",
              "ar": [{"name": "周杰伦"}]
            }
            """.trimIndent()
        ).asJsonObject
        val ncmRecord = NativeDownloadManager.buildDownloadRecord("晴天", dummyFile, ncmSongInfo)
        assertEquals(186016L, ncmRecord.get("id").asLong)
        assertEquals("晴天", ncmRecord.get("name").asString)

        val nullInfoRecord = NativeDownloadManager.buildDownloadRecord("未知曲目", dummyFile, null)
        assertEquals("未知曲目", nullInfoRecord.get("name").asString)
    }
}
