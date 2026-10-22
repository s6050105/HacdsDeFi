package com.hacds.defi.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.ui.components.MonoText
import com.hacds.defi.ui.components.Notice
import com.hacds.defi.ui.components.Section
import com.hacds.defi.ui.tr

/** 钱包管理页（D2 / D30 / D32 / D1）：创建 / 导入 / 切换 / 重命名 / 删除 / 导出私钥。 */
@Composable
fun WalletScreen(vm: AppViewModel) {
    val wallets by vm.wallets.collectAsState()
    val session by vm.session.collectAsState()
    var msg by remember { mutableStateOf<String?>(null) }
    var dialog by remember { mutableStateOf<String?>(null) }   // "create" | "import" | "export"
    var label by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var importText by remember { mutableStateOf("") }
    var createdKind by remember { mutableStateOf("random") }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    var useBio by remember { mutableStateOf(false) }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Section(tr("acct.mgr"), subtitle = session.address ?: tr("acct.locked")) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = { dialog = "create"; msg = null }, modifier = Modifier.weight(1f)) {
                        Text(tr("acct.create"))
                    }
                    OutlinedButton(onClick = { dialog = "import"; msg = null }, modifier = Modifier.weight(1f)) {
                        Text(tr("acct.import"))
                    }
                }
                if (com.hacds.defi.wallet.Biometric.isAvailable(ctx)) {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(tr("x_bioOpen"), modifier = Modifier.weight(1f),
                            style = MaterialTheme.typography.bodySmall)
                        androidx.compose.material3.Switch(checked = useBio, onCheckedChange = { useBio = it })
                    }
                }
                if (session.unlocked) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { dialog = "export" }, modifier = Modifier.weight(1f)) {
                            Text(tr("acct.exportKey"))
                        }
                        OutlinedButton(onClick = { vm.lock(); msg = tr("x_lockedOk") }, modifier = Modifier.weight(1f)) {
                            Text(tr("acct.lock"))
                        }
                    }
                }
                msg?.let { Notice(it) }
            }
        }
        item { Text(tr("acct.mgr"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold) }
        items(wallets) { w ->
            Section(w.label.ifEmpty { w.address.take(16) + "…" }) {
                MonoText(w.address)
                Text("${w.kind} · ${w.created}", style = MaterialTheme.typography.labelSmall)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            // vault 型无需密码；PC 型需密码
                            val pw = if (w.kind == "pc") password else null
                            val act = ctx as? androidx.fragment.app.FragmentActivity
                            if (useBio && act != null &&
                                com.hacds.defi.wallet.Biometric.isAvailable(ctx)
                            ) {
                                com.hacds.defi.wallet.Biometric.prompt(act,
                                    onOk = {
                                        vm.openWallet(w, pw).onSuccess { msg = tr("x_switched", it) }
                                            .onFailure { msg = tr("x_openFail", it.message ?: "") }
                                    },
                                    onFail = { msg = tr("x_bioFail", it) })
                            } else {
                                vm.openWallet(w, pw).onSuccess { msg = tr("x_switched", it) }
                                    .onFailure { msg = tr("x_openFail", it.message ?: "") }
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("acct.mgr")) }
                    OutlinedButton(
                        onClick = { vm.deleteWallet(w); msg = tr("x_deleted") },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("x_delete")) }
                }
            }
        }
        if (wallets.isEmpty()) item { Notice(tr("x_noWallet")) }
    }

    // 密码输入（PC 型钱包打开时需要）——简单放一个全局输入
    if (wallets.any { it.kind == "pc" }) {
        Section(tr("acct.open")) {
            OutlinedTextField(
                value = password, onValueChange = { password = it },
                label = { Text(tr("x_pwPc")) }, modifier = Modifier.fillMaxWidth(),
                singleLine = true,
            )
        }
    }

    when (dialog) {
        "create" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(tr("acct.create")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { createdKind = "random" }) {
                            Text(if (createdKind == "random") tr("x_randKey") else tr("x_randKey"))
                        }
                        Button(onClick = { createdKind = "password" }) {
                            Text(if (createdKind == "password") tr("x_pwDerived") else tr("x_pwDerived"))
                        }
                    }
                    OutlinedTextField(value = label, onValueChange = { label = it },
                        label = { Text(if (createdKind == "password") tr("x_passphrase") else tr("x_note")) },
                        modifier = Modifier.fillMaxWidth(), singleLine = true)
                    OutlinedTextField(value = password, onValueChange = { password = it },
                        label = { Text(tr("x_pwEnc")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (createdKind == "password" && password.length < 6) { msg = tr("x_pwMin"); return@TextButton }
                    vm.createWallet(createdKind, password, label)
                        .onSuccess { msg = tr("x_created", it); dialog = null; password = ""; label = "" }
                        .onFailure { msg = tr("x_createFail", it.message ?: "") }
                }) { Text(tr("btn_ok")) }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text(tr("btn_cancel")) } },
        )
        "import" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(tr("acct.import")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = importText, onValueChange = { importText = it },
                        label = { Text(tr("x_importHint")) },
                        modifier = Modifier.fillMaxWidth(), minLines = 3)
                    OutlinedTextField(value = password, onValueChange = { password = it },
                        label = { Text(tr("x_pwKs")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                    OutlinedTextField(value = label, onValueChange = { label = it },
                        label = { Text(tr("x_note")) }, modifier = Modifier.fillMaxWidth(), singleLine = true)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    vm.importWallet(importText, password.ifEmpty { null }, label)
                        .onSuccess { msg = tr("x_imported", it); dialog = null; importText = ""; password = "" }
                        .onFailure { msg = tr("x_importFail", it.message ?: "") }
                }) { Text(tr("btn_ok")) }
            },
            dismissButton = { TextButton(onClick = { dialog = null }) { Text(tr("btn_cancel")) } },
        )
        "export" -> {
            val key = vm.exportKey()
            var confirmed by remember { mutableStateOf(false) }
            AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text("⚠ " + tr("acct.exportKey")) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Notice(tr("x_keyWarn"), error = true)
                        if (!confirmed) {
                            Button(onClick = { confirmed = true }) { Text(tr("x_showKey")) }
                        } else {
                            MonoText(key ?: "—")
                        }
                    }
                },
                confirmButton = { TextButton(onClick = { dialog = null }) { Text(tr("btn_close")) } },
            )
        }
    }
}
