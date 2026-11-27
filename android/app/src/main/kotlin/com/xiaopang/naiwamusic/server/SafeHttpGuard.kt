package com.xiaopang.naiwamusic.server

import okhttp3.Dns
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import java.net.Inet4Address
import java.net.Inet6Address
import java.net.InetAddress
import java.net.URI
import java.net.UnknownHostException

/**
 * 统一外部 HTTP 安全守卫（防 SSRF + 域名白名单 + 手动 3 跳重定向校验 + DNS 重绑定防护）
 */
object SafeHttpGuard {
    const val MAX_REDIRECTS = 3

    val NETEASE_ALLOWED_DOMAINS: Set<String> = setOf(
        "163.com",
        "126.net"
    )

    val AUDIO_AND_PROXY_ALLOWED_DOMAINS: Set<String> = setOf(
        // 网易云与主流音乐解灰/音频 CDN 域名
        "163.com",
        "126.net",
        "gdstudio.xyz",
        "kuwo.cn",
        "kugou.com",
        "migu.cn",
        "qq.com",
        "gtimg.cn",
        "joox.com",
        "tidal.com",
        "bilibili.com",
        "bilivideo.com",
        "bilivideo.cn",
        "hdslb.com",
        // 云同步与官方服务域名
        "supabase.co",
        "github.com",
        "githubusercontent.com",
        "jianguoyun.com",
        "infini-cloud.net",
        "teracloud.jp",
        "netlify.app"
    )

    // 自定义 LX 音源仅屏蔽本地敏感主机与云同步域，放开第三方公网解析域名（仍全量强制公网 IP + 重定向 SSRF 防护）
    val CUSTOM_LX_BLOCKED_DOMAINS = setOf(
        "supabase.co",
        "localhost",
        "local",
        "internal"
    )

    private val REDIRECT_CODES = setOf(301, 302, 307, 308)

    fun isAllowedDomain(host: String, allowedSuffixes: Set<String>): Boolean {
        val clean = host.lowercase().trim().trimEnd('.')
        if (clean.isEmpty()) return false
        return allowedSuffixes.any { suffix ->
            clean == suffix || clean.endsWith(".$suffix")
        }
    }

    fun isBlockedDomain(
        host: String,
        blockedSuffixes: Set<String> = CUSTOM_LX_BLOCKED_DOMAINS
    ): Boolean {
        return isAllowedDomain(host, blockedSuffixes)
    }

    private fun isPublicIpv4Bytes(bytes: ByteArray): Boolean {
        if (bytes.size != 4) return false
        val b0 = bytes[0].toInt() and 0xFF
        val b1 = bytes[1].toInt() and 0xFF
        val b2 = bytes[2].toInt() and 0xFF
        // 0.0.0.0/8 (unspecified), 10.0.0.0/8 (private), 127.0.0.0/8 (loopback)
        if (b0 == 0 || b0 == 10 || b0 == 127) return false
        // 100.64.0.0/10 (CGNAT)
        if (b0 == 100 && b1 in 64..127) return false
        // 169.254.0.0/16 (link-local & cloud metadata 169.254.169.254)
        if (b0 == 169 && b1 == 254) return false
        // 172.16.0.0/12 (private)
        if (b0 == 172 && b1 in 16..31) return false
        // 192.0.0.0/24 (IETF protocol), 192.168.0.0/16 (private)
        if (b0 == 192 && b1 == 0 && b2 == 0) return false
        if (b0 == 192 && b1 == 168) return false
        // Note: 198.18.0.0/15 is intentionally allowed for VPN FakeIP / TUN virtual routing compatibility
        // 224.0.0.0/4 (multicast) & 240.0.0.0/4 (reserved/broadcast)
        if (b0 >= 224) return false
        return true
    }

    fun isPublicAddress(addr: InetAddress): Boolean {
        if (addr.isLoopbackAddress ||
            addr.isAnyLocalAddress ||
            addr.isLinkLocalAddress ||
            addr.isSiteLocalAddress ||
            addr.isMulticastAddress
        ) {
            return false
        }
        val bytes = addr.address
        return when (addr) {
            is Inet4Address -> isPublicIpv4Bytes(bytes)
            is Inet6Address -> {
                if (bytes.size != 16) return false
                val b0 = bytes[0].toInt() and 0xFF
                val b1 = bytes[1].toInt() and 0xFF
                // Unspecified :: or loopback ::1
                val allZeroPrefix = (0 until 15).all { bytes[it].toInt() == 0 }
                if (allZeroPrefix && (bytes[15].toInt() == 0 || bytes[15].toInt() == 1)) return false
                // ULA fc00::/7
                if ((b0 and 0xFE) == 0xFC) return false
                // Link-local fe80::/10
                if (b0 == 0xFE && (b1 and 0xC0) == 0x80) return false
                // Multicast ff00::/8
                if (b0 == 0xFF) return false
                // IPv4-mapped IPv6 ::ffff:0:0/96
                val isV4Mapped = (0 until 10).all { bytes[it].toInt() == 0 } &&
                    (bytes[10].toInt() and 0xFF) == 0xFF &&
                    (bytes[11].toInt() and 0xFF) == 0xFF
                if (isV4Mapped) {
                    return isPublicIpv4Bytes(bytes.copyOfRange(12, 16))
                }
                true
            }
            else -> false
        }
    }

