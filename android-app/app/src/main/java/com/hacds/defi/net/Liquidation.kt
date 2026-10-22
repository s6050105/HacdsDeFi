package com.hacds.defi.net

import com.hacds.defi.core.Sha3
import org.json.JSONObject

/**
 * 清算模块（D51 / D57）：**服务端索引器优先**，不在手机扫链。
 *
 * 合约无法枚举借款人（键按地址拼、无日志、节点无前缀枚举接口），所以需要索引器
 * 遍历区块收集「调用过借贷函数的地址」；实测手机扫链耗流量/电量且慢，
 * 故首选服务端 `GET /watchlist`，App 只发一次请求。
 */
object Liquidation {

    data class Entry(
        val address: String,
        val health: Int?,
        val debt: String?,
        val coll: String?,
        val liquidatable: Boolean,
        val noLoan: Boolean,
        val note: String?,
    )

    data class Snapshot(val list: List<Entry>, val source: String, val head: Long?, val error: String?)

    /** 服务端索引器健康检查。 */
    suspend fun probe(indexer: String): Triple<Boolean, Long?, Int?> {
        if (indexer.isBlank()) return Triple(false, null, null)
        return try {
            val d = Http.getJsonAsync(indexer.trimEnd('/') + "/health")
            Triple(d.optBoolean("ok", false), d.optLong("head", 0), d.optInt("watched", 0))
        } catch (e: Exception) {
            Triple(false, null, null)
        }
    }

    /** 拉台账快照（服务端优先；失败回退本地直查合约）。 */
    suspend fun snapshot(node: String, contract: String, indexer: String): Snapshot {
        // 1) 服务端 /watchlist（D57 唯一入口）
        if (indexer.isNotBlank()) {
            try {
                val d = Http.getJsonAsync(indexer.trimEnd('/') + "/watchlist")
                if (d.optInt("ret", 1) == 0) {
                    val arr = d.optJSONArray("snapshot") ?: d.optJSONArray("list")
                    return Snapshot(parseList(arr), "server", d.optLong("head", 0), null)
                }
            } catch (e: Exception) { /* 回退 */ }
        }
        // 2) 回退：本地手工台账为空 → 直接查当前地址
        return Snapshot(emptyList(), "none", null, "未连接索引器（服务端未配置或不可达）")
    }

    private fun parseList(arr: org.json.JSONArray?): List<Entry> {
        if (arr == null) return emptyList()
        val out = mutableListOf<Entry>()
        for (i in 0 until arr.length()) {
            val o = arr.optJSONObject(i) ?: continue
            val h = if (o.isNull("health")) null else o.optInt("health")
            val debt = o.opt("debt")?.toString()
            val hasDebt = (debt?.toBigIntegerOrNull() ?: java.math.BigInteger.ZERO).signum() > 0
            out.add(
                Entry(
                    address = o.optString("address"),
                    health = h,
                    debt = debt,
                    coll = o.opt("coll")?.toString(),
                    // 可清算 ⟺ debt > 0 && 0 < health < 200（PC §0.4）
                    liquidatable = hasDebt && h != null && h > 0 && h < 200,
                    noLoan = !hasDebt,
                    note = o.optString("note").ifEmpty { null },
                )
            )
        }
        return out.sortedWith(
            compareByDescending<Entry> { it.liquidatable }.thenBy { it.health ?: Int.MAX_VALUE }
        )
    }

    /** 手工增删观察地址（走服务端，保持台账唯一）。 */
    suspend fun watch(indexer: String, action: String, address: String, note: String?): Boolean {
        if (indexer.isBlank()) return false
        return try {
            val u = indexer.trimEnd('/') + "/watch/" + (if (action == "add") "add" else "remove") +
                    "?address=${Http.enc(address)}" + (note?.let { "&note=" + Http.enc(it) } ?: "")
            val d = Http.getJsonAsync(u)
            d.optInt("ret", 1) == 0
        } catch (e: Exception) {
            false
        }
    }

    /** 借贷相关函数 selector（本地扫链兜底时用；服务端模式下不需要）。 */
    val LOAN_FNS = listOf(
        "loan_borrow", "loan_repay", "loan_liquidate",
        "loan_add_collateral", "loan_status", "loan_debt_of", "loan_coll_of",
    )
    fun loanSelectors(): Map<String, String> =
        LOAN_FNS.associateWith { Sha3.fnSelectorHex(it) }
}
