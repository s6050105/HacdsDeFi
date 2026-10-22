package com.hacds.defi.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.FilterChip
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccountBalanceWallet
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.lifecycle.viewmodel.compose.viewModel
import com.hacds.defi.AppViewModel
import com.hacds.defi.ui.screens.AdminScreen
import com.hacds.defi.ui.screens.HacdScreen
import com.hacds.defi.ui.screens.HomeScreen
import com.hacds.defi.ui.screens.LiquidationScreen
import com.hacds.defi.ui.screens.OfflineScreen
import com.hacds.defi.ui.screens.OpTabScreen
import com.hacds.defi.ui.screens.QueryScreen
import com.hacds.defi.ui.screens.SettingsScreen
import com.hacds.defi.ui.screens.WalletScreen
import com.hacds.defi.ui.screens.formatHac
import com.hacds.defi.ui.theme.HacdsTheme

/** 首页底部导航四页（4.1）。 */
private enum class Tab(val titleKey: String) {
    Home("tab_home"),
    Trade("tab_trade"),
    Favorites("tab_hacd"),
    Settings("net_save"),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppRoot() {
    HacdsTheme {
        val vm: AppViewModel = viewModel()
        // 测试/深度链接：intent extra "tab"(0..3) 与 "sub"(0..8)，便于自动化直达指定页
        val act = androidx.compose.ui.platform.LocalContext.current as? android.app.Activity
        val startTab = act?.intent?.getIntExtra("tab", 0) ?: 0
        val startSub = act?.intent?.getIntExtra("sub", 0) ?: 0
        var tab by remember { mutableIntStateOf(startTab.coerceIn(0, 3)) }
        val session by vm.session.collectAsState()

        // 首次进入加载钱包列表 + 公开协议状态 + 清算台账（服务端索引器）
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
                )
            },
            bottomBar = {
                NavigationBar {
                    Tab.entries.forEachIndexed { i, t ->
                        NavigationBarItem(
                            selected = tab == i,
                            onClick = { tab = i },
                            icon = {
                                Icon(
                                    when (t) {
                                        Tab.Home -> Icons.Filled.Home
                                        Tab.Trade -> Icons.Filled.SwapHoriz
                                        Tab.Favorites -> Icons.Filled.AccountBalanceWallet
                                        Tab.Settings -> Icons.Filled.Settings
                                    },
                                    contentDescription = null,
                                )
                            },
                            label = {
                                Text(
                                    when (t) {
                                        Tab.Home -> tr("tab_home")
                                        Tab.Trade -> tr("tab_trade")
                                        Tab.Favorites -> tr("tab_hacd")
                                        Tab.Settings -> tr("tab_settings")
                                    }
                                )
                            },
                        )
                    }
                }
            },
        ) { pad ->
            androidx.compose.foundation.layout.Box(Modifier.padding(pad)) {
                CenteredContent {
                    when (Tab.entries[tab]) {
                        Tab.Home -> HomeScreen(vm)
                        Tab.Trade -> TradeTabs(vm, startSub)
                        Tab.Favorites -> HacdScreen(vm)
                        Tab.Settings -> SettingsScreen(vm)
                    }
                }
            }
        }
    }
}

/**
 * 交易页内部二级导航。
 *
 * 页签较多（9 个），窄屏下用 `ScrollableTabRow` 需横滑才能到达末尾、且点击区偏窄。
 * 改为**两行等宽网格**：一屏可见全部入口，点击区大且位置稳定（不再依赖滑动）。
 */
@Composable
private fun TradeTabs(vm: AppViewModel, startSub: Int = 0) {
    // 页签标题走 i18n（D28/D36/D47）；键复用 PC 版词条
    // 注：钱包管理已移到「设置」页（属设置类功能，不在交易流里）
    val titles = listOf(
        tr("tab_trade"), tr("tab_amm"), tr("tab_loan"), tr("tab_xfer"), tr("tab_query"),
        tr("tab_liq"), tr("tab_offline"), tr("tab_admin"),
    )
    var idx by remember { mutableIntStateOf(startSub.coerceIn(0, 7)) }
    Column(Modifier.fillMaxSize()) {
        // 两行等宽网格（每行 5 个）：一屏可见全部入口，点击区大且位置稳定
        Column(Modifier.fillMaxWidth().padding(horizontal = 6.dp)) {
            titles.chunked(5).forEachIndexed { rowI, row ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    row.forEachIndexed { colI, title ->
                        val i = rowI * 5 + colI
                        FilterChip(
                            selected = idx == i,
                            onClick = { idx = i },
                            label = { Text(title, style = MaterialTheme.typography.labelSmall, maxLines = 1) },
                            modifier = Modifier.weight(1f),
                        )
                    }
                    repeat(5 - row.size) { Box(Modifier.weight(1f)) }
                }
            }
        }
        when (idx) {
            0 -> OpTabScreen(vm, "trade")
            1 -> OpTabScreen(vm, "amm")
            2 -> OpTabScreen(vm, "loan")
            3 -> OpTabScreen(vm, "xfer")
            4 -> QueryScreen(vm)
            5 -> LiquidationScreen(vm)
            6 -> OfflineScreen(vm)
            else -> AdminScreen(vm)
        }
    }
}
