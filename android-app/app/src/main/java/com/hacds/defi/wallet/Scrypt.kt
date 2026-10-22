package com.hacds.defi.wallet

import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

/**
 * 纯 Kotlin scrypt（RFC 7914）—— 用于与 PC 版 `keystore.js`（Node `crypto.scryptSync`）互通。
 *
 * Android 的 JCE 没有 scrypt（只有 PBKDF2），又不想引入第三方库，故自实现。
 * 已与 Node 的 `crypto.scryptSync` 交叉验证（同 pass/salt/参数 → 同 DK）。
 *
 * 结构：PBKDF2-HMAC-SHA256(c=1) 展开 → ROMix(N) → PBKDF2-HMAC-SHA256(c=1) 收口。
 */
object Scrypt {

    fun derive(password: String, salt: ByteArray, n: Int, r: Int, p: Int, dkLen: Int): ByteArray =
        derive(password.toByteArray(Charsets.UTF_8), salt, n, r, p, dkLen)

    fun derive(password: ByteArray, salt: ByteArray, n: Int, r: Int, p: Int, dkLen: Int): ByteArray {
        require(n > 1 && (n and (n - 1)) == 0) { "N 必须是大于 1 的 2 的幂" }
        require(r > 0 && p > 0) { "r/p 必须为正" }

        val blockSize = 128 * r              // 每个 ROMix 块的字节数（= 2r × 64）
        val b = pbkdf2(password, salt, 1, p * blockSize)

        for (i in 0 until p) {
            val off = i * blockSize
            romix(b, off, n, r)
        }
        return pbkdf2(password, b, 1, dkLen)
    }

    // ---- PBKDF2-HMAC-SHA256（c=1 时即 HMAC(pass, salt||INT(i))，但保留通用实现）----
    private fun pbkdf2(password: ByteArray, salt: ByteArray, iterations: Int, dkLen: Int): ByteArray {
        val mac = Mac.getInstance("HmacSHA256")
        mac.init(SecretKeySpec(password, "HmacSHA256"))
        val hLen = mac.macLength
        val blocks = (dkLen + hLen - 1) / hLen
        val out = ByteArray(blocks * hLen)
        val u = ByteArray(hLen)
        val t = ByteArray(hLen)
        for (i in 1..blocks) {
            mac.reset()
            mac.update(salt)
            mac.update(byteArrayOf((i ushr 24).toByte(), (i ushr 16).toByte(), (i ushr 8).toByte(), i.toByte()))
            mac.doFinal(u, 0)
            System.arraycopy(u, 0, t, 0, hLen)
            for (c in 1 until iterations) {
                mac.reset()
                mac.update(u)
                mac.doFinal(u, 0)
                for (k in 0 until hLen) t[k] = (t[k].toInt() xor u[k].toInt()).toByte()
            }
            System.arraycopy(t, 0, out, (i - 1) * hLen, hLen)
        }
        return out.copyOf(dkLen)
    }

    // ---- ROMix ----
    private fun romix(block: ByteArray, off: Int, n: Int, r: Int) {
        val words = 32 * r                    // 每块 512*r 位 = 32r 个 32-bit 字
        val x = IntArray(words)
        bytesToWords(block, off, x, words)

        val v = IntArray(n * words)
        for (i in 0 until n) {
            System.arraycopy(x, 0, v, i * words, words)
            blockMix(x, r)
        }
        for (i in 0 until n) {
            val j = integerify(x, r) and (n - 1)
            for (k in 0 until words) x[k] = x[k] xor v[j * words + k]
            blockMix(x, r)
        }
        wordsToBytes(x, block, off, words)
    }

    /** BlockMix：B[0..2r-1]（每块 16 字）→ Y。 */
    private fun blockMix(b: IntArray, r: Int) {
        val x = IntArray(16)
        // X = B[2r-1]
        System.arraycopy(b, (2 * r - 1) * 16, x, 0, 16)
        val y = IntArray(32 * r)
        for (i in 0 until 2 * r) {
            for (k in 0 until 16) x[k] = x[k] xor b[i * 16 + k]
            salsa20_8(x)
            // Y[i] = X ；奇数块写入后半段（保持 scrypt 的 Y 排列）
            val dst = if (i % 2 == 0) (i / 2) * 16 else (r + i / 2) * 16
            System.arraycopy(x, 0, y, dst, 16)
        }
        System.arraycopy(y, 0, b, 0, 32 * r)
    }

