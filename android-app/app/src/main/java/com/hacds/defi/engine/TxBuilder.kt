package com.hacds.defi.engine

import com.hacds.defi.TxEngine
import com.hacds.defi.core.Fee
import com.hacds.defi.net.NodeApi

/**
 * 交易构建 / 签名门面。参数与 CLI / PC 版 `main.js` 完全对齐（共用同一份 Rust 引擎）。
 *
 * 私钥路径：解锁后以 64-hex 明文经 [TxEngine.runWithKey] 传入（进程内，不落盘）。
 * 冷端（D23/D-A5）：不传私钥即可构建「未签名体」。
 */
object TxBuilder {

    data class Built(
        val ok: Boolean,
        val result: EngineResult? = null,
        val error: String? = null,
        val feeUsed: String? = null,
        val feeAuto: Boolean = false,
        val minPurity: Long? = null,
        val rounds: List<Round> = emptyList(),
    )

    data class Round(val i: Int, val fee: String, val size: Int)

    /** 用 0 时刻的时间戳（引擎在 ts=0 时会取当前时间）。 */
    private const val TS0 = "0"

    /**
     * 构建并签名一笔交易（带私钥）。
     * [mode] 与 [args] 对齐引擎子命令（不含 argv[0] 占位）。
     */
    fun build(
        mode: String,
        args: List<String>,
        keyHex: String?,
        label: String = "<wallet>",
        fee: String? = null,
        gasMax: Int? = null,
    ): Built {
        val argv = mutableListOf("hacds_txbuild", mode)
        argv.addAll(args)
        val envFee = fee
        return try {
            val text = if (!keyHex.isNullOrBlank())
                TxEngine.runWithKey(argv, keyHex, label)
            else
                TxEngine.run(argv)
            val r = EngineOutput.parse(text)
            Built(ok = r.errorMessage == null, result = r, error = r.errorMessage, feeUsed = envFee, feeAuto = false)
        } catch (e: Exception) {
            Built(ok = false, error = e.message ?: e.toString())
        }
    }

    /**
     * 自动估算手续费（D7）：先用默认 fee → 读字节数 → 不足则按所需 fee 重建（通常 1~2 轮）。
     * 引擎侧的 fee 由环境变量 `HACDS_FEE` 控制；Android 无法设子进程 env，故此处通过
     * **argv 无关的进程内设置**——实际上引擎读的是 env，所以这里改为直接多次调用并传入
     * 已含 fee 的参数：见 [buildWithFee] 的说明。
     */
    suspend fun buildWithAutoFee(
        node: String,
        mode: String,
        args: List<String>,
        keyHex: String?,
        label: String = "<wallet>",
        gasMax: Int? = null,
    ): Built {
        val minPurity = NodeApi.minPurity(node)
        var feeStr = Fee.DEFAULT_FEE
        val rounds = mutableListOf<Round>()
        var last: Built? = null
        for (i in 0 until 6) {
            val b = buildWithFee(mode, args, keyHex, label, feeStr, gasMax)
            last = b
            val r = b.result ?: return Built(false, error = b.error)
            val size = if (r.isSigned) (r.signedTxHex!!.length / 2) else (r.txBytes ?: 0)
            rounds.add(Round(i + 1, feeStr, size))
            if (node.isBlank() || minPurity == null || Fee.isFeeEnough(feeStr, size, minPurity)) {
                return Built(true, r, null, feeStr, true, minPurity, rounds)
            }
            feeStr = Fee.fee232ToHacString(Fee.minFee232(size, minPurity))
        }
        return Built(true, last?.result, null, feeStr, true, minPurity, rounds)
    }

    /**
     * 指定 fee 构建。fee 通过引擎的进程内覆盖机制传入。
     * 注：引擎的 `HACDS_FEE` 是环境变量；Android 侧改由 [EngineBridge] 设置进程内
     * fee 覆盖（不依赖 env），以保证与 PC 行为一致。
     */
    fun buildWithFee(
        mode: String,
        args: List<String>,
        keyHex: String?,
        label: String,
        fee: String?,
        gasMax: Int?,
    ): Built {
        EngineBridge.setOverrides(fee, gasMax)
        try {
            return build(mode, args, keyHex, label, fee, gasMax)
        } finally {
            EngineBridge.clearOverrides()
        }
    }

    /** 构建未签名体（冷端，D23）：不注入任何密钥。 */
    fun buildUnsigned(mode: String, args: List<String>, fee: String? = null, gasMax: Int? = null): Built {
        EngineBridge.setOverrides(fee, gasMax)
        try {
            return build(mode, args, null, "<unsigned>", fee, gasMax)
        } finally {
            EngineBridge.clearOverrides()
        }
    }

    /** 对给定的未签名体签名（离线机调用）。 */
    fun signRaw(unsignedHex: String, keyHex: String, label: String = "<wallet>"): Built {
        val argv = listOf("hacds_txbuild", "sign", "<key>", unsignedHex)
        return try {
            val text = TxEngine.runWithKey(argv, keyHex, label)
            val r = EngineOutput.parse(text)
            Built(ok = r.errorMessage == null, result = r, error = r.errorMessage)
        } catch (e: Exception) {
            Built(ok = false, error = e.message ?: e.toString())
        }
    }

    /** 由私钥派生地址（走引擎的 addr 模式，避免在 Kotlin 重造 secp256k1）。 */
    fun addressOf(keyHex: String): String? {
        val text = TxEngine.runWithKey(listOf("hacds_txbuild", "addr"), keyHex)
        return EngineOutput.parseAddress(text)
    }

    /** 引擎模式自检（D48 等价物）：校验 .so 已加载且可用。 */
    fun engineSelfCheck(): String = TxEngine.version()
}
