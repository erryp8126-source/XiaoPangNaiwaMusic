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
    fun allowsPublicIpv4Address() {
        val addr = InetAddress.getByName("8.8.8.8")
        assertTrue(SafeHttpGuard.isPublicAddress(addr))
        val dns = SafeHttpGuard.createPublicIpOnlyDns()
        val resolved = dns.lookup("8.8.8.8")
        assertTrue(resolved.isNotEmpty())
    }
}
