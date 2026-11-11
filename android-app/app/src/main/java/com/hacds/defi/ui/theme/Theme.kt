package com.hacds.defi.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

// ============================================================================
// 设计变量 —— 与网页端 / PC 钱包对齐
//
// 三端共用同一套色板，源码在：
//     hacds.com/assets/css/design-tokens.css        （网页端）
//     wallet-app/renderer/design-tokens.css         （PC 钱包）
//     android-app/.../ui/theme/Theme.kt             （本文件，Kotlin 版）
//
// ⚠ 改配色时三处都要同步。安卓以前用金橙 #F7AF34 作主色、深棕 #14110C 作底，
//   2026-11-11 统一改为网页端的深蓝黑 #0A0E14 + 主色蓝 #4A9EFF。
//   金色现在**只用于 HACD / 钻石强调**（对应网页端 --gold）。
// ============================================================================

// ---- 背景层次 ----
val Bg        = Color(0xFF0A0E14)   // 页面底色   --bg
val BgElev    = Color(0xFF0F141B)   // 抬升面     --bg-elev
val Card      = Color(0xFF141A22)   // 卡片       --card
val CardHover = Color(0xFF1A222C)   // 卡片悬停   --card-hover
val Border    = Color(0xFF1F2933)   // 常规边框   --border
val BorderLit = Color(0xFF2D3A47)   // 强调边框   --border-lit

// ---- 文字 ----
val TextMain  = Color(0xFFE6EDF3)   // --text
val TextDim   = Color(0xFF8B949E)   // --text-dim
val TextFaint = Color(0xFF5A6673)   // --text-faint

// ---- 主色 ----
val Blue      = Color(0xFF4A9EFF)   // --blue
val BlueDim   = Color(0xFF2B6CB0)   // --blue-dim

// ---- 语义色 ----
val Green     = Color(0xFF3DD68C)   // --green  成功
val Amber     = Color(0xFFF5A524)   // --amber  警告
val Red       = Color(0xFFF04438)   // --red    错误
val Gold      = Color(0xFFF7AF34)   // --gold   HACD / 钻石强调（唯一保留的品牌金）

// 兼容旧代码的别名（BrandGold 等在多处被引用，保留避免大改）
val BrandGold = Gold
val BrandGoldDark = Color(0xFFB87D14)
val BrandBgDark = Bg
val BrandSurfaceDark = Card

private val DarkColors = darkColorScheme(
    primary = Blue,
    onPrimary = Color.White,
    primaryContainer = BlueDim,
    onPrimaryContainer = Color.White,
    secondary = Gold,
    onSecondary = Color(0xFF2A1E05),
    tertiary = Green,
    background = Bg,
    onBackground = TextMain,
    surface = Card,
    onSurface = TextMain,
    surfaceVariant = BgElev,
    onSurfaceVariant = TextDim,
    outline = Border,
    outlineVariant = BorderLit,
    error = Red,
    onError = Color.White,
)

// 浅色主题保持可用，但企业色以深色为准（网页端只有深色）
private val LightColors = lightColorScheme(
    primary = BlueDim,
    onPrimary = Color.White,
    secondary = BrandGoldDark,
    background = Color(0xFFF7F9FB),
    surface = Color.White,
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
