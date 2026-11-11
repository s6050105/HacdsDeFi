package com.hacds.defi.ui.components

import android.annotation.SuppressLint
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView

/**
 * HACD 图样（D12 / D-A7）：**局部 WebView 内嵌官方 `diamondsvgimg.js`**（HIP-5 绘制），
 * 与 explorer 逐像素一致；其余界面仍全 Kotlin 原生。
 *
 * 安全边界（D-A14）：WebView **只做 SVG 字节拼装，不接触私钥**；JS 与网络均关闭，
 * 仅加载随包 assets 里的静态库。
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable
fun DiamondImage(
    visualGeneHex: String,
    modifier: Modifier = Modifier,
    height: Dp = 160.dp,
    label: String? = null,
) {
    // M-14：原实现只校验长度 >= 19，visual_gene 来自明文 HTTP 的 /query/diamond，
    // 攻击者可让长度合法但内容含 `</script><script>…` → WebView 内执行任意 JS。
    // 改为严格的**十六进制白名单**：只允许 [0-9a-fA-F]，且长度为偶数。
    val ok = visualGeneHex.length >= 19 &&
             visualGeneHex.length % 2 == 0 &&
             visualGeneHex.all { it.isDigit() || it in 'a'..'f' || it in 'A'..'F' }
    if (!ok) {
        Box(modifier.fillMaxWidth().height(height)) {
            Text(
                label ?: "（无图样数据）",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        return
    }

    val html = remember(visualGeneHex, height.value) {
        // 只传 visual_gene hex；不涉及任何私钥或网络
        """
        <!doctype html><html><head><meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <style>html,body{margin:0;padding:0;background:#fff;}
        .wrap{display:flex;align-items:center;justify-content:center;width:100%;
              height:${height.value}px;}</style>
        <script src="diamondsvgimg.js"></script></head>
        <body><div class="wrap" id="box"></div>
        <script>
          try {
            var svg = window.CreateDiamondImageTagSVG(${jsStr(visualGeneHex)}, ${height.value - 8});
            document.getElementById('box').innerHTML = svg;
          } catch (e) {
            document.getElementById('box').innerText = '图样生成失败: ' + e;
          }
        </script></body></html>
        """.trimIndent()
    }

    AndroidView(
        modifier = modifier.fillMaxWidth().height(height),
        factory = { ctx ->
            WebView(ctx).apply {
                settings.javaScriptEnabled = true
                settings.allowFileAccess = true
                settings.allowContentAccess = false
                settings.blockNetworkLoads = true          // 禁网（图样是纯本地绘制）
                settings.domStorageEnabled = false
                settings.setSupportZoom(false)
                isVerticalScrollBarEnabled = false
                isHorizontalScrollBarEnabled = false
                webViewClient = WebViewClient()
                loadDataWithBaseURL("file:///android_asset/", html, "text/html", "utf-8", null)
            }
        },
    )
}

/** JS 字符串字面量转义（gene 是纯 hex，安全）。 */
// M-14：除反斜杠/单引号外，还必须转义 `<`、`>`、`&` 与换行——
// 只转义前两者时，`</script>` 仍能闭合外层的 <script> 块执行注入代码。
private fun jsStr(s: String): String = "'" + s
    .replace("\\", "\\\\")
    .replace("'", "\\'")
    .replace("<", "\\x3C")
    .replace(">", "\\x3E")
    .replace("&", "\\x26")
    .replace("\n", "\\n")
    .replace("\r", "\\r")
    .replace(" ", "\\u2028")
    .replace(" ", "\\u2029") + "'"
