package com.hacds.defi

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.hacds.defi.core.AppConfig
import com.hacds.defi.core.ConfigStore
import com.hacds.defi.core.ContractErrors
import com.hacds.defi.core.DiamondScore
import com.hacds.defi.core.Units
import com.hacds.defi.engine.TxBuilder.Built
import com.hacds.defi.engine.EngineOutput
import com.hacds.defi.engine.TxBuilder
import com.hacds.defi.net.NodeApi
import com.hacds.defi.ui.Ops
import com.hacds.defi.wallet.Keystore
import com.hacds.defi.wallet.WalletSession
import com.hacds.defi.wallet.WalletStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.math.BigInteger

/**
 * 应用主 ViewModel：配置、钱包、查询、交易构建 / 广播、管理员的统一入口。
 */
class AppViewModel(app: Application) : AndroidViewModel(app) {

    private val cfgStore = ConfigStore(app)
    private val walletStore = WalletStore(app)

    // ---- 配置 ----
    private val _cfg = MutableStateFlow(cfgStore.load())
    val cfg: StateFlow<AppConfig> = _cfg.asStateFlow()

    fun saveConfig(c: AppConfig) {
        cfgStore.save(c); _cfg.value = c
    }

    // ---- 钱包 ----
    private val _wallets = MutableStateFlow<List<WalletStore.WalletInfo>>(emptyList())
    val wallets: StateFlow<List<WalletStore.WalletInfo>> = _wallets.asStateFlow()
    val session = WalletSession.state

    fun refreshWallets() { _wallets.value = walletStore.list() }

    fun createWallet(kind: String, password: String, label: String): Result<String> = runCatching {
        // ⚠ 2026-11-15 审计 B-3：私钥一律**随机生成**，不再由口令派生。
        //
        //   原实现 kind == "password" 时走 Keystore.secretFromPassword(label)，
        //   即 sha2_256(口令) 当私钥（无 salt、无迭代），可离线枚举口令盗币。
        //   口令现在是**纯粹的加密口令**，只参与 scrypt 派生 AES 密钥。
        //
        //   kind 参数保留只为兼容旧调用点，取值不再影响私钥生成。
        require(password.length >= 12) { "密码至少 12 位（它用于加密私钥，请足够长）" }
        val secret = Keystore.newSecret()
        val addr = TxBuilder.addressOf(Keystore.hex(secret)) ?: error("无法派生地址")
        walletStore.saveWithVault(secret, addr, label)
        WalletSession.unlock(addr, Keystore.hex(secret), label)
        refreshWallets()
        addr
    }

    fun importWallet(content: String, password: String?, label: String): Result<String> = runCatching {
        val (addr, _) = walletStore.importText(content, password, label)
        // 明文私钥导入后立即解锁
        val secret = when (val c = Keystore.classifyImport(content)) {
            is Keystore.Imported.Raw -> Keystore.unhex(c.hex)
            is Keystore.Imported.Ks -> Keystore.decrypt(c.json, password ?: error("需要密码"))
        }
        WalletSession.unlock(addr, Keystore.hex(secret), label)
        refreshWallets()
        addr
    }

    /**
     * 打开钱包。
     *
     * ⚠ 2026-11-15 审计 H-11：vault 型钱包必须带 [cipher]（来自
     *   `AndroidKeyVault.prepareDecrypt` + BiometricPrompt 认证）。
     *   没有它就不能解密 —— 这是硬件层的强制，不是 UI 层的自觉。
     */
    fun openWallet(
        w: WalletStore.WalletInfo,
        password: String?,
        cipher: javax.crypto.Cipher? = null,
    ): Result<String> = runCatching {
        val secret = walletStore.open(w, password, cipher)
        WalletSession.unlock(w.address, Keystore.hex(secret), w.label)
        w.address
    }

    /** 该钱包是否为需要生物识别解锁的本机 vault 型。 */
    fun needsBiometric(w: WalletStore.WalletInfo): Boolean =
        walletStore.vaultSealedOf(w) != null

    /** 读取 vault 密文，交给 AndroidKeyVault.prepareDecrypt 用。 */
    fun vaultSealedOf(w: WalletStore.WalletInfo): String? =
        walletStore.vaultSealedOf(w)

    fun lock() = WalletSession.lock()
    fun renameWallet(w: WalletStore.WalletInfo, label: String) { walletStore.rename(w, label); refreshWallets() }
    fun deleteWallet(w: WalletStore.WalletInfo) {
        if (WalletSession.address == w.address) WalletSession.lock()
        walletStore.delete(w); refreshWallets()
    }

    // ---- 日志 ----
    private val _log = MutableStateFlow<List<String>>(emptyList())
    val log: StateFlow<List<String>> = _log.asStateFlow()
    fun log(msg: String) { _log.value = (_log.value + msg).takeLast(400) }
    fun clearLog() { _log.value = emptyList() }

    // ---- 资产总览 ----
    private val _assets = MutableStateFlow<AssetState?>(null)
    val assets: StateFlow<AssetState?> = _assets.asStateFlow()

    // ---- 金库分红（2026-11-18）----
    //
    // 语义（见 hacds_exchange/钱包-金库分红页签-设计.md §4.1）：
    //   due       已结算、只差提现
    //   pending   尚未结算的增量 = claimable − due
    //   claimable 两者之和
    // ⚠ claim 之后 claimable 数值不变（增量转成了 due），UI 必须显示成「待提取」。
    data class VaultState(
        val hold: Long,        // 钱包持有的 3001 份数
        val staked: Long,      // 已质押进合约 B
        val due: Long,         // 已结算待提现（zhu）
        val claimable: Long,   // 总计可提取（zhu）
        val pending: Long,     // 未结算增量（zhu）
        val rpu: String,       // 全局累加器（×1e12）
        val totdiv: Long,      // 累计分红（zhu）
        val reserve: Long,     // 续租储备（zhu）
        val stale: Boolean = false,
    )

    private val _vault = MutableStateFlow<VaultState?>(null)
    val vault: StateFlow<VaultState?> = _vault.asStateFlow()

    /** 页签是否显示 —— 持有 3001 **或** 已质押 > 0（只看钱包余额的话质押后会消失）。 */
    val vaultVisible: kotlinx.coroutines.flow.StateFlow<Boolean> = _vault
        .map { it != null && (it.hold > 0 || it.staked > 0) }
        .stateIn(viewModelScope, kotlinx.coroutines.flow.SharingStarted.Eagerly, false)

    data class AssetState(
        val hac: String, val satoshi: Long, val diamondCount: Int, val diamonds: List<String>,
        val due: String?, val hacPoints: String?, val hacdsOnchain: String,
        val otherAssets: List<JSONObject>,
        val diamondsDetail: List<JSONObject> = emptyList(),
        val expectedHacds: BigInteger? = null,
    )

    fun refreshAssets() {
        val c = _cfg.value; val addr = WalletSession.address ?: return
        viewModelScope.launch {
            runCatching {
                val o = NodeApi.assetOverview(c.baseNode(), c.contract, addr)
                _assets.value = AssetState(
                    o.hac, o.satoshi, o.diamondCount, o.diamonds,
                    o.due, o.hacPoints, o.hacdsOnchain, o.otherAssets,
                )
                log("资产已刷新：HACD ${o.diamondCount} 颗")
            }.onFailure { log("刷新资产失败：${it.message}") }
        }
    }

