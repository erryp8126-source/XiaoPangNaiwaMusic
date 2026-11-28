package com.xiaopang.naiwamusic.server

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PlatformAuthProxyTest {
    @Test
    fun computesStandardHash33PtqrToken() {
        assertEquals(0, PlatformAuthProxy.computeQqPtqrToken(""))
        val token = PlatformAuthProxy.computeQqPtqrToken("test_qrsig_value")
        assertTrue(token > 0)
    }

    @Test
    fun parsesQqPtuiCbStatesIncludingRiskControlFallback() {
        val waiting = PlatformAuthProxy.parseQqPtuiCB("ptuiCB('66','0','','0','二维码未失效。', '')")
        assertEquals("waiting", waiting.status)

        val scanned = PlatformAuthProxy.parseQqPtuiCB("ptuiCB('67','0','','0','二维码认证中。', '小庞')")
        assertEquals("scanned", scanned.status)

        val confirmed = PlatformAuthProxy.parseQqPtuiCB("ptuiCB('0','0','https://ssl.ptlogin2.qq.com/check_sig?ok=1','0','登录成功！', '小庞')")
        assertEquals("confirmed", confirmed.status)
        assertEquals("小庞", confirmed.nickname)

        val blocked = PlatformAuthProxy.parseQqPtuiCB("<html>Access Denied</html>")
        assertEquals("risk_control", blocked.status)
    }

    @Test
    fun extractsWhitelistedBilibiliCookiesAndValidatesSafeDomainAllowlist() {
        val map = PlatformAuthProxy.extractBilibiliCookieMap(
            listOf(
                "SESSDATA=bili_sess_123; Path=/; HttpOnly",
                "bili_jct=csrf_456; Path=/",
                "DedeUserID=987654; Path=/",
                "OTHER_TRACKING=ignored"
            ),
            null
        )
        assertEquals("bili_sess_123", map["SESSDATA"])
        assertEquals("csrf_456", map["bili_jct"])
        assertEquals("987654", map["DedeUserID"])
        assertFalse(map.containsKey("OTHER_TRACKING"))

        assertTrue(SafeHttpGuard.isAllowedDomain("passport.bilibili.com", SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS))
        assertTrue(SafeHttpGuard.isAllowedDomain("api.bilibili.com", SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS))
        assertTrue(SafeHttpGuard.isAllowedDomain("ssl.ptlogin2.qq.com", SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS))
        assertTrue(SafeHttpGuard.isAllowedDomain("u.y.qq.com", SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS))
        assertTrue(SafeHttpGuard.isAllowedDomain("c.y.qq.com", SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS))
        assertFalse(SafeHttpGuard.isAllowedDomain("127.0.0.1", SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS))
        assertFalse(SafeHttpGuard.isAllowedDomain("passport.bilibili.com.evil.com", SafeHttpGuard.PLATFORM_AUTH_ALLOWED_DOMAINS))
    }
}