    fun validatePublicHttpUrlSyntax(rawUrl: String): URI? {
        val parsed = runCatching { URI(rawUrl.trim()) }.getOrNull() ?: return null
        val scheme = parsed.scheme?.lowercase() ?: return null
        if (scheme != "http" && scheme != "https") return null
        val host = parsed.host?.lowercase()?.trim() ?: return null
        if (host.isEmpty()) return null
        return parsed
    }

    fun validateUrlSyntax(rawUrl: String, allowedSuffixes: Set<String>): URI? {
        val parsed = validatePublicHttpUrlSyntax(rawUrl) ?: return null
        val host = parsed.host?.lowercase()?.trim() ?: return null
        if (!isAllowedDomain(host, allowedSuffixes)) return null
        return parsed
    }

    fun validateCustomLxUrlSyntax(
        rawUrl: String,
        blockedSuffixes: Set<String> = CUSTOM_LX_BLOCKED_DOMAINS
    ): URI? {
        val parsed = validatePublicHttpUrlSyntax(rawUrl) ?: return null
        val host = parsed.host?.lowercase()?.trim() ?: return null
        if (isBlockedDomain(host, blockedSuffixes)) return null
        return parsed
    }

    private fun validateResolvedPublicIps(host: String): Boolean {
        val addresses = runCatching { InetAddress.getAllByName(host) }.getOrNull()
        if (addresses.isNullOrEmpty()) return false
        return addresses.all { isPublicAddress(it) }
    }

    fun validatePublicHttpUrlAndResolve(rawUrl: String): Boolean {
        val parsed = validatePublicHttpUrlSyntax(rawUrl) ?: return false
        val host = parsed.host ?: return false
        return validateResolvedPublicIps(host)
    }

    fun validateUrlAndResolve(rawUrl: String, allowedSuffixes: Set<String>): Boolean {
        val parsed = validateUrlSyntax(rawUrl, allowedSuffixes) ?: return false
        val host = parsed.host ?: return false
        return validateResolvedPublicIps(host)
    }

    fun validateCustomLxUrlAndResolve(
        rawUrl: String,
        blockedSuffixes: Set<String> = CUSTOM_LX_BLOCKED_DOMAINS
    ): Boolean {
        val parsed = validateCustomLxUrlSyntax(rawUrl, blockedSuffixes) ?: return false
        val host = parsed.host ?: return false
        return validateResolvedPublicIps(host)
    }

