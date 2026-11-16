package com.hacds.defi.wallet

import android.os.Build
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
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
 *
 * ==========================================================================
 * 2026-11-15 审计 H-11：生物识别必须绑定到 Keystore 密钥本身
 * ==========================================================================
 *
 * 原实现的问题链：
 *   ① 主密钥 `setUserAuthenticationRequired(false)` —— 密钥本身不要求任何认证；
 *   ② `Biometric.authenticate()` 没传 `CryptoObject` —— 指纹只是"回调闸门"，
 *      验证通过后回调里照样能调 `open()`；
 *   ③ `useBio=false` 时直接开钱包，`openWallet` 无需任何系统认证。
 *
 * 后果：root / Frida / 注入可以**完全绕过 UI** 直接调 [open] 解密私钥。
 * 生物识别形同装饰。
 *
 * 现在的做法：
 *   · 主密钥 `setUserAuthenticationRequired(true)` + `setInvalidatedByBiometricEnrollment(true)`
 *     —— 密钥材料在硬件里被锁，**没有一次成功的生物识别就拿不到**；
 *   · 解密必须走 [prepareDecrypt]，它返回一个"已绑定认证"的 Cipher，
 *     由 `BiometricPrompt.authenticate(info, CryptoObject(cipher))` 解锁；
 *   · 新增生物识别/锁屏时密钥自动失效（防"先录自己的指纹再开"）。
 *
 * ⚠ 兼容性：改造前后密钥别名不同（见 [KEY_ALIAS] 与 [LEGACY_KEY_ALIAS]）。
 *   旧别名从未要求认证，继续用它等于保留后门，所以这里**不迁移旧密钥** ——
 *   旧钱包文件需要用户重新导入一次。当前无用户，代价为零。
 */
object AndroidKeyVault {

    /** 新别名：要求生物识别/设备凭据认证。 */
    private const val KEY_ALIAS = "hacds_defi_master_v2"

    /**
     * 旧别名（v1，不要求认证）。
     * 只用于**识别**旧钱包文件并给出明确提示，绝不用于解密。
     */
    private const val LEGACY_KEY_ALIAS = "hacds_defi_master"

    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val TRANSFORM = "AES/GCM/NoPadding"
    private const val GCM_TAG_BITS = 128

    /** 密钥是否已在硬件里存在。 */
    private fun keyExists(): Boolean {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        return ks.containsAlias(KEY_ALIAS)
    }

    private fun masterKey(): SecretKey {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        (ks.getEntry(KEY_ALIAS, null) as? KeyStore.SecretKeyEntry)?.let { return it.secretKey }

        val gen = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
        val builder = KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
        )
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            // 密钥必须经过一次生物识别或设备凭据认证才能使用
            .setUserAuthenticationRequired(true)
            // 录入新指纹/面容后密钥自动失效 —— 防止"先诱使用户录入攻击者指纹"
            .setInvalidatedByBiometricEnrollment(true)

        // API 30+ 可以限定"每次使用都要认证"，更强的语义
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            builder.setUserAuthenticationParameters(
                0,   // 0 = 每次使用都要求认证（而不是某个时间窗口内复用）
                KeyProperties.AUTH_BIOMETRIC_STRONG or
                        KeyProperties.AUTH_DEVICE_CREDENTIAL,
            )
        }
        gen.init(builder.build())
        return gen.generateKey()
    }

    /**
     * 加密私钥。
     *
     * ⚠ 加密同样要求认证（密钥被 setUserAuthenticationRequired 锁住）。
     *   这里用 `setUserAuthenticationParameters(0, …)` 的 key，一次认证只能
     *   完成一次 Cipher 操作，所以**写入和读取都需要用户认证**。
     *   对"创建钱包"这个低频动作来说可以接受。
     */
    fun seal(secret32: ByteArray): String {
        val cipher = Cipher.getInstance(TRANSFORM)
        cipher.init(Cipher.ENCRYPT_MODE, masterKey())
        val iv = cipher.iv
        val ct = cipher.doFinal(secret32)
        return Keystore.hex(iv) + ":" + Keystore.hex(ct)
    }

    /**
     * 准备一个解密 Cipher，交给 BiometricPrompt 绑定。
     *
     * 用法（必须这样用，否则拿不到可用 Cipher）：
     * ```
     * val cipher = AndroidKeyVault.prepareDecrypt(sealed)
     * Biometric.prompt(activity, cipher = cipher, onOk = { c ->
     *     val secret = AndroidKeyVault.finishDecrypt(c, sealed)
     * })
     * ```
     */
    fun prepareDecrypt(sealed: String): Cipher {
        val parts = sealed.split(":")
        require(parts.size == 2) { "vault 数据格式错误" }
        val iv = Keystore.unhex(parts[0])
        val cipher = Cipher.getInstance(TRANSFORM)
        try {
            cipher.init(Cipher.DECRYPT_MODE, masterKey(), GCMParameterSpec(GCM_TAG_BITS, iv))
        } catch (e: KeyPermanentlyInvalidatedException) {
            // 用户改了锁屏/录了新指纹 → 密钥已被系统作废
            throw IllegalStateException(
                "设备生物识别/锁屏已变更，本机钱包密钥已失效。" +
                        "请用私钥或 keystore 文件重新导入钱包。", e
            )
        }
        return cipher
    }

    /** 用认证通过的 Cipher 完成解密。 */
    fun finishDecrypt(cipher: Cipher, sealed: String): ByteArray {
        val parts = sealed.split(":")
        require(parts.size == 2) { "vault 数据格式错误" }
        return cipher.doFinal(Keystore.unhex(parts[1]))
    }

    /**
     * 判断某个 vault 密文是否来自**旧版不要求认证的密钥**。
     *
     * 无法从密文本身判断（GCM 不携带密钥标识），所以这里只能检查
     * "新密钥不存在但旧别名存在" 这种典型迁移场景，用于给用户明确提示。
     */
    fun looksLikeLegacyVault(): Boolean {
        val ks = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
        return !ks.containsAlias(KEY_ALIAS) && ks.containsAlias(LEGACY_KEY_ALIAS)
    }
}
