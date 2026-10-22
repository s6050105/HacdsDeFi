package com.hacds.defi.core

import java.math.BigInteger
import java.math.RoundingMode

/**
 * 手续费估算（D7）—— 纯函数，与 PC 版 `fee.js` 逐式对齐。
 *
 * 规则（Hacash Type-3）：
 *   纯度 purity = fee(单位 u232) / billing_size(字节)
 *   节点准入要求 purity >= min_purity（节点配置，当前主网 ≈ 6.024e9）
 *   ⇒ 满足准入的最小 fee = ceil(min_purity × size × headroom)
 *
 * fee 增大会略微增大编码后字节数，故采用**迭代**：构建 → 读字节数 → 算所需 fee
 * → 不足则提高 fee 重建，直至收敛（通常 1~2 轮）。
 */
object Fee {

    /** 1 HAC = 1:248，fee 以 u232 计 ⇒ ×1e16。 */
    private val U232_PER_HAC: BigInteger = Units.U232_PER_HAC

    /** +30% 余量。 */
    private val HEADROOM_NUM = BigInteger.valueOf(13)
    private val HEADROOM_DEN = BigInteger.TEN

    /**
     * 给定字节数与最低纯度，返回所需最小 fee（u232，向上取整）。
     * ceil(p * s * 13 / 10)。
     */
    fun minFee232(sizeBytes: Int, minPurity: Long): BigInteger {
        val s = BigInteger.valueOf(maxOf(0, sizeBytes).toLong())
        val p = BigInteger.valueOf(minPurity)
        val num = p.multiply(s).multiply(HEADROOM_NUM)
        return (num + HEADROOM_DEN - BigInteger.ONE).divide(HEADROOM_DEN)
    }

    /** u232 整数 → HAC 小数字符串（12 位精度，去尾随 0）。 */
    fun fee232ToHacString(v232: BigInteger): String {
        val s = java.math.BigDecimal(v232).divide(java.math.BigDecimal(U232_PER_HAC), 12, RoundingMode.DOWN)
        return Units.trimZeros(s.toPlainString())
    }

    /** HAC 金额字符串 → u232（BigInteger），用于比较。 */
    fun hacStringTo232(str: String): BigInteger {
        val t = str.trim()
        if (t.isEmpty()) return BigInteger.ZERO
        val dot = t.indexOf('.')
        val intPart = if (dot >= 0) t.substring(0, dot) else t
        var frac = if (dot >= 0) t.substring(dot + 1) else ""
        frac = (frac + "0".repeat(16)).substring(0, 16)
        return BigInteger(intPart.ifEmpty { "0" }).multiply(U232_PER_HAC)
            .add(BigInteger(frac.ifEmpty { "0" }))
    }

    /** 判定 fee 是否已满足 size 下的准入。 */
    fun isFeeEnough(feeHac: String, sizeBytes: Int, minPurity: Long): Boolean =
        hacStringTo232(feeHac) >= minFee232(sizeBytes, minPurity)

    /** 默认 fee（与 PC / 引擎 DEFAULT_FEE 一致）。 */
    const val DEFAULT_FEE = "0.0002"
}
