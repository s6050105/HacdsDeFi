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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.ui.components.KV
import com.hacds.defi.ui.components.Notice
import com.hacds.defi.ui.components.Section
import com.hacds.defi.ui.tr

/**
 * 清算 / 结算页（D51）：① LP 奖励结算 ② 金库清扫 ③ 借贷清算台。
 * ①② 直接查合约；③ 需要链下索引器（D57）。
 */
@Composable
fun LiquidationScreen(vm: AppViewModel) {
    val liq by vm.liq.collectAsState()
    val proto by vm.protocol.collectAsState()
    var watchAddr by remember { mutableStateOf("") }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Section(tr("x_liqLp"), subtitle = tr("x_harvestHint")) {
                KV(tr("x_pendHac"), proto?.pendHac?.let { formatHac(it) } ?: "—")
                KV(tr("x_pendDs"), proto?.pendDs ?: "—")
                Button(onClick = {
                    com.hacds.defi.ui.Ops.byId("harvest")?.let { op ->
                        vm.buildOp(op, emptyMap(), null, null)
                    }
                }, modifier = Modifier.fillMaxWidth()) { Text(tr("x_genHarvest")) }
            }
        }
        item {
            Section(tr("x_liqTre"), subtitle = tr("x_treTransfer")) {
                KV(tr("x_treHac"), proto?.treHac?.let { formatHac(it) } ?: "—")
                KV(tr("x_treDs"), proto?.treDs ?: "—")
                Notice(tr("x_sweepNote", com.hacds.defi.core.AppConfig.DEFAULT_TREASURY))
            }
        }
        item {
            Section(tr("x_liqDesk"), subtitle = tr("x_needIdx")) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { vm.refreshLiquidation() }, modifier = Modifier.weight(1f)) { Text(tr("x_pullLedger")) }
                    OutlinedButton(onClick = { vm.probeIndexer() }, modifier = Modifier.weight(1f)) { Text(tr("x_probeIdx")) }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(watchAddr, { watchAddr = it },
                        label = { Text(tr("x_watchAddr")) }, modifier = Modifier.weight(1f), singleLine = true)
                    OutlinedButton(onClick = { vm.watchAddress("add", watchAddr) }) { Text(tr("x_add")) }
                    OutlinedButton(onClick = { vm.watchAddress("remove", watchAddr) }) { Text(tr("x_remove")) }
                }
                val s = liq
                if (s == null) {
                    Text(tr("x_pullHint"), style = MaterialTheme.typography.bodySmall)
                } else {
                    Notice(if (s.source == "server") tr("x_srcServer") else tr("x_idxDown", s.error ?: ""))
                    if (s.list.isEmpty()) {
                        Text(tr("x_ledgerEmpty"),
                            style = MaterialTheme.typography.bodySmall)
                    }
                    s.list.forEach { e ->
                        val tag = when {
                            e.liquidatable -> tr("x_liquidatable")
                            e.noLoan -> tr("x_noDebt")
                            else -> tr("x_safe")
                        }
                        Section(e.address.take(16) + "…", subtitle = tag) {
                            KV(tr("p_health"), e.health?.toString() ?: "—")
                            KV(tr("p_debt"), e.debt?.let { formatHac(it) } ?: "—")
                            KV(tr("p_coll"), e.coll ?: "—")
                            if (e.liquidatable) {
                                Button(onClick = {
                                    com.hacds.defi.ui.Ops.byId("liq")?.let { op ->
                                        vm.buildOp(op, mapOf("who" to e.address), null, null)
                                    }
                                }, modifier = Modifier.fillMaxWidth()) { Text(tr("x_liqThis")) }
                            }
                        }
                    }
                }
            }
        }
    }
}
