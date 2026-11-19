package com.hacds.defi.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.FilterChip
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.core.AppConfig
import com.hacds.defi.ui.components.MonoText
import com.hacds.defi.ui.components.Notice
import com.hacds.defi.ui.components.Section
import com.hacds.defi.ui.tr
import com.hacds.defi.ui.theme.Red
import com.hacds.defi.ui.theme.Green

/**
 * 股权 OTC 原子交易页（2026-11-18）。
 *
 * 为什么必须做成「构建 → 核对 → 双签」三步而不是一键成交：
 *   Hacash 的 Type-3 交易要求签名数恰好等于签名者数（广播时），
 *   而两方资产在同一笔里，谁都看不到对方会付什么 —— 所以只能：
 *     A 构建 + 签 → 把 hex 发给 B → B **用翻译器看清内容** → B 签名 → 广播
 *   ⚠ 交易体没有有效期（设计文档 §13.4）。签名交出去就等于授权，
 *     随时可能被广播且无法撤回，UI 必须把这句话放在最显眼的位置。
 *
 * 三块内容对齐设计文档 §6：
 *   ① 构建器（发起方）
 *   ② 交易核对（你将付出 / 你将收到 + 收款地址是否是我）
 *   ③ 核对他人的交易体（粘贴 hex → 翻译）
 */
@Composable
fun OtcScreen(vm: AppViewModel, unlocked: Boolean) {
    val st by vm.otc.collectAsState()
    val tx by vm.otcTx.collectAsState()
    val lines by vm.otcLines.collectAsState()
    val verified by vm.otcVerified.collectAsState()
    val otherTx by vm.otcOther.collectAsState()
    val otherLines by vm.otcOtherLines.collectAsState()
    val otherVerified by vm.otcOtherVerified.collectAsState()
    val clip = LocalClipboardManager.current
    var otherHex by remember { mutableStateOf("") }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {

        // ---- 风险警告（永远在最上面）----
        item {
            Text(
                tr("otc_noExpiryWarn"),
                style = MaterialTheme.typography.bodySmall,
                color = Color(0xFFFFE08A),
                modifier = Modifier.fillMaxWidth()
                    .background(Color(0xFF3A2E12), RoundedCornerShape(8.dp))
                    .padding(10.dp),
            )
        }

        // ---- ① 构建器 ----
        item {
            Section(tr("otc_builder"), subtitle = tr("otc_builderDesc")) {
                // 方向
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(
                        selected = st.dir == "sell",
                        onClick = { vm.otcUpdate { it.copy(dir = "sell") } },
                        label = { Text(tr("otc_dirSell"), maxLines = 1) },
                        modifier = Modifier.weight(1f),
                    )
                    FilterChip(
                        selected = st.dir == "buy",
                        onClick = { vm.otcUpdate { it.copy(dir = "buy") } },
                        label = { Text(tr("otc_dirBuy"), maxLines = 1) },
                        modifier = Modifier.weight(1f),
                    )
                }

                OutlinedTextField(
                    value = st.shares,
                    onValueChange = { v -> vm.otcUpdate { it.copy(shares = v.filter { c -> c.isDigit() }) } },
                    label = { Text(tr("otc_shares")) },
                    supportingText = { Text(tr("otc_sharesHint", AppConfig.SHARE_SERIAL.toString())) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                OutlinedTextField(
                    value = st.counter,
                    onValueChange = { v -> vm.otcUpdate { it.copy(counter = v.trim()) } },
                    label = { Text(tr("otc_counter")) },
                    supportingText = { Text(tr("otc_counterHint")) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )

                // 对价（最多 3 种，选中第 4 个自动禁用）
                Text(tr("otc_paySide"), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                st.pay.forEachIndexed { i, p ->
                    PayRow(
                        vm = vm, index = i, p = p,
                        canEnable = p.on || st.picked < 3,
                    )
                }

                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = { vm.otcBuild() },
                        modifier = Modifier.weight(1f),
                        enabled = unlocked,
                    ) { Text(tr("otc_build"), maxLines = 1) }
                    OutlinedButton(
                        onClick = { vm.otcSignMine() },
                        modifier = Modifier.weight(1f),
                        enabled = unlocked && tx != null,
                    ) { Text(tr("otc_signMine"), maxLines = 1) }
                }
                if (!unlocked) Notice(tr("acct_locked"))
            }
        }

        // ---- ② 交易核对 ----
        item {
            Section(tr("otc_preview")) {
                if (tx == null) {
                    Text(tr("otc_noTx"), style = MaterialTheme.typography.bodySmall)
                } else {
                    if (lines.isEmpty()) {
                        Text(tr("otc_noActions"), style = MaterialTheme.typography.bodySmall)
                    }
                    lines.forEach { l ->
                        OtcLineRow(l)
                    }
                    // ⚠ 未核实必须显式警告，不能静默
                    if (!verified) {
                        Notice(tr("otc_unverified"), error = true)
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(
                            onClick = {
                                clip.setText(AnnotatedString(tx ?: ""))
                                vm.log(tr("otc_copied"))
                            },
                            modifier = Modifier.weight(1f),
                        ) { Text(tr("otc_copy"), maxLines = 1) }
                        OutlinedButton(
                            onClick = { vm.otcTranslate(tx ?: "") },
                            modifier = Modifier.weight(1f),
                        ) { Text(tr("otc_verifyBtn"), maxLines = 1) }
                    }
                    MonoText((tx ?: "").take(200) + "…", maxLines = 3)
                }
            }
        }

        // ---- ③ 核对他人的交易体 ----
        item {
            Section(tr("otc_verifyOther"), subtitle = tr("otc_verifyDesc")) {
                OutlinedTextField(
                    value = otherHex,
                    onValueChange = { otherHex = it.trim() },
                    label = { Text(tr("otc_pasteHex")) },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 6,
                )
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        onClick = {
                            if (otherHex.isNotBlank()) {
                                vm.log(tr("otc_verifying"))
                                // ⚠ 翻译外部交易体走**独立**存储，不覆盖自己那份的核对结果
                                vm.otcTranslateOther(otherHex)
                            }
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("otc_verifyBtn"), maxLines = 1) }
                    OutlinedButton(
                        onClick = { otherHex = clip.getText()?.text ?: "" },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("otc_paste"), maxLines = 1) }
                    OutlinedButton(
                        onClick = {
                            otherHex = ""
                            vm.otcSetOther("")
                        },
                        modifier = Modifier.weight(1f),
                    ) { Text(tr("otc_clear"), maxLines = 1) }
                }

                // 外部交易体的核对结果
                if (otherTx != null) {
                    if (otherLines.isEmpty()) {
                        Text(tr("otc_noActions"), style = MaterialTheme.typography.bodySmall)
                    }
                    otherLines.forEach { OtcLineRow(it) }
                    if (!otherVerified) Notice(tr("otc_unverified"), error = true)
                }

                Notice(tr("otc_verifyHint"))

                // ⚠ 追加签名必须建立在"已核实"之上 —— 否则就是盲签
                Button(
                    onClick = { vm.otcSignOther() },
                    modifier = Modifier.fillMaxWidth(),
                    enabled = unlocked && otherTx != null && otherVerified,
                ) { Text(tr("otc_signThis"), maxLines = 1) }
                if (otherTx != null && !otherVerified) {
                    Notice(tr("otc_mustVerifyFirst"), error = true)
                }
            }
        }
    }
}

