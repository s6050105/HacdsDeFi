package com.hacds.defi.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.core.Units
import com.hacds.defi.ui.tr
import com.hacds.defi.ui.theme.VaultGold
import com.hacds.defi.ui.theme.VaultGoldBd
import com.hacds.defi.ui.theme.VaultGoldBg
import com.hacds.defi.ui.theme.VaultGoldSoft
import java.math.BigInteger

/**
 * 金库分红卡片（合约 B / 股权 3001）。
 *
 * 为什么不做独立页签：底部/顶部一级导航已有 7 项，手机窄屏再加会挤。
 * 按设计文档 §7.2 的结论，放在「资金」页顶部的一张卡片里。
 *
 * 显示条件（§6.3）：**钱包持有 3001 > 0 或 已质押 > 0**。
 * 只看钱包余额的话，用户把份额全质押后卡片会凭空消失 —— 那笔钱就"看不见"了。
 *
 * 三块内容严格按设计文档 §5：
 *   ① 我的权益：钱包持有 / 已质押 / 未质押，未质押 > 0 时给醒目提示
 *   ② 分红：待结算 / 待提现 / 总计可提取 + 「领取并提现」
 *   ③ 全局：累计分红 / 续租储备 / 每份累计
 *
 * ⚠ §4.1 的语义坑：claim 之后 `get_claimable` **数值不变**（增量转成了 due）。
 *   所以这一栏必须叫「总计可提取」而不是「可领取」，否则用户点完 claim 看数字没变
 *   会以为功能坏了。
 */
@Composable
fun VaultCard(vm: AppViewModel, unlocked: Boolean) {
    val st by vm.vault.collectAsState()
    val d = st ?: return          // 未探测到 / 合约校验失败 → 整块不显示（§9①②）
    if (d.hold <= 0 && d.staked <= 0) return

    var dialog by remember { mutableStateOf<String?>(null) }
    var amount by remember { mutableStateOf("") }
    val unstaked = (d.hold - d.staked).coerceAtLeast(0L)

    VaultSection(tr("vault_title")) {
        // ---- 数据过期提示（§9 网络失败）----
        if (d.stale) {
            Text(
                tr("vault_staleData"),
                style = MaterialTheme.typography.bodySmall,
                color = VaultGold,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0x1FF7AF34), RoundedCornerShape(8.dp))
                    .padding(8.dp),
            )
        }

        // ---- ① 我的权益 ----
        Text(
            tr("vault_holdings"),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            color = VaultGoldSoft,
        )
        VaultKV(tr("vault_walletHolds"), fmtShares(d.hold), VaultGoldSoft)
        VaultKV(tr("vault_staked"), fmtShares(d.staked), VaultGold)
        VaultKV(
            tr("vault_unstaked"), fmtShares(unstaked),
            if (unstaked > 0) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
        )

        // ---- 未质押提示（§5.1）----
        if (unstaked > 0) {
            Text(
                tr("vault_warnUnstaked", fmtShares(unstaked)),
                style = MaterialTheme.typography.bodySmall,
                color = VaultGoldSoft,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(VaultGoldBg, RoundedCornerShape(8.dp))
                    .padding(8.dp),
            )
            GoldButton(tr("vault_stakeNow"), enabled = unlocked) {
                amount = unstaked.toString(); dialog = "stake"
            }
        }

        HorizontalDivider(thickness = 1.dp, color = VaultGoldBd)

        // ---- ② 分红 ----
        Text(
            tr("vault_dividend"),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            color = VaultGold,
        )
        if (d.staked <= 0) {
            // §5.2 首次进入：置灰 + 引导
            Text(
                tr("vault_emptyStake"),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        } else {
            VaultKV(tr("vault_pendingSettle"), "${fmtHac(d.pending)} HAC")
            VaultKV(tr("vault_pendingWithdraw"), "${fmtHac(d.due)} HAC")
            HorizontalDivider(thickness = 1.dp, color = VaultGoldBd)
            // ⚠ §4.1：必须叫「总计可提取」而不是「可领取」——
            //   claim 之后 get_claimable 数值不变（增量转成了 due）。
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(tr("vault_totalClaimable"), style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(
                    "${fmtHac(d.claimable)} HAC",
                    style = MaterialTheme.typography.titleMedium.copy(fontFamily = FontFamily.Monospace),
                    fontWeight = FontWeight.Bold,
                    color = VaultGold,
                )
            }
            GoldButton(
                tr("vault_claimAndWithdraw"),
                enabled = unlocked && d.claimable > 0,
            ) { dialog = "claim" }
        }

        // ---- ③ 全局 ----
        Text(
            tr("vault_global"),
            style = MaterialTheme.typography.titleSmall,
            fontWeight = FontWeight.Bold,
            color = VaultGold,
            modifier = Modifier.padding(top = 4.dp),
        )
        VaultKV(tr("vault_totalDividend"), "${fmtHac(d.totdiv)} HAC")
        VaultKV(tr("vault_rentReserve"), "${fmtHac(d.reserve)} HAC")
        // 每份累计 = rpu / 1e12（rpu 是 ×1e12 的定点数）
        VaultKV(tr("vault_perShare"), fmtPerShare(d.rpu))

        // ---- 操作区 ----
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            GoldButton(tr("vault_stake"), enabled = unlocked, modifier = Modifier.weight(1f)) {
                amount = (if (unstaked > 0) unstaked else d.hold).toString(); dialog = "stake"
            }
            OutlinedButton(
                onClick = { amount = d.staked.toString(); dialog = "unstake" },
                modifier = Modifier.weight(1f),
                enabled = unlocked && d.staked > 0,
            ) { Text(tr("vault_unstake")) }
            OutlinedButton(
                onClick = { vm.vaultRefreshNow() },
                modifier = Modifier.weight(1f),
            ) { Text(tr("vault_refresh")) }
        }
        if (!unlocked) Notice(tr("acct_locked"))
    }

    // ---- 对话框 ----
    when (dialog) {
        "stake", "unstake" -> {
            val isStake = dialog == "stake"
            AlertDialog(
                onDismissRequest = { dialog = null },
                title = { Text(if (isStake) tr("vault_stakeTitle") else tr("vault_unstakeTitle")) },
                text = {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedTextField(
                            value = amount,
                            onValueChange = { amount = it.filter { c -> c.isDigit() } },
                            label = {
                                Text(if (isStake) tr("vault_stakeAmount") else tr("vault_unstakeAmount"))
                            },
                            supportingText = if (isStake) ({ Text(tr("vault_stakeMax")) }) else null,
                            singleLine = true,
                            modifier = Modifier.fillMaxWidth(),
                        )
                        // §4.2 必须讲清楚「质押是转账，份额会离开钱包」
                        if (isStake) {
                            Text(
                                tr("vault_stakeConfirm", amount.ifBlank { "0" }),
                                style = MaterialTheme.typography.bodySmall,
                                color = VaultGoldSoft,
                            )
                        }
                    }
                },
                confirmButton = {
                    TextButton(onClick = {
                        val n = amount.trim().toLongOrNull() ?: 0L
                        dialog = null
                        if (n <= 0) { vm.log(tr("vault_badAmount")); return@TextButton }
                        if (isStake) {
                            if (n > d.hold) { vm.log(tr("vault_exceedHold")); return@TextButton }
                            vm.vaultStake(n)
                        } else {
                            if (n > d.staked) { vm.log(tr("vault_exceedStaked")); return@TextButton }
                            vm.vaultUnstake(n)
                        }
                    }) { Text(tr("btn_ok")) }
                },
                dismissButton = {
                    TextButton(onClick = { dialog = null }) { Text(tr("btn_cancel")) }
                },
            )
        }
        "claim" -> AlertDialog(
            onDismissRequest = { dialog = null },
            title = { Text(tr("vault_claimAndWithdraw")) },
            text = { Text(tr("vault_claimConfirm", fmtHac(d.claimable))) },
            confirmButton = {
                TextButton(onClick = {
                    dialog = null
                    vm.vaultClaimAndWithdraw(d.claimable)
                }) { Text(tr("btn_ok")) }
            },
            dismissButton = {
                TextButton(onClick = { dialog = null }) { Text(tr("btn_cancel")) }
            },
        )
    }
}

