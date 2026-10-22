package com.hacds.defi.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * 屏幕适配（D49 移动端等价物）。
 *
 * 手机竖屏、平板、横屏、桌面/模拟器宽屏四种形态下都不应「单列拉满」：
 *  - 窄屏：单列，全宽
 *  - 宽屏（≥ [MAX_CONTENT_WIDTH]）：内容限制最大宽度并居中，避免被拉得过长
 */
object Adaptive {
    /** 内容最大宽度：超过此宽度就居中。 */
    val MAX_CONTENT_WIDTH: Dp = 720.dp

    fun contentWidth(screenWidthDp: Dp): Dp =
        if (screenWidthDp > MAX_CONTENT_WIDTH) MAX_CONTENT_WIDTH else screenWidthDp
}

/** 把内容限制在合理宽度内并水平居中（宽屏友好）。 */
@Composable
fun CenteredContent(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        Box(Modifier.fillMaxWidth().widthIn(max = Adaptive.MAX_CONTENT_WIDTH)) { content() }
    }
}
