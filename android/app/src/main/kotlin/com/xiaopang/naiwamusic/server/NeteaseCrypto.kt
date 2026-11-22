package com.xiaopang.naiwamusic.server

import android.graphics.Bitmap
import android.graphics.Color
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import java.io.ByteArrayOutputStream
import java.math.BigInteger
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.SecureRandom
import java.security.interfaces.RSAPublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.Base64
import java.util.zip.GZIPInputStream
import javax.crypto.Cipher
import javax.crypto.spec.IvParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * 网易云音乐加解密工具（与 netease-cloud-music-api-alger/util/crypto.js 保持完全一致）
 */
object NeteaseCrypto {
    private const val IV = "0102030405060708"
    private const val PRESET_KEY = "0CoJUm6Qyw8W8jud"
    private const val LINUX_API_KEY = "rFgB&h#%2?^eDg:Q"
    private const val EAPI_KEY = "e82ckenh8dichen8"
    private const val ID_XOR_KEY = "3go8&$8*3*3h0k(2)2"
    private const val BASE62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
    private const val PUBLIC_KEY_B64 =
        "MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDgtQn2JZ34ZC28NWYpAUd98iZ3" +
            "7BUrX/aKzmFbt7clFSs6sXqHauqKWqdtLkF2KexO40H1YTX8z2lSgBBOAxLsvakl" +
            "V8k4cBFK9snQXE9/DDaFt6Rr7iVZMldczhC0JNgTz+SHXT6CBHuX3e9SdB1Ua44o" +
            "ncaTWz7OBGLbCiK45wIDAQAB"

    private val random = SecureRandom()

    private val rsaPublicKey: RSAPublicKey by lazy {
        val keyBytes = Base64.getDecoder().decode(PUBLIC_KEY_B64)
        val spec = X509EncodedKeySpec(keyBytes)
        KeyFactory.getInstance("RSA").generatePublic(spec) as RSAPublicKey
    }

    fun aesEncryptCbcBase64(text: String, key: String, iv: String = IV): String {
        val cipher = Cipher.getInstance("AES/CBC/PKCS5Padding")
        val keySpec = SecretKeySpec(key.toByteArray(Charsets.UTF_8), "AES")
        val ivSpec = IvParameterSpec(iv.toByteArray(Charsets.UTF_8))
        cipher.init(Cipher.ENCRYPT_MODE, keySpec, ivSpec)
        val encrypted = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        return Base64.getEncoder().encodeToString(encrypted)
    }

    fun aesEncryptEcbHex(text: String, key: String): String {
        val cipher = Cipher.getInstance("AES/ECB/PKCS5Padding")
        val keySpec = SecretKeySpec(key.toByteArray(Charsets.UTF_8), "AES")
        cipher.init(Cipher.ENCRYPT_MODE, keySpec)
        val encrypted = cipher.doFinal(text.toByteArray(Charsets.UTF_8))
        return bytesToHex(encrypted).uppercase()
    }

    fun aesDecryptEcbBytes(cipherBytes: ByteArray, key: String = EAPI_KEY): ByteArray {
        val cipher = Cipher.getInstance("AES/ECB/PKCS5Padding")
        val keySpec = SecretKeySpec(key.toByteArray(Charsets.UTF_8), "AES")
        cipher.init(Cipher.DECRYPT_MODE, keySpec)
        return cipher.doFinal(cipherBytes)
    }

    fun eapiResDecrypt(rawBytes: ByteArray, gunzip: Boolean = false): String {
        val decrypted = aesDecryptEcbBytes(rawBytes, EAPI_KEY)
        return if (gunzip) {
            GZIPInputStream(decrypted.inputStream()).bufferedReader(Charsets.UTF_8).use { it.readText() }
        } else {
            String(decrypted, Charsets.UTF_8)
        }
    }