    /** 加载 HACD 详情并本地算「预期 hacds」（D13）。 */
    fun loadHacdDetails() {
        val c = _cfg.value; val cur = _assets.value ?: return
        if (cur.diamonds.isEmpty()) return
        viewModelScope.launch {
            runCatching {
                val list = NodeApi.hacdDetails(c.baseNode(), cur.diamonds)
                var sum = BigInteger.ZERO
                for (d in list) {
                    val vg = d.optString("visual_gene", "")
                    val num = d.optLong("number", 0)
                    val nm = d.optString("name", "")
                    if (vg.length == 20 && nm.length == 6) {
                        sum = sum.add(BigInteger.valueOf(DiamondScore.analyse(nm, num, vg).score.toLong()))
                    }
                }
                // 预期 hacds = Σ评分 × SCORE_SCALE
                // #3000 起 decimal=0，SCORE_SCALE = 1，即 **Σ评分就是 hacds 个数**。
                // （旧版 #2000 是 decimal=8、SCORE_SCALE=1e8，那套口径已作废。）
                val expected = sum.multiply(BigInteger.valueOf(Units.SCORE_SCALE))
                _assets.value = cur.copy(diamondsDetail = list, expectedHacds = expected)
                log("已加载 ${list.size} 颗 HACD 详情")
            }.onFailure { log("加载 HACD 详情失败：${it.message}") }
        }
    }

    /** 按任意地址加载 HACD（收藏页的地址查询，用于查看他人/合约钻石）。 */
    fun loadHacdByAddress(addr: String) {
        val c = _cfg.value
        if (addr.isBlank()) { log("地址为空"); return }
        viewModelScope.launch {
            runCatching {
                val bal = NodeApi.balance(c.baseNode(), addr)
                val list = NodeApi.hacdDetails(c.baseNode(), bal.diamonds)
                var sum = BigInteger.ZERO
                for (d in list) {
                    val vg = d.optString("visual_gene", "")
                    val nm = d.optString("name", "")
                    if (vg.length == 20 && nm.length == 6)
                        sum = sum.add(BigInteger.valueOf(DiamondScore.analyse(nm, d.optLong("number"), vg).score.toLong()))
                }
                _assets.value = AssetState(
                    bal.hac, bal.satoshi, bal.diamondCount, bal.diamonds,
                    null, null, "0", emptyList(),
                    diamondsDetail = list,
                    expectedHacds = sum.multiply(BigInteger.valueOf(Units.SCORE_SCALE)),
                )
                log("已加载地址 $addr 的 ${list.size} 颗 HACD")
            }.onFailure { log("加载失败：${it.message}") }
        }
    }

    // ---- 协议状态 ----
    private val _protocol = MutableStateFlow<NodeApi.ProtocolOverview?>(null)
    val protocol: StateFlow<NodeApi.ProtocolOverview?> = _protocol.asStateFlow()

    fun refreshProtocol() {
        val c = _cfg.value; val addr = WalletSession.address ?: return
        viewModelScope.launch {
            runCatching {
                _protocol.value = NodeApi.protocolOverview(c.baseNode(), c.contract, addr)
                log("协议状态已刷新")
            }.onFailure { log("协议状态刷新失败：${it.message}") }
        }
    }

    // ---- 未解锁时也能查协议（用合约地址当 caller）----
    fun refreshProtocolPublic() {
        val c = _cfg.value
        viewModelScope.launch {
            runCatching { _protocol.value = NodeApi.protocolOverview(c.baseNode(), c.contract, "") }
        }
    }

    /** 金库数据的最近一次成功时间（30 秒缓存，设计文档 §6.2）。 */
    private var vaultAt = 0L

    /**
     * 刷新金库分红数据（2026-11-18）。
     *
     * 设计要点（见设计文档 §6、§9）：
     *   · **串行**调用 —— 节点 sandboxcall 每 IP 并发上限 2
     *   · 先用 share_serial() 校验合约身份，防止 VAULT_ADDR 配错
     *   · 失败时保留上次数据并标记 stale，而不是清空
     *   · 30 秒内不重复拉，写操作成功后用 force=true 穿透
     */
    fun refreshVault(force: Boolean = false) {
        val c = _cfg.value
        val addr = WalletSession.address ?: return
        val now = System.currentTimeMillis()
        if (!force && _vault.value != null && now - vaultAt < 30_000L) return
        viewModelScope.launch {
            val prev = _vault.value
            runCatching {
                // ① 身份校验：合约 B 的 share_serial() 必为 3001
                val serial = NodeApi.call(c.baseNode(), AppConfig.VAULT_ADDR,
                                          "share_serial", c.contract, null)
                if (serial == null || serial.trim().toLongOrNull() != AppConfig.SHARE_SERIAL) {
                    // 未部署 / 地址配错 → 隐藏卡片，不打扰用户（§9 ①②）
                    log("金库合约校验失败（share_serial=$serial），卡片已隐藏")
                    _vault.value = null
                    return@launch
                }

                // ② 串行读数（顺序 await，不并发）
                val who = "$addr:address"
                val shares = NodeApi.call(c.baseNode(), AppConfig.VAULT_ADDR, "get_shares", c.contract, who)
                val due    = NodeApi.call(c.baseNode(), AppConfig.VAULT_ADDR, "get_due", c.contract, who)
                val claim  = NodeApi.call(c.baseNode(), AppConfig.VAULT_ADDR, "get_claimable", c.contract, who)
                val rpu    = NodeApi.call(c.baseNode(), AppConfig.VAULT_ADDR, "get_current_rpu", c.contract, null)
                val tdiv   = NodeApi.call(c.baseNode(), AppConfig.VAULT_ADDR, "get_total_dividend", c.contract, null)
                val rsv    = NodeApi.call(c.baseNode(), AppConfig.VAULT_ADDR, "get_reserve", c.contract, null)

                if (shares == null) {
                    // 网络/合约失败 → 保留上次数据并标记过期
                    _vault.value = prev?.copy(stale = true)
                    vaultAt = now          // 避免每次重组都重试
                    if (prev == null) log("金库数据读取失败")
                    return@launch
                }

                // ③ 钱包持有的 3001 —— 直接查余额，不依赖「资金页」是否加载过
                var hold = 0L
                runCatching {
                    val bal = NodeApi.balance(c.baseNode(), addr)
                    hold = bal.assets.firstOrNull {
                        it.optString("serial").toLongOrNull() == AppConfig.SHARE_SERIAL
                    }?.optString("amount")?.toLongOrNull() ?: 0L
                }

                val s = shares.trim().toLongOrNull() ?: 0L
                val d0 = due?.trim()?.toLongOrNull() ?: 0L
                val c0 = claim?.trim()?.toLongOrNull() ?: 0L
                _vault.value = VaultState(
                    hold = hold,
                    staked = s,
                    due = d0,
                    claimable = c0,
                    pending = (c0 - d0).coerceAtLeast(0L),
                    rpu = rpu?.trim() ?: "0",
                    totdiv = tdiv?.trim()?.toLongOrNull() ?: 0L,
                    reserve = rsv?.trim()?.toLongOrNull() ?: 0L,
                    stale = false,
                )
                vaultAt = now
            }.onFailure { log("刷新金库失败：${it.message}") }
        }
    }

