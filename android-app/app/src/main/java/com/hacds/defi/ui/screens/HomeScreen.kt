package com.hacds.defi.ui.screens

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.core.Units
import com.hacds.defi.ui.components.AssetRow
import com.hacds.defi.ui.components.KV
import com.hacds.defi.ui.components.Notice
import com.hacds.defi.ui.components.Section
import com.hacds.defi.ui.theme.BrandGold
import com.hacds.defi.ui.tr
import java.math.BigDecimal
import java.math.BigInteger
import java.math.RoundingMode

/** 首页：资产总览（D10/D17）+ 借贷状态常驻卡（D61）+ 协议状态（D19）。 */
@Composable
fun HomeScreen(vm: AppViewModel) {
    val assets by vm.assets.collectAsState()
    val proto by vm.protocol.collectAsState()
    val session by vm.session.collectAsState()
    val addr = session.address

    LazyColumn(
        modifier = Modifier.fillMaxSize().padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item {
            Section(tr("ov.assets"), subtitle = addr ?: tr("acct.locked")) {
                if (addr == null) {
                    Notice(tr("acct.locked"))
                } else {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { vm.refreshAssets() }, modifier = Modifier.weight(1f)) {
                            Text(tr("acct.refresh"))
                        }
                        OutlinedButton(onClick = { vm.refreshProtocol() }, modifier = Modifier.weight(1f)) {
                            Text(tr("ov.protocol"))
                        }
                    }
                    val a = assets
                    if (a == null) {
                        Text(tr("ov.loading"), style = MaterialTheme.typography.bodySmall)
                    } else {
                        AssetRow("HAC", tr("ov_hac"), formatHac(a.hac))
                        AssetRow("HACD", tr("ov_hacd"), tr("x_nDiamonds", a.diamondCount))
                        // 预期 hacds：Σ评分 × SCORE_SCALE(1e8)
                        // decimal=0 但分数按 1 分 = 1e8 定标：
                        //   存 1 分钻石 → 铸 100,000,000 个 hacds
                        AssetRow("HACDS", tr("ov_expect"),
                            a.expectedHacds?.toString() ?: tr("ov.loadHacdCalc"))
                        AssetRow("HACDS", tr("ov_due"), a.due ?: "—")
                        AssetRow("HACDS", tr("ov_onchain"), a.hacdsOnchain)
                        AssetRow("HAC", tr("ov_hacPoints"), a.hacPoints ?: "—")
                        AssetRow("SAT", tr("ov_sat"), a.satoshi.toString())
                        // decimal=0 说明：hacds 的 1 个最小单位就是 1 个 hacds，
                        // 分数按 1 分 = 1e8 定标，用户会看到很大的数字，需解释
                        Text(
                            tr("x_decimalNote"),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp),
                        )
                        if (a.otherAssets.isNotEmpty()) {
                            Text(tr("ov_others"),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                            a.otherAssets.forEach { o ->
                                val serial = o.optString("serial")
                                AssetRow(serial, "#$serial", o.optString("amount", "0"))
                            }
                        }
                        if (a.expectedHacds == null && a.diamonds.isNotEmpty()) {
                            Button(onClick = { vm.loadHacdDetails() }, modifier = Modifier.fillMaxWidth()) {
                                Text(tr("ov.loadHacd"))
                            }
                        }
                    }
                }
            }
        }

        // 借贷状态常驻卡（D61）
        item { LoanStatusCard(proto, vm) }

        // 协议状态（D19）
        item {
            Section(tr("ov.protocol")) {
                val p = proto
                if (p == null) Text(tr("ov.loading"), style = MaterialTheme.typography.bodySmall)
                else {
                    KV(tr("p.poolHac"), formatHac(p.poolHac))
                    KV(tr("p.poolDs"), p.poolDs ?: "—")
                    KV(tr("p.price"), formatPrice(p.poolPrice))
                    KV(tr("p.lpTotal"), p.lpTotal ?: "—")
                    KV(tr("p.myLp"), p.myLp ?: "—")
                    KV(tr("p.pendHac"), formatHac(p.pendHac))
                    KV(tr("p.pendDs"), p.pendDs ?: "—")
                    KV(tr("p.stakedHac"), formatHac(p.stakedHac))
                    KV(tr("p.stakedDs"), p.stakedDs ?: "—")
                    KV(tr("p.treHac"), formatHac(p.treHac))
                    KV(tr("p.treDs"), p.treDs ?: "—")
                }
            }
        }
    }
}

