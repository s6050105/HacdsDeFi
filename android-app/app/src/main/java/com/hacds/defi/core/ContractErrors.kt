package com.hacds.defi.core

/**
 * 错误码翻译 —— 把 HacdsDeFi 合约的 `return N` 与节点/沙箱的英文错误翻成人话。
 * 与 PC 版 `contract-errors.js` 逐条对齐（D42 / D16 / M7）。
 */
object ContractErrors {

    /** 合约返回码：{ 函数名: { 码: 说明 } }。 */
    val CONTRACT_CODES: Map<String, Map<Int, String>> = mapOf(
        "swap_hac_to_ds" to mapOf(
            1 to "合约已暂停",
            11 to "HAC 积分不足（先“充 HAC”再兑换）",
            20 to "流动性池为空（尚无 LP，无法兑换）",
            21 to "滑点保护触发：实际得到低于你设定的下限（可放宽 min_out）",
            22 to "兑换量过大，超出池子储备",
        ),
        "swap_ds_to_hac" to mapOf(
            11 to "待领取 hacds（due 配额）不足",
            20 to "流动性池为空",
            21 to "滑点保护触发（可放宽 min_out）",
            22 to "兑换量过大，超出池子储备",
        ),
        "add_liquidity" to mapOf(
            1 to "合约已暂停", 2 to "投入量为 0",
            11 to "注入所需的 HAC 积分或 hacds 配额不足",
            23 to "池状态异常（份额尺度已定但份额归零，已拒绝以防重置）",
            24 to "注入量太小，算得 LP 份额为 0",
            26 to "单侧投入超出上限（1e18）",
        ),
        "remove_liquidity" to mapOf(2 to "份额为 0", 25 to "LP 份额不足"),
        "lp_harvest" to mapOf(1 to "合约已暂停"),
        "loan_add_collateral" to mapOf(1 to "合约已暂停", 11 to "待领取 hacds（due 配额）不足以作为抵押"),
        "loan_borrow" to mapOf(
            1 to "合约已暂停",
            40 to "超过可借额度（抵押率不足：新债务 > 抵押价值/2）",
            11 to "HAC 积分不足（利息结算需要）",
        ),
        "loan_repay" to mapOf(41 to "当前没有债务（无需还款）", 11 to "HAC 积分不足以还款"),
        "loan_liquidate" to mapOf(42 to "该账户没有债务，无法清算", 43 to "该账户健康（未超线），不能清算"),
        "loan_status" to mapOf(999 to "无借贷记录（健康度哨兵值）"),
        "init_admin" to mapOf(1 to "合约已初始化（幂等，无需重复）"),
        "set_oracle" to mapOf(1 to "无管理员权限"),
        "set_fee" to mapOf(1 to "无管理员权限", 2 to "费率超出范围（0–300，即 0–3%）"),
        "set_loan_rate" to mapOf(1 to "无管理员权限", 2 to "利率超出范围（0–2000，即 0–20%）"),
        "set_liquidate_bonus" to mapOf(1 to "无管理员权限", 2 to "清算奖励超出范围（0–1000，即 0–10%）"),
        "set_paused" to mapOf(1 to "无管理员权限"),
        "rent_batch" to mapOf(1 to "无管理员权限", 2 to "klen（键长）不能为 0", 3 to "键列表长度不是 klen 的整数倍"),
        "PayableHACD" to mapOf(
            1 to "合约已暂停", 2 to "钻石名单格式不合法", 3 to "缺少证书流（既无 Message 也无 Blob）",
            4 to "证书流长度不足（每颗需 126 字节）",
            5 to "证书校验失败（验签不过 / 链上重算评分与声称不符 / 名字对不上）",
            48 to "单笔只能 1 颗 HACD（VM resource 限制）",
        ),
        "PermitHACD" to mapOf(
            2 to "钻石名单格式不合法", 3 to "缺少证书流", 4 to "证书流长度不足", 5 to "证书校验失败",
            12 to "兑换所需 hacds 不足，且自动经 AMM 补足失败（需先充 HAC 或先兑换）",
            48 to "单笔只能 1 颗 HACD（VM resource 限制）",
        ),
        "PermitAsset" to mapOf(
            1 to "资产序列号不符（本合约只收/发 serial=2000 的 hacds）",
            10 to "金库待结算额不足（金库清扫失败）",
            11 to "待领取 hacds（due 配额）不足",
            20 to "流动性池为空（自动补足无法进行）",
            21 to "自动补足时滑点保护触发",
            22 to "自动补足量超出池子储备",
            30 to "自动补足的池状态异常",
            31 to "HAC 积分不足以自动补足",
            32 to "自动补足兑换失败",
        ),
        "PayableAsset" to mapOf(1 to "合约已暂停，或资产序列号不符（只收 serial=2000）"),
        "PayableHAC" to mapOf(1 to "合约已暂停"),
        "PermitHAC" to mapOf(10 to "金库待结算的 HAC 不足", 11 to "HAC 积分不足"),
        "PayableSAT" to mapOf(1 to "本合约不接受 SAT"),
        "PermitSAT" to mapOf(1 to "本合约不接受 SAT"),
    )

    data class Translated(val text: String, val hint: String = "")

    private class Rule(val match: Regex, val text: String, val hint: String = "")