    // ---- 金库写操作（2026-11-18）----
    //
    // ⚠ 三种操作在链上是三件不同的事（设计文档 §3.2）：
    //   质押     TransferAssetFromTo(我 → B, 3001, N)  触发 B 的 PayableAsset
    //   赎回     TransferAssetFromTo(B → 我, 3001, N)  触发 B 的 PermitAsset（先结算再减份额）
    //   claim    ContractMainCall(B, 'claim')          只把增量结算进 due（钱还在合约里）
    //   提现     TransferHacFromTo(B → 我, X)          触发 B 的 PermitHAC，钱才真正到钱包
    // 「领取并提现」= claim + hac-from-to 打包成 combo 原子交易，**顺序不能反**。

    /**
     * 质押 N 份：把 3001 从钱包转进合约 B。
     *
     * ⚠ 这是**转账**不是存入 —— 份数会离开钱包余额（合约账本 sh:<我> 记账），
     *   但所有权仍是自己的，可随时赎回。UI 确认框必须讲清楚（设计文档 §4.2）。
     */
    fun vaultStake(n: Long) {
        val c = _cfg.value
        val main = WalletSession.address ?: run { log("未解锁钱包"); return }
        if (n <= 0) { log("份数不合法"); return }
        val st = _vault.value
        if (st != null && n > st.hold) { log("超过钱包持有份额（${st.hold}）"); return }
        viewModelScope.launch {
            val args = listOf(main, "0", "asset-from-to", main, AppConfig.VAULT_ADDR,
                              AppConfig.SHARE_SERIAL.toString(), n.toString())
            // gas 固定 99：asset-from-to 打到合约地址会触发 PayableAsset 钩子，
            // 内部还要 settle() + 多次 storage 写入，默认档位（50）不够。
            val b = if (WalletSession.keyHex != null)
                TxBuilder.buildWithAutoFee(c.baseNode(), "transfer", args, WalletSession.keyHex, main, 99)
            else TxBuilder.buildWithFee("transfer", args, null, main, null, 99)
            _lastBuilt.value = b
            if (b.ok) log("质押交易已构建（$n 份 → 金库）") else log("质押构建失败：${b.error}")
        }
    }

    /** 赎回 N 份：把份额从合约 B 转回自己（触发 PermitAsset，先结算再减份额）。 */
    fun vaultUnstake(n: Long) {
        val c = _cfg.value
        val main = WalletSession.address ?: run { log("未解锁钱包"); return }
        if (n <= 0) { log("份数不合法"); return }
        val st = _vault.value
        if (st != null && n > st.staked) { log("超过已质押份额（${st.staked}）"); return }
        viewModelScope.launch {
            val args = listOf(main, "0", "asset-from-to", AppConfig.VAULT_ADDR, main,
                              AppConfig.SHARE_SERIAL.toString(), n.toString())
            val b = if (WalletSession.keyHex != null)
                TxBuilder.buildWithAutoFee(c.baseNode(), "transfer", args, WalletSession.keyHex, main, 99)
            else TxBuilder.buildWithFee("transfer", args, null, main, null, 99)
            _lastBuilt.value = b
            if (b.ok) log("赎回交易已构建（$n 份 → 钱包）") else log("赎回构建失败：${b.error}")
        }
    }

    /**
     * 领取并提现（一步完成）。
     *
     * ⚠ 两步缺一不可（设计文档 §4.3）：
     *   claim()                    → 增量结算进 due（钱还在合约里）
     *   TransferHacFromTo(B→自己)  → 钱真正到钱包
     * 放同一笔 combo 里，**claim 必须在前**：先提现再 claim 只能提走旧的 due。
     */
    fun vaultClaimAndWithdraw(zhu: Long) {
        val c = _cfg.value
        val main = WalletSession.address ?: run { log("未解锁钱包"); return }
        if (zhu <= 0) { log("没有可提取的分红"); return }
        viewModelScope.launch {
            val hac = Units.zhuToHacString(java.math.BigInteger.valueOf(zhu))
            val actions = org.json.JSONArray()
                .put(JSONObject().put("type", "call")
                    .put("contract", AppConfig.VAULT_ADDR)
                    .put("fn", "claim").put("params", "-"))
                .put(JSONObject().put("type", "hac-from-to")
                    .put("from", AppConfig.VAULT_ADDR).put("to", main).put("hac", hac))
            val spec = JSONObject()
                .put("contract", AppConfig.VAULT_ADDR)
                .put("actions", actions)
            val specFile = java.io.File(
                getApplication<Application>().cacheDir,
                "vaultclaim_${System.currentTimeMillis()}.json")
            specFile.writeText(spec.toString())
            val args = listOf(main, "0", specFile.absolutePath)
            // 与 buildCombo 同样的清理纪律（审计 M-8）：参数明文不能留在 cache 里
            val b = try {
                TxBuilder.buildWithAutoFee(c.baseNode(), "combo", args, WalletSession.keyHex, main, 99)
            } finally {
                specFile.delete()
            }
            _lastBuilt.value = b
            if (b.ok) log("领取并提现已构建（$hac HAC）") else log("领取构建失败：${b.error}")
        }
    }

    /** 写操作成功后由 UI 调用：强制刷新，不吃缓存。 */
    fun vaultRefreshNow() = refreshVault(force = true)

    // ---- 交易构建 ----
    private val _lastBuilt = MutableStateFlow<Built?>(null)
    val lastBuilt: StateFlow<Built?> = _lastBuilt.asStateFlow()

    // 纯转账不触发 VM，gas_max=1 足够；涉及合约（from/to/contract=合约）的转账
    // 会触发 Permit*/Payable* 钩子，必须用引擎默认 99（预算 111911）。
    // hacds 资产转账是 extra9 动作：每笔约 500+ gas。按笔数选 gas_max。
    private fun gasByteForAssetCount(n: Int): Int = when {
        n <= 6 -> 50
        n <= 12 -> 60
        n <= 24 -> 70
        n <= 48 -> 80
        n <= 96 -> 90
        else -> 99
    }

    private fun defaultGasMax(mode: String, args: List<String>, contract: String): Int? {
        if (mode != "transfer") return null
        val sub = args.getOrNull(2) ?: return null
        val addrs = when (sub) {
            "hac-to", "asset-to", "hacd-to" -> listOf(args.getOrNull(3))
            "hac-from-to", "asset-from-to" -> listOf(args.getOrNull(3), args.getOrNull(4))
            "hac-from", "asset-from" -> listOf(args.getOrNull(3))
            else -> emptyList()
        }
        if (addrs.any { it == contract }) return null
        return if (sub == "asset-to" || sub == "asset-from-to" || sub == "asset-from") gasByteForAssetCount(1) else 1
    }

