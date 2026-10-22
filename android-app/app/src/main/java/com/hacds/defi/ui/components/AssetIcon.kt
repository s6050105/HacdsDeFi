package com.hacds.defi.ui.components

import androidx.annotation.DrawableRes
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.hacds.defi.R

/**
 * 资产图标（D27/D29 / D-A10 / D-A11）。
 *
 * | 资产 | 图标 | 来源 |
 * |---|---|---|
 * | HAC | 官方 `hac.svg`（金橙 #f7af34） | hacash.org `/svg/hac` |
 * | HACD | 官方 `hacd.svg` | hacash.org `/svg/hacd` |
 * | hacds | 本地 `hacds_icon_*.png` | hacds_exchange/assets |
 * | SAT | 官方 `/svg/btc` | hacash.org |
 * | CARAT | hacashdex.com `/assets/carat.png` | |
 * | HACP | hacashdex.com `/assets/hacp.png` | |
 * | 其它 | 首字母色块兜底 | — |
 */
object AssetIcons {

    /** 按资产名/serial 返回 drawable id（0 = 无内置图标，用兜底）。 */
    @DrawableRes
    fun resolve(nameOrSerial: String): Int = when (nameOrSerial.uppercase()) {
        "HAC", "HACASH" -> R.drawable.ic_hac
        "HACD" -> R.drawable.ic_hacd
        "HACDS", "2000" -> R.drawable.ic_hacds
        "SAT", "SATOSHI" -> R.drawable.ic_sat
        "CARAT" -> R.drawable.ic_carat
        "HACP" -> R.drawable.ic_hacp
        else -> 0
    }
}

/** 圆形资产图标；无内置图标时用「首字母色块」兜底。 */
@Composable
fun AssetIcon(symbol: String, size: Dp = 28.dp, color: Color? = null) {
    val id = AssetIcons.resolve(symbol)
    if (id != 0) {
        Image(
            painter = painterResource(id),
            contentDescription = symbol,
            modifier = Modifier.size(size),
            contentScale = ContentScale.Fit,
        )
    } else {
        Box(
            Modifier.size(size).background(color ?: MaterialTheme.colorScheme.secondary, CircleShape),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                symbol.take(1).uppercase(),
                color = Color.Black,
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
            )
        }
    }
}