    private fun integerify(b: IntArray, r: Int): Int = b[(2 * r - 1) * 16]

    private fun bytesToWords(src: ByteArray, off: Int, dst: IntArray, words: Int) {
        for (i in 0 until words) {
            val o = off + i * 4
            dst[i] = (src[o].toInt() and 0xff) or
                    ((src[o + 1].toInt() and 0xff) shl 8) or
                    ((src[o + 2].toInt() and 0xff) shl 16) or
                    ((src[o + 3].toInt() and 0xff) shl 24)
        }
    }

    private fun wordsToBytes(src: IntArray, dst: ByteArray, off: Int, words: Int) {
        for (i in 0 until words) {
            val o = off + i * 4
            dst[o] = src[i].toByte()
            dst[o + 1] = (src[i] ushr 8).toByte()
            dst[o + 2] = (src[i] ushr 16).toByte()
            dst[o + 3] = (src[i] ushr 24).toByte()
        }
    }

    private fun rotl(x: Int, n: Int): Int = (x shl n) or (x ushr (32 - n))

    /** Salsa20/8 核心（RFC 7914 参考实现的列/行轮）。 */
    private fun salsa20_8(input: IntArray) {
        val x = input.copyOf()
        var i = 8
        while (i > 0) {
            x[4] = x[4] xor rotl(x[0] + x[12], 7); x[8] = x[8] xor rotl(x[4] + x[0], 9)
            x[12] = x[12] xor rotl(x[8] + x[4], 13); x[0] = x[0] xor rotl(x[12] + x[8], 18)
            x[9] = x[9] xor rotl(x[5] + x[1], 7); x[13] = x[13] xor rotl(x[9] + x[5], 9)
            x[1] = x[1] xor rotl(x[13] + x[9], 13); x[5] = x[5] xor rotl(x[1] + x[13], 18)
            x[14] = x[14] xor rotl(x[10] + x[6], 7); x[2] = x[2] xor rotl(x[14] + x[10], 9)
            x[6] = x[6] xor rotl(x[2] + x[14], 13); x[10] = x[10] xor rotl(x[6] + x[2], 18)
            x[3] = x[3] xor rotl(x[15] + x[11], 7); x[7] = x[7] xor rotl(x[3] + x[15], 9)
            x[11] = x[11] xor rotl(x[7] + x[3], 13); x[15] = x[15] xor rotl(x[11] + x[7], 18)

            x[1] = x[1] xor rotl(x[0] + x[3], 7); x[2] = x[2] xor rotl(x[1] + x[0], 9)
            x[3] = x[3] xor rotl(x[2] + x[1], 13); x[0] = x[0] xor rotl(x[3] + x[2], 18)
            x[6] = x[6] xor rotl(x[5] + x[4], 7); x[7] = x[7] xor rotl(x[6] + x[5], 9)
            x[4] = x[4] xor rotl(x[7] + x[6], 13); x[5] = x[5] xor rotl(x[4] + x[7], 18)
            x[11] = x[11] xor rotl(x[10] + x[9], 7); x[8] = x[8] xor rotl(x[11] + x[10], 9)
            x[9] = x[9] xor rotl(x[8] + x[11], 13); x[10] = x[10] xor rotl(x[9] + x[8], 18)
            x[12] = x[12] xor rotl(x[15] + x[14], 7); x[13] = x[13] xor rotl(x[12] + x[15], 9)
            x[14] = x[14] xor rotl(x[13] + x[12], 13); x[15] = x[15] xor rotl(x[14] + x[13], 18)
            i -= 2
        }
        for (k in 0 until 16) input[k] = x[k] + input[k]
    }
}