    /**
     * 仅校验公网 IP 的安全 Dns（不限制域名后缀，用于 ExoPlayer CDN 音频流重定向兼容），
     * 拒绝回环、私网、链路本地（含 169.254.169.254）、IPv6 ULA/link-local、组播及未指定地址。
     */
    fun createPublicIpOnlyDns(): Dns {
        return object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                val resolved = InetAddress.getAllByName(hostname)
                if (resolved.isEmpty() || resolved.any { !isPublicAddress(it) }) {
                    throw UnknownHostException("Blocked non-public resolved IP for media host: $hostname")
                }
                return resolved.toList()
            }
        }
    }

    fun createSafeDns(allowedSuffixes: Set<String>): Dns {
        return object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                if (!isAllowedDomain(hostname, allowedSuffixes)) {
                    throw UnknownHostException("Blocked non-allowlisted domain: $hostname")
                }
                val resolved = InetAddress.getAllByName(hostname)
                if (resolved.isEmpty() || resolved.any { !isPublicAddress(it) }) {
                    throw UnknownHostException("Blocked non-public resolved IP for host: $hostname")
                }
                return resolved.toList()
            }
        }
    }

    fun createCustomLxSafeDns(
        blockedSuffixes: Set<String> = CUSTOM_LX_BLOCKED_DOMAINS
    ): Dns {
        return object : Dns {
            override fun lookup(hostname: String): List<InetAddress> {
                if (isBlockedDomain(hostname, blockedSuffixes)) {
                    throw UnknownHostException("Blocked restricted local/cloud domain for LX host: $hostname")
                }
                val resolved = InetAddress.getAllByName(hostname)
                if (resolved.isEmpty() || resolved.any { !isPublicAddress(it) }) {
                    throw UnknownHostException("Blocked non-public resolved IP for LX host: $hostname")
                }
                return resolved.toList()
            }
        }
    }

    /**
     * 执行带严格 SSRF 校验的 HTTP 请求：关闭自动重定向，手动跟随最多 maxRedirects 跳（301/302/307/308），
     * 每一跳先校验协议与域名白名单，再校验 InetAddress.getAllByName 解析出的全部 IP。
     */
    fun executeWithSafeRedirects(
        client: OkHttpClient,
        initialRequest: Request,
        allowedSuffixes: Set<String>,
        maxRedirects: Int = MAX_REDIRECTS
    ): Response {
        return executeRedirectsInternal(client, initialRequest, allowedSuffixes, null, maxRedirects)
    }

    /**
     * 用于用户启用的自定义 LX 音源请求：放开公网第三方域名，
     * 同时每一跳强制拦截内网/私网/回环/元数据 IP 与云同步域名（supabase.co）及 localhost。
     */
    fun executeCustomLxWithSafeRedirects(
        client: OkHttpClient,
        initialRequest: Request,
        blockedSuffixes: Set<String> = CUSTOM_LX_BLOCKED_DOMAINS,
        maxRedirects: Int = MAX_REDIRECTS
    ): Response {
        return executeRedirectsInternal(client, initialRequest, null, blockedSuffixes, maxRedirects)
    }

    /**
     * 用于已解灰音频流 CDN HEAD 可达性探测：不限制第三方 CDN 域名后缀，
     * 但每一跳严格要求 http/https 协议与全量公网 IP（防内网/回环/元数据 SSRF）。
     */
    fun executePublicMediaWithSafeRedirects(
        client: OkHttpClient,
        initialRequest: Request,
        maxRedirects: Int = MAX_REDIRECTS
    ): Response {
        return executeRedirectsInternal(client, initialRequest, null, null, maxRedirects)
    }

    private fun isUrlAllowedForRedirect(
        targetUrl: String,
        allowedSuffixes: Set<String>?,
        blockedSuffixes: Set<String>?
    ): Boolean {
        return when {
            allowedSuffixes != null -> validateUrlAndResolve(targetUrl, allowedSuffixes)
            blockedSuffixes != null -> validateCustomLxUrlAndResolve(targetUrl, blockedSuffixes)
            else -> validatePublicHttpUrlAndResolve(targetUrl)
        }
    }

    private fun executeRedirectsInternal(
        client: OkHttpClient,
        initialRequest: Request,
        allowedSuffixes: Set<String>?,
        blockedSuffixes: Set<String>?,
        maxRedirects: Int
    ): Response {
        var currentReq = initialRequest
        var hop = 0
        while (true) {
            val targetUrl = currentReq.url.toString()
            if (!isUrlAllowedForRedirect(targetUrl, allowedSuffixes, blockedSuffixes)) {
                throw SecurityException("Blocked unsafe or non-allowlisted URL: ${currentReq.url.host}")
            }

            val resp = client.newCall(currentReq).execute()
            val code = resp.code
            val location = resp.header("Location")?.trim()
            if (code !in REDIRECT_CODES || location.isNullOrEmpty()) {
                return resp
            }

            resp.close()
            if (hop >= maxRedirects) {
                throw SecurityException("Exceeded maximum safe redirect hops ($maxRedirects)")
            }

            val nextUrl = currentReq.url.resolve(location)
                ?: throw SecurityException("Malformed redirect target")
            if (!isUrlAllowedForRedirect(nextUrl.toString(), allowedSuffixes, blockedSuffixes)) {
                throw SecurityException("Blocked redirect to unsafe or non-allowlisted host: ${nextUrl.host}")
            }

            val nextBuilder = currentReq.newBuilder().url(nextUrl)
            if (!currentReq.url.host.equals(nextUrl.host, ignoreCase = true)) {
                nextBuilder.removeHeader("Authorization")
                nextBuilder.removeHeader("Cookie")
            }
            if ((code == 301 || code == 302) &&
                currentReq.method != "GET" &&
                currentReq.method != "HEAD"
            ) {
                nextBuilder.method("GET", null)
            }
            currentReq = nextBuilder.build()
            hop += 1
        }
    }
}
