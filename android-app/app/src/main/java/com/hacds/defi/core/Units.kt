package com.hacds.defi.core

import java.math.BigDecimal
import java.math.BigInteger
import java.math.RoundingMode

/**
 * 单位换算（唯一口径见 PC 设计文档 §0.2 / D37 / D55）。
 *
 * | 量 | 链上单位 | 界面单位 | 换算 |
 * |---|---|---|---|
 * | HAC 侧（bal:hac / amm:hac / loan:debt / tre:hac） | zhu | **HAC** | 1 HAC = 1e8 zhu |
 * | hacds 侧（due / amm:ds / loan:coll / #2000 amount） | atoms | **atoms（raw，不换算）** | — |
 * | LP 份额 lpt | 无定标 | 原值 | 不除 |
 * | pool_price | amm:hac × 1e8 / amm:ds | HAC/hacds | ÷1e8 |
 *
 * ⚠ hacds **全端用 atoms**，不做 ÷1e8。要「个数」自己除 1e8，但**不要填进输入框**。
 */
object Units {

    /** 1 HAC = 1e8 zhu。 */
    val ZHU_PER_HAC: BigInteger = BigInteger.valueOf(100_000_000L)

    /** fee 以 u232 计：1 HAC = 1:248 = 1e16 u232。 */
    val U232_PER_HAC: BigInteger = BigInteger.TEN.pow(16)

    /** HAC（小数）→ zhu（整数）。 */
    fun hacToZhu(hac: BigDecimal): BigInteger =
        hac.multiply(BigDecimal(ZHU_PER_HAC)).setScale(0, RoundingMode.DOWN).toBigInteger()

    /** zhu（整数）→ HAC（小数，8 位）。 */
    fun zhuToHac(zhu: BigInteger): BigDecimal =
        BigDecimal(zhu).divide(BigDecimal(ZHU_PER_HAC), 8, RoundingMode.DOWN)

    /** HAC 数值字符串 → zhu。容忍 "1"、"0.5"、"1e-8"。 */
    fun hacStringToZhu(s: String): BigInteger {
        val t = s.trim()
        if (t.isEmpty()) return BigInteger.ZERO
        return hacToZhu(BigDecimal(t))
    }

    /** zhu → HAC 字符串（去尾随 0，至少保留整数部分）。 */
    fun zhuToHacString(zhu: BigInteger): String = trimZeros(zhuToHac(zhu).toPlainString())

    /** 修剪小数尾随 0；"1.00000000" → "1"，"0.50000000" → "0.5"。 */
    fun trimZeros(s: String): String {
        if (!s.contains('.')) return s
        val r = s.trimEnd('0').trimEnd('.')
        return r.ifEmpty { "0" }
    }

    /** hacds atoms → 显示用「个数」字符串（仅在明确需要个数时用）。 */
    fun atomsToCountString(atoms: BigInteger): String = atoms.toBigDecimal()
        .divide(BigDecimal(ZHU_PER_HAC), 8, RoundingMode.DOWN).toPlainString().let(::trimZeros)

    /**
     * 池价 = amm:hac × 1e8 / amm:ds（HAC/hacds）。
     * amm:hac / loan:debt 等均为 zhu。
     */
    fun poolPriceHacPerDs(ammHacZhu: BigInteger, ammDsAtoms: BigInteger): BigDecimal {
        if (ammDsAtoms.signum() == 0) return BigDecimal.ZERO
        return BigDecimal(ammHacZhu).divide(BigDecimal(ammDsAtoms), 18, RoundingMode.DOWN)
    }
}
