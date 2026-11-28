package com.xiaopang.naiwamusic

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class MainActivityUrlPolicyTest {
    @Test
    fun internalWebViewPolicyAllowsOnlyHttpsAppAssetsWithoutUserInfoOrAuthorityConfusion() {
        assertTrue(MainActivity.isAllowedInternalWebViewUrl("https://appassets.androidplatform.net/assets/www/index.html?v=10100"))
        assertTrue(MainActivity.isAllowedInternalWebViewUrl("https://appassets.androidplatform.net:443/assets/www/index.html"))
        assertTrue(MainActivity.isAllowedInternalWebViewUrl("https://appassets.androidplatform.net/"))

        assertFalse(MainActivity.isAllowedInternalWebViewUrl("http://127.0.0.1:80@attacker.example/exploit.html"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("http://127.0.0.1:30488/song/url"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("http://appassets.androidplatform.net/assets/www/index.html"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("https://appassets.androidplatform.net@attacker.example/assets/index.html"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("https://user:pass@appassets.androidplatform.net/assets/www/index.html"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("https://appassets.androidplatform.net.attacker.example/assets/www/index.html"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("https://appassets.androidplatform.net\\@attacker.example/"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("https://appassets.androidplatform.net:8443/assets/www/index.html"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl("javascript:alert(1)"))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl(""))
        assertFalse(MainActivity.isAllowedInternalWebViewUrl(null))
    }

    @Test
    fun externalBrowserPolicyRestrictsToHttpAndHttpsWithValidHost() {
        assertTrue(MainActivity.isAllowedExternalBrowserUrl("https://github.com/erryp8126-source/XiaoPangNaiwaMusic"))
        assertTrue(MainActivity.isAllowedExternalBrowserUrl("http://music.example.com/path?a=1"))

        assertFalse(MainActivity.isAllowedExternalBrowserUrl("javascript:alert(1)"))
        assertFalse(MainActivity.isAllowedExternalBrowserUrl("file:///etc/passwd"))
        assertFalse(MainActivity.isAllowedExternalBrowserUrl("intent://scan/#Intent;end"))
        assertFalse(MainActivity.isAllowedExternalBrowserUrl("https://host\\evil.com/"))
        assertFalse(MainActivity.isAllowedExternalBrowserUrl(""))
        assertFalse(MainActivity.isAllowedExternalBrowserUrl(null))
    }
}
