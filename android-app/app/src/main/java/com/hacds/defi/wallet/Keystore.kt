package com.hacds.defi.wallet

import org.json.JSONObject
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKeyFactory
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.PBEKeySpec
import javax.crypto.spec.SecretKeySpec

/**
 * 钱包 keystore —— scrypt 派生 + AES-256-GCM，**与 PC 版 `keystore.js` 格式完全兼容**
 * （`hacds-keystore v1`），因此 PC ↔ 手机钱包可互相导入导出（D-A?·3.3 / M2）。
 *
 * 文件格式：
 * ```json
 * {
 *   "v":1, "kdf":"scrypt", "n":32768, "r":8, "p":1, "dklen":32,
 *   "salt":"<hex16>", "iv":"<hex12>", "ct":"<hex>", "tag":"<hex>",
 *   "address":"<readable>", "created":"<iso8601>", "label":"<可选>"
 * }
 * ```
 *
 * 密钥只在内存解密，永不落盘明文。派生用 JCE 的 `PBKDF2WithHmacSHA256` 无法实现
 * scrypt，故此处：
 *  - **导出/导入 PC 格式**：使用内置纯 Kotlin scrypt（见 [Scrypt]），保证互通；
 *  - 本机钱包默认另用 **Android Keystore** 保护（见 [AndroidKeyVault]），更强。
 */
object Keystore {

    // 与 PC 一致：N=2^15, r=8, p=1, dklen=32
    const val SCRYPT_N = 1 shl 15
    const val SCRYPT_R = 8
    const val SCRYPT_P = 1
    const val DKLEN = 32

    /** AAD：'hacds-keystore-v1'。 */
    private val AAD = "hacds-keystore-v1".toByteArray(Charsets.UTF_8)

    private val rng = SecureRandom()

    /** 生成随机 32 字节私钥（避开 Hacash 拒绝的 0xffffffff 前缀）。 */
    fun newSecret(): ByteArray {
        while (true) {
            val b = ByteArray(32).also { rng.nextBytes(it) }
            if (!(b[0] == 0xff.toByte() && b[1] == 0xff.toByte() &&
                        b[2] == 0xff.toByte() && b[3] == 0xff.toByte())
            ) return b
        }
    }

    /** 由口令派生私钥：sha2_256(utf8(password))（与 Hacash create_by 一致）。 */
    fun secretFromPassword(password: String): ByteArray =
        java.security.MessageDigest.getInstance("SHA-256")
            .digest(password.toByteArray(Charsets.UTF_8))

    /** 加密一个 32B 私钥 → keystore JSON 字符串（与 PC 格式一致）。 */
    fun encrypt(secret32: ByteArray, password: String, address: String): String {
        val salt = ByteArray(16).also { rng.nextBytes(it) }
        val iv = ByteArray(12).also { rng.nextBytes(it) }
        val key = Scrypt.derive(password, salt, SCRYPT_N, SCRYPT_R, SCRYPT_P, DKLEN)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(AAD)
        val ct = cipher.doFinal(secret32)
        // JCE 把 tag 附在密文尾部：末 16 字节是 tag
        val tag = ct.copyOfRange(ct.size - 16, ct.size)
        val body = ct.copyOfRange(0, ct.size - 16)
        return JSONObject()
            .put("v", 1).put("kdf", "scrypt")
            .put("n", SCRYPT_N).put("r", SCRYPT_R).put("p", SCRYPT_P).put("dklen", DKLEN)
            .put("salt", hex(salt)).put("iv", hex(iv))
            .put("ct", hex(body)).put("tag", hex(tag))
            .put("address", address)
            .put("created", isoNow())
            .toString(2)
    }

    /** 解密 keystore JSON。口令错误 / 被篡改 → 抛异常（GCM 认证失败）。 */
    fun decrypt(ksJson: String, password: String): ByteArray {
        val j = JSONObject(ksJson)
        if (j.optInt("v") != 1 || j.optString("kdf") != "scrypt")
            throw IllegalArgumentException("keystore 格式不支持")
        val salt = unhex(j.getString("salt"))
        val iv = unhex(j.getString("iv"))
        val tag = unhex(j.getString("tag"))
        val ct = unhex(j.getString("ct"))
        val key = Scrypt.derive(password, salt, j.getInt("n"), j.getInt("r"), j.getInt("p"), j.getInt("dklen"))
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, iv))
        cipher.updateAAD(AAD)
        return try {
            cipher.doFinal(ct + tag)
        } catch (e: Exception) {
            throw IllegalArgumentException("密码错误或 keystore 已损坏")
        }
    }

    sealed class Imported {
        /** 64-hex 私钥。 */
        data class Raw(val hex: String) : Imported()
        /** 本应用/PC 的 keystore JSON。 */
        data class Ks(val json: String, val address: String?) : Imported()
    }

    /** 解析导入内容：64-hex 私钥（可带 0x），或 keystore JSON。 */
    fun classifyImport(text: String): Imported {
        val t = text.trim()
        if (t.startsWith("{")) {
            val j = try {
                JSONObject(t)
            } catch (e: Exception) {
                throw IllegalArgumentException("JSON 解析失败")
            }
            if (j.optInt("v") == 1 && j.optString("kdf") == "scrypt")
                return Imported.Ks(t, j.optString("address").ifEmpty { null })
            throw IllegalArgumentException("不是受支持的 keystore 文件")
        }
        val hx = t.replace(Regex("^0x", RegexOption.IGNORE_CASE), "")
        if (Regex("^[0-9a-fA-F]{64}$").matches(hx)) return Imported.Raw(hx.lowercase())
        throw IllegalArgumentException("既不是 64 位 hex 私钥，也不是 keystore JSON")
    }

    fun hex(b: ByteArray): String = b.joinToString("") { "%02x".format(it) }

    fun unhex(s: String): ByteArray {
        val t = s.trim()
        require(t.length % 2 == 0) { "hex 长度必须是偶数" }
        return ByteArray(t.length / 2) { ((Character.digit(t[it * 2], 16) shl 4) or Character.digit(t[it * 2 + 1], 16)).toByte() }
    }

    private fun isoNow(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())
}
