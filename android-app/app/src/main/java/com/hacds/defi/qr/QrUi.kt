package com.hacds.defi.qr

import android.graphics.Bitmap
import android.graphics.Color as AColor
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.unit.dp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel

/** 用 zxing 把文本渲染成二维码位图。 */
fun qrBitmap(text: String, sizePx: Int = 640): Bitmap {
    val hints = mapOf(
        EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.L,
        EncodeHintType.MARGIN to 1,
        EncodeHintType.CHARACTER_SET to "UTF-8",
    )
    val matrix = QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, sizePx, sizePx, hints)
    val bmp = Bitmap.createBitmap(matrix.width, matrix.height, Bitmap.Config.ARGB_8888)
    for (x in 0 until matrix.width) {
        for (y in 0 until matrix.height) {
            bmp.setPixel(x, y, if (matrix.get(x, y)) AColor.BLACK else AColor.WHITE)
        }
    }
    return bmp
}

/**
 * 分片二维码展示：自动/手动轮播 N 张码，每张带 `HXDS/<seq>/<total>/<crc>/<data>` 包头。
 * 冷端把 signed hex 出码，热端逐张扫码拼回（D-A3）。
 */
@Composable
fun ShardQrView(hexOrText: String, chunk: Int = Shards.DEFAULT_CHUNK) {
    val shards = remember(hexOrText, chunk) {
        runCatching { Shards.split(hexOrText, chunk) }.getOrNull() ?: emptyList()
    }
    if (shards.isEmpty()) {
        Text(com.hacds.defi.ui.tr("x_qrNoData"), style = MaterialTheme.typography.bodySmall)
        return
    }
    var idx by remember(shards) { mutableIntStateOf(0) }
    val cur = shards[idx.coerceIn(0, shards.size - 1)]

    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp)) {
        val bmp = remember(cur) { qrBitmap(cur.encode(), 760) }
        Image(bmp.asImageBitmap(), contentDescription = "分片二维码",
            modifier = Modifier.size(280.dp))
        Text(com.hacds.defi.ui.tr("x_qrShard", cur.seq, cur.total, cur.crc),
            style = MaterialTheme.typography.bodySmall)
        Text(com.hacds.defi.ui.tr("x_qrChars", cur.data.length), style = MaterialTheme.typography.labelSmall)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            OutlinedButton(
                onClick = { idx = if (idx <= 0) shards.size - 1 else idx - 1 },
                modifier = Modifier.weight(1f),
            ) { Text(com.hacds.defi.ui.tr("x_qrPrev")) }
            Button(
                onClick = { idx = (idx + 1) % shards.size },
                modifier = Modifier.weight(1f),
            ) { Text(com.hacds.defi.ui.tr("x_qrNext")) }
        }
        Text(com.hacds.defi.ui.tr("x_qrTotal", shards.size),
            style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(top = 4.dp))
    }
}
