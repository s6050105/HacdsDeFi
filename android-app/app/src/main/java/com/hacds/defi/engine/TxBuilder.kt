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

    /**
     * 需要注入时间戳的引擎子命令（argv 布局含 `<ts>` 位的）。
     * `sign` / `addr` 没有 ts 位，不能注入。
     *
     * ⚠ 旧代码用常量 `TS0 = "0"` 作占位，注释写「引擎在 ts=0 时会取当前时间」——
     *   这是**错的**：`txbuild.rs` 里是 `a.get(3).map(|s| s.parse().unwrap())`，
     *   `"0".parse() == Ok(0)` 直接得 0，不会回退到 `curtimes()`。
     *   结果所有 Android 交易 timestamp 恒为 0，参数相同的重复操作会撞哈希。
     */
    private val MODES_WITH_TS = setOf(
        "asset", "deploy", "call", "hacd", "redeem-hacd",
        "combo", "combined", "transfer", "redemption",   // ⚠ combo 与 PC 端 TX_MODES_WITH_TS 对齐
    )

    /**
     * 构建并签名一笔交易（带私钥）。
     * [mode] 与 [args] 对齐引擎子命令（不含 argv[0] 占位）。
     */
    /**
     * 上一次用过的时间戳（秒）。引擎的 `-ts` 参数布局是
     * `<mode> <main> <ts> ...`，`a.get(3).parse()` 对 "0" 会成功得到 0，
     * **不会**回退到 curtimes()。所以调用方传的占位 "0" 会让 timestamp 恒为 0，
     * 而交易哈希包含 timestamp（protocol/src/codec/tx.rs:326）：
     * 参数相同的第二笔交易会得到同一哈希，被节点以
     * "already exists in height" 拒绝。
     *
     * PC 端靠 `nextTxTime()` 覆盖这个占位（会主动等到下一秒），
     * Android 无法等（UI 线程），这里改用**单调递增**保证同秒内多笔也不撞。
     */
    private val lastTs = java.util.concurrent.atomic.AtomicLong(0)

    /**
     * 分配一个**单调递增且不超前于当前时间**的时间戳。
     *
     * 硬约束（`chain/src/engine.rs:788`）：
     *   `if tx.timestamp() > curtimes() { return errf!("tx timestamp ... is in the future") }`
     * 所以**绝不能**返回 now+1 —— 会被节点直接拒绝。
     *
     * 旧实现用 `maxOf(now, prev + 1)`，同秒第二笔必然得到 now+1 → 被拒。
     * 这里改为与 PC 的 `nextTxTime()` 一致：本秒已用过就等到下一秒。
     *
     * ⚠ 这是**阻塞**调用（最多等 1 秒）。只能在后台协程里调（本函数确实在
     *   viewModelScope 协程内被调用），不要在 UI 线程直接用。
     */
    private fun nextTs(): String {
        var t = System.currentTimeMillis() / 1000
        var prev = lastTs.get()
        if (t <= prev) {
            // 本秒已用过 → 等到下一秒（不超前，符合引擎校验）
            val waitMs = (prev + 1) * 1000 - System.currentTimeMillis() + 5
            if (waitMs > 0) Thread.sleep(waitMs.coerceAtMost(2000))
            t = System.currentTimeMillis() / 1000
            // 系统时钟回拨兜底：最多再等 5 秒，仍未前进则用当前值（可能撞哈希，但不会发未来时间戳）
            var i = 0
            while (i < 50 && t <= prev) {
                Thread.sleep(100)
                t = System.currentTimeMillis() / 1000
                i++
            }
        }
        lastTs.set(t)
        return t.toString()
    }

    fun build(
        mode: String,
        args: List<String>,
        keyHex: String?,
        label: String = "<wallet>",
        fee: String? = null,
        gasMax: Int? = null,
        ts: String? = null,
    ): Built {
        val argv = mutableListOf("hacds_txbuild", mode)
        // ts 注入：引擎各模式的 argv 布局都是 <mode> <main> <ts> ...。
        // 同一笔逻辑交易的多次 fee 估算轮次必须复用同一个 ts，否则会白白
        // 消耗掉一串秒级时间戳；因此由调用方传入 ts，未传时才新分配。
        // ⚠ 索引换算（2026-10-26 修正，此前是回归）：
        //   argv = ["hacds_txbuild", mode] + args
        //   → argv[2+i] == args[i]
        //   引擎布局：a[1]=mode, a[2]=main, a[3]=ts, a[4]=contract
        //   → 要改 argv[3]（ts），必须改 **args[1]**，不是 args[2]。
        //   旧代码写 fixed[2] 会把 argv[4]（合约地址）覆盖成时间戳 →
        //   引擎 `Address::from_readable(&a[4])` panic "invalid address"，
        //   导致 call / transfer / combo / hacd 全部无法构造交易。
        val effective = if (mode in MODES_WITH_TS && args.size >= 3) {
            val fixed = args.toMutableList()
            fixed[1] = ts ?: nextTs()
            fixed
        } else args
        argv.addAll(effective)
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
        // 冻结 ts：多轮 fee 估算必须复用同一个时间戳，否则每次重建都会推进
        // 秒级时钟，白白消耗时间戳（PC 端 runTxbuild 的注释也是这么要求的）。
        val frozenTs = if (mode in MODES_WITH_TS && args.size >= 3) nextTs() else null
        for (i in 0 until 6) {
            val b = buildWithFee(mode, args, keyHex, label, feeStr, gasMax, frozenTs)
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
        ts: String? = null,
    ): Built {
        EngineBridge.setOverrides(fee, gasMax)
        try {
            return build(mode, args, keyHex, label, fee, gasMax, ts)
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
