package com.hacds.defi.core

/**
 * HACD 5 维评分 —— Diamond_Analyzer v0.1.1 的 Kotlin 移植（与预言机 `hacds_oracle.py`、
 * PC 版 `diamond-score.js` 逐行对齐）。用途：本地算「预期 hacds」（Σ score × 10⁸），无需调预言机（D13）。
 *
 * 正确性：与预言机同输入必同输出（用 PC 版 JS 交叉验证）。
 */
object DiamondScore {

    private val RULE_SCORES: Map<String, Int> = mapOf(
        "Square|01" to 30, "Ellipse|02" to 30, "Heart|03" to 50, "Triangle|04" to 20,
        "Teardrop|05" to 30, "Circle|06" to 30, "Rhombus|07" to 20, "Hexagon|08" to 20,
        "Pure" to 250, "Sum four color" to 200, "All 16 color" to 200,
        "Sum five color" to 100, "All 15 color" to 100,
        "Sum six color" to 50, "All 14 color" to 30,
        "Left three pure" to 20, "Left mix pure" to 20, "Right three pure" to 20,
        "Right mix pure" to 20, "Color Symmetry" to 20, "Half divide" to 20, "Double mix" to 20,
        "Sum seven color" to 20, "darkColor" to 20, "lightColor" to 20,
        "Center color" to 3, "Edge color" to 3,
        "six repeat" to 200, "Penta repeat" to 50, "ABCABC" to 20,
        "Two letters" to 10, "Quadro repeat" to 10, "AABCCD" to 10, "ABBCDD" to 10,
        "Symmetric letter" to 10, "Three letters" to 3, "Triple repeat" to 2,
        "Tail seven" to 200, "Tail six" to 100, "Tail five" to 50, "Repetition" to 50,
        "Single num" to 30, "Serial num" to 25, "Tail four" to 20, "Number Symmetry" to 10,
        "Red cyan|A" to 7, "Cyan|B" to 6, "Secret|E" to 1, "Pink|H" to 8, "Red|I" to 8,
        "Pink cyan|K" to 8, "Yellow secret|M" to 2, "Yellow Cyan|N" to 6, "Green|S" to 6,
        "Blue|T" to 8, "Blue purple|U" to 3, "Light pink|V" to 8, "Dark blue|W" to 3,
        "Grey|X" to 5, "Red purple|Y" to 3, "Gold|Z" to 10,
        "darkColor|color" to 20, "lightColor|color" to 20,
    )

    /** CLEAN_SCORES = 键去掉 "|" 后的部分（后者覆盖前者，与 JS 的赋值顺序一致）。 */
    private val CLEAN_SCORES: Map<String, Int> = buildMap {
        for ((k, v) in RULE_SCORES) put(k.substringBefore('|'), v)
    }

    private val SHAPES_BY_HEX = mapOf(
        "01" to "Square", "02" to "Ellipse", "03" to "Heart", "04" to "Triangle",
        "05" to "Teardrop", "06" to "Circle", "07" to "Rhombus", "08" to "Hexagon",
    )

    private val COLOR_BY_LETTER = mapOf(
        'A' to "Red cyan", 'B' to "Cyan", 'E' to "Secret", 'H' to "Pink",
        'I' to "Red", 'K' to "Pink cyan", 'M' to "Yellow secret", 'N' to "Yellow Cyan",
        'S' to "Green", 'T' to "Blue", 'U' to "Blue purple", 'V' to "Light pink",
        'W' to "Dark blue", 'X' to "Grey", 'Y' to "Red purple", 'Z' to "Gold",
    )

    const val DIAMOND_NAME_VALID_CHARS = "WTYUIAHXVMEKBSZN"
    const val COMMON = "Common diamond"

    /** visual_gene 由 life_gene（32B）本地派生。 */
    fun visualGeneHex(name: String, lifeGene: ByteArray): String {
        require(name.length == 6) { "name must be 6 chars" }
        require(lifeGene.size == 32) { "life_gene 32 bytes" }
        val gene = CharArray(20) { '0' }
        for (i in 0 until 6) {
            val idx = DIAMOND_NAME_VALID_CHARS.indexOf(name[i])
            require(idx >= 0) { "invalid diamond name char: ${name[i]}" }
            gene[i + 2] = idx.toString(16)[0]
        }
        var o = 8
        for (i in 20 until 31) {
            val nibble = (lifeGene[i].toInt() and 0xff) % 16
            gene[o] = nibble.toString(16)[0]
            o++
        }
        val last = "%02x".format(lifeGene[31].toInt() and 0xff)
        gene[0] = last[0]; gene[1] = last[1]
        return String(gene)
    }

    private fun distinctChars(s: String) = s.toSet().size

    private fun maxRun(s: String): Int {
        var best = 1; var cur = 1
        for (i in 1 until s.length) {
            if (s[i] == s[i - 1]) { cur++; if (cur > best) best = cur } else cur = 1
        }
        return best
    }

    private fun symmetry(s: String): Boolean {
        val mid = s.length / 2
        if (mid == 0) return false
        val front = s.substring(0, mid)
        val back = s.substring(s.length - mid).reversed()
        return front == back
    }

    private fun shunzi(num: String, cha: Int): Boolean {
        for (i in 0 until num.length - 1) {
            if ((num[i + 1] - num[i]) != cha) return false
        }
        return true
    }

