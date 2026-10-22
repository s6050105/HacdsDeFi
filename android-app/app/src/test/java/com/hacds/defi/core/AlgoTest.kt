package com.hacds.defi.core

import com.hacds.defi.wallet.Keystore
import com.hacds.defi.wallet.Scrypt
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.math.BigInteger

/**
 * 纯算法交叉验证 —— 向量由 PC 端 Node（crypto.scryptSync / keccak.js）实测生成。
 * 这些算法必须与 PC / 预言机同输入同输出，否则会出现「本地算的预期 hacds 与链上不符」
 * 或「PC 钱包导不进来」这类严重问题。
 */
class AlgoTest {

    // ---- scrypt：与 Node crypto.scryptSync 交叉验证 ----
    @Test fun scrypt_matchesNode() {
        val salt = Keystore.unhex("000102030405060708090a0b0c0d0e0f")
        val dk = Scrypt.derive("password", salt, 32768, 8, 1, 32)
        assertEquals(
            "2bf82378f6c4c5f8c13d9eb323452f9e37a06291fc00b2f5afae8fcad22f33e3",
            Keystore.hex(dk),
        )
    }

    @Test fun scrypt_matchesNode_second() {
        val salt = Keystore.unhex("aabbccddeeff00112233445566778899")
        val dk = Scrypt.derive("hacds123", salt, 32768, 8, 1, 32)
        assertEquals(
            "73d0f6c4e1435f3afc30134463043d9bbd1fb6dd8cbb7d3891d7df5a6f7ccac7",
            Keystore.hex(dk),
        )
    }

    // ---- SHA3-256 selector：与 PC keccak.js 交叉验证 ----
    @Test fun sha3_loanSelectors() {
        assertEquals("a4fea537", Sha3.fnSelectorHex("loan_borrow"))
        assertEquals("3e403fb8", Sha3.fnSelectorHex("loan_liquidate"))
        assertEquals("dfd17a76", Sha3.fnSelectorHex("loan_status"))
        // 与主网节点实测一致：txbuild 生成的 call 交易 codes 里 selector=b6e791c9
        assertEquals("b6e791c9", Sha3.fnSelectorHex("pool_price"))
    }

    @Test fun sha3_knownVector_empty() {
        // SHA3-256("") 标准向量
        assertEquals(
            "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
            Sha3.sha3_256(ByteArray(0)).joinToString("") { "%02x".format(it) },
        )
    }

    // ---- 单位换算 ----
    @Test fun units_hacZhu() {
        assertEquals(BigInteger.valueOf(100_000_000L), Units.hacToZhu(java.math.BigDecimal("1")))
        assertEquals(
            BigInteger.valueOf(50_000_000L),
            Units.hacToZhu(java.math.BigDecimal("0.5")),
        )
        assertEquals("1", Units.zhuToHacString(BigInteger.valueOf(100_000_000L)))
        assertEquals("0.5", Units.zhuToHacString(BigInteger.valueOf(50_000_000L)))
    }

    @Test fun units_poolPrice() {
        // amm:hac=9e8 zhu (9 HAC), amm:ds=1e10 atoms → 9e8/1e10 = 0.09 HAC/hacds
        val p = Units.poolPriceHacPerDs(BigInteger.valueOf(900_000_000L), BigInteger.valueOf(10_000_000_000L))
        assertEquals("0.09", Units.trimZeros(p.stripTrailingZeros().toPlainString()))
    }

    // ---- 手续费估算（与 PC fee.js 对齐）----
    @Test fun fee_minFeeIteration() {
        // 主网 min_purity ≈ 6.024e9；200 字节 → ceil(6.024e9 * 200 * 13 / 10)
        val min = Fee.minFee232(200, 6_024_000_000L)
        val expect = (BigInteger.valueOf(6_024_000_000L)
            .multiply(BigInteger.valueOf(200)).multiply(BigInteger.valueOf(13)) +
            BigInteger.TEN - BigInteger.ONE) / BigInteger.TEN
        assertEquals(expect, min)
        // 换回 HAC 字符串应可比较
        val s = Fee.fee232ToHacString(min)
        assertTrue(Fee.isFeeEnough(s, 200, 6_024_000_000L))
    }

    // ---- HACD 评分：与预言机/PC 一致 ----
    @Test fun diamondScore_basic() {
        // life_gene 全 0 → visual_gene 可预测；只验证不崩且分数 >= 1
        val lifeGene = ByteArray(32)
        val vg = DiamondScore.visualGeneHex("KWTVSH", lifeGene)
        assertEquals(20, vg.length)
        val r = DiamondScore.analyse("KWTVSH", 12345L, vg)
        assertTrue(r.score >= 1)
    }

    @Test fun diamondScore_visualGeneDerivation() {
        // 名字字符 → gene[2..7]；life_gene 后段 → gene[8..18]；life_gene[31] → gene[0..1]
        val lifeGene = ByteArray(32) { (it * 7 % 256).toByte() }
        val vg = DiamondScore.visualGeneHex("WTYUIA", lifeGene)
        // 名字首字符 'W' 在字母表索引 0 → gene[2]='0'
        assertEquals('0', vg[2])
        // 'T' 在字母表 "WTYUIAHXVMEKBSZN" 索引 1 → gene[3]='1'
        assertEquals('1', vg[3])
        // life_gene[31]=217=0xd9 → gene[0..1] = "d9"
        assertEquals('d', vg[0])
        assertEquals('9', vg[1])
    }
}