    // 顺序敏感：单桶 gas 上限必须先于通用 OutOfGas
    private val NODE_ERRORS = listOf(
        Rule(Regex("invalid address argument|address .* format invalid|InvalidBase58Character", RegexOption.IGNORE_CASE),
            "地址为空或格式不对", "检查是否漏填、或复制不完整"),
        Rule(Regex("base58check failed|InvalidChecksum", RegexOption.IGNORE_CASE),
            "地址校验位不对", "可能复制时漏字符，请重新复制完整地址"),
        Rule(Regex("contract address (format|version)", RegexOption.IGNORE_CASE),
            "合约地址格式错误", "请核对合约地址（配置项）"),
        Rule(Regex("asset is insufficient", RegexOption.IGNORE_CASE),
            "资产余额不足", "该地址的对应 serial 资产不足；核对数量与 serial（hacds=2000/3000）。"),
        Rule(Regex("balance .* is insufficient", RegexOption.IGNORE_CASE),
            "HAC 余额不足", "Type-3 交易会按 gas_max 预扣 HAC（99≈0.56 HAC、50≈0.0203 HAC、1≈0.000735 HAC，执行后退回）。纯 HAC/HACD 转账可用 1；hacds 资产转账约 50；涉及合约的转账/调用需 99。"),
        Rule(Regex("insufficient", RegexOption.IGNORE_CASE),
            "余额不足", "检查该地址的 HAC 与资产余额；纯转账优先降低 gas_max。"),
        Rule(Regex("state changed", RegexOption.IGNORE_CASE), "链上状态已变化，请重试"),
        Rule(Regex("resource gas limit exceeded", RegexOption.IGNORE_CASE),
            "resource gas 单桶上限超出（与 gas_max 无关）",
            "该交易在 VM resource 桶的消耗超过协议硬上限（主网 6,100）。常见于一次向合约存入多颗 HACD（链上重算评分约 3,000/颗）。请拆成单颗多笔广播；提高 gas_max 或手续费都无效。"),
        Rule(Regex("compute gas limit exceeded", RegexOption.IGNORE_CASE),
            "compute gas 单桶上限超出（与 gas_max 无关）",
            "VM compute 桶消耗超过协议硬上限（主网 18,009）。请把大交易拆成多笔；提高 gas_max 无效。"),
        Rule(Regex("storage gas limit exceeded", RegexOption.IGNORE_CASE),
            "storage gas 单桶上限超出（与 gas_max 无关）",
            "VM storage 桶消耗超过协议硬上限（主网 111,911）。该笔写入的新键/租期过多，请减少动作或降低租期。"),
        Rule(Regex("gas has run out|OutOfGas", RegexOption.IGNORE_CASE), "gas 不足", "提高 gas_max（高级选项）；手续费不增加 gas 预算。hacds 资产转账建议 ≥50，合约调用建议 99。"),
        Rule(Regex("CallNotExist", RegexOption.IGNORE_CASE), "合约里没有这个函数", "检查函数名拼写"),
        Rule(Regex("CallArgvTypeFail|argument type", RegexOption.IGNORE_CASE), "参数类型不匹配", "检查参数格式（值:类型）"),
        Rule(Regex("contract storage budget|storage fee", RegexOption.IGNORE_CASE), "合约存储预算不足", "该操作需要的链上存储费超出当前预算"),
        Rule(Regex("budget snapshot missing", RegexOption.IGNORE_CASE), "合约存储预算快照缺失（节点状态异常）", "稍后重试或换节点"),
        Rule(Regex("transaction parse failed|transaction body invalid|trailing bytes", RegexOption.IGNORE_CASE), "交易体解析失败", "hex 可能不完整或被截断"),
        Rule(Regex("prikey|secret_key|key file|key must", RegexOption.IGNORE_CASE), "私钥格式错误", "私钥应为 64 位十六进制（不含 0x）"),
        Rule(Regex("NotFindContract", RegexOption.IGNORE_CASE), "找不到合约", "合约可能尚未部署，或地址写错"),
        Rule(Regex("Cannot find module|MODULE_NOT_FOUND", RegexOption.IGNORE_CASE), "程序文件缺失", "安装不完整，请重装"),
        Rule(Regex("ECONNREFUSED|socket hang up|ECONNRESET|ENOTFOUND", RegexOption.IGNORE_CASE), "连不上节点/预言机", "检查地址与端口，或目标服务是否在运行"),
        Rule(Regex("timeout|timed out", RegexOption.IGNORE_CASE), "请求超时", "节点/预言机响应慢或不可达"),
        Rule(Regex("HTTP 5\\d\\d|Bad Gateway|Service Unavailable", RegexOption.IGNORE_CASE), "服务端错误", "节点/预言机暂时不可用，稍后重试"),
    )

    /** 合约返回码 → 人话。 */
    fun translateContractReturn(fnName: String, retVal: Int): String {
        if (retVal == 0) return "成功"
        CONTRACT_CODES[fnName]?.get(retVal)?.let { return it }
        return "操作失败（合约错误码 $retVal）"
    }

    /** 节点/沙箱英文错误 → 人话。 */
    fun translateNodeError(rawText: String?): Translated {
        val s = rawText ?: ""
        for (r in NODE_ERRORS) {
            if (r.match.containsMatchIn(s)) return Translated(r.text, r.hint)
        }
        return Translated(s.take(160), "")
    }
}
