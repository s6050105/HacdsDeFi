package com.hacds.defi.wallet

import android.content.Context
import com.hacds.defi.engine.TxBuilder
import org.json.JSONObject
import java.io.File

/**
 * 钱包文件管理（D2 列表/切换/重命名/删除；D30 热切换；M2）。
 *
 * 存储：`filesDir/wallets/wallet-<addr前10>.json`
 *  - **本机钱包**：含 `vault` 字段（Android Keystore 加密的私钥）——无密码也安全
 *  - **PC 兼容钱包**：PC 的 `hacds-keystore v1` JSON（scrypt+AES-GCM）——导入/导出互通
 */
class WalletStore(private val ctx: Context) {

    private val dir: File get() = File(ctx.filesDir, "wallets").apply { mkdirs() }

    data class WalletInfo(
        val file: File,
        val address: String,
        val label: String,
        val kind: String,     // "vault" | "pc"
        val created: String,
    )

    fun list(): List<WalletInfo> = (dir.listFiles { f -> f.name.endsWith(".json") } ?: emptyArray())
        .mapNotNull { f ->
            try {
                val j = JSONObject(f.readText())
                WalletInfo(
                    file = f,
                    address = j.optString("address"),
                    label = j.optString("label", ""),
                    kind = if (j.has("vault")) "vault" else "pc",
                    created = j.optString("created", ""),
                )
            } catch (e: Exception) {
                null
            }
        }.sortedBy { it.created }

    /** 用 Android Keystore 保护保存（本机默认）。 */
    fun saveWithVault(secret32: ByteArray, address: String, label: String): File {
        val j = JSONObject()
            .put("v", 2).put("kind", "vault")
            .put("vault", AndroidKeyVault.seal(secret32))
            .put("address", address)
            .put("label", label)
            .put("created", nowIso())
        val f = File(dir, "wallet-" + address.take(10) + ".json")
        f.writeText(j.toString(2))
        return f
    }

    /** 保存 PC 兼容 keystore JSON（导入用）。 */
    fun savePcKeystore(json: String, address: String, label: String): File {
        val j = JSONObject(json)
        if (label.isNotEmpty()) j.put("label", label)
        val f = File(dir, "wallet-" + address.take(10) + ".json")
        f.writeText(j.toString(2))
        return f
    }

    /** 打开钱包：返回 32B 私钥。vault 型无需密码；PC 型需要密码。 */
    fun open(w: WalletInfo, password: String?): ByteArray {
        val j = JSONObject(w.file.readText())
        return if (j.has("vault")) {
            AndroidKeyVault.open(j.getString("vault"))
        } else {
            if (password.isNullOrEmpty()) throw IllegalArgumentException("该钱包需要密码")
            Keystore.decrypt(j.toString(), password)
        }
    }

    fun rename(w: WalletInfo, label: String) {
        val j = JSONObject(w.file.readText())
        j.put("label", label)
        w.file.writeText(j.toString(2))
    }

    fun delete(w: WalletInfo) {
        w.file.delete()
    }

    /** 从 PC 版配置目录导出的 keystore 文本导入。 */
    fun importText(content: String, password: String?, label: String): Pair<String, File?> {
        val cls = Keystore.classifyImport(content)
        return when (cls) {
            is Keystore.Imported.Raw -> {
                val secret = Keystore.unhex(cls.hex)
                if (secret.size != 32) throw IllegalArgumentException("私钥长度不是 32 字节")
                if (secret[0] == 0xff.toByte() && secret[1] == 0xff.toByte() &&
                    secret[2] == 0xff.toByte() && secret[3] == 0xff.toByte()
                ) throw IllegalArgumentException("该私钥以 0xffffffff 开头，Hacash 不支持")
                val addr = TxBuilder.addressOf(cls.hex) ?: throw IllegalArgumentException("无法派生地址")
                val f = saveWithVault(secret, addr, label)
                addr to f
            }
            is Keystore.Imported.Ks -> {
                if (password.isNullOrEmpty()) throw IllegalArgumentException("导入 keystore 需要输入其口令")
                val secret = Keystore.decrypt(cls.json, password)
                val addr = cls.address ?: TxBuilder.addressOf(Keystore.hex(secret))
                ?: throw IllegalArgumentException("无法派生地址")
                val f = savePcKeystore(cls.json, addr, label)
                addr to f
            }
        }
    }

    private fun nowIso(): String =
        java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US)
            .apply { timeZone = java.util.TimeZone.getTimeZone("UTC") }
            .format(java.util.Date())
}