    /** 构建某个操作（已解锁 → 直接签名；未解锁 → 构建未签名体，用于离线/预览）。 */
    fun buildOp(op: com.hacds.defi.ui.Op, values: Map<String, String>, fee: String?, gasMax: Int?) {
        val c = _cfg.value
        val main = WalletSession.address
        if (main == null) { log("未解锁钱包"); return }
        viewModelScope.launch {
            // C-4：remove_liquidity 单笔撞主网 resource 上限（6,102 > 6,100）。
            // resource_limit_byte=56 是主网参数，独立于 gas_max，调高 gas 绕不过；
            // 合约不可升级，所以客户端拆成两笔：先 lp_harvest 结算，再撤池。
            // 顺序不能反——先撤池会按减少后的 lpt 结算，用户少拿奖励。
            val fnName = if (op.fn == "remove_liquidity") "lp_harvest" else op.fn
            val args = when (op.kind) {
                com.hacds.defi.ui.OpKind.CALL -> {
                    val params =
                        if (op.fn == "remove_liquidity") "-"
                        else Ops.callParams(op, values)
                    listOf(main, "0", c.contract, fnName ?: "", params)
                }
                else -> op.build?.invoke(values, main, c.contract)
                    ?: listOf(main, "0", "hac-to", values["to"] ?: "", values["hac"] ?: "")
            }
            val mode = if (op.kind == com.hacds.defi.ui.OpKind.CALL) "call" else "transfer"
            val key = if (WalletSession.isUnlocked) WalletSession.keyHex else null
            val gm = gasMax ?: defaultGasMax(mode, args, c.contract)
            val b = if (fee.isNullOrBlank() && key != null) {
                TxBuilder.buildWithAutoFee(c.baseNode(), mode, args, key, WalletSession.address ?: "<wallet>", gm)
            } else {
                TxBuilder.buildWithFee(mode, args, key, WalletSession.address ?: "<wallet>", fee, gm)
            }
            _lastBuilt.value = b
            if (b.ok) {
                log("已构建：${b.result?.label ?: mode}（${b.result?.txBytes ?: 0} 字节，fee ${b.feeUsed ?: "-"}）")
                // C-4：记住撤池参数，等 lp_harvest 广播成功后自动生成第二笔
                pendingRemoveParams = if (op.fn == "remove_liquidity") Ops.callParams(op, values) else null
                if (pendingRemoveParams != null) log("撤池分两步：这是第 1 步「结算 LP 奖励」。广播成功后会自动构建第 2 步。")
            } else log("构建失败：${b.error}")
        }
    }

    /** C-4 等待第二步的撤池参数（null = 当前不是撤池流程）。 */
    private var pendingRemoveParams: String? = null

    /** C-4 第二步：lp_harvest 已上链，构建 remove_liquidity。 */
    fun buildPendingRemove() {
        val p = pendingRemoveParams ?: return
        pendingRemoveParams = null
        val c = _cfg.value
        val main = WalletSession.address
        if (main == null) { log("未解锁钱包"); return }
        viewModelScope.launch {
            val args = listOf(main, "0", c.contract, "remove_liquidity", p)
            val key = if (WalletSession.isUnlocked) WalletSession.keyHex else null
            val b = if (key != null) {
                TxBuilder.buildWithAutoFee(c.baseNode(), "call", args, key, WalletSession.address ?: "<wallet>", 99)
            } else {
                TxBuilder.buildWithFee("call", args, key, WalletSession.address ?: "<wallet>", null, 99)
            }
            _lastBuilt.value = b
            if (b.ok) log("第 2 步：撤池交易体已生成，请签名后广播。")
            else log("第 1 步「结算 LP 奖励」已成功上链，只是第 2 步「撤池」未生成。资金无损失，可重试撤池。原因：${b.error}")
        }
    }

    /** 广播当前已构建的交易。 */
    fun broadcastLast() {
        val c = _cfg.value
        val hex = _lastBuilt.value?.result?.let { it.signedTxHex ?: it.unsignedTxHex }
        if (hex.isNullOrBlank()) { log("没有可广播的交易"); return }
        viewModelScope.launch {
            runCatching {
                val d = NodeApi.broadcast(c.baseNode(), hex)
                val ret = d.optInt("ret", -1)
                if (ret == 0) {
                    log("✔ 已接受 hash=${d.optString("hash")}（仅进入 mempool，需等待打包）")
                    // C-4：第 1 步（lp_harvest）已进 mempool → 生成第 2 步交易体。
                    // 两步可以连续广播：harvest 只改 chk/lch 检查点，撤池读的是 lpt/amm，
                    // 顺序在同一 mempool 里按 nonce/时间戳排队执行即可。
                    if (pendingRemoveParams != null) buildPendingRemove()
                    // 上链后所有读数都可能变（余额、金库份额、分红），强制刷新不吃缓存。
                    // 注意：这里只是进了 mempool，真正生效要等打包；用户点「刷新」可再看一次。
                    refreshAssets()
                    refreshVault(force = true)
                } else log("✘ 广播失败：${d.optString("_translated", d.optString("err"))}")
            }.onFailure { log("广播异常：${it.message}") }
        }
    }

    fun checkLast() {
        val c = _cfg.value
        val hex = _lastBuilt.value?.result?.let { it.signedTxHex ?: it.unsignedTxHex } ?: return
        viewModelScope.launch {
            runCatching { log("校验 ret=${NodeApi.check(c.baseNode(), hex).optInt("ret", -1)}") }
                .onFailure { log("校验失败：${it.message}") }
        }
    }

    // ---- 清算模块（D51）----
    private val _liq = MutableStateFlow<com.hacds.defi.net.Liquidation.Snapshot?>(null)
    val liq: StateFlow<com.hacds.defi.net.Liquidation.Snapshot?> = _liq.asStateFlow()

    fun refreshLiquidation() {
        val c = _cfg.value
        viewModelScope.launch {
            runCatching {
                _liq.value = com.hacds.defi.net.Liquidation.snapshot(c.baseNode(), c.contract, c.baseIndexer())
                val n = _liq.value?.list?.size ?: 0
                val lq = _liq.value?.list?.count { it.liquidatable } ?: 0
                val msg = "清算台账：$n 个地址，可清算 $lq（来源 ${_liq.value?.source}）"
                log(msg)
                android.util.Log.i("HacdsLiq", msg + " addrs=" +
                    _liq.value?.list?.joinToString { it.address.take(12) })
            }.onFailure {
                log("清算台账失败：${it.message}")
                android.util.Log.e("HacdsLiq", "失败: ${it.message}")
            }
        }
    }

    fun watchAddress(action: String, address: String) {
        val c = _cfg.value
        viewModelScope.launch {
            val ok = com.hacds.defi.net.Liquidation.watch(c.baseIndexer(), action, address, null)
            log(if (ok) "台账已${if (action == "add") "添加" else "移除"} $address" else "台账操作失败（索引器未配置）")
            refreshLiquidation()
        }
    }

