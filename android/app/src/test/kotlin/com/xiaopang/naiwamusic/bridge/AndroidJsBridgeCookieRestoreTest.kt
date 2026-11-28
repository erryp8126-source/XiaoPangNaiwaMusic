package com.xiaopang.naiwamusic.bridge

import org.junit.Assert.assertEquals
import org.junit.Test

class AndroidJsBridgeCookieRestoreTest {
    @Test
    fun picksFirstCookieContainingUserSession() {
        val picked = AndroidJsBridge.pickNeteaseUserCookie(
            listOf(
                null,
                "   ",
                "NMTID=abc123; MUSIC_A=anon_only",
                "__csrf=xyz; MUSIC_U=real_user_cookie_value; Max-Age=1296000"
            )
        )
        assertEquals("__csrf=xyz; MUSIC_U=real_user_cookie_value; Max-Age=1296000", picked)
    }

    @Test
    fun returnsEmptyWhenOnlyAnonymousOrEmptyCookiesExist() {
        val picked = AndroidJsBridge.pickNeteaseUserCookie(
            listOf(
                "",
                "NMTID=111; MUSIC_A=anon",
                "MUSIC_U=; __csrf=none"
            )
        )
        assertEquals("", picked)
    }
}
