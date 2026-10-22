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
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.core.AppConfig
import com.hacds.defi.ui.Ops
import com.hacds.defi.ui.components.KV
import com.hacds.defi.ui.components.MonoText
import com.hacds.defi.ui.components.Notice
import com.hacds.defi.ui.components.Section
import com.hacds.defi.ui.tr

/** 只读查询页（D16/D50）——11 个整句查询按钮。 */
@Composable
fun QueryScreen(vm: AppViewModel) {
    val proto by vm.protocol.collectAsState()
    val session by vm.session.collectAsState()
    var who by remember { mutableStateOf("") }
    val results = remember { mutableStateMapOf<String, String>() }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Section(tr("tab_query")) {
                OutlinedTextField(value = who, onValueChange = { who = it },
                    label = { Text(tr("q_fieldWho").ifEmpty { tr("x_whoHint") }) },
                    modifier = Modifier.fillMaxWidth(), singleLine = true)
                Notice(tr("x_sandboxNote"))
            }
        }
        item {
            Section(tr("ov_protocol")) {
                val p = proto
                if (p == null) Text(tr("x_protoHint"), style = MaterialTheme.typography.bodySmall)
                else {
                    KV(tr("p_price"), p.poolPrice)
                    KV(tr("p_poolHac"), p.poolHac)
                    KV(tr("p_poolDs"), p.poolDs)
                    KV(tr("p_health"), p.health)
                    KV(tr("p_debt"), p.debt)
                    KV(tr("p_coll"), p.coll)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        vm.querySingle("pool_price", null)
                    }, modifier = Modifier.weight(1f)) { Text(tr("qb_price")) }
                    Button(onClick = {
                        vm.querySingle("amm_reserves", null)
                    }, modifier = Modifier.weight(1f)) { Text(tr("qb_poolHac")) }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        vm.querySingle("balance_hac", (who.ifBlank { session.address ?: "" }) + ":address")
                    }, modifier = Modifier.weight(1f)) { Text(tr("qb_hac")) }
                    Button(onClick = {
                        vm.querySingle("balance_ds", (who.ifBlank { session.address ?: "" }) + ":address")
                    }, modifier = Modifier.weight(1f)) { Text(tr("qb_due")) }
                    Button(onClick = {
                        vm.querySingle("loan_status", (who.ifBlank { session.address ?: "" }) + ":address")
                    }, modifier = Modifier.weight(1f)) { Text(tr("qb_health")) }
                }
                results.forEach { (k, v) -> KV(k, v, mono = true) }
            }
        }
    }
}