/** 对价的一行：勾选 + 类型 + 参数。 */
@Composable
private fun PayRow(
    vm: AppViewModel,
    index: Int,
    p: AppViewModel.OtcPay,
    canEnable: Boolean,
) {
    Column(
        Modifier.fillMaxWidth()
            .background(
                if (p.on) Color(0x1F4A9EFF) else Color.Transparent,
                RoundedCornerShape(8.dp),
            )
            .padding(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Checkbox(
                checked = p.on,
                onCheckedChange = { c ->
                    if (!c || canEnable) vm.otcSetPay(index) { it.copy(on = c) }
                },
                enabled = canEnable,
            )
            FilterChip(
                selected = p.kind == "hac",
                onClick = { vm.otcSetPay(index) { it.copy(kind = "hac") } },
                label = { Text(tr("otc_kindHac"), maxLines = 1) },
            )
            FilterChip(
                selected = p.kind == "asset",
                onClick = { vm.otcSetPay(index) { it.copy(kind = "asset") } },
                label = { Text(tr("otc_kindAsset"), maxLines = 1) },
            )
            FilterChip(
                selected = p.kind == "hacd",
                onClick = { vm.otcSetPay(index) { it.copy(kind = "hacd") } },
                label = { Text(tr("otc_kindHacd"), maxLines = 1) },
            )
        }

        if (p.on) {
            when (p.kind) {
                "hacd" -> OutlinedTextField(
                    value = p.names,
                    onValueChange = { v -> vm.otcSetPay(index) { it.copy(names = v) } },
                    label = { Text(tr("otc_hacdHint")) },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
                "asset" -> Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    OutlinedTextField(
                        value = p.serial,
                        onValueChange = { v ->
                            vm.otcSetPay(index) { it.copy(serial = v.filter { c -> c.isDigit() }) }
                        },
                        label = { Text("serial") },
                        singleLine = true,
                        modifier = Modifier.weight(1f),
                    )
                    OutlinedTextField(
                        value = p.amount,
                        onValueChange = { v ->
                            vm.otcSetPay(index) { it.copy(amount = v.filter { c -> c.isDigit() }) }
                        },
                        label = { Text(tr("otc_amountHint")) },
                        singleLine = true,
                        modifier = Modifier.weight(1.4f),
                    )
                }
                else -> OutlinedTextField(
                    value = p.amount,
                    onValueChange = { v -> vm.otcSetPay(index) { it.copy(amount = v.trim()) } },
                    label = { Text(tr("otc_amountHint")) },
                    supportingText = { Text("HAC（支持 1:248 或小数）") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }
    }
}

/** 核对结果的一行：付出（红）/ 收到（绿）/ 其它（灰），收款人非我时高亮警告。 */
@Composable
private fun OtcLineRow(l: AppViewModel.OtcLine) {
    val (tag, color) = when (l.dir) {
        "out" -> tr("otc_youPay") to Red
        "in" -> tr("otc_youGet") to Green
        else -> tr("otc_other") to MaterialTheme.colorScheme.onSurfaceVariant
    }
    Card(
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant),
        shape = RoundedCornerShape(8.dp),
        modifier = Modifier.fillMaxWidth(),
    ) {
        Column(Modifier.padding(10.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(tag, style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold, color = color)
            Text(l.text, style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace))
            // §8.2 防钓鱼：这是整个流程里最关键的一行
            when (l.toIsMe) {
                true -> Text("✓ " + tr("otc_toIsYou"),
                    style = MaterialTheme.typography.labelSmall, color = Green)
                false -> Text("⚠ " + tr("otc_toNotYou"),
                    style = MaterialTheme.typography.labelSmall, color = Red,
                    fontWeight = FontWeight.Bold)
                else -> {}
            }
        }
    }
}
