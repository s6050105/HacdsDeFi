package com.hacds.defi.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.ui.Op
import com.hacds.defi.ui.OpKind
import com.hacds.defi.ui.Ops
import com.hacds.defi.ui.components.KV
import com.hacds.defi.ui.components.MonoText
import com.hacds.defi.ui.components.Notice
import com.hacds.defi.ui.components.Section
import com.hacds.defi.ui.tr

/** 按页签渲染该组操作（兑换/存取、AMM、借贷、链上转账、管理员）。 */
@Composable
fun OpTabScreen(vm: AppViewModel, tab: String, ops: List<Op> = Ops.MAIN) {
    val session by vm.session.collectAsState()
    val last by vm.lastBuilt.collectAsState()
    val batchLog by vm.batchLog.collectAsState()

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            PreviewCard(vm, last)
        }
        val group = ops.filter { it.tab == tab }
        if (group.isEmpty()) item { Notice(tr("x_noop")) }
        items(group.size) { i ->
            val op = group[i]
            OpCard(vm, op, unlocked = session.unlocked)
        }
        if (batchLog.isNotEmpty()) {
            item {
                Section(tr("x_batchResult")) { batchLog.forEach { MonoText(it, maxLines = 1) } }
            }
        }
    }
}

/** 交易预览 / 广播卡片。 */
@Composable
fun PreviewCard(vm: AppViewModel, last: com.hacds.defi.engine.TxBuilder.Built?) {
    Section(tr("ov.protocol").let { tr("x_txPreview") }) {
        if (last == null) { Text(tr("x_noTx"), style = MaterialTheme.typography.bodySmall); return@Section }
        val r = last.result
        if (!last.ok || r == null) { Notice(tr("x_buildFail2", last.error), error = true); return@Section }
        KV(tr("x_kind"), r.label)
        KV(tr("x_bytes"), r.txBytes?.toString())
        KV(tr("common_fee"), last.feeUsed ?: (if (last.feeAuto) tr("common_auto") else "—"))
        KV(tr("x_digest"), r.signDigest?.take(16) + "…")
        KV(tr("x_selfcheck"), if (r.signedCheckOk) "OK" else if (r.selfCheckOk) tr("x_unsignedOnly") else "—")
        MonoText((r.signedTxHex ?: r.unsignedTxHex ?: "").take(160) + "…")
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { vm.broadcastLast() }, modifier = Modifier.weight(1f)) { Text(tr("btn_broadcast")) }
            OutlinedButton(onClick = { vm.checkLast() }, modifier = Modifier.weight(1f)) { Text(tr("btn_check")) }
            OutlinedButton(onClick = { vm.translateLast() }, modifier = Modifier.weight(1f)) { Text(tr("btn_translate")) }
        }
    }
}

/** 单个操作卡片：动态字段 + 构建。 */
@Composable
fun OpCard(vm: AppViewModel, op: Op, unlocked: Boolean) {
    val values = remember { mutableStateMapOf<String, String>() }
    // 初始化默认值
    remember(op.id) {
        op.fields.forEach { f -> values[f.name] = f.default }
        true
    }
    var fee by remember { mutableStateOf("") }
    var gas by remember { mutableStateOf("") }

    Section(tr(op.titleKey), subtitle = tr(op.descKey)) {
        op.fields.forEach { f ->
            OutlinedTextField(
                value = values[f.name] ?: "",
                onValueChange = { values[f.name] = it },
                label = { Text(f.label ?: f.labelKey?.let { tr(it) } ?: f.name) },
                modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }
        // D62：加流动性两侧按池内比例联动；D58：借贷实时额度提示
        when (op.id) {
            "addLiq" -> LiquidityHint(vm, values, onSet = { k, v -> values[k] = v })
            "borrow", "coll" -> LoanHint(vm, op, values)
        }

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedTextField(value = fee, onValueChange = { fee = it },
                label = { Text(tr("common_fee") + tr("common_auto")) }, modifier = Modifier.weight(1f), singleLine = true)
            OutlinedTextField(value = gas, onValueChange = { gas = it },
                label = { Text("gas_max") }, modifier = Modifier.weight(1f), singleLine = true)
        }

        // HACD 点对点转账 / 存入赎回：走批量流程（D43/D63）
        when (op.kind) {
            OpKind.HACD_TRANSFER -> {
                Button(
                    onClick = {
                        val names = (values["names"] ?: "").split(Regex("[\\s,]+")).filter { it.isNotBlank() }
                        vm.hacdPointToPoint(names, values["to"] ?: "")
                    },
                    modifier = Modifier.fillMaxWidth(),
                ) { Text(tr("x_hacdP2P")) }
            }
            OpKind.REDEEM_HACD -> {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            val names = (values["names"] ?: "").split(Regex("[\\s,]+")).filter { it.isNotBlank() }
                            vm.redeemHacd(names)
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("hacd_batchIn")) }
                    OutlinedButton(
                        onClick = {
                            val names = (values["names"] ?: "").split(Regex("[\\s,]+")).filter { it.isNotBlank() }
                            vm.withdrawHacd(names)
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("hacd_batchOut")) }
                }
            }
            else -> {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { vm.buildOp(op, values.toMap(), fee.ifBlank { null }, gas.toIntOrNull()) },
                        modifier = Modifier.weight(1f),
                        enabled = unlocked,
                    ) { Text(tr("btn_genTx")) }
                    OutlinedButton(
                        onClick = { vm.addToCombo(op, values.toMap()) },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("combo_addBtn")) }
                }
                if (!unlocked) Notice(tr("acct_locked"))
            }
        }
    }
}


