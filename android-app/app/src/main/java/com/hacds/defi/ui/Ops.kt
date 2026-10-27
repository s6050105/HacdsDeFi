package com.hacds.defi.ui

import com.hacds.defi.core.Units
import java.math.BigDecimal

/**
 * 操作目录（对齐 PC 版 `renderer/app.js` 的 OPS / ADMIN_OPS）。
 *
 * 【单位口径 D37/D55】`hacFields` 列出「以 HAC 计价」的输入字段：用户填 HAC，
 * 上链前 ×1e8 转 zhu；未列出的字段保持原量纲（hacds 侧 = atoms；share 无定标）。
 * ⚠ `swap_ds_to_hac` 的输出腿是 HAC，故其滑点保护 `min_out` 也以 HAC 计。
 */
data class Field(
    val name: String,
    val labelKey: String? = null,
    val label: String? = null,
    val type: String = "u128",
    val default: String = "",
)

enum class OpKind { CALL, TRANSFER, REDEEM_HACD, HACD_TRANSFER, TRANSFER_OTHER, OFFLINE_RAW }

data class Op(
    val id: String,
    val tab: String,
    val kind: OpKind,
    val titleKey: String,
    val descKey: String,
    val fn: String? = null,
    val fields: List<Field> = emptyList(),
    val hacFields: List<String> = emptyList(),
    val quote: String? = null,
    /** 构造引擎 argv（不含 argv[0]/mode）。[main] = 当前地址。 */
    val build: ((Map<String, String>, String, String) -> List<String>)? = null,
) {
    /** 该字段是否以 HAC 计价。 */
    fun isHacField(n: String) = hacFields.contains(n)
}

/** HAC 输入 → zhu 字符串；支持 "1:248"（单位式）与 "0.5"（小数式）。 */
fun hacInputToZhu(s: String): String? {
    val t = s.trim()
    if (t.isEmpty()) return null
    if (t.contains(':')) {
        // "a:b" = a × 10^b（Hacash 单位表示）
        val parts = t.split(':')
        val a = parts[0].toBigIntegerOrNull() ?: return null
        val b = parts[1].toIntOrNull() ?: return null
        return a.multiply(java.math.BigInteger.TEN.pow(b)).toString()
    }
    return try {
        Units.hacToZhu(BigDecimal(t)).toString()
    } catch (e: Exception) {
        null
    }
}

object Ops {

