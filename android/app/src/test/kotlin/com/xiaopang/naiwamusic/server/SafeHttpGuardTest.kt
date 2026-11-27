package com.xiaopang.naiwamusic.server

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.InetAddress
import java.net.UnknownHostException

class SafeHttpGuardTest {
    @Test
    fun rejectsLoopbackPrivateMetadataAndUlaIps() {
        val blocked = listOf(
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "0.0.0.0",
            "224.0.0.1",
            "::1",
            "fc00::1",
            "fd12:3456:789a::1",
            "fe80::1",
            "::ffff:127.0.0.1"
        )
        val dns = SafeHttpGuard.createPublicIpOnlyDns()
        for (ip in blocked) {
            val addr = InetAddress.getByName(ip)
            assertFalse("Expected $ip to be rejected as non-public", SafeHttpGuard.isPublicAddress(addr))
            var threw = false
            try {
                dns.lookup(ip)
            } catch (_: UnknownHostException) {
                threw = true
            }
            assertTrue("Expected public-IP Dns to reject literal $ip", threw)
        }
    }

    @Test
    fun allowsPublicIpv4AndVpnFakeIpAddresses() {
        for (ip in listOf("8.8.8.8", "198.18.0.1", "198.18.10.20", "198.19.255.254", "::ffff:198.18.0.1")) {
            val addr = InetAddress.getByName(ip)
            assertTrue("Expected $ip to be allowed (public or VPN FakeIP)", SafeHttpGuard.isPublicAddress(addr))
        }
        val dns = SafeHttpGuard.createPublicIpOnlyDns()
        assertTrue(dns.lookup("8.8.8.8").isNotEmpty())
        assertTrue(dns.lookup("198.18.0.1").isNotEmpty())
    }

    @Test
    fun publicMediaUrlCheckBlocksPrivateAndNonHttpSchemes() {
        assertFalse(SafeHttpGuard.validatePublicHttpUrlAndResolve("http://127.0.0.1:8080/a.mp3"))
        assertFalse(SafeHttpGuard.validatePublicHttpUrlAndResolve("http://169.254.169.254/latest/meta-data"))
        assertFalse(SafeHttpGuard.validatePublicHttpUrlAndResolve("http://10.0.0.1/a.mp3"))
        assertFalse(SafeHttpGuard.validatePublicHttpUrlAndResolve("http://192.168.1.1/a.mp3"))
        assertFalse(SafeHttpGuard.validatePublicHttpUrlAndResolve("ftp://cdn.example.com/a.mp3"))
        assertTrue(SafeHttpGuard.validatePublicHttpUrlSyntax("https://thirdparty-cdn.example.com/stream.mp3") != null)
        assertTrue(SafeHttpGuard.validatePublicHttpUrlAndResolve("https://198.18.0.1/track.mp3"))
    }

    @Test
    fun customLxAllowsPublicThirdPartyDomainsWhileBlockingLocalPrivateAndSupabase() {
        assertTrue(
            SafeHttpGuard.validateCustomLxUrlSyntax("https://api.example-lx-source.com/music/url?id=123") != null
        )
        assertTrue(
            SafeHttpGuard.validateCustomLxUrlAndResolve("https://1.1.1.1/music/url")
        )
        assertTrue(
            SafeHttpGuard.validateCustomLxUrlAndResolve("http://198.18.0.1/music/url")
        )
        // 内置严格通道仍拒绝未列入白名单的任意第三方域名
        assertFalse(
            SafeHttpGuard.validateUrlAndResolve(
                "https://api.example-lx-source.com/music/url",
                SafeHttpGuard.AUDIO_AND_PROXY_ALLOWED_DOMAINS
            )
        )

        val blockedCustomLxUrls = listOf(
            "https://abc.supabase.co/rest/v1/sync_profiles",
            "https://supabase.co/",
            "http://localhost:30488/song/url",
            "http://sub.localhost/test",
            "http://device.local/api",
            "http://service.internal/api",
            "http://127.0.0.1:30488/song/url",
            "http://169.254.169.254/latest/meta-data/",
            "http://192.168.1.1/api",
            "http://10.0.0.1/api",
            "http://172.16.0.1/api",
            "http://100.64.0.1/api",
            "http://[::1]:30488/song/url",
            "http://[fe80::1]/api",
            "http://[fc00::1]/api",
            "file:///etc/passwd"
        )
        for (url in blockedCustomLxUrls) {
            assertFalse("Expected custom LX guard to block $url", SafeHttpGuard.validateCustomLxUrlAndResolve(url))
        }

        val lxDns = SafeHttpGuard.createCustomLxSafeDns()
        for (host in listOf("abc.supabase.co", "localhost", "127.0.0.1", "169.254.169.254", "192.168.1.1")) {
            var threw = false
            try {
                lxDns.lookup(host)
            } catch (_: UnknownHostException) {
                threw = true
            }
            assertTrue("Expected custom LX Dns to block $host", threw)
        }
    }
}