/** 借贷状态常驻卡（D61）：债务/抵押/抵押价值/抵押率/可借上限/清算状态。 */
@Composable
fun LoanStatusCard(proto: com.hacds.defi.net.NodeApi.ProtocolOverview?, vm: AppViewModel) {
    Section(
        tr("ov.loan"),
        subtitle = tr("loan.ltvTag"),
    ) {
        val p = proto
        if (p == null) {
            Text(tr("ov.loading"), style = MaterialTheme.typography.bodySmall)
            return@Section
        }
        val debt = p.debt?.toBigIntegerOrNull() ?: BigInteger.ZERO
        val coll = p.coll?.toBigIntegerOrNull() ?: BigInteger.ZERO
        val poolHac = p.poolHac?.toBigIntegerOrNull() ?: BigInteger.ZERO
        val poolDs = p.poolDs?.toBigIntegerOrNull() ?: BigInteger.ZERO
        val health = p.health?.toIntOrNull()

        // 抵押价值（zhu）= coll × amm:hac / amm:ds
        val collValueZhu: BigInteger = if (poolDs.signum() > 0)
            coll.multiply(poolHac).divide(poolDs) else BigInteger.ZERO
        // 可借上限 = 抵押价值 / 2 − 债务
        // 注意：BigInteger.TWO 是 API 33 才有的字段，minSdk 24 必须用 valueOf(2)
        val maxBorrow = collValueZhu.divide(BigInteger.valueOf(2)).subtract(debt).coerceAtLeast(BigInteger.ZERO)
        // 抵押率 = coll_hac × 100 / debt；debt=0 → 哨兵 999
        val rate: Int? = if (debt.signum() == 0) null
        else if (health == 999) 999 else health

        KV(tr("p.debt"), formatHac(p.debt))
        KV(tr("p.coll"), p.coll ?: "—")
        KV(tr("p.collValue"), Units.zhuToHacString(collValueZhu) + " HAC")
        KV(tr("p.rate"), rate?.let { if (it == 999) "—" else "$it%" } ?: "—")
        KV(tr("p.maxBorrow"), Units.zhuToHacString(maxBorrow) + " HAC", hl = true)

        val state = when {
            debt.signum() == 0 -> tr("x_safeNoDebt")
            health != null && health > 0 && health < 200 -> tr("x_liquidatable")
            else -> tr("x_safe")
        }
        Text(state, color = if (state.contains("⚠")) MaterialTheme.colorScheme.error else BrandGold,
            fontWeight = FontWeight.Bold, style = MaterialTheme.typography.bodyMedium)
    }
}

/** zhu（"hac:zhu" 或裸数字）→ HAC 字符串。 */
fun formatHac(v: String?): String {
    if (v.isNullOrBlank()) return "—"
    return try {
        val zhu = if (v.contains(':')) {
            val (h, z) = v.split(":")
            BigInteger(h).multiply(BigInteger.valueOf(100_000_000L))
                .add(BigInteger(z.ifEmpty { "0" }))
        } else v.toBigInteger()
        Units.zhuToHacString(zhu)
    } catch (e: Exception) {
        v
    }
}

/**
 * 池价显示。
 *
 * 合约 `pool_price()` 返回 **zhu per hacds**（无额外缩放）：
 *   pool_price = amm:hac(zhu) / amm:ds(个数)
 *
 * 界面上要 HAC/hacds，所以 ÷1e8。
 * ⚠ 不要与 `amm:ref` 混用：ref 是 zhu/hacds × 1e8，需要 ÷1e16 才是 HAC/hacds。
 *    Contracts 里另有 `ref_price_zhu_per_ds()` 直接给 zhu/hacds，优先用它。
 */
fun formatPrice(v: String?): String {
    if (v.isNullOrBlank()) return "—"
    return try {
        // zhu → HAC：÷1e8，保留 8 位小数（价格可能很小，如 0.00001 HAC/hacds）
        BigDecimal(v).divide(BigDecimal(100_000_000L), 8, RoundingMode.DOWN)
            .stripTrailingZeros().toPlainString() + " HAC/hacds"
    } catch (e: Exception) {
        v
    }
}
