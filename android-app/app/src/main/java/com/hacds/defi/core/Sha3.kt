package com.hacds.defi.core

/**
 * 纯 Kotlin SHA3-256（Keccak-f[1600]，FIPS 202 填充 0x06）。
 *
 * ⚠ 不要用 `MessageDigest.getInstance("SHA3-256")` —— Android 各版本对 SHA-3 支持不一致
 * （API 35 前多数设备取不到），这是 PC 侧踩过的同类坑（D53）。
 *
 * 用途：只读查询模式下算合约函数 selector（sha3_256(name)[0:4]）。
 * 注：选服务端索引器（D57）时 Kotlin 侧根本不需要它——此为本地兜底。
 */
object Sha3 {

    // Keccak-f[1600] 24 轮常量（FIPS 202）。用无符号十六进制解析，避免手写负数出错。
    private val RC: LongArray = arrayOf(
        "0000000000000001", "0000000000008082", "800000000000808a", "8000000080008000",
        "000000000000808b", "0000000080000001", "8000000080008081", "8000000000008009",
        "000000000000008a", "0000000000000088", "0000000080008009", "000000008000000a",
        "000000008000808b", "800000000000008b", "8000000000008089", "8000000000008003",
        "8000000000008002", "8000000000000080", "000000000000800a", "800000008000000a",
        "8000000080008081", "8000000000008080", "0000000080000001", "8000000080008008",
    ).map { java.lang.Long.parseUnsignedLong(it, 16) }.toLongArray()

    private val ROT = arrayOf(
        intArrayOf(0, 36, 3, 41, 18),
        intArrayOf(1, 44, 10, 45, 2),
        intArrayOf(62, 6, 43, 15, 61),
        intArrayOf(28, 55, 25, 21, 56),
        intArrayOf(27, 20, 39, 8, 14),
    )

    private fun rotl(x: Long, n: Int): Long =
        if (n == 0) x else (x shl n) or (x ushr (64 - n))

    private fun keccakF(st: Array<LongArray>) {
        for (round in 0 until 24) {
            val c = LongArray(5)
            for (x in 0 until 5) c[x] = st[x][0] xor st[x][1] xor st[x][2] xor st[x][3] xor st[x][4]
            val d = LongArray(5)
            for (x in 0 until 5) d[x] = c[(x + 4) % 5] xor rotl(c[(x + 1) % 5], 1)
            for (x in 0 until 5) for (y in 0 until 5) st[x][y] = st[x][y] xor d[x]

            val b = Array(5) { LongArray(5) }
            for (x in 0 until 5) for (y in 0 until 5) {
                b[y][(2 * x + 3 * y) % 5] = rotl(st[x][y], ROT[x][y])
            }
            for (x in 0 until 5) for (y in 0 until 5) {
                st[x][y] = b[x][y] xor (b[(x + 1) % 5][y].inv() and b[(x + 2) % 5][y])
            }
            st[0][0] = st[0][0] xor RC[round]
        }
    }

    fun sha3_256(input: ByteArray): ByteArray {
        val rate = 136
        val paddedLen = ((input.size + 1 + rate - 1) / rate) * rate
        val padded = ByteArray(paddedLen)
        System.arraycopy(input, 0, padded, 0, input.size)
        padded[input.size] = (padded[input.size].toInt() xor 0x06).toByte()
        padded[paddedLen - 1] = (padded[paddedLen - 1].toInt() xor 0x80.toByte().toInt()).toByte()

        val st = Array(5) { LongArray(5) }
        var off = 0
        while (off < paddedLen) {
            for (i in 0 until rate / 8) {
                var lane = 0L
                for (b in 7 downTo 0) {
                    lane = (lane shl 8) or (padded[off + i * 8 + b].toLong() and 0xff)
                }
                st[i % 5][i / 5] = st[i % 5][i / 5] xor lane
            }
            keccakF(st)
            off += rate
        }
        val out = ByteArray(32)
        for (i in 0 until 4) {
            var lane = st[i % 5][i / 5]
            for (b in 0 until 8) {
                out[i * 8 + b] = (lane and 0xff).toByte()
                lane = lane ushr 8
            }
        }
        return out
    }

    /** 合约函数 selector = sha3_256(name)[0:4] 的 hex。 */
    fun fnSelectorHex(name: String): String =
        sha3_256(name.toByteArray(Charsets.UTF_8)).copyOfRange(0, 4)
            .joinToString("") { "%02x".format(it) }
}
