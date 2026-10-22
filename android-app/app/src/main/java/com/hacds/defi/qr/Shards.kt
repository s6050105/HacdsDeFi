package com.hacds.defi.qr

/**
 * 分片二维码的数据层（D-A3）。**与 UI 解耦，可单测**。
 *
 * 包格式：`HXDS/<seq>/<total>/<crc>/<data>`
 *  - seq / total：1 起的序号与总数
 *  - crc：整段 hex（未分片前）的 CRC32（8 位十六进制大写），用于收齐后校验
 *  - data：本片 hex 内容
 *
 * 容量：QR 版本 40、纠错 L 约 2900 字节；单片 hex 取 800 字符（留足纠错与协议头余量）。
 */
object Shards {

    const val PREFIX = "HXDS"
    /** 单片数据（hex 字符数）。留足二维码纠错余量。 */
    const val DEFAULT_CHUNK = 800

    data class Shard(val seq: Int, val total: Int, val crc: String, val data: String) {
        fun encode(): String = "$PREFIX/$seq/$total/$crc/$data"
    }

    /** 把完整 hex 切成若干片。 */
    fun split(hex: String, chunk: Int = DEFAULT_CHUNK): List<Shard> {
        val h = hex.trim()
        require(h.isNotEmpty()) { "交易体为空" }
        val crc = crc32Hex(h)
        val parts = h.chunked(chunk)
        return parts.mapIndexed { i, part -> Shard(i + 1, parts.size, crc, part) }
    }

    /** 解析单张二维码文本；不是本格式返回 null。 */
    fun parse(text: String): Shard? {
        val t = text.trim()
        if (!t.startsWith("$PREFIX/")) return null
        val body = t.removePrefix("$PREFIX/")
        val idx = body.indexOf('/')
        if (idx < 0) return null
        // HXDS/seq/total/crc/data —— data 可能含 '/'？hex 不含，安全
        val segs = body.split('/', limit = 4)
        if (segs.size < 4) return null
        val seq = segs[0].toIntOrNull() ?: return null
        val total = segs[1].toIntOrNull() ?: return null
        val crc = segs[2]
        val data = segs[3]
        if (seq < 1 || total < 1 || seq > total) return null
        return Shard(seq, total, crc, data)
    }

    sealed class Assemble {
        data class Need(val missing: List<Int>) : Assemble()
        data class Invalid(val reason: String) : Assemble()
        data class Ok(val hex: String) : Assemble()
    }

    /** 收齐后按序拼回并校验 CRC。 */
    fun assemble(shardsIn: List<Shard>): Assemble {
        if (shardsIn.isEmpty()) return Assemble.Invalid("没有扫描到任何分片")
        val total = shardsIn.first().total
        if (shardsIn.any { it.total != total }) return Assemble.Invalid("分片总数不一致")
        val bySeq = shardsIn.groupBy { it.seq }.mapValues { it.value.first() }
        val missing = (1..total).filter { !bySeq.containsKey(it) }
        if (missing.isNotEmpty()) return Assemble.Need(missing)
        val hex = (1..total).joinToString("") { bySeq.getValue(it).data }
        val expectCrc = bySeq.getValue(1).crc
        val gotCrc = crc32Hex(hex)
        return if (expectCrc.equals(gotCrc, ignoreCase = true)) Assemble.Ok(hex)
        else Assemble.Invalid("校验失败：CRC 不符（可能混入了别的交易的分片）")
    }

    /** CRC32（与 zlib/标准一致），输出 8 位大写十六进制。 */
    fun crc32Hex(s: String): String {
        val bytes = s.toByteArray(Charsets.UTF_8)
        var crc = 0xFFFFFFFFu
        for (b in bytes) {
            crc = crc xor (b.toUByte().toUInt())
            for (i in 0 until 8) {
                crc = if ((crc and 1u) != 0u) (crc shr 1) xor 0xEDB88320u else crc shr 1
            }
        }
        return (crc.inv()).toString(16).uppercase().padStart(8, '0')
    }
}