/** 离线签名页（D23/D33）：构建未签名体 / 对 hex 签名 / 分片二维码（冷端）/ 扫码拼回（热端）。 */
@Composable
fun OfflineScreen(vm: AppViewModel) {
    var unsigned by remember { mutableStateOf("") }
    var signed by remember { mutableStateOf("") }
    var fn by remember { mutableStateOf("swap_hac_to_ds") }
    var params by remember { mutableStateOf("-") }
    val session by vm.session.collectAsState()

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Section(tr("tab_offline")) {
                Notice(tr("x_coldNote"))
                OutlinedTextField(value = fn, onValueChange = { fn = it },
                    label = { Text(tr("x_fnName")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(value = params, onValueChange = { params = it },
                    label = { Text(tr("x_params")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                Button(onClick = {
                    val b = vm.buildUnsignedCall(fn, params)
                    unsigned = b?.result?.let { it.unsignedTxHex ?: it.signedTxHex } ?: (b?.error ?: "")
                    signed = ""
                }, modifier = Modifier.fillMaxWidth()) { Text(tr("x_buildUnsigned")) }
                if (unsigned.isNotEmpty()) {
                    MonoText(unsigned, maxLines = 6)
                    Button(onClick = {
                        val b = vm.signRawHex(unsigned)
                        signed = b?.result?.signedTxHex ?: (b?.error ?: "")
                    }, modifier = Modifier.fillMaxWidth(), enabled = session.unlocked) {
                        Text(tr("x_signNow"))
                    }
                    if (!session.unlocked) Notice(tr("acct_locked"))
                }
                if (signed.isNotEmpty()) {
                    KV(tr("x_signed"), tr("x_nBytes", signed.length / 2))
                    MonoText(signed, maxLines = 4)
                    // 分片二维码（D-A3）：冷端把 signed hex 出码，热端逐张扫码拼回
                    com.hacds.defi.qr.ShardQrView(signed)
                    Button(onClick = { vm.broadcastHex(signed) },
                        modifier = Modifier.fillMaxWidth()) {
                        Text(tr("x_broadcastNow"))
                    }
                    Button(onClick = {
                        val f = vm.saveHexFile(signed, "signed")
                        if (f != null) vm.log(tr("x_saved", f.absolutePath))
                    }, modifier = Modifier.fillMaxWidth()) { Text(tr("x_exportHex")) }
                }
            }
        }
        // 热端：扫码拼回并广播（D-A3 的分片扫描端）
        item {
            Section(tr("x_scanRecv"), subtitle = tr("x_scanNote")) {
                val scanned = remember { androidx.compose.runtime.mutableStateListOf<com.hacds.defi.qr.Shards.Shard>() }
                val launcher = androidx.activity.compose.rememberLauncherForActivityResult(
                    com.journeyapps.barcodescanner.ScanContract(),
                ) { result ->
                    val text = result.contents
                    if (text != null) {
                        val sh = com.hacds.defi.qr.Shards.parse(text)
                        if (sh == null) {
                            vm.log(tr("x_notShard"))
                        } else {
                            scanned.removeAll { it.seq == sh.seq && it.total == sh.total }
                            scanned.add(sh)
                            vm.log(tr("x_scannedSeq", sh.seq, sh.total))
                        }
                    }
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        launcher.launch(com.journeyapps.barcodescanner.ScanOptions().apply {
                            setDesiredBarcodeFormats(com.journeyapps.barcodescanner.ScanOptions.QR_CODE)
                            setPrompt(tr("x_aimQr"))
                            setBeepEnabled(false)
                            setOrientationLocked(false)
                        })
                    }, modifier = Modifier.weight(1f)) { Text(tr("x_scanOne")) }
                    OutlinedButton(onClick = { scanned.clear() }, modifier = Modifier.weight(1f)) { Text(tr("x_clear")) }
                }
                Text(tr("x_scannedN", scanned.size), style = MaterialTheme.typography.labelMedium)
                if (scanned.isNotEmpty()) {
                    when (val a = com.hacds.defi.qr.Shards.assemble(scanned.toList())) {
                        is com.hacds.defi.qr.Shards.Assemble.Need ->
                            Notice(tr("x_missingN", a.missing.joinToString(",")))
                        is com.hacds.defi.qr.Shards.Assemble.Invalid ->
                            Notice(a.reason, error = true)
                        is com.hacds.defi.qr.Shards.Assemble.Ok -> {
                            Notice(tr("x_assembled", a.hex.length / 2))
                            Button(onClick = { vm.broadcastHex(a.hex) }, modifier = Modifier.fillMaxWidth()) {
                                Text(tr("x_broadcastTx"))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 管理员页（D25）：仅探测到管理员时可用。 */
@Composable
fun AdminScreen(vm: AppViewModel) {
    val isAdmin by vm.isAdmin.collectAsState()
    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Section(tr("admin_title")) {
                if (!isAdmin) {
                    Notice(tr("x_notAdmin"))
                    Button(onClick = { vm.probeAdmin() }, modifier = Modifier.fillMaxWidth()) { Text(tr("x_probeAdmin")) }
                } else {
                    Notice(tr("admin_desc").replace("%1\$s", vm.session.value.address ?: ""))
                    Notice(tr("admin_noReadback"))
                }
            }
        }
        if (isAdmin) {
            items(Ops.ADMIN.size) { i ->
                OpCard(vm, Ops.ADMIN[i], unlocked = true)
            }
        }
    }
}

/** 设置 / 配置页（网络项可留空 → 冷端模式，D-A5）。钱包管理也在这里（设置类功能）。 */
@Composable
fun SettingsScreen(vm: AppViewModel) {
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val cfg by vm.cfg.collectAsState()
    var node by remember { mutableStateOf(cfg.node) }
    var oracle by remember { mutableStateOf(cfg.oracle) }
    var contract by remember { mutableStateOf(cfg.contract) }
    var indexer by remember { mutableStateOf(cfg.indexer) }
    var lang by remember { mutableStateOf(cfg.lang) }
    val log by vm.log.collectAsState()
    val session by vm.session.collectAsState()
    var msg by remember { mutableStateOf<String?>(null) }
    // 设置页内的子页：null=设置首页；"wallet"=钱包管理
    var subPage by remember { mutableStateOf<String?>(null) }

    if (subPage == "wallet") {
        androidx.compose.foundation.layout.Column(Modifier.fillMaxSize()) {
            androidx.compose.material3.OutlinedButton(
                onClick = { subPage = null },
                modifier = Modifier.fillMaxWidth().padding(12.dp),
            ) { Text("← " + tr("tab_settings")) }
            WalletScreen(vm)
        }
        return
    }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        // 钱包管理入口
        item {
            Section(tr("acct_mgr"), subtitle = session.address ?: tr("acct_locked")) {
                Button(onClick = { subPage = "wallet" }, modifier = Modifier.fillMaxWidth()) {
                    Text(tr("acct_mgr"))
                }
            }
        }
        // 语言（放在靠上位置：无需滚动即可切换）
        item {
            Section(tr("x_langTitle")) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("zh-CN" to "中文", "en" to "English", "tr" to "Türkçe").forEach { (k, label) ->
                        OutlinedButton(onClick = {
                            lang = k
                            vm.saveConfig(AppConfig(node, oracle, contract, indexer, k))
                            // 自实现语言切换：写偏好 + 改进程 Resources + 重建 Activity
                            com.hacds.defi.ui.LocaleHelper.switchAndRecreate(ctx, k)
                        }, modifier = Modifier.weight(1f)) {
                            Text(if (lang == k) "● $label" else label, style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                Notice(tr("x_langInstant"))
            }
        }
        item {
            Section(tr("net.save").let { tr("x_netCfg") }) {
                OutlinedTextField(node, { node = it }, label = { Text(tr("net_node")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(oracle, { oracle = it }, label = { Text(tr("net_oracle")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(contract, { contract = it }, label = { Text(tr("net_contract")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                OutlinedTextField(indexer, { indexer = it }, label = { Text(tr("net_indexer")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                Button(onClick = {
                    vm.saveConfig(AppConfig(node, oracle, contract, indexer, lang))
                    msg = tr("x_cfgSaved")
                }, modifier = Modifier.fillMaxWidth()) { Text(tr("net_save")) }
                msg?.let { Notice(it) }
            }
        }
        item {
            Section(tr("log_title"), subtitle = tr("log_clear")) {
                OutlinedButton(onClick = { vm.clearLog() }, modifier = Modifier.fillMaxWidth()) { Text(tr("log_clear")) }
                log.takeLast(40).forEach { MonoText(it, maxLines = 2) }
            }
        }
    }
}