    /** "1"=纯暗, "0"=纯亮, "2"=混合。 */
    private fun darkOrLight(styleIn: String): Char {
        val style = styleIn.lowercase()
        val dark = "01234"; val light = "56789abcdef"
        var hasDark = false; var hasLight = false
        for (ch in style) {
            if (ch in dark) hasDark = true
            if (ch in light) hasLight = true
            if (hasDark && hasLight) return '2'
        }
        if (hasDark) return '1'
        if (hasLight) return '0'
        return '2'
    }

    /** 取最高分；等分并列时先出现者胜（对应 DA 的严格大于循环）。 */
    private fun maxScoreFeature(feats: List<String>): String {
        if (feats.isEmpty()) return COMMON
        var best = feats[0]; var bestScore = RULE_SCORES[best] ?: 0
        for (i in 1 until feats.size) {
            val sc = RULE_SCORES[feats[i]] ?: 0
            if (sc > bestScore) { best = feats[i]; bestScore = sc }
        }
        return best
    }

    fun getShapes(vg: String) = SHAPES_BY_HEX[vg.substring(0, 2)] ?: COMMON

    fun getStyles(vg: String): String {
        val style = vg.substring(2, 18)
        val t13 = style[12]; val t14 = style[13]; val t15 = style[14]; val t16 = style[15]
        val feats = mutableListOf<String>()
        if (t13 == t14 && t14 == t15 && t15 == t16) feats.add("Pure")
        else if (t14 == t15 && t15 == t13 && t14 != t16) feats.add("Left three pure")
        else if (t13 == t15 && t15 == t16 && t14 != t13) feats.add("Left mix pure")
        else if (t13 == t14 && t14 == t16 && t15 != t13) feats.add("Right three pure")
        else if (t14 == t16 && t16 == t15 && t14 != t13) feats.add("Right mix pure")
        else if (t16 == t15 && t13 == t14) feats.add("Color Symmetry")
        else if (t16 == t14 && t13 == t15) feats.add("Half divide")
        // 字符串拼接（与预言机一致；不能用数值，'a'-'f' 会变 NaN）
        else if ((t15.toString() + t13) == (t14.toString() + t16)) feats.add("Double mix")
        else if (t13 == t14 && t15 != t16) feats.add("Center color")
        else if (t15 == t16 && t14 != t13) feats.add("Edge color")
        val dc = distinctChars(style)
        when (dc) {
            4 -> feats.add("Sum four color")
            5 -> feats.add("Sum five color")
            6 -> feats.add("Sum six color")
            7 -> feats.add("Sum seven color")
            14 -> feats.add("All 14 color")
            15 -> feats.add("All 15 color")
            16 -> feats.add("All 16 color")
        }
        when (darkOrLight(style)) {
            '1' -> feats.add("darkColor")
            '0' -> feats.add("lightColor")
        }
        return maxScoreFeature(feats)
    }

    fun getColor(vg: String, name: String): String {
        val style = vg.substring(2, 19)
        val feats = mutableListOf<String>()
        COLOR_BY_LETTER[name[0]]?.let { feats.add(it) }
        when (darkOrLight(style)) {
            '1' -> feats.add("darkColor|color")
            '0' -> feats.add("lightColor|color")
        }
        val best = maxScoreFeature(feats)
        return if (best == COMMON) COMMON else best.substringBefore('|')
    }

    fun getNameliteral(name: String): String {
        val feats = mutableListOf<String>()
        val run = maxRun(name)
        if (run >= 3) when (run) {
            6 -> feats.add("six repeat")
            5 -> feats.add("Penta repeat")
            4 -> feats.add("Quadro repeat")
            else -> feats.add("Triple repeat")
        }
        when (distinctChars(name)) {
            2 -> feats.add("Two letters")
            3 -> feats.add("Three letters")
        }
        if (name.substring(0, 3) == name.substring(3, 6)) feats.add("ABCABC")
        if (symmetry(name)) feats.add("Symmetric letter")
        if (name[0] == name[1] && name[3] == name[4]) feats.add("AABCCD")
        if (name[1] == name[2] && name[4] == name[5]) feats.add("ABBCDD")
        return maxScoreFeature(feats)
    }

    fun getNumberliteral(numberStr: String): String {
        val feats = mutableListOf<String>()
        val n = numberStr.toIntOrNull() ?: 0
        if (n < 10) feats.add("Single num")
        if (distinctChars(numberStr) == 1) feats.add("Repetition")
        if (shunzi(numberStr, 1) || shunzi(numberStr, -1)) feats.add("Serial num")
        if (symmetry(numberStr)) feats.add("Number Symmetry")
        val run = maxRun(numberStr)
        if (run >= 4) when (run) {
            7 -> feats.add("Tail seven")
            6 -> feats.add("Tail six")
            5 -> feats.add("Tail five")
            else -> feats.add("Tail four")
        }
        return maxScoreFeature(feats)
    }

    private fun cleanScore(metricEn: String) = CLEAN_SCORES[metricEn] ?: 0

    data class Result(
        val shapes: String,
        val stylesOrColor: String,
        val nameliteral: String,
        val numberliteral: String,
        val score: Int,
    )

    fun analyse(name: String, number: Long, visualGene: String): Result {
        val numberStr = number.toString()
        val shapes = getShapes(visualGene)
        val stylesOrColor = if (shapes == COMMON) getStyles(visualGene) else getColor(visualGene, name)
        val nameliteral = getNameliteral(name)
        val numberliteral = getNumberliteral(numberStr)
        var score = cleanScore(shapes) + cleanScore(stylesOrColor) +
                cleanScore(nameliteral) + cleanScore(numberliteral)
        score = maxOf(1, score)   // DA 下限：0 分抬 1
        return Result(shapes, stylesOrColor, nameliteral, numberliteral, score)
    }
}