    fun probeIndexer() {
        val c = _cfg.value
        viewModelScope.launch {
            val (ok, head, n) = com.hacds.defi.net.Liquidation.probe(c.baseIndexer())
            log(if (ok) "索引器在线：高度 $head，台账 $n" else "索引器未连接（需要服务端 ${c.baseIndexer()}）")
        }
    }

    // ---- 管理员探测 ----
    private val _isAdmin = MutableStateFlow(false)
    val isAdmin: StateFlow<Boolean> = _isAdmin.asStateFlow()

    fun probeAdmin() {
        val c = _cfg.value; val addr = WalletSession.address ?: return
        viewModelScope.launch {
            runCatching { _isAdmin.value = NodeApi.adminProbe(c.baseNode(), c.contract, addr) }
        }
    }

    // ---- 批量存入 / 批量赎回（D43）----
    private val _batch = MutableStateFlow<List<String>>(emptyList())
    val batchLog: StateFlow<List<String>> = _batch.asStateFlow()

    fun batchRedeem(kind: String, names: List<String>) {
        val c = _cfg.value
        val main = WalletSession.address ?: run { log("未解锁钱包"); return }
        if (!WalletSession.isUnlocked) { log("批量操作需解锁钱包"); return }
        viewModelScope.launch {
            _batch.value = emptyList()
            val isOut = kind == "out"
            var okCount = 0
            for ((i, nm) in names.withIndex()) {
                try {
                    // ⚠ D-1：#3000 已删除证书与预言机（合约 0 处读取 tx_message/blob），
                    //   不再向预言机取证，也不写 cert 临时文件。
                    //   直接 TransferHacdTo / TransferHacdFromTo 驱动钩子。
                    val mode: String; val args: List<String>
                    if (isOut) {
                        mode = "redeem-hacd"
                        args = listOf(main, "0", c.contract, main, nm)
                    } else {
                        mode = "hacd"
                        args = listOf(main, "0", c.contract, nm)
                    }
                    val b = TxBuilder.buildWithAutoFee(c.baseNode(), mode, args, WalletSession.keyHex, main, 99)
                    if (!b.ok) throw IllegalStateException(b.error)
                    val hex = b.result?.signedTxHex ?: throw IllegalStateException("未得到交易体")
                    val d = NodeApi.broadcast(c.baseNode(), hex)
                    if (d.optInt("ret", -1) == 0) {
                        okCount++
                        _batch.value = _batch.value + "[${i + 1}/${names.size}] $nm ✔ ${d.optString("hash").take(16)}…"
                    } else {
                        val tr = ContractErrors.translateNodeError(d.optString("err"))
                        _batch.value = _batch.value + "[${i + 1}/${names.size}] $nm ✘ ${tr.text}"
                    }
                } catch (e: Exception) {
                    _batch.value = _batch.value + "[${i + 1}/${names.size}] $nm ✘ ${e.message}"
                }
                kotlinx.coroutines.delay(120)   // 节流，避免瞬时并发过高
            }
            log("批量${if (isOut) "赎回" else "存入"}完成：成功 $okCount / ${names.size}")
        }
    }

    // ---- 交易翻译（D22）----
    fun translateLast() {
        val c = _cfg.value
        val hex = _lastBuilt.value?.result?.let { it.signedTxHex ?: it.unsignedTxHex } ?: return
        viewModelScope.launch {
            runCatching {
                val d = NodeApi.translate(c.baseNode(), hex)
                log("翻译：" + (d.optString("description").ifEmpty { d.toString().take(200) }))
            }.onFailure { log("翻译失败：${it.message}") }
        }
    }

    /** 导出当前私钥明文（D1，UI 层做二次确认）。 */
    /**
     * 导出当前会话私钥。
     *
     * ⚠ M-12（上线前审计）：原实现无任何闸门——`fun exportKey() = WalletSession.keyHex`，
     * 无密码、无生物识别、无二次确认，私钥直接进 Compose 状态并上屏。
     * 对比 PC 端已在 `main.js` 加了主进程原生 dialog 二次确认，Android 落后。
     *
     * 现在要求：
     *   1. 必须已解锁
     *   2. 必须显式传 `confirm = true`（UI 层必须先弹确认框）
     *   3. 导出后 60 秒自动失效（UI 应只展示一次、不缓存）
     *
     * 真正的强保护（系统认证）需要 Keystore 配合，见 M-11 的后续项。
     */
    private var lastExportAt = 0L

    fun exportKey(confirm: Boolean = false): String? {
        if (!confirm) return null
        if (!WalletSession.isUnlocked) return null
        val now = System.currentTimeMillis()
        // 60 秒内只允许一次，避免脚本反复抓取
        if (now - lastExportAt < 60_000) return null
        lastExportAt = now
        return WalletSession.keyHex
    }

    // ---- 只读查询（D16/D50）----
    private val _query = MutableStateFlow<Map<String, String>>(emptyMap())
    val queryResult: StateFlow<Map<String, String>> = _query.asStateFlow()

    fun querySingle(fn: String, params: String?) {
        val c = _cfg.value
        val caller = WalletSession.address
        viewModelScope.launch {
            runCatching {
                val v = NodeApi.call(c.baseNode(), c.contract, fn, caller, params)
                _query.value = _query.value + (fn to (v ?: "—"))
                log("查询 $fn → ${v ?: "—"}")
            }.onFailure { log("查询失败：${it.message}") }
        }
    }

    // ---- 离线工作流（D23）----
    fun buildUnsignedCall(fn: String, params: String): Built? {
        val c = _cfg.value
        val main = WalletSession.address ?: run { log("未解锁钱包（离线构建也需地址）"); return null }
        val args = listOf(main, "0", c.contract, fn, params)
        val b = TxBuilder.buildUnsigned("call", args)
        if (!b.ok) log("构建失败：${b.error}") else log("已构建未签名体")
        return b
    }

    fun signRawHex(unsignedHex: String): Built? {
        val key = WalletSession.keyHex ?: run { log("未解锁钱包"); return null }
        val b = TxBuilder.signRaw(unsignedHex, key, WalletSession.address ?: "<wallet>")
        if (!b.ok) log("签名失败：${b.error}") else log("已签名")
        return b
    }

    /** 直接广播一段 hex（离线页/扫码后热端用）。 */
    fun broadcastHex(hex: String) {
        val c = _cfg.value
        if (hex.isBlank()) { log("无可广播内容"); return }
        viewModelScope.launch {
            runCatching {
                val d = NodeApi.broadcast(c.baseNode(), hex)
                if (d.optInt("ret", -1) == 0)
                    log("✔ 已接受 hash=${d.optString("hash")}（等待打包）")
                else log("✘ 广播失败：${d.optString("_translated", d.optString("err"))}")
            }.onFailure { log("广播异常：${it.message}") }
        }
    }

