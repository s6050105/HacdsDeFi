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
 * | hacds 侧（due / amm:ds / loan:coll / #3000 amount） | **个数**（decimal=0） | **个数** | **1:1，不换算** |
 * | LP 份额 lpt | 无定标 | 原值 | 不除 |
 * | pool_price | amm:hac / amm:ds | zhu/hacds | ÷1e8 得 HAC/hacds |
 * | ref_price_of | zhu/hacds × 1e8 | — | 用 ref_price_zhu_per_ds 替代 |
 *
 * ⚠ **#3000 起 decimal=0：1 atom = 1 hacds**，atoms 数就是个数，**任何地方都不要再 ÷1e8**。
 *    旧版 #2000（decimal=8）已作废，不要沿用它的换算习惯。
 */
object Units {

    /** 1 HAC = 1e8 zhu。 */
    val ZHU_PER_HAC: BigInteger = BigInteger.valueOf(100_000_000L)

    /**
     * 每 1 分钻石评分铸多少 **hacds（最小单位）**，对应合约 `SCORE_SCALE`。
     *
     * **1 分 = 1e8 个单位**。
     *
     * ⚠ 与 decimal 的关系（#3000 定稿）：
     *   decimal = 0，1 个最小单位 = 1 个 hacds。
     *   所以存 1 分钻石 → 铸 100,000,000 个 hacds；
     *      存 3 分钻石 → 铸 300,000,000 个 hacds。
     *   总量 5,963,298,700,000,000 个 hacds。
     *
     * ⚠ 与价格定标 PRICE_SCALE（同为 1e8，但语义不同）不要混用。
     */
    const val SCORE_SCALE: Long = 100_000_000L

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

    /**
     * hacds atoms → 显示字符串。
     *
     * #3000 decimal=0：1 atom = 1 hacds，**不做除法**，直接原样返回。
     * （旧版 #2000 是 decimal=8，这里曾 ÷1e8；该口径已作废。）
     *
     * 注意：虽然 1 分钻石铸 1e8 个 hacds，但那是 SCORE_SCALE 的效果，
     * 与「atom → 显示」的换算无关。显示层不做任何除法。
     */
    fun atomsToCountString(atoms: BigInteger): String = atoms.toString()

    /**
     * 池价（HAC per hacds）。
     *
     * decimal=0 下 1 hacds = 1 atom，所以：
     *   HAC/hacds = (amm:hac / 1e8) / amm:ds = ammHacZhu / (ammDsAtoms × 1e8)
     *
     * 合约 pool_price() 返回的是 **zhu per hacds**（= ammHacZhu / ammDsAtoms），
     * 客户端显示 HAC 时再 ÷1e8 —— 本函数直接给 HAC 口径，省去两步换算。
     */
    fun poolPriceHacPerDs(ammHacZhu: BigInteger, ammDsAtoms: BigInteger): BigDecimal {
        if (ammDsAtoms.signum() == 0) return BigDecimal.ZERO
        return BigDecimal(ammHacZhu)
            .divide(BigDecimal(ammDsAtoms).multiply(BigDecimal(ZHU_PER_HAC)), 18, RoundingMode.DOWN)
    }
}