/** 金库专用卡片容器（金色描边 + 金色底，设计文档 §13.4）。 */
@Composable
private fun VaultSection(
    title: String,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = Modifier.fillMaxWidth().padding(vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = VaultGoldBg),
        shape = RoundedCornerShape(12.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, VaultGoldBd),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold, color = VaultGold)
            content()
        }
    }
}

/** 金库键值行（金额用等宽数字，避免刷新时跳动）。 */
@Composable
private fun VaultKV(k: String, v: String, color: Color = Color.Unspecified) {
    Row(
        Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(k, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            v,
            style = MaterialTheme.typography.bodyMedium.copy(fontFamily = FontFamily.Monospace),
            fontWeight = FontWeight.SemiBold,
            color = if (color == Color.Unspecified) MaterialTheme.colorScheme.onSurface else color,
        )
    }
}

/** 金色按钮（质押 / 领取这类正向资金动作）。 */
@Composable
private fun GoldButton(
    label: String,
    enabled: Boolean,
    modifier: Modifier = Modifier,
    onClick: () -> Unit,
) {
    Button(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().height(40.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = VaultGold,
            contentColor = Color(0xFF2A1E05),
            disabledContainerColor = Color(0x33E8C76A),
            disabledContentColor = Color(0x88FFFFFF),
        ),
        shape = RoundedCornerShape(8.dp),
    ) {
        Text(label, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

// ---- 数值格式化 ----

/** 份数（整数，带千分位）。 */
private fun fmtShares(n: Long): String {
    val s = n.toString()
    val sb = StringBuilder()
    for ((i, c) in s.withIndex()) {
        if (i > 0 && (s.length - i) % 3 == 0) sb.append(',')
        sb.append(c)
    }
    return sb.toString()
}

/** zhu → HAC（8 位小数）。 */
private fun fmtHac(zhu: Long): String =
    Units.zhuToHacString(BigInteger.valueOf(zhu))

/**
 * 每份累计（HAC/份）。
 *
 * 推导（务必按这个来，少除一次或多次都是错的）：
 *   合约里结算用的是 `mul_div(shares, rpu_delta, RPU_SCALE)`，
 *   即 **增量(zhu) = 份额 × rpu_delta / 1e12**。
 *   反过来，每份的增量(zhu) = rpu_delta / 1e12；而 zhu → HAC 还要再除 1e8。
 *   所以 **每份 HAC = rpu / 1e20**。
 *
 *   举个实测过的数：240 HAC 分给 25 份 → rpu = 9.6e20 → 9.6 HAC/份，对得上。
 *
 * ⚠ 只除 1e12 得到的是 **zhu**，把它当 HAC 显示会大 1 亿倍。
 */
private fun fmtPerShare(rpu: String): String {
    val v = rpu.toBigIntegerOrNull() ?: BigInteger.ZERO
    if (v.signum() == 0) return "0"
    // 用 BigDecimal 保留小数，整数除法会把小额分红截成 0
    val hac = java.math.BigDecimal(v).movePointLeft(20)
    return hac.stripTrailingZeros().toPlainString()
}