    /**
     * 导出 hex 到文件（二维码不便时的兜底，D-A3）。
     *
     * ⚠ 2026-11-15 审计 M-8 / A-48：默认写**内部**存储。
     *
     *   原实现优先写 `getExternalFilesDir()` —— 那是外部存储，
     *   虽然属于 app 私有目录，但在旧版本 Android 上其他应用仍可读，
     *   而这文件里装的是**已签名交易体**（含收款地址与金额）。
     *
     *   现在默认内部存储（只有本应用可读）。开发者要用 adb 取时，
     *   传 [preferExternal]=true 显式指定。
     */
    fun saveHexFile(
        hex: String,
        prefix: String,
        preferExternal: Boolean = false,
    ): java.io.File? = runCatching {
        val dir = if (preferExternal) {
            getApplication<Application>().getExternalFilesDir(null)
                ?: getApplication<Application>().filesDir
        } else {
            getApplication<Application>().filesDir
        }
        val f = java.io.File(dir, "${prefix}_${System.currentTimeMillis()}.hex")
        f.writeText(hex)
        f
    }.getOrNull()

    /** 便捷：把 HACD 存入兑换（单颗，走 redeem-hacd 的反向 hacd 模式）。 */
    fun redeemHacd(names: List<String>) = batchRedeem("in", names)

    /** 便捷：从合约赎回 HACD。 */
    fun withdrawHacd(names: List<String>) = batchRedeem("out", names)

    // ---- HACD 点对点转账（D63）：kind 6，不碰合约、无需证书 ----
    fun hacdPointToPoint(names: List<String>, to: String) {
        val c = _cfg.value
        val main = WalletSession.address ?: run { log("未解锁钱包"); return }
        if (names.isEmpty()) { log("钻石名为空"); return }
        if (names.size > 200) { log("一笔最多 200 颗钻石"); return }
        viewModelScope.launch {
            val args = listOf(main, "0", "hacd-to", to, names.joinToString(","))
            val b = TxBuilder.buildWithAutoFee(c.baseNode(), "transfer", args, WalletSession.keyHex, main, 1)
            _lastBuilt.value = b
            if (b.ok) log("HACD 点对点转账已构建（${names.size} 颗 → $to）") else log("构建失败：${b.error}")
        }
    }

    // ---- 原子交易 combo（D24）----
    private val _combo = MutableStateFlow<List<Pair<String, Map<String, String>>>>(emptyList())
    val combo: StateFlow<List<Pair<String, Map<String, String>>>> = _combo.asStateFlow()

    fun addToCombo(op: com.hacds.defi.ui.Op, values: Map<String, String>) {
        if (op.kind != com.hacds.defi.ui.OpKind.CALL && op.kind != com.hacds.defi.ui.OpKind.TRANSFER) {
            log("该项暂不支持加入组合"); return
        }
        _combo.value = _combo.value + (op.id to values)
        log("已加入组合（${_combo.value.size} 个动作）")
    }

    fun clearCombo() { _combo.value = emptyList() }

    /** 构建原子交易（把组合里的动作翻译成引擎 combo 规格 JSON）。 */
    fun buildCombo() {
        val c = _cfg.value
        val main = WalletSession.address ?: run { log("未解锁钱包"); return }
        val items = _combo.value
        if (items.isEmpty()) { log("组合为空"); return }
        viewModelScope.launch {
            val actions = mutableListOf<JSONObject>()
            var hasCall = false
            for ((id, values) in items) {
                val op = Ops.byId(id) ?: continue
                when (op.kind) {
                    com.hacds.defi.ui.OpKind.CALL -> {
                        hasCall = true
                        // ⚠ 引擎要求 call 动作**自带 action 级 contract**（仅顶层 spec.contract 不够，
                        // 否则 panic "action[i].contract missing"）。实测确认。
                        actions.add(JSONObject().put("type", "call")
                            .put("contract", c.contract)
                            .put("fn", op.fn).put("params", Ops.callParams(op, values)))
                    }
                    com.hacds.defi.ui.OpKind.TRANSFER -> {
                        val sub = op.build?.invoke(values, main, c.contract) ?: continue
                        // sub = [main,"0",<sub-form>,...] → 转成 combo 动作规格
                        val form = sub.getOrNull(2)
                        when (form) {
                            "hac-to" -> actions.add(JSONObject().put("type", "hac-to")
                                .put("to", sub[3]).put("hac", sub[4]))
                            "hac-from-to" -> actions.add(JSONObject().put("type", "hac-from-to")
                                .put("from", sub[3]).put("to", sub[4]).put("hac", sub[5]))
                            "asset-to" -> actions.add(JSONObject().put("type", "asset-to")
                                .put("to", sub[3]).put("serial", sub[4]).put("atoms", sub[5]))
                            "asset-from-to" -> actions.add(JSONObject().put("type", "asset-from-to")
                                .put("from", sub[3]).put("to", sub[4])
                                .put("serial", sub[5]).put("atoms", sub[6]))
                        }
                    }
                    else -> {}
                }
            }
            val spec = JSONObject().put("actions", org.json.JSONArray(actions))
            if (hasCall) spec.put("contract", c.contract)
            val specFile = java.io.File(getApplication<Application>().cacheDir, "combo_${System.currentTimeMillis()}.json")
            specFile.writeText(spec.toString())
            val args = listOf(main, "0", specFile.absolutePath)
            val acts = spec.getJSONArray("actions")
            var touchesContract = hasCall
            var nAsset = 0
            for (i in 0 until acts.length()) {
                val o = acts.getJSONObject(i)
                if (o.optString("from", "") == c.contract ||
                    o.optString("to", "") == c.contract ||
                    o.optString("contract", "") == c.contract) touchesContract = true
                val ty = o.optString("type", "")
                if (ty == "asset-to" || ty == "asset-from-to" || ty == "asset-from") nAsset++
            }
            val gm = if (touchesContract) null else if (nAsset > 0) gasByteForAssetCount(nAsset) else 1
            // ⚠ 2026-11-15 审计 M-8 / A-49：spec 落盘必须用 try/finally 清理。
            //   原实现把 delete() 放在 buildWithAutoFee 之后 —— 一旦它抛异常，
            //   cache 目录里会残留含**交易参数明文**的 json 文件。
            val b = try {
                TxBuilder.buildWithAutoFee(c.baseNode(), "combo", args, WalletSession.keyHex, main, gm)
            } finally {
                specFile.delete()
            }
            _lastBuilt.value = b
            if (b.ok) log("原子交易已构建（${actions.size} 个动作）") else log("构建失败：${b.error}")
        }
    }

    // ========================================================================
    // 股权 OTC 原子交易（2026-11-18）
    // ========================================================================
    //
    // 目标：一方卖出 3001，另一方付 HAC / HACD / 任意链上资产（≤3 种），
    //       全部放进**一笔** combo 交易，要么全部成交要么全部回滚。
    //
    // 双签流程（链上规则见 protocol/src/codec/tx.rs:450）：
    //   A 构建未签名体 → A 签名（PARTIAL）→ 把 hex 发给 B
    //   → B 用「核对他人的交易体」看清内容 → B 追加签名（OK）→ 广播
    // ⚠ 交易体**没有有效期**：一旦签名交给对方，随时可能被广播，不可撤回。

    /** OTC 对价的一项（最多 3 项）。 */
    data class OtcPay(
        val on: Boolean = false,
        val kind: String = "hac",       // hac | asset | hacd
        val serial: String = "3000",
        val amount: String = "",
        val names: String = "",
    )

