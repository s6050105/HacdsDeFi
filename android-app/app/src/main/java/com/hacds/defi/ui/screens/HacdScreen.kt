package com.hacds.defi.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hacds.defi.AppViewModel
import com.hacds.defi.core.DiamondScore
import com.hacds.defi.ui.components.Notice
import com.hacds.defi.ui.components.Section
import com.hacds.defi.ui.tr

/**
 * HACD 收藏页（D12/D15/D20/D34/D39）：2–3 列网格 + 长按多选 + 筛选/排序 + 批量操作。
 * 图样（HIP-5）用局部 WebView 加载官方 diamondsvgimg.js 绘制（见 components/DiamondImage.kt，D-A7）。
 */
@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
fun HacdScreen(vm: AppViewModel) {
    val assets by vm.assets.collectAsState()
    val selected = remember { mutableStateListOf<String>() }
    var filterShape by remember { mutableStateOf("") }
    var minScore by remember { mutableStateOf("") }
    var sortBy by remember { mutableStateOf("score") }
    var queryAddr by remember { mutableStateOf("") }
    val clipboard = LocalClipboardManager.current

    val detail = assets?.diamondsDetail ?: emptyList()
    val names = assets?.diamonds ?: emptyList()

    // 计算每颗的评分（本地，D13）
    val items = remember(detail, names) {
        val fromDetail = detail.mapNotNull { d ->
            val nm = d.optString("name"); val vg = d.optString("visual_gene")
            if (nm.isEmpty()) null else HacdItem(nm, d.optLong("number"), vg,
                if (vg.length == 20) DiamondScore.analyse(nm, d.optLong("number"), vg).score else 0,
                if (vg.length == 20) DiamondScore.getShapes(vg) else "")
        }
        if (fromDetail.isNotEmpty()) fromDetail else names.map { HacdItem(it, 0, "", 0, "") }
    }
    val shown = items
        .filter { filterShape.isBlank() || it.shape.contains(filterShape, true) }
        .filter { minScore.isBlank() || it.score >= (minScore.toIntOrNull() ?: 0) }
        .let {
            when (sortBy) {
                "number" -> it.sortedBy { x -> x.number }
                "name" -> it.sortedBy { x -> x.name }
                else -> it.sortedByDescending { x -> x.score }
            }
        }

    LazyColumn(Modifier.fillMaxSize().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        item {
            Section(tr("ov.hacd"), subtitle = tr("x_nSelected", names.size, selected.size)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(value = filterShape, onValueChange = { filterShape = it },
                        label = { Text(tr("hacd_filterShape")) }, modifier = Modifier.weight(1f), singleLine = true)
                    OutlinedTextField(value = minScore, onValueChange = { minScore = it },
                        label = { Text(tr("hacd_filterMin")) }, modifier = Modifier.weight(1f), singleLine = true)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("score" to "x_sortScore", "number" to "x_sortNumber", "name" to "x_sortName").forEach { (k, label) ->
                        OutlinedButton(onClick = { sortBy = k },
                            modifier = Modifier.weight(1f)) {
                            Text(if (sortBy == k) "● " + tr(label) else tr(label), style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }
                if (names.isNotEmpty() && detail.isEmpty()) {
                    Button(onClick = { vm.loadHacdDetails() }, modifier = Modifier.fillMaxWidth()) {
                        Text(tr("ov_loadHacd"))
                    }
                }
                if (selected.isNotEmpty()) {
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = {
                            clipboard.setText(AnnotatedString(selected.joinToString(",")))
                        }, modifier = Modifier.weight(1f)) { Text(tr("hacd_copyNames")) }
                        Button(onClick = { vm.redeemHacd(selected.toList()) },
                            modifier = Modifier.weight(1f)) { Text(tr("hacd_batchIn")) }
                        OutlinedButton(onClick = { vm.withdrawHacd(selected.toList()) },
                            modifier = Modifier.weight(1f)) { Text(tr("hacd_batchOut")) }
                    }
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        OutlinedButton(onClick = { selected.clear() }, modifier = Modifier.weight(1f)) { Text(tr("x_cancel")) }
                        OutlinedButton(onClick = {
                            selected.clear(); selected.addAll(shown.map { it.name })
                        }, modifier = Modifier.weight(1f)) { Text(tr("x_selectAll")) }
                    }
                }
                Notice(tr("hacd_depositWarn"))
                // 地址查询：加载他人/合约地址的 HACD（便于看图样）
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = queryAddr, onValueChange = { queryAddr = it },
                        label = { Text(tr("x_queryByAddr")) },
                        modifier = Modifier.weight(1f), singleLine = true,
                    )
                    Button(onClick = {
                        vm.loadHacdByAddress(queryAddr.ifBlank { vm.session.value.address ?: "" })
                    }) { Text(tr("x_query")) }
                }
            }
        }
        item {
            // 网格：用固定行数模拟（LazyVerticalGrid 嵌在 LazyColumn 里需固定高度）
            val cols = 3
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                shown.chunked(cols).forEach { row ->
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        row.forEach { it2 ->
                            DiamondCell(
                                item = it2, selected = selected.contains(it2.name),
                                modifier = Modifier.weight(1f),
                                onToggle = {
                                    if (selected.contains(it2.name)) selected.remove(it2.name)
                                    else selected.add(it2.name)
                                },
                            )
                        }
                        repeat(cols - row.size) { Box(Modifier.weight(1f)) {} }
                    }
                }
            }
        }
        if (items.isEmpty()) item { Notice(tr("x_noHacd")) }
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun DiamondCell(
    item: HacdItem,
    selected: Boolean,
    modifier: Modifier,
    onToggle: () -> Unit,
) {
    Box(
        modifier = modifier
            .background(
                if (selected) MaterialTheme.colorScheme.primaryContainer
                else MaterialTheme.colorScheme.surfaceVariant,
                RoundedCornerShape(8.dp),
            )
            .combinedClickable(onClick = onToggle, onLongClick = onToggle)
            .padding(8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (item.vg.length >= 19) {
                com.hacds.defi.ui.components.DiamondImage(item.vg, height = 72.dp)
            }
            Text(item.name, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace,
                style = MaterialTheme.typography.labelMedium)
            if (item.shape.isNotEmpty()) Text(item.shape, style = MaterialTheme.typography.labelSmall, maxLines = 1)
            Text("${item.score}", style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** 单颗 HACD 的展示数据。 */
private data class HacdItem(
    val name: String, val number: Long, val vg: String, val score: Int, val shape: String,
)
