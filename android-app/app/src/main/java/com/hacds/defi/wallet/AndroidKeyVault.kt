package com.hacds.defi.wallet

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * 本机钱包的**硬件保护层**（D-A?·3.3）。
 *
 * 生成一个**不可导出的 AES 主密钥**（存于 Android Keystore，硬件 backed），
 * 用它加密私钥后落盘 → 用户不设密码也安全。
 *
 * 与 [Keystore]（PC 兼容的 scrypt 格式）分工：
 *  - [AndroidKeyVault]：本机默认存储（更强）
 *  - [Keystore]：导入/导出 PC 的 `keystore.json`（互通）
 */
object AndroidKeyVault {

    private const val KEY_ALIAS = "hacds_defi_master"
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128
    private const val IV_LEN = 12

    private fun masterKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }
        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        gen.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256)
                .setUserAuthenticationRequired(false)   // 解锁由应用层 BiometricPrompt 控制
                .build()
        )
        return gen.generateKey()
    }

    /** 私钥（32B）→ "iv(hex):ct(hex)"。 */
    fun seal(secret32: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, masterKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(secret32)
        return Keystore.hex(iv) + ":" + Keystore.hex(ct)
    }

    /** 反向解封。 */
    fun open(sealed: String): ByteArray {
        val parts = sealed.split(":")
        require(parts.size == 2) { "vault 数据格式错误" }
        val iv = Keystore.unhex(parts[0])
        val ct = Keystore.unhex(parts[1])
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        return cipher.doFinal(ct)
    }
}