    /** OTC 构建器状态。 */
    data class OtcState(
        val dir: String = "sell",       // sell = 我卖股权；buy = 我买股权
        val shares: String = "",
        val counter: String = "",
        val pay: List<OtcPay> = listOf(OtcPay(on = true)),
    ) {
        /** 已勾选的对价数量（UI 用来禁用第 4 个）。 */
        val picked: Int get() = pay.count { it.on }
    }

    /** 核对结果的一行：你在付出 / 你在收到 / 其它。 */
    data class OtcLine(
        val dir: String,        // out | in | other
        val text: String,
        val toIsMe: Boolean?,   // null = 不适用；false → 必须红色警告
    )

    private val _otc = MutableStateFlow(OtcState())
    val otc: StateFlow<OtcState> = _otc.asStateFlow()

    /** 待签/已签的交易体。 */
    private val _otcTx = MutableStateFlow<String?>(null)
    val otcTx: StateFlow<String?> = _otcTx.asStateFlow()

    /** 交易核对结果（node 翻译成功时为权威结果）。 */
    private val _otcLines = MutableStateFlow<List<OtcLine>>(emptyList())
    val otcLines: StateFlow<List<OtcLine>> = _otcLines.asStateFlow()

    private val _otcVerified = MutableStateFlow(false)
    val otcVerified: StateFlow<Boolean> = _otcVerified.asStateFlow()

    /**
     * 对方发来的交易体（待我追加签名的那一份）。
     *
     * ⚠ 必须与我自己的 [_otcTx] **分开存**：两处翻译共用一个 `_otcLines`
     *   会让粘贴一份外部交易体就把自己的核对结果冲掉 —— 用户接着点
     *   「用我的私钥签名」签的还是自己那份，但屏幕上显示的是对方那份的内容。
     *   这是最典型的盲签漏洞。
     */
    private val _otcOther = MutableStateFlow<String?>(null)
    val otcOther: StateFlow<String?> = _otcOther.asStateFlow()

    private val _otcOtherLines = MutableStateFlow<List<OtcLine>>(emptyList())
    val otcOtherLines: StateFlow<List<OtcLine>> = _otcOtherLines.asStateFlow()

    private val _otcOtherVerified = MutableStateFlow(false)
    val otcOtherVerified: StateFlow<Boolean> = _otcOtherVerified.asStateFlow()

    /** 外部交易体是否已经翻译并核对过（没核对过就不许签名）。 */
    fun otcSetOther(hex: String) {
        _otcOther.value = hex.trim().ifBlank { null }
        _otcOtherLines.value = emptyList()
        _otcOtherVerified.value = false
    }

    /** 翻译一份**外部**交易体（不碰自己那份的状态）。 */
    fun otcTranslateOther(hex: String) {
        val h = hex.trim()
        if (h.isEmpty()) return
        otcSetOther(h)
        val c = _cfg.value
        viewModelScope.launch {
            val (lines, ok) = otcDecode(c.baseNode(), h)
            _otcOtherLines.value = lines
            _otcOtherVerified.value = ok
            if (!ok) log(tr_("otc_verifyFail"))
        }
    }

    /**
     * 给**对方的**交易体追加我的签名（我是接受方）。
     *
     * 前置条件：必须已经翻译并核实过 —— 否则等于盲签（审计 H-5）。
     * 签齐则直接广播；未签齐说明还有第三方签名者，提示把 hex 交回去。
     */
    fun otcSignOther() {
        val key = WalletSession.keyHex ?: run { log("未解锁钱包"); return }
        val hex = _otcOther.value ?: run { log(tr_("otc_noTx")); return }
        if (!_otcOtherVerified.value) { log(tr_("otc_unverified")); return }
        viewModelScope.launch {
            val b = TxBuilder.signRaw(hex, key, WalletSession.address ?: "<wallet>")
            val signed = b.result?.signedTxHex
            if (!b.ok || signed.isNullOrBlank()) {
                log(tr_("otc_signFail") + (b.error ?: "")); return@launch
            }
            _otcOther.value = signed
            if (TxBuilder.isPartial(b)) {
                log(tr_("otc_signedPartial"))
            } else {
                log(tr_("otc_signedFull"))
                broadcastHex(signed)
            }
            otcTranslateOther(signed)
        }
    }

    fun otcUpdate(f: (OtcState) -> OtcState) { _otc.value = f(_otc.value) }

    fun otcSetPay(i: Int, f: (OtcPay) -> OtcPay) {
        _otc.value = _otc.value.copy(
            pay = _otc.value.pay.mapIndexed { idx, p -> if (idx == i) f(p) else p }
        )
    }

    /**
     * 按当前表单拼 combo spec。
     *
     * 谁付股权、谁付对价，取决于买卖方向：
     *   sell → 股权 我→对方，对价 对方→我
     *   buy  → 股权 对方→我，对价 我→对方
     * 对价的付款方就是「不付股权的那一方」，这是原子交易的语义保证 ——
     * 两边都在同一笔里，任何一边余额不足整笔回滚。
     */
    fun otcBuildSpec(): JSONObject {
        val st = _otc.value
        val me = WalletSession.address ?: throw IllegalStateException(tr_("acct_locked"))
        val other = st.counter.trim()
        if (other.isEmpty()) throw IllegalStateException(tr_("otc_needCounter"))
        val n = st.shares.trim().toLongOrNull() ?: 0L
        if (n <= 0) throw IllegalStateException(tr_("otc_badShares"))
        if (other == me) throw IllegalStateException(tr_("otc_sameAddr"))

        val shareFrom = if (st.dir == "sell") me else other
        val shareTo   = if (st.dir == "sell") other else me
        val payFrom   = if (st.dir == "sell") other else me
        val payTo     = if (st.dir == "sell") me else other

        val actions = org.json.JSONArray().put(
            JSONObject().put("type", "asset-from-to")
                .put("from", shareFrom).put("to", shareTo)
                .put("serial", AppConfig.SHARE_SERIAL.toString()).put("atoms", n.toString())
        )

        val picks = st.pay.filter { it.on }
        if (picks.isEmpty()) throw IllegalStateException(tr_("otc_needCounterAsset"))
        if (picks.size > 3) throw IllegalStateException(tr_("otc_tooManyAssets"))

        for (p in picks) {
            when (p.kind) {
                "hac" -> {
                    val a = p.amount.trim()
                    if (a.isEmpty()) throw IllegalStateException(tr_("otc_badAmount"))
                    actions.put(JSONObject().put("type", "hac-from-to")
                        .put("from", payFrom).put("to", payTo).put("hac", a))
                }
                "hacd" -> {
                    val names = p.names.trim()
                    if (names.isEmpty()) throw IllegalStateException(tr_("otc_badHacd"))
                    actions.put(JSONObject().put("type", "hacd-from-to")
                        .put("from", payFrom).put("to", payTo).put("names", names))
                }
                else -> {
                    val a = p.amount.trim()
                    val sr = p.serial.trim().removePrefix("#")
                    if (a.isEmpty() || sr.isEmpty())
                        throw IllegalStateException(tr_("otc_badAmount"))
                    actions.put(JSONObject().put("type", "asset-from-to")
                        .put("from", payFrom).put("to", payTo)
                        .put("serial", sr).put("atoms", a))
                }
            }
        }
        // 纯转账不需要顶层 contract（只有含 call 动作才需要，见 txbuild.rs）
        return JSONObject().put("actions", actions)
    }

