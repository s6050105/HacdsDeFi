package com.hacds.defi.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// 品牌色取自 HACD 官方金橙 #f7af34
val BrandGold = Color(0xFFF7AF34)
val BrandGoldDark = Color(0xFFB87D14)
val BrandBgDark = Color(0xFF14110C)
val BrandSurfaceDark = Color(0xFF1E1A13)

private val LightColors = lightColorScheme(
    primary = BrandGoldDark,
    onPrimary = Color.White,
    secondary = BrandGold,
    background = Color(0xFFFAF7F2),
    surface = Color.White,
)

private val DarkColors = darkColorScheme(
    primary = BrandGold,
    onPrimary = Color(0xFF2A1E05),
    secondary = BrandGoldDark,
    background = BrandBgDark,
    surface = BrandSurfaceDark,
)

@Composable
fun HacdsTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    MaterialTheme(
        colorScheme = if (darkTheme) DarkColors else LightColors,
        content = content,
    )
}