    fun rsaEncryptNoPaddingHex(text: String): String {
        val input = BigInteger(1, text.toByteArray(Charsets.UTF_8))
        val encrypted = input.modPow(rsaPublicKey.publicExponent, rsaPublicKey.modulus)
        val hex = encrypted.toString(16)
        // RSA-1024 输出固定 256 位十六进制（128 字节）
        return hex.padStart(256, '0')
    }

    fun weapi(jsonText: String): Map<String, String> {
        val sb = StringBuilder(16)
        repeat(16) {
            sb.append(BASE62[random.nextInt(BASE62.length)])
        }
        val secretKey = sb.toString()
        val firstPass = aesEncryptCbcBase64(jsonText, PRESET_KEY, IV)
        val params = aesEncryptCbcBase64(firstPass, secretKey, IV)
        val encSecKey = rsaEncryptNoPaddingHex(secretKey.reversed())
        return mapOf("params" to params, "encSecKey" to encSecKey)
    }

    fun linuxapi(jsonText: String): Map<String, String> {
        return mapOf("eparams" to aesEncryptEcbHex(jsonText, LINUX_API_KEY))
    }

    fun eapi(url: String, jsonText: String): Map<String, String> {
        val message = "nobody${url}use${jsonText}md5forencrypt"
        val digest = md5Hex(message)
        val data = "${url}-36cd479b6b5-${jsonText}-36cd479b6b5-${digest}"
        return mapOf("params" to aesEncryptEcbHex(data, EAPI_KEY))
    }

    fun md5Bytes(bytes: ByteArray): ByteArray {
        return MessageDigest.getInstance("MD5").digest(bytes)
    }

    fun md5Hex(text: String): String {
        return bytesToHex(md5Bytes(text.toByteArray(Charsets.UTF_8)))
    }

    fun cloudmusicDllEncodeId(deviceId: String): String {
        val xored = ByteArray(deviceId.length)
        for (i in deviceId.indices) {
            xored[i] = (deviceId[i].code xor ID_XOR_KEY[i % ID_XOR_KEY.length].code).toByte()
        }
        val digest = md5Bytes(xored)
        return Base64.getEncoder().encodeToString(digest)
    }

    fun encodeAnonymousUsername(deviceId: String): String {
        val combined = "$deviceId ${cloudmusicDllEncodeId(deviceId)}"
        return Base64.getEncoder().encodeToString(combined.toByteArray(Charsets.UTF_8))
    }

    fun generateDeviceId(): String {
        val hexChars = "0123456789ABCDEF"
        return buildString(52) {
            repeat(52) { append(hexChars[random.nextInt(hexChars.length)]) }
        }
    }

    fun randomHex(byteCount: Int): String {
        val bytes = ByteArray(byteCount)
        random.nextBytes(bytes)
        return bytesToHex(bytes)
    }

    fun bytesToHex(bytes: ByteArray): String {
        val sb = StringBuilder(bytes.size * 2)
        for (b in bytes) {
            sb.append(String.format("%02x", b.toInt() and 0xFF))
        }
        return sb.toString()
    }

    /**
     * 使用 ZXing 在本地生成可扫描的 PNG 二维码 Data URL（支持扫码登录）
     */
    fun generateQrPngDataUrl(content: String, size: Int = 280): String {
        return try {
            val hints = mapOf(
                EncodeHintType.CHARACTER_SET to "UTF-8",
                EncodeHintType.MARGIN to 2
            )
            val matrix = QRCodeWriter().encode(content, BarcodeFormat.QR_CODE, size, size, hints)
            val bitmap = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888)
            for (y in 0 until size) {
                for (x in 0 until size) {
                    bitmap.setPixel(x, y, if (matrix[x, y]) Color.BLACK else Color.WHITE)
                }
            }
            val baos = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, baos)
            bitmap.recycle()
            val b64 = Base64.getEncoder().encodeToString(baos.toByteArray())
            "data:image/png;base64,$b64"
        } catch (e: Exception) {
            ""
        }
    }
}
