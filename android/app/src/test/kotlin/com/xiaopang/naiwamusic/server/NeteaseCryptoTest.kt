package com.xiaopang.naiwamusic.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 与官方 netease-cloud-music-api-alger/util/crypto.js 逐字节比对的单元测试
 */
class NeteaseCryptoTest {

    @Test
    fun testEapiMatchesOfficialVector() {
        val out = NeteaseCrypto.eapi("/api/song/lyric/v1", """{"id":33894312,"cp":false}""")
        assertEquals(
            "04AE33D34A93FE3EC22DA8FA305D290AB337D0FE5F36D211DE0D338CC6AA89D0225F21612C19710495E1945C831DFA7164A3CE01495EA2D27C0456E1F3982E87B43655A357E63EB6EABCF03972A6431B5404E11D3D41FB7299F60068D3128CEF0104F26BBABD099099424F80904EF05D",
            out["params"]
        )
    }

    @Test
    fun testLinuxApiMatchesOfficialVector() {
        val out = NeteaseCrypto.linuxapi("""{"method":"POST","url":"https://music.163.com/api/test","params":{"id":1}}""")
        assertEquals(
            "A0D9583F4C5FF68DE851D2893A49DE98FAFB24399F27B4F7E74C64B6FC49A965CFA972FA5EA3D6247CD6247C8198CB870BA9CD10AFCB560B2CA37358E4B3EE0F6D413EB75E7FF1B92A9A5327530CB4C6",
            out["eparams"]
        )
    }

    @Test
    fun testAesCbcMatchesOfficialVector() {
        val out = NeteaseCrypto.aesEncryptCbcBase64("""{"id":123}""", "0CoJUm6Qyw8W8jud", "0102030405060708")
        assertEquals("v/EbP7H0SxTYsElxIHJhmg==", out)
    }

    @Test
    fun testRsaNoPaddingMatchesOfficialVector() {
        val out = NeteaseCrypto.rsaEncryptNoPaddingHex("fedcba9876543210")
        assertEquals(
            "35701388baf89fed412e11269b9c76625d095ecaf17f03fa018abe19ea2d38b949debf242ee39a71ca1f6cda71b1b86a45aa909ee27f7e78e267d34e732f0de948206c3340a788d0003372183e2f753c1f78b66ac23d134ac1fc9b993156520ea826b8aa89a962d4491b4b8d7e08738e1da9b07aa39bf4a7ef0b1c210728cd52",
            out
        )
    }

    @Test
    fun testAnonymousUsernameMatchesOfficialVector() {
        val devId = "0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123"
        val out = NeteaseCrypto.encodeAnonymousUsername(devId)
        assertEquals(
            "MDEyMzQ1Njc4OUFCQ0RFRjAxMjM0NTY3ODlBQkNERUYwMTIzNDU2Nzg5QUJDREVGMDEyMyBYa2pIc2o5dnlXcTVRNDdCdXYyVWNnPT0=",
            out
        )
    }

    @Test
    fun testWeapiProducesValidParamsAndEncSecKey() {
        val out = NeteaseCrypto.weapi("""{"limit":30,"total":true}""")
        assertTrue(!out["params"].isNullOrBlank())
        assertEquals(256, out["encSecKey"]?.length)
    }
}