    /** 主要操作。 */
    val MAIN: List<Op> = listOf(
        // ---- 兑换 / 存取（trade）----
        // 领取 hacds 实物：把合约账面配额（due）兑现为链上流通 hacds（合约 → 我）。
        // 与 PC 端 `claim` 完全一致：asset-from-to 合约→main，serial=hacds。
        Op("claim", "trade", OpKind.TRANSFER, "op.claim.t", "op.claim.d",
            fields = listOf(Field("atoms", "f.atoms", null, "u128", "100000000")),
            build = { v, main, contract -> listOf(main, "0", "asset-from-to", contract, main, "hacds", v["atoms"] ?: "") }),
        Op("hacIn", "trade", OpKind.TRANSFER, "op.hacIn.t", "op.hacIn.d",
            fields = listOf(Field("hac", "f.hacAmt", null, "text", "1:248")),
            build = { v, main, contract -> listOf(main, "0", "hac-to", contract, v["hac"] ?: "") }),
        Op("hacOut", "trade", OpKind.TRANSFER, "op.hacOut.t", "op.hacOut.d",
            fields = listOf(Field("hac", "f.hacAmt2", null, "text", "0.5")),
            build = { v, main, contract -> listOf(main, "0", "hac-from-to", contract, main, v["hac"] ?: "") }),
        Op("redeemHacd", "trade", OpKind.REDEEM_HACD, "op.redeemHacd.t", "op.redeemHacd.d",
            fields = listOf(Field("names", "f.names"), Field("to", "f.toAddrDef", null, "address"))),

        // ---- AMM 与流动性 ----
        Op("swapH2D", "amm", OpKind.CALL, "op.swapH2D.t", "op.swapH2D.d",
            fn = "swap_hac_to_ds", hacFields = listOf("hac_in"), quote = "swap_hac_to_ds",
            fields = listOf(Field("hac_in", "f.hacInUnit", null, "u128", "1"),
                Field("min_out", "f.minOutAtoms", null, "u128", "0"))),
        Op("swapD2H", "amm", OpKind.CALL, "op.swapD2H.t", "op.swapD2H.d",
            fn = "swap_ds_to_hac", hacFields = listOf("min_out"), quote = "swap_ds_to_hac",
            fields = listOf(Field("ds_in", "f.dsInAtoms", null, "u128", "100000000"),
                Field("min_out", "f.minOutHac", null, "u128", "0"))),
        Op("addLiq", "amm", OpKind.CALL, "op.addLiq.t", "op.addLiq.d",
            fn = "add_liquidity", hacFields = listOf("hac_amt"),
            fields = listOf(Field("hac_amt", "f.hacSideUnit", null, "u128", "1"),
                Field("ds_amt", "f.dsSideAtoms", null, "u128", "0"))),
        // ⚠ #3000 合约签名：remove_liquidity(share, min_hac_out, min_ds_out, deadline)
        //   旧版只传 share，上链必报 CallArgvTypeFail（参数个数不符）。
        //   C-4：单笔会撞主网 resource 上限（6,102 > 6,100），必须由 UI 拆成
        //   「先 lp_harvest、再 remove_liquidity」两笔（见 OpsFlow.removeLiquidity）。
        Op("rmLiq", "amm", OpKind.CALL, "op.rmLiq.t", "op.rmLiq.d",
            fn = "remove_liquidity",
            fields = listOf(Field("share", "f.share", null, "u128", "1000000"),
                Field("min_hac_out", "f.minHacOut", null, "u128", "0"),
                Field("min_ds_out", "f.minDsOut", null, "u128", "0"),
                Field("deadline", "f.deadline", null, "u128", "0"))),
        Op("harvest", "amm", OpKind.CALL, "op.harvest.t", "op.harvest.d", fn = "lp_harvest"),

        // ---- 借贷 ----
        Op("coll", "loan", OpKind.CALL, "op.coll.t", "op.coll.d",
            fn = "loan_add_collateral",
            fields = listOf(Field("ds_amt", "f.dsCollAtoms", null, "u128", "100000000"))),
        Op("borrow", "loan", OpKind.CALL, "op.borrow.t", "op.borrow.d",
            fn = "loan_borrow", hacFields = listOf("hac"),
            fields = listOf(Field("hac", "f.borrowUnit", null, "u128", "0.5"))),
        Op("repay", "loan", OpKind.CALL, "op.repay.t", "op.repay.d",
            fn = "loan_repay", hacFields = listOf("hac"),
            fields = listOf(Field("hac", "f.repayUnit", null, "u128", "0.5"))),
        Op("liq", "loan", OpKind.CALL, "op.liq.t", "op.liq.d",
            fn = "loan_liquidate",
            fields = listOf(Field("who", "f.borrower", null, "address"))),

        // ---- 链上转账 ----
        Op("trH2A", "xfer", OpKind.TRANSFER, "op.trH2A.t", "op.trH2A.d",
            fields = listOf(Field("to", "f.toAddr", null, "address"),
                Field("hac", "f.hacAmt", null, "text", "1:248")),
            build = { v, main, _ -> listOf(main, "0", "hac-to", v["to"] ?: "", v["hac"] ?: "") }),
        // 【金库清扫】合约 → 金库（触发合约 PermitHAC/PermitAsset，扣 tre:）。
        // ⚠ 必须是 from-to 形态（from=合约）；"用户→金库"不会清扫。
        Op("sweepHac", "xfer", OpKind.TRANSFER, "op.sweepHac.t", "op.sweepHac.d",
            fields = listOf(Field("amount", "f.hacAmt", null, "text", "1:248")),
            build = { v, main, contract -> listOf(main, "0", "hac-from-to", contract,
                "1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK", v["amount"] ?: "") }),
        Op("sweepDs", "xfer", OpKind.TRANSFER, "op.sweepDs.t", "op.sweepDs.d",
            fields = listOf(Field("atoms", "f.atomsNum", null, "u128", "100000000")),
            build = { v, main, contract -> listOf(main, "0", "asset-from-to", contract,
                "1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK", "hacds", v["atoms"] ?: "") }),
        Op("trA2C", "xfer", OpKind.TRANSFER, "op.trA2C.t", "op.trA2C.d",
            fields = listOf(Field("atoms", "f.atomsNum", null, "u128", "100000000")),
            build = { v, main, contract -> listOf(main, "0", "asset-to", contract, "hacds", v["atoms"] ?: "") }),
        Op("trA2A", "xfer", OpKind.TRANSFER, "op.trA2A.t", "op.trA2A.d",
            fields = listOf(Field("to", "f.toAddr", null, "address"),
                Field("atoms", "f.atomsNum", null, "u128", "100000000")),
            build = { v, main, _ -> listOf(main, "0", "asset-from-to", main, v["to"] ?: "", "hacds", v["atoms"] ?: "") }),
        Op("trHacd", "xfer", OpKind.HACD_TRANSFER, "op.trHacd.t", "op.trHacd.d",
            fields = listOf(Field("names", "f.hacdNames"), Field("to", "f.toAddr", null, "address"))),
        Op("trOther", "xfer", OpKind.TRANSFER_OTHER, "op.trOther.t", "op.trOther.d",
            fields = listOf(Field("serial", "f.serialNum", null, "u128"),
                Field("to", "f.toAddr", null, "address"), Field("atoms", "f.atomsNum2", null, "u128")),
            build = { v, main, _ ->
                listOf(main, "0", "asset-from-to", main, v["to"] ?: "",
                    (v["serial"] ?: "").trim().removePrefix("#"), v["atoms"] ?: "")
            }),
    )

