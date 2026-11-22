package com.xiaopang.naiwamusic.config

import android.content.Context
import android.content.SharedPreferences
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 基于 Android Keystore (AES-256-GCM) 的硬件级敏感凭据安全存储
 * - 密钥由系统硬件 Keystore 托管，不可导出
 * - 密文以 v1:<iv_b64>:<cipher_b64> 存入专用 SharedPreferences，杜绝 WebView localStorage 明文泄露
 */
class SecureCredentialStore(context: Context) {
    companion object {
        private const val TAG = "SecureCredentialStore"
        private const val KEYSTORE_PROVIDER = "AndroidKeyStore"
        private const val KEY_ALIAS = "xiaopang_naiwa_secret_key_v1"
        private const val PREFS_NAME = "alger_secure_secrets"
        private const val CIPHER_TRANSFORMATION = "AES/GCM/NoPadding"
        private const val GCM_TAG_BITS = 128
        private val VALID_KEY_RE = Regex("^[a-zA-Z0-9_.-]{1,64}$")
    }

    private val prefs: SharedPreferences =
        context.applicationContext.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    private val lock = Any()

    private fun isValidKey(key: String): Boolean {
        return VALID_KEY_RE.matches(key)
    }

    private fun getOrCreateSecretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE_PROVIDER).apply { load(null) }
        val existing = (keyStore.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.secretKey
        if (existing != null) return existing

        val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE_PROVIDER)
        val spec = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build()
        keyGenerator.init(spec)
        return keyGenerator.generateKey()
    }

    fun setSecret(key: String, value: String): Boolean {
        if (!isValidKey(key)) return false
        if (value.isEmpty()) {
            return removeSecret(key)
        }
        return synchronized(lock) {
            runCatching {
                val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
                cipher.init(Cipher.ENCRYPT_MODE, getOrCreateSecretKey())
                val iv = cipher.iv
                val encrypted = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
                val encoded = "v1:" +
                    Base64.encodeToString(iv, Base64.NO_WRAP) +
                    ":" +
                    Base64.encodeToString(encrypted, Base64.NO_WRAP)
                prefs.edit().putString(key, encoded).apply()
                true
            }.onFailure { err ->
                Log.w(TAG, "setSecret failed for key=$key: ${err.message}")
            }.getOrDefault(false)
        }
    }

    fun getSecret(key: String): String {
        if (!isValidKey(key)) return ""
        return synchronized(lock) {
            runCatching {
                val raw = prefs.getString(key, null) ?: return@synchronized ""
                val parts = raw.split(":")
                if (parts.size != 3 || parts[0] != "v1") return@synchronized ""
                val iv = Base64.decode(parts[1], Base64.DEFAULT)
                val ciphertext = Base64.decode(parts[2], Base64.DEFAULT)
                val cipher = Cipher.getInstance(CIPHER_TRANSFORMATION)
                cipher.init(Cipher.DECRYPT_MODE, getOrCreateSecretKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
                val plain = cipher.doFinal(ciphertext)
                String(plain, StandardCharsets.UTF_8)
            }.onFailure { err ->
                Log.w(TAG, "getSecret failed for key=$key: ${err.message}")
            }.getOrDefault("")
        }
    }

    fun removeSecret(key: String): Boolean {
        if (!isValidKey(key)) return false
        return synchronized(lock) {
            runCatching {
                prefs.edit().remove(key).apply()
                true
            }.getOrDefault(false)
        }
    }
}
