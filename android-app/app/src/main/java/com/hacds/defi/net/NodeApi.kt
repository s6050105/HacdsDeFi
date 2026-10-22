package com.hacds.defi.net

import com.hacds.defi.core.ContractErrors
import org.json.JSONObject

/**
 * 节点 / 合约 / 预言机查询封装。端点与 PC 版 `main.js` 完全一致。
 * 所有 sandboxcall 走 [Http.sandboxGet]（并发闸门 + 退避重试，D45）。
 */
object NodeApi {

    // ---- 通用 sandboxcall ----

    /** 单次只读查询；返回 ret_val 字符串或 null（失败/未配）。 */
    suspend fun call(node: String, contract: String, fn: String, caller: String?, params: String?): String? {
        val sb = StringBuilder(node.trimEnd('/'))
            .append("/query/contract/sandboxcall?contract=").append(contract)
            .append("&function=").append(fn)
        if (!caller.isNullOrBlank()) sb.append("&caller=").append(Http.enc(caller))
        if (!params.isNullOrBlank()) sb.append("&params=").append(Http.enc(params))
        return try {
            val d = Http.sandboxGet(sb.toString())
            if (d.optInt("ret", 1) == 0) d.opt("ret_val")?.toString() else null
        } catch (e: Exception) {
            null
        }
    }

    /** 带错误信息的查询（供需要区分错误码的调用，如管理员探测）。 */
    suspend fun callRaw(node: String, contract: String, fn: String, caller: String?, params: String?): JSONObject? {
        val sb = StringBuilder(node.trimEnd('/'))
            .append("/query/contract/sandboxcall?contract=").append(contract)
            .append("&function=").append(fn)
        if (!caller.isNullOrBlank()) sb.append("&caller=").append(Http.enc(caller))
        if (!params.isNullOrBlank()) sb.append("&params=").append(Http.enc(params))
        return try {
            Http.sandboxGet(sb.toString())
        } catch (e: Exception) {
            null
        }
    }

    // ---- 链上余额 ----

    data class Balances(
        val hac: String = "0:0",
        val satoshi: Long = 0,
        val diamondCount: Int = 0,
        val diamonds: List<String> = emptyList(),
        val assets: List<JSONObject> = emptyList(),
    )

    suspend fun balance(node: String, address: String): Balances {
        val url = "${node.trimEnd('/')}/query/balance?address=$address&diamonds=true&assets=true&asset_meta=true"
        val d = Http.getJsonAsync(url)
        val b = d.optJSONArray("list")?.optJSONObject(0) ?: JSONObject()
        val diamondsStr = b.optString("diamonds", "")
        val names = if (diamondsStr.isEmpty()) emptyList() else diamondsStr.chunked(6)
        val assets = mutableListOf<JSONObject>()
        b.optJSONArray("assets")?.let { arr ->
            for (i in 0 until arr.length()) arr.optJSONObject(i)?.let { assets.add(it) }
        }
        return Balances(
            hac = b.optString("hacash", "0:0"),
            satoshi = b.optLong("satoshi", 0),
            diamondCount = b.optInt("diamond", 0),
            diamonds = names,
            assets = assets,
        )
    }

    // ---- 资产总览（D10/D17）----

    data class AssetOverview(
        val hac: String,
        val satoshi: Long,
        val diamondCount: Int,
        val diamonds: List<String>,
        val due: String?,
        val hacPoints: String?,
        val hacdsOnchain: String,
        val otherAssets: List<JSONObject>,
    )

    suspend fun assetOverview(node: String, contract: String, address: String): AssetOverview {
        val bal = balance(node, address)
        val due = call(node, contract, "balance_ds", address, "$address:address")
        val hacPts = call(node, contract, "balance_hac", address, "$address:address")
        val others = bal.assets.filter { it.optString("serial") != "2000" }
        val onchain = bal.assets.firstOrNull { it.optString("serial") == "2000" }?.optString("amount", "0") ?: "0"
        return AssetOverview(
            hac = bal.hac, satoshi = bal.satoshi, diamondCount = bal.diamondCount,
            diamonds = bal.diamonds, due = due, hacPoints = hacPts,
            hacdsOnchain = onchain, otherAssets = others,
        )
    }

    // ---- 协议状态总览（D19）----

