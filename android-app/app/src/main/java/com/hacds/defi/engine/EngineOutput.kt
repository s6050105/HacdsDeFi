package com.hacds.defi.engine

/**
 * 引擎输出解析：把 `testkit::txbuild::run` 的文本输出拆成结构化字段。
 *
 * 输出形如：
 * ```
 * # signing with ...
 * --- TransferHacTo(to=…, 0.001) ---
 *   unsigned_tx_hex = 0300…
 *   prefix_hex      = 0300…
 *   signs_hex       = 0000
 *   suffix_hex      = 6300
 *   sign_digest     = aa3d…
 *   fee             = 0.0002 HAC
 *   tx_bytes        = 62   actions = 1   signers = 0
 *   selfcheck       = OK (decode + hash_with_fee == sign_digest)
 *   signed_tx_hex   = 0300…
 *   signer          = 1Q9h…
 *   signed_check    = OK (fill_sign_account + verify_signature)
 * ```
 */
data class EngineResult(
    val label: String?,
    val unsignedTxHex: String?,
    val prefixHex: String?,
    val signsHex: String?,
    val suffixHex: String?,
    val signDigest: String?,
    val signedTxHex: String?,
    val signer: String?,
    val fee: String?,
    val txBytes: Int?,
    val actionCount: Int?,
    val signerCount: Int?,
    val selfCheckOk: Boolean,
    val signedCheckOk: Boolean,
    val rawText: String,
    val errorMessage: String?,
) {
    val hasError: Boolean get() = errorMessage != null
    val isSigned: Boolean get() = !signedTxHex.isNullOrBlank()
    val isUnsignedOnly: Boolean get() = !isSigned && !unsignedTxHex.isNullOrBlank()
}

object EngineOutput {

    /** 解析引擎输出文本。任何 `[ERROR]` 行都会归到 errorMessage。 */
    fun parse(text: String): EngineResult {
        var label: String? = null
        var unsigned: String? = null
        var prefix: String? = null
        var signs: String? = null
        var suffix: String? = null
        var digest: String? = null
        var signed: String? = null
        var signer: String? = null
        var fee: String? = null
        var txBytes: Int? = null
        var actions: Int? = null
        var signers: Int? = null
        var selfCheck = false
        var signedCheck = false
        var error: String? = null

        for (line in text.lineSequence()) {
            val t = line.trim()
            if (t.isEmpty()) continue
            if (t.startsWith("[ERROR]")) {
                error = t.removePrefix("[ERROR]").trim()
                continue
            }
            if (t.startsWith("---") && t.endsWith("---")) {
                label = t.trim('-').trim()
                continue
            }
            val eq = t.indexOf('=')
            if (eq > 0) {
                val key = t.substring(0, eq).trim()
                val value = t.substring(eq + 1).trim()
                when (key) {
                    "unsigned_tx_hex" -> unsigned = value
                    "prefix_hex" -> prefix = value
                    "signs_hex" -> signs = value
                    "suffix_hex" -> suffix = value
                    "sign_digest" -> digest = value
                    "signed_tx_hex" -> signed = value
                    "signer" -> signer = value
                    "fee" -> fee = value
                    "selfcheck" -> selfCheck = value.startsWith("OK")
                    "signed_check" -> signedCheck = value.startsWith("OK")
                }
                continue
            }
            if (t.startsWith("tx_bytes")) {
                txBytes = Regex("tx_bytes\\s*=\\s*(\\d+)").find(t)?.groupValues?.get(1)?.toIntOrNull()
                actions = Regex("actions\\s*=\\s*(\\d+)").find(t)?.groupValues?.get(1)?.toIntOrNull()
                signers = Regex("signers\\s*=\\s*(\\d+)").find(t)?.groupValues?.get(1)?.toIntOrNull()
                continue
            }
        }

        return EngineResult(
            label = label,
            unsignedTxHex = unsigned,
            prefixHex = prefix,
            signsHex = signs,
            suffixHex = suffix,
            signDigest = digest,
            signedTxHex = signed,
            signer = signer,
            fee = fee,
            txBytes = txBytes,
            actionCount = actions,
            signerCount = signers,
            selfCheckOk = selfCheck,
            signedCheckOk = signedCheck,
            rawText = text,
            errorMessage = error,
        )
    }

    /** 解析 `addr` 模式的 `address = …` 输出。 */
    fun parseAddress(text: String): String? =
        Regex("address\\s*=\\s*(1[A-Za-z0-9]+)").find(text)?.groupValues?.get(1)
}