    /**
     * 管理员操作（D25）。
     * ⚠ **#3000 起合约完全取消管理员**（无 set_fee/set_loan_rate/set_liquidate_bonus/
     *   set_paused/set_oracle）；本组**仅对 #2000 合约有效**，#3000 下应隐藏。
     *   唯一保留的 `rent_keys` 在 #3000 是**任何人可调**（keeper 续租）。
     */
    val ADMIN: List<Op> = listOf(
        Op("set_fee", "admin", OpKind.CALL, "admin.setFee", "admin.setFeeD", fn = "set_fee",
            fields = listOf(Field("bps", null, "bps", "u128", "50"))),
        Op("set_loan_rate", "admin", OpKind.CALL, "admin.setLoanRate", "admin.setLoanRateD", fn = "set_loan_rate",
            fields = listOf(Field("bps", null, "bps", "u128", "500"))),
        Op("set_liquidate_bonus", "admin", OpKind.CALL, "admin.setBonus", "admin.setBonusD", fn = "set_liquidate_bonus",
            fields = listOf(Field("bps", null, "bps", "u128", "200"))),
        Op("set_paused", "admin", OpKind.CALL, "admin.setPaused", "admin.setPausedD", fn = "set_paused",
            fields = listOf(Field("p", null, "0 / 1", "u8", "0"))),
        Op("set_oracle", "admin", OpKind.CALL, "admin.setOracle", "admin.setOracleD", fn = "set_oracle",
            fields = listOf(Field("o", "net.oracle", null, "address"))),
        // #3000：rent_batch(管理员) → rent_keys(任何人可调)
        Op("rent_keys", "admin", OpKind.CALL, "admin.rent", "admin.rentD", fn = "rent_keys",
            fields = listOf(Field("keys", null, "keys (hex，无 0x)", "bytes"),
                Field("klen", null, "klen", "u128", "21"),
                Field("period", null, "period", "u128", "300"))),
    )

    fun byId(id: String): Op? = (MAIN + ADMIN).firstOrNull { it.id == id }

    /**
     * 组装合约调用参数串：`<值>:<类型>,...`；hacFields 先转 zhu；空则 "-"。
     * 与 PC 版 `buildCallParams` 一致。
     */
    fun callParams(op: Op, values: Map<String, String>): String {
        if (op.fields.isEmpty()) return "-"
        return op.fields.joinToString(",") { f ->
            val raw = values[f.name] ?: ""
            if (op.isHacField(f.name)) {
                val z = hacInputToZhu(raw) ?: "0"
                "$z:${f.type}"
            } else {
                "$raw:${f.type}"
            }
        }
    }
}