/**
 * D62：加流动性两侧联动。改一侧 → 按池内比例自动配平另一侧；不匹配时告警。
 * 注意取整容差（下取整必然差 1 个单位，不算不匹配）。
 */
@Composable
fun LiquidityHint(vm: AppViewModel, values: Map<String, String>, onSet: (String, String) -> Unit) {
    val proto by vm.protocol.collectAsState()
    val p = proto ?: return
    val ph = p.poolHac?.toBigIntegerOrNull() ?: return
    val pd = p.poolDs?.toBigIntegerOrNull() ?: return
    if (pd.signum() == 0 || ph.signum() == 0) {
        Notice(tr("x_poolEmptyIsq"))
        return
    }
    Notice(tr("x_poolRatio", com.hacds.defi.ui.screens.formatHac(ph.toString()), pd.toString()))
    // ratio = pd / ph（atoms per zhu）；改 hac 侧 → ds = hacZhu × pd / ph
    val hacStr = values["hac_amt"] ?: ""
    val dsStr = values["ds_amt"] ?: ""
    val hacZ = com.hacds.defi.ui.hacInputToZhu(hacStr)?.toBigIntegerOrNull()
    val dsA = dsStr.toBigIntegerOrNull()
    if (hacZ != null && hacZ.signum() > 0) {
        val expectDs = hacZ.multiply(pd).divide(ph)
        if (dsA == null || dsA.signum() == 0) {
            onSet("ds_amt", expectDs.toString())
        } else {
            val diff = (dsA - expectDs).abs()
            if (diff > java.math.BigInteger.ONE) {
                Notice(tr("x_legMismatch", expectDs.toString(), diff.toString()), error = true)
            }
        }
    }
}

/**
 * D58：借贷实时额度提示（借款前不必试错）。
 * 可借上限 = 抵押价值/2 − 债务；需抵押 = (债务+借款)×2×amm:ds/amm:hac。
 */
@Composable
fun LoanHint(vm: AppViewModel, op: Op, values: Map<String, String>) {
    val proto by vm.protocol.collectAsState()
    val p = proto ?: return
    val poolHac = p.poolHac?.toBigIntegerOrNull() ?: return
    val poolDs = p.poolDs?.toBigIntegerOrNull() ?: return
    val debt = p.debt?.toBigIntegerOrNull() ?: java.math.BigInteger.ZERO
    val coll = p.coll?.toBigIntegerOrNull() ?: java.math.BigInteger.ZERO
    if (poolDs.signum() == 0) { Notice(tr("x_poolEmptyNoVal")); return }
    // 抵押价值(zhu) = coll × amm:hac / amm:ds
    val collValue = coll.multiply(poolHac).divide(poolDs)
    val maxBorrow = collValue.divide(java.math.BigInteger.valueOf(2)).subtract(debt)
        .coerceAtLeast(java.math.BigInteger.ZERO)

    when (op.id) {
        "borrow" -> {
            val hacZ = com.hacds.defi.ui.hacInputToZhu(values["hac"] ?: "")?.toBigIntegerOrNull()
            val need = (debt + (hacZ ?: java.math.BigInteger.ZERO)).multiply(java.math.BigInteger.valueOf(2))
                .multiply(poolDs).divide(if (poolHac.signum() > 0) poolHac else java.math.BigInteger.ONE)
            KV(tr("x_curCollVal"), com.hacds.defi.core.Units.zhuToHacString(collValue) + " HAC")
            KV(tr("x_maxBorrow"), com.hacds.defi.core.Units.zhuToHacString(maxBorrow) + " HAC", hl = true)
            if (hacZ != null && hacZ.signum() > 0) {
                KV(tr("x_needColl"), "$need atoms")
                if (hacZ > maxBorrow) Notice(tr("x_overBorrow"), error = true)
                else Notice(tr("x_canBorrow"))
            }
        }
        "coll" -> {
            val add = values["ds_amt"]?.toBigIntegerOrNull() ?: java.math.BigInteger.ZERO
            val newCollValue = (coll + add).multiply(poolHac).divide(poolDs)
            val newMax = newCollValue.divide(java.math.BigInteger.valueOf(2)).subtract(debt)
                .coerceAtLeast(java.math.BigInteger.ZERO)
            KV(tr("x_valueApprox"), com.hacds.defi.core.Units.zhuToHacString(add.multiply(poolHac).divide(poolDs)) + " HAC")
            KV(tr("x_newMaxBorrow"), com.hacds.defi.core.Units.zhuToHacString(newMax) + " HAC", hl = true)
        }
    }
}
