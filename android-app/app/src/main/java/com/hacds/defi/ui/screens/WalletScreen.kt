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
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
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
    // 2026-11-15 审计 B-3：createdKind 已删 —— 创建钱包只剩「随机私钥」一种方式。
    val ctx = androidx.compose.ui.platform.LocalContext.current
    // M-11 P0：生物识别开关改为**持久化 + 默认开启**。
    // 原实现 `remember { mutableStateOf(false) }` 默认关且重启复位，
    // 等于默认不设防。现在首次安装即开启，用户可手动关。
    var useBio by remember { mutableStateOf(com.hacds.defi.wallet.Biometric.isEnabled(ctx)) }

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
                        androidx.compose.material3.Switch(
                            checked = useBio,
                            onCheckedChange = {
                                useBio = it
                                com.hacds.defi.wallet.Biometric.setEnabled(ctx, it)  // 持久化
                            })
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
                            val sealed = vm.vaultSealedOf(w)

                            // ⚠ 2026-11-15 审计 H-11：vault 型钱包**必须**先过
                            //   生物识别拿到被解锁的 Cipher，才能解密。
                            //   原来 useBio=false 时会直接 openWallet —— 那等于
                            //   完全跳过认证。现在没有 Cipher 就开不了。
                            if (sealed != null) {
                                if (act == null) {
                                    msg = tr("x_openFail", "需要生物识别界面")
                                } else {
                                    val cipher = try {
                                        com.hacds.defi.wallet.AndroidKeyVault
                                            .prepareDecrypt(sealed)
                                    } catch (e: Exception) {
                                        msg = tr("x_openFail", e.message ?: "")
                                        null
                                    }
                                    if (cipher != null) {
                                        com.hacds.defi.wallet.Biometric.prompt(act,
                                            cipher = cipher,
                                            onOk = { unlocked ->
                                                if (unlocked == null) {
                                                    msg = tr("x_openFail", "认证未返回 Cipher")
                                                } else {
                                                    vm.openWallet(w, pw, unlocked)
                                                        .onSuccess { msg = tr("x_switched", it) }
                                                        .onFailure { msg = tr("x_openFail", it.message ?: "") }
                                                }
                                            },
                                            onFail = { msg = tr("x_bioFail", it) })
                                    }
                                }
                            } else {
                                // PC 型（scrypt + 口令）不需要硬件认证
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
                // M-13：密码必须掩码显示（原实现明文，肩窥/录屏即泄露）
                visualTransformation = PasswordVisualTransformation(),
            )
        }
    }

    when (dialog) {
        "create" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(tr("acct.create")) },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    // ⚠ 2026-11-15 审计 B-3：删掉了「口令派生」按钮。
                    //   原界面让用户在「随机私钥」和「口令当私钥」之间二选一，
                    //   后者是 sha2_256(口令)，可离线枚举盗币，已彻底移除。
                    //   现在**只有一种创建方式**：私钥随机生成，口令只用于加密文件。
                    Text(tr("x_createRandOnly"), style = MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(value = label, onValueChange = { label = it },
                        label = { Text(tr("x_note")) },
                        modifier = Modifier.fillMaxWidth(), singleLine = true)
                    OutlinedTextField(value = password, onValueChange = { password = it },
                        label = { Text(tr("x_pwEnc")) }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                        // M-13：掩码显示
                        visualTransformation = PasswordVisualTransformation())
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    // 口令现在只是加密口令，至少 12 位（审计 B-3 的强度下限）
                    if (password.length < 12) { msg = tr("x_pwMin"); return@TextButton }
                    vm.createWallet("random", password, label)
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
                    // 导入 keystore 用的口令 —— 明文显示会让旁人/录屏直接看到
                    // 解密钱包的钥匙（2026-11-12 审计 C-M2）。
                    OutlinedTextField(value = password, onValueChange = { password = it },
                        label = { Text(tr("x_pwKs")) }, modifier = Modifier.fillMaxWidth(), singleLine = true,
                        visualTransformation = PasswordVisualTransformation())
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
            // M-12：确认后才真正取私钥（原实现一进对话框就取，私钥已进 Compose 状态）
            var confirmed by remember { mutableStateOf(false) }
            val key = if (confirmed) vm.exportKey(confirm = true) else null
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
