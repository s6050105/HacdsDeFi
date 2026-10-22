package com.hacds.defi.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.hacds.defi.ui.theme.BrandGold
import com.hacds.defi.ui.components.AssetIcon

/** 区块卡片。 */
@Composable
fun Section(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    content: @Composable () -> Unit,
) {
    Card(
        modifier = modifier.fillMaxWidth().padding(vertical = 6.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        shape = RoundedCornerShape(12.dp),
    ) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
            if (!subtitle.isNullOrBlank())
                Text(subtitle, style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            content()
        }
    }
}

/** 键值行。 */
@Composable
fun KV(k: String, v: String?, mono: Boolean = false, hl: Boolean = false) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(k, style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(
            v ?: "—",
            style = if (mono) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
            else MaterialTheme.typography.bodyMedium,
            fontWeight = if (hl) FontWeight.Bold else FontWeight.Normal,
            color = if (hl) BrandGold else MaterialTheme.colorScheme.onSurface,
            maxLines = 3,
        )
    }
}

/** 小徽标。 */
@Composable
fun Chip(text: String, color: Color = BrandGold) {
    Text(
        text,
        style = MaterialTheme.typography.labelSmall,
        color = Color.Black,
        modifier = Modifier
            .background(color, RoundedCornerShape(6.dp))
            .padding(horizontal = 6.dp, vertical = 2.dp),
    )
}

/** 错误/提示条。 */
@Composable
fun Notice(text: String, error: Boolean = false) {
    val bg = if (error) Color(0xFF5A1F1F) else Color(0xFF2A2A1A)
    val fg = if (error) Color(0xFFFFB4B4) else Color(0xFFFFE08A)
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = fg,
        modifier = Modifier.fillMaxWidth().background(bg, RoundedCornerShape(8.dp)).padding(10.dp),
    )
}

@Composable
fun MonoText(s: String, maxLines: Int = 4) {
    Text(
        s,
        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
        maxLines = maxLines,
        modifier = Modifier.fillMaxWidth(),
    )
}

@Composable
fun Row2(left: @Composable () -> Unit, right: @Composable () -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { left() }
        Column { right() }
    }
}

/** 带图标的资产行：图标 + 名称/副标题 + 右侧数值。 */
@Composable
fun AssetRow(
    symbol: String,
    label: String,
    value: String,
    subtitle: String? = null,
    valueMono: Boolean = false,
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        AssetIcon(symbol, size = 32.dp)
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
            if (!subtitle.isNullOrBlank())
                Text(subtitle, style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 2)
        }
        Text(
            value,
            style = if (valueMono) MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace)
            else MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = BrandGold,
        )
    }
}
