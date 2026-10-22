package com.hacds.defi.qr

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** 分片二维码数据层单测（D-A3）。 */
class ShardsTest {

    @Test fun crc32_matches_zlib() {
        // 标准 CRC32("123456789") = 0xCBF43926
        assertEquals("CBF43926", Shards.crc32Hex("123456789"))
        assertEquals("00000000", Shards.crc32Hex(""))
    }

    @Test fun splitAndAssemble_roundTrip() {
        val hex = "ab".repeat(1500)   // 3000 字符
        val shards = Shards.split(hex, 800)
        assertEquals(4, shards.size)          // 800+800+800+600
        assertEquals(1, shards[0].seq)
        assertEquals(4, shards[0].total)
        // 逐片编码再解析
        val parsed = shards.map { Shards.parse(it.encode())!! }
        val r = Shards.assemble(parsed)
        assertTrue(r is Shards.Assemble.Ok)
        assertEquals(hex, (r as Shards.Assemble.Ok).hex)
    }

    @Test fun assemble_outOfOrder_ok() {
        val hex = "deadbeef".repeat(400)      // 3200 字符
        val shards = Shards.split(hex, 800).map { Shards.parse(it.encode())!! }.reversed()
        val r = Shards.assemble(shards)
        assertTrue(r is Shards.Assemble.Ok)
        assertEquals(hex, (r as Shards.Assemble.Ok).hex)
    }

    @Test fun assemble_missing_reportsIndices() {
        val hex = "cd".repeat(2000)
        val shards = Shards.split(hex, 800).map { Shards.parse(it.encode())!! }
        val r = Shards.assemble(shards.filter { it.seq != 2 })
        assertTrue(r is Shards.Assemble.Need)
        assertEquals(listOf(2), (r as Shards.Assemble.Need).missing)
    }

    @Test fun assemble_crcMismatch_detected() {
        val a = Shards.split("aa".repeat(1000), 800).map { Shards.parse(it.encode())!! }
        val b = Shards.split("bb".repeat(1000), 800).map { Shards.parse(it.encode())!! }
        // 混入另一笔交易的一片（seq=1 来自 b，其余来自 a）→ CRC 不符
        val mixed = listOf(b[0]) + a.drop(1)
        val r = Shards.assemble(mixed)
        assertTrue(r is Shards.Assemble.Invalid)
    }

    @Test fun parse_rejectsForeign() {
        assertEquals(null, Shards.parse("https://example.com"))
        assertEquals(null, Shards.parse("HXDS/1/3"))
        assertEquals(null, Shards.parse(""))
    }
}
