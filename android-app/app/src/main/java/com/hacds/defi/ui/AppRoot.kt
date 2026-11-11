package com.hacds.defi.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hacds.defi.AppViewModel
import com.hacds.defi.ui.screens.HacdScreen
import com.hacds.defi.ui.screens.LiquidationScreen
import com.hacds.defi.ui.screens.OfflineScreen
import com.hacds.defi.ui.screens.OpTabScreen
import com.hacds.defi.ui.screens.QueryScreen
import com.hacds.defi.ui.screens.SettingsScreen
import com.hacds.defi.ui.screens.WalletScreen
import com.hacds.defi.ui.theme.HacdsTheme

/**
 * 一级页签 —— 与网页端 hacds.com 完全一致（2026-11-11 统一）。
 *
 * 网页端 7 个页签：兑换 | 流动性 | 借贷 | HACD | 转账 | 资金 | 工具
 *
 * 为什么不用底部 4 图标导航：
 *   7 个入口放在底部导航栏，手机窄屏（320–430dp）每个只有 45–60dp，
 *   图标 + 文字会挤成一团。改为**顶部横向滚动页签**，与网页端页签形态一致，
 *   点击区更大、文案完整可见。
 *
 * ⚠ 旧结构（首页/交易/HACD/设置 + 交易下 8 个二级 chip）已废弃：
 *   交易类功能不再收在一个「交易」页里，按网页端的分法平铺到一级页签。
 *   原「首页」的概览信息（池子、HACD 统计、健康度）按网页端做法分散到各业务页。
 */
private enum class Tab(val key: String, val titleKey: String) {
    Swap("swap", "tab_swap"),
    Lp("lp", "tab_lp"),
    Loan("loan", "tab_loan"),
    Hacd("hacd", "tab_hacd"),
    Xfer("xfer", "tab_xfer"),
    Fund("fund", "tab_fund"),
    Tools("tools", "tab_tools"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot() {
    HacdsTheme {
        val vm: AppViewModel = viewModel()
        // 测试/深度链接：intent extra "tab"(0..6) 直达指定页
        val act = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity
        val startTab = act?.intent?.getIntExtra("tab", 0) ?: 0
        var tab by remember { mutableIntStateOf(startTab.coerceIn(0, Tab.entries.size - 1)) }
        val session by vm.session.collectAsState()

        // 首次进入加载钱包列表 + 公开协议状态 + 清算台账
        remember { vm.refreshWallets(); vm.refreshProtocolPublic(); vm.refreshLiquidation(); true }

        Scaffold(
            topBar = {
                TopAppBar(
                    title = {
                        Text(
                            session.address?.let { "HacdsDeFi · ${it.take(10)}…" } ?: "HacdsDeFi",
                            style = MaterialTheme.typography.titleMedium,
                            fontFamily = FontFamily.Monospace,
                        )
                    },
                    actions = {
                        // 设置从一级页签移到右上角图标（与网页端顶栏做法一致）
                        IconButton(onClick = { tab = Tab.entries.indexOf(Tab.Tools) }) {
                            Icon(Icons.Filled.Settings, contentDescription = tr("tab_settings"))
                        }
                    },
                )
            },
        ) { pad ->
            Column(Modifier.padding(pad).fillMaxSize()) {
                // 顶部一级页签（可横滑）
                PrimaryTabs(tab) { tab = it }

                CenteredContent {
                    when (Tab.entries[tab]) {
                        Tab.Swap -> OpTabScreen(vm, "swap")
                        Tab.Lp -> OpTabScreen(vm, "lp")
                        Tab.Loan -> OpTabScreen(vm, "loan")
                        Tab.Hacd -> HacdScreen(vm)
                        Tab.Xfer -> OpTabScreen(vm, "xfer")
                        Tab.Fund -> OpTabScreen(vm, "fund")
                        Tab.Tools -> ToolsTab(vm)
                    }
                }
            }
        }
    }
}

/** 顶部一级页签，7 个横排可滚动。 */
@Composable
private fun PrimaryTabs(sel: Int, onSelect: (Int) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState())
            .padding(horizontal = 8.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        Tab.entries.forEachIndexed { i, t ->
            FilterChip(
                selected = sel == i,
                onClick = { onSelect(i) },
                label = { Text(tr(t.titleKey), style = MaterialTheme.typography.labelLarge, maxLines = 1) },
            )
        }
    }
}

/**
 * 工具页：续租 + 只读查询 + 清算台账 + 离线签名 + 钱包管理。
 *
 * 网页端工具页只有「续租」和「只读查询」；安卓这几项是移动端特有的
 * （离线签名、本地清算台账），仍归在工具页，不新开一级页签。
 */
@Composable
private fun ToolsTab(vm: AppViewModel) {
    val titles = listOf(
        tr("tab_query"), tr("tab_liq"), tr("tab_offline"), tr("tab_wallet"),
    )
    var idx by remember { mutableIntStateOf(0) }
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 6.dp),
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            titles.forEachIndexed { i, title ->
                FilterChip(
                    selected = idx == i,
                    onClick = { idx = i },
                    label = { Text(title, style = MaterialTheme.typography.labelSmall, maxLines = 1) },
                    modifier = Modifier.weight(1f),
                )
            }
        }
        when (idx) {
            0 -> QueryScreen(vm)
            1 -> LiquidationScreen(vm)
            2 -> OfflineScreen(vm)
            else -> WalletScreen(vm)
        }
    }
}