    data class ProtocolOverview(
        val poolHac: String?, val poolDs: String?, val poolPrice: String?, val lpTotal: String?,
        val myLp: String?, val pendHac: String?, val pendDs: String?,
        val stakedHac: String?, val stakedDs: String?, val treHac: String?, val treDs: String?,
        val debt: String?, val coll: String?, val health: String?,
    )

    suspend fun protocolOverview(node: String, contract: String, address: String): ProtocolOverview {
        val c = address.ifBlank { contract }
        return ProtocolOverview(
            poolHac = call(node, contract, "amm_reserves", c, null),
            poolDs = call(node, contract, "amm_reserve_ds", c, null),
            poolPrice = call(node, contract, "pool_price", c, null),
            lpTotal = call(node, contract, "lp_total", c, null),
            myLp = call(node, contract, "lp_share_of", c, "$address:address"),
            pendHac = call(node, contract, "lp_pending_hac", c, "$address:address"),
            pendDs = call(node, contract, "lp_pending_ds", c, "$address:address"),
            stakedHac = call(node, contract, "total_staked", c, "0:u128"),
            stakedDs = call(node, contract, "total_staked", c, "1:u128"),
            treHac = call(node, contract, "treasury_pending", c, "0:u128"),
            treDs = call(node, contract, "treasury_pending", c, "1:u128"),
            debt = call(node, contract, "loan_debt_of", c, "$address:address"),
            coll = call(node, contract, "loan_coll_of", c, "$address:address"),
            health = call(node, contract, "loan_status", c, "$address:address"),
        )
    }

    // ---- HACD 详情（图样 gene 等）----

    suspend fun hacdDetails(node: String, names: List<String>): List<JSONObject> {
        val out = mutableListOf<JSONObject>()
        for (chunk in names.chunked(10)) {
            for (nm in chunk) {
                try {
                    val d = Http.getJsonAsync("${node.trimEnd('/')}/query/diamond?name=$nm")
                    if (d.optString("name").isNotEmpty()) out.add(d)
                } catch (e: Exception) { /* 跳过 */ }
            }
        }
        return out
    }

    // ---- 管理员探测（D25）----

    suspend fun adminProbe(node: String, contract: String, address: String): Boolean {
        val d = callRaw(node, contract, "set_paused", address, "0:u8") ?: return false
        if (d.optInt("ret", 1) != 0) return false
        return d.opt("ret_val")?.toString() == "0"
    }

    // ---- 金库待清扫额 ----

    suspend fun treasuryPending(node: String, contract: String, caller: String?): Pair<String?, String?> {
        val c = caller ?: contract
        val hac = call(node, contract, "treasury_pending", c, "0:u128")
        val ds = call(node, contract, "treasury_pending", c, "1:u128")
        return hac to ds
    }

    // ---- 节点费率（自动估算用，D7）----

    suspend fun minPurity(node: String): Long? {
        if (node.isBlank()) return null
        return try {
            val d = Http.getJsonAsync("${node.trimEnd('/')}/query/fee/average")
            when {
                d.has("purity") -> d.optLong("purity", 0)
                d.has("min_fee_purity") -> d.optLong("min_fee_purity", 0)
                else -> null
            }?.takeIf { it > 0 }
        } catch (e: Exception) {
            null
        }
    }

    // ---- 广播 / 校验 / 翻译 ----

    suspend fun broadcast(node: String, hex: String): JSONObject {
        val d = Http.postAsync("${node.trimEnd('/')}/submit/transaction?hexbody=true", hex)
        if (d.has("ret") && d.optInt("ret") != 0) {
            val tr = ContractErrors.translateNodeError(d.optString("err", "ret=${d.optInt("ret")}"))
            d.put("_translated", tr.text).put("_hint", tr.hint)
        }
        return d
    }

    suspend fun check(node: String, hex: String): JSONObject =
        Http.postAsync("${node.trimEnd('/')}/util/transaction/check?hexbody=true", hex)

    suspend fun translate(node: String, hex: String): JSONObject =
        Http.postAsync(
            "${node.trimEnd('/')}/util/transaction/check?hexbody=true&description=true&action=true&body=true", hex)

    // ---- 预言机证书 ----

    suspend fun cert(oracle: String, name: String): JSONObject =
        Http.getJsonAsync("${oracle.trimEnd('/')}/cert?name=$name")
}
