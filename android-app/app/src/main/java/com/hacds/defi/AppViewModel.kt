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
        require(password.length >= 6) { "密码至少 6 位" }
        val secret = if (kind == "password") {
            require(label.isNotEmpty()) { "口令钱包需要填写口令" }
            Keystore.secretFromPassword(label)
        } else Keystore.newSecret()
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

    fun openWallet(w: WalletStore.WalletInfo, password: String?): Result<String> = runCatching {
        val secret = walletStore.open(w, password)
        WalletSession.unlock(w.address, Keystore.hex(secret), w.label)
        w.address
    }

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
                // 预期 hacds = Σ评分 × 1e8（D13 单位：Σ评分 = 个数）
                val expected = sum.multiply(BigInteger.valueOf(100_000_000L))
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
                    expectedHacds = sum.multiply(BigInteger.valueOf(100_000_000L)),
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

    // ---- 交易构建 ----
    private val _lastBuilt = MutableStateFlow<Built?>(null)
    val lastBuilt: StateFlow<Built?> = _lastBuilt.asStateFlow()

    /** 构建某个操作（已解锁 → 直接签名；未解锁 → 构建未签名体，用于离线/预览）。 */
    fun buildOp(op: com.hacds.defi.ui.Op, values: Map<String, String>, fee: String?, gasMax: Int?) {
        val c = _cfg.value
        val main = WalletSession.address
        if (main == null) { log("未解锁钱包"); return }
        viewModelScope.launch {
            val args = when (op.kind) {
                com.hacds.defi.ui.OpKind.CALL -> {
                    val params = Ops.callParams(op, values)
                    listOf(main, "0", c.contract, op.fn ?: "", params)
                }
                else -> op.build?.invoke(values, main, c.contract)
                    ?: listOf(main, "0", "hac-to", values["to"] ?: "", values["hac"] ?: "")
            }
            val mode = if (op.kind == com.hacds.defi.ui.OpKind.CALL) "call" else "transfer"
            val key = if (WalletSession.isUnlocked) WalletSession.keyHex else null
            val b = if (fee.isNullOrBlank() && key != null) {
                TxBuilder.buildWithAutoFee(c.baseNode(), mode, args, key, WalletSession.address ?: "<wallet>", gasMax)
            } else {
                TxBuilder.buildWithFee(mode, args, key, WalletSession.address ?: "<wallet>", fee, gasMax)
            }
            _lastBuilt.value = b
            if (b.ok) log("已构建：${b.result?.label ?: mode}（${b.result?.txBytes ?: 0} 字节，fee ${b.feeUsed ?: "-"}）")
            else log("构建失败：${b.error}")
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
                if (ret == 0) log("✔ 已接受 hash=${d.optString("hash")}（仅进入 mempool，需等待打包）")
                else log("✘ 广播失败：${d.optString("_translated", d.optString("err"))}")
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
                    val cert = NodeApi.cert(c.baseOracle(), nm)
                    val cm = cert.optString("cert_message_hex")
                    val sg = cert.optString("sign_hex")
                    if (cm.length != 58) throw IllegalStateException("$nm 证书消息应 29B")
                    if (sg.length != 194) throw IllegalStateException("$nm 签名应 97B")
                    val certFile = java.io.File(getApplication<Application>().cacheDir, "cert_$nm.hex")
                    certFile.writeText(cm + sg)
                    val mode: String; val args: List<String>
                    if (isOut) {
                        mode = "redeem-hacd"
                        args = listOf(main, "0", c.contract, main, nm, certFile.absolutePath)
                    } else {
                        mode = "hacd"
                        args = listOf(main, "0", c.contract, nm, certFile.absolutePath)
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
                    certFile.delete()
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
    fun exportKey(): String? = WalletSession.keyHex

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

    /** 导出 hex 到文件（二维码不便时的兜底，D-A3）。同时写一份到外部 files 供 adb 取。 */
    fun saveHexFile(hex: String, prefix: String): java.io.File? = runCatching {
        val f = java.io.File(getApplication<Application>().getExternalFilesDir(null)
            ?: getApplication<Application>().filesDir, "${prefix}_${System.currentTimeMillis()}.hex")
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
            val b = TxBuilder.buildWithAutoFee(c.baseNode(), "transfer", args, WalletSession.keyHex, main)
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
            val b = TxBuilder.buildWithAutoFee(c.baseNode(), "combo", args, WalletSession.keyHex, main)
            specFile.delete()
            _lastBuilt.value = b
            if (b.ok) log("原子交易已构建（${actions.size} 个动作）") else log("构建失败：${b.error}")
        }
    }
}