    /** 取词（ViewModel 里没有 Context，走 Strings.appContext）。 */
    private fun tr_(key: String, vararg args: Any?): String =
        com.hacds.defi.ui.Strings.appContext
            ?.let { com.hacds.defi.ui.Strings.t(it, key, *args) } ?: key

    /** 生成待签名交易体（不注入私钥）。 */
    fun otcBuild() {
        val main = WalletSession.address ?: run { log("未解锁钱包"); return }
        val c = _cfg.value
        val spec = try {
            otcBuildSpec()
        } catch (e: Exception) {
            log(e.message ?: "构建失败"); return
        }
        viewModelScope.launch {
            log(tr_("otc_building"))
            // gas_max 固定 99：combo 里可能含 HACD/资产多腿，默认档不够
            val b = TxBuilder.buildUnsignedCombo(
                getApplication<Application>().cacheDir, main, spec, fee = null, gasMax = 99)
            val hex = b.result?.unsignedTxHex
            if (!b.ok || hex.isNullOrBlank()) {
                log(tr_("otc_buildFail") + (b.error ?: tr_("otc_noUnsigned"))); return@launch
            }
            _otcTx.value = hex
            log(tr_("otc_built").format((hex.length / 2).toString()))
            otcTranslate(hex)
        }
    }

    /**
     * 翻译交易体为「你将付出 / 你将收到」。
     *
     * 优先用节点 `/util/transaction/check`（权威、结构化）；
     * 拿不到时**不猜** —— 直接把 verified 标成 false，UI 必须显示"未核实"警告。
     * 这是防止盲签的最后一道闸（审计 H-5）。
     */
    fun otcTranslate(hex: String) {
        val c = _cfg.value
        viewModelScope.launch {
            val (lines, ok) = otcDecode(c.baseNode(), hex)
            _otcLines.value = lines
            _otcVerified.value = ok
            if (!ok) log(tr_("otc_verifyFail"))
        }
    }

    /**
     * 调节点把交易体解成「相对我而言」的收支行。
     *
     * 返回 `(lines, ok)`；`ok=false` 表示节点没给出可用结果 ——
     * 调用方必须据此显示"未核实"，不得假定内容正确。
     */
    private suspend fun otcDecode(node: String, hex: String): Pair<List<OtcLine>, Boolean> {
        val me = WalletSession.address
        val lines = mutableListOf<OtcLine>()
        runCatching {
            val d = NodeApi.translate(node, hex)
            val arr = d.optJSONArray("actions") ?: return@runCatching
            for (i in 0 until arr.length()) {
                val item = arr.optJSONObject(i) ?: continue
                // `/util/transaction/check?description=true` 会把协议 JSON 包在
                // `{"action": {...}, "description": "..."}` 里（mint/src/api/util/tx.rs
                // action_desc_array_json）；不带 description 时则是平铺的协议对象。
                val a = item.optJSONObject("action") ?: item
                val desc = item.optString("description", "")

                // ⚠ 字段名以链上协议为准（protocol/src/codec/action/transfer.rs）：
                //   HAC  → "hacash"（不是 hac）
                //   HACD → "diamonds"（TransferHacdFromTo）/ "diamond"（SingleTo）
                //   资产 → "asset": {"serial":N,"amount":N}
                // 地址字段是 AddrOrPtr：可能是可读地址串，也可能是**指针索引数字**。
                val from = addrOrPtr(a, "from")
                val to = addrOrPtr(a, "to")
                val hac = a.optString("hacash", "")
                val sat = a.optString("satoshi", "")
                val asset = a.optJSONObject("asset")
                val names = a.optString("diamonds", a.optString("diamond", ""))

                val text = when {
                    hac.isNotEmpty() && hac != "0" -> "$hac HAC"
                    sat.isNotEmpty() && sat != "0" -> "$sat SAT"
                    asset != null -> "${asset.optString("amount")} × " +
                            tr_("otc_serialN", asset.optString("serial"))
                    names.isNotEmpty() -> tr_("otc_hacdN", names)
                    desc.isNotEmpty() -> desc
                    else -> a.optString("name", a.optString("kind", "?"))
                }

                // 方向判定：main 发起的（TransferHacTo / TransferAssetTo 无 from 字段）
                // 默认视为「我付出」——main 就是发起人，这是链上事实。
                val dir = when {
                    me.isNullOrEmpty() -> "other"
                    from == me -> "out"
                    to == me -> "in"
                    // 没有 from 字段 = 从 main 转出
                    from.isEmpty() && a.has("to") -> "out"
                    else -> "other"
                }

                // ⚠ §8.2 防钓鱼：收进来的钱，收款人必须是我。
                //   拿不到可读地址（指针形式）时只能给 null，UI 显示不出"是/不是"，
                //   但那也不能当"是"放过 —— 所以 null 时会连带 verified=false。
                val toIsMe = if (dir == "in") to == me else null
                lines.add(OtcLine(dir, text, toIsMe))
            }
        }
        // 只有在「收款地址可判定」时才算核实通过（否则防钓鱼这道闸形同虚设）
        val allResolved = lines.all { it.toIsMe != null || it.dir != "in" }
        return lines to (lines.isNotEmpty() && allResolved)
    }

    /**
     * 读 AddrOrPtr 字段。
     *
     * 协议允许用「指针索引」代替地址（省字节），JSON 里就变成一个数字。
     * 这种情况我们拿不到可读地址 —— 返回空串，由调用方把该笔标为"无法核实"，
     * **绝不能**退化成"看起来没问题"。
     */
    private fun addrOrPtr(obj: JSONObject, key: String): String {
        if (!obj.has(key)) return ""
        val v = obj.opt(key)
        // 指针形式是数字 → 无法解析成地址
        if (v is Number) return ""
        return v?.toString()?.trim().orEmpty()
    }

    /** 用我的私钥签名（未签齐 → 提示发给对方；签齐 → 直接广播）。 */
    fun otcSignMine() {
        val key = WalletSession.keyHex ?: run { log("未解锁钱包"); return }
        val hex = _otcTx.value ?: run { log(tr_("otc_noTx")); return }
        val c = _cfg.value
        viewModelScope.launch {
            val b = TxBuilder.signRaw(hex, key, WalletSession.address ?: "<wallet>")
            val signed = b.result?.signedTxHex
            if (!b.ok || signed.isNullOrBlank()) {
                log(tr_("otc_signFail") + (b.error ?: "")); return@launch
            }
            _otcTx.value = signed
            if (TxBuilder.isPartial(b)) {
                log(tr_("otc_signedPartial"))
            } else {
                log(tr_("otc_signedFull"))
                broadcastHex(signed)
            }
            otcTranslate(signed)
        }
    }
}
