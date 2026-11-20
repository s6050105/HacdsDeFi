package com.hacds.defi.core

import android.content.Context
import org.json.JSONObject

/**
 * 应用配置（节点 / 预言机 / 合约 / 索引器）。默认值见 PC 设计文档 §0.1 部署事实。
 *
 * **冷端可零配置**（D-A5）：网络项可留空，未配置时联网入口灰显并提示。
 */
data class AppConfig(
    val node: String = DEFAULT_NODE,
    val oracle: String = DEFAULT_ORACLE,
    val contract: String = DEFAULT_CONTRACT,
    val indexer: String = DEFAULT_INDEXER,
    val lang: String = "zh-CN",
    val treasury: String = DEFAULT_TREASURY,
) {
    companion object {
        // 默认走 HTTPS 域名，**不再硬编码服务器 IP 和明文端口**（2026-11-12 审计 M-5）。
        //
        // 为什么必须换：
        //   ① 明文 HTTP 的响应可被链路上任何人篡改 —— 这是要签名的应用，
        //      改掉一个收款地址或合约调用参数就是直接盗币。
        //   ② 把运维 IP 写进公开仓库，等于把攻击面一起发出去。
        // 这三个域名由 Cloudflare Tunnel 转到源站，端口只在隧道内部可见。
        const val DEFAULT_NODE = "https://api.hacds.com"
        const val DEFAULT_CONTRACT = "bw2sRCNPw3DsvAyS9o8CeMbJJhQ9NJ37h"
        const val DEFAULT_INDEXER = "https://indexer.hacds.com"
        // ⚠ 2026-11-20：#4000 起 TREASURY 指向**金库分红合约 B**，不再是冷钱包。
        //   旧值 1FbwjELG… 是 #2000 时代的冷钱包，协议收入早已不往那里走。
        const val DEFAULT_TREASURY = "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4"
        // ⚠ #3000 已删除预言机（评分改由合约链上直读基因）。这个字段只为
        //   **向后兼容旧配置文件**保留：老版本存过 oracle 键，删掉常量会让
        //   反序列化在 DEFAULT_ORACLE 上崩。留空串，任何代码都不该再使用它。
        @Deprecated("预言机在 #3000 已移除；此常量仅为兼容旧配置文件保留")
        const val DEFAULT_ORACLE = ""
        // #3000 版资产 serial。旧版 #2000 已作废（契约、预言机、资产均已停用）。
        // ⚠ 部署新合约并发行新资产后，此值必须与链上实际 serial 一致。
        const val HACDS_SERIAL = 4000L

        // ---- 金库分红合约 B（2026-11-18）----
        //
        // 地址由「部署者 15fv6cNE… + nonce 3」推导。主网实际部署后若与此不符，
        // 只需改这一处 —— 页签会在 share_serial() 校验失败时自动隐藏。
        const val VAULT_ADDR = "duEkx1E3owCP2VhTq6LzvLUGeMJpjZXm4"

        /** 股权资产 serial，必须与合约 B 的 SHARE_SERIAL 常量一致。 */
        const val SHARE_SERIAL = 4001L

        /**
         * 已作废的合约地址（小写比对）。
         *
         * ⚠ 只用来**识别旧配置并迁移**，不要拿它做任何业务判断。
         *
         * 为什么需要这份清单：
         *   这些地址的旧默认值曾被写进用户的 SharedPreferences，而
         *   `getString(key, default)` 对「键存在」的情况永远返回存下的旧值 ——
         *   换默认值救不了老用户。旧合约还活着、会正常响应，只是数据全空，
         *   于是表现为「资金不显示」而不是「配置错误」。
         */
        val RETIRED_CONTRACTS: Set<String> = setOf(
            "t1a8kaewqk6wmuw5umhca6tmq1ibdecyh",   // #3000 第一轮（issuer 事故作废）
            "vknwxffmcen9xfmrhyhhd5rhqbneym3m1",   // #2000 铭文版
        )
    }

    /** 是否配置了网络（冷端可能为空）。 */
    val hasNetwork: Boolean get() = node.isNotBlank()

    fun baseNode(): String = node.trimEnd('/')
    fun baseOracle(): String = oracle.trimEnd('/')
    fun baseIndexer(): String = indexer.trimEnd('/')
}

/** 配置持久化（SharedPreferences）。 */
class ConfigStore(ctx: Context) {
    private val sp = ctx.getSharedPreferences("hacds_cfg", Context.MODE_PRIVATE)

    fun load(): AppConfig {
        if (!sp.contains("node") && !sp.contains("contract")) return AppConfig()

        // ⚠ 旧版残留配置迁移（2026-11-20）
        //
        // 背景：v0.4.0 ~ v0.4.3 的 DEFAULT_CONTRACT 是 T1A8kaeW…（第一轮主网，
        //   因 issuer 误填导致股权锁死后整套作废）。用户升级到新版后，
        //   SharedPreferences 里存着这个旧地址，getString 会**原样读出来**，
        //   新的默认值永远不生效。
        //
        // 症状（用户实际反馈的「资金不显示」）：
        //   旧合约还能响应 sandboxcall，不报错，但数据全是空 ——
        //   amm_reserves 返回 0、池子无流动性、仓位全 0。
        //   用户看到的是「余额不见了」，而不是「配置错了」，极难自行排查。
        //
        // 处理：命中作废地址时静默换成当前默认值并写回，
        //   用户不必手动改配置。历史地址见 AppConfig.RETIRED_CONTRACTS。
        val savedContract = sp.getString("contract", AppConfig.DEFAULT_CONTRACT)
            ?: AppConfig.DEFAULT_CONTRACT
        val contract = if (savedContract.lowercase() in AppConfig.RETIRED_CONTRACTS) {
            // 只重置网络与合约相关字段，**保留用户选的语言**。
            //   （直接 save(AppConfig()) 会把 lang 打回 zh-CN，
            //     英文/土文用户升级后界面突然变中文，属于无谓的体验损失。）
            val keepLang = sp.getString("lang", "zh-CN") ?: "zh-CN"
            val fixed = AppConfig(lang = keepLang)
            save(fixed)
            fixed
        } else {
            AppConfig(
                node = sp.getString("node", AppConfig.DEFAULT_NODE) ?: AppConfig.DEFAULT_NODE,
                oracle = sp.getString("oracle", AppConfig.DEFAULT_ORACLE) ?: AppConfig.DEFAULT_ORACLE,
                contract = savedContract,
                indexer = sp.getString("indexer", AppConfig.DEFAULT_INDEXER) ?: AppConfig.DEFAULT_INDEXER,
                lang = sp.getString("lang", "zh-CN") ?: "zh-CN",
                treasury = sp.getString("treasury", AppConfig.DEFAULT_TREASURY) ?: AppConfig.DEFAULT_TREASURY,
            )
        }
        return contract
    }

    /**
     * 校验端点：必须 https，且不能是环回/内网（2026-11-15 审计 H-10）。
     *
     * 返回 null 表示通过，否则返回给用户看的错误说明。
     * 空串放行 —— 允许"零配置"冷端（见 D-A5）。
     */
    fun validateEndpoint(name: String, raw: String): String? {
        val s = raw.trim()
        if (s.isEmpty()) return null
        if (!s.startsWith("https://", ignoreCase = true)) {
            return "$name 必须以 https:// 开头（当前：${s.take(40)}）"
        }
        val host = try {
            java.net.URI(s).host?.lowercase()
        } catch (e: Exception) {
            return "$name 不是合法 URL"
        } ?: return "$name 缺少主机名"
        if (host == "localhost" || host.endsWith(".localhost") ||
            host == "::1" || host.matches(Regex("^127\\..*")) ||
            host.matches(Regex("^10\\..*")) ||
            host.matches(Regex("^192\\.168\\..*")) ||
            host.matches(Regex("^169\\.254\\..*")) ||
            host.matches(Regex("^172\\.(1[6-9]|2\\d|3[01])\\..*"))
        ) {
            return "$name 不能指向内网/环回地址（$host）"
        }
        return null
    }

    fun save(cfg: AppConfig) {
        // ⚠ 2026-11-15 审计 H-10：保存前校验端点，非法值一律不落盘。
        //   原实现直接写盘，设置页填什么就存什么（含 http:// 与内网地址）。
        validateEndpoint("节点地址", cfg.node)?.let {
            throw kotlin.IllegalArgumentException(it)
        }
        validateEndpoint("索引器地址", cfg.indexer)?.let {
            throw kotlin.IllegalArgumentException(it)
        }
        sp.edit()
            .putString("node", cfg.node)
            .putString("oracle", cfg.oracle)
            .putString("contract", cfg.contract)
            .putString("indexer", cfg.indexer)
            .putString("lang", cfg.lang)
            .putString("treasury", cfg.treasury)
            .apply()
    }

    /** PC 兼容：从 JSON 读取/写出（便于与 PC 端配置互导）。 */
    fun toJson(cfg: AppConfig): String = JSONObject()
        .put("node", cfg.node).put("oracle", cfg.oracle)
        .put("contract", cfg.contract).put("indexer", cfg.indexer)
        .put("lang", cfg.lang).put("treasury", cfg.treasury)
        .toString(2)

    fun fromJson(s: String): AppConfig = try {
        val j = JSONObject(s)
        AppConfig(
            node = j.optString("node", AppConfig.DEFAULT_NODE),
            oracle = j.optString("oracle", AppConfig.DEFAULT_ORACLE),
            contract = j.optString("contract", AppConfig.DEFAULT_CONTRACT),
            indexer = j.optString("indexer", AppConfig.DEFAULT_INDEXER),
            lang = j.optString("lang", "zh-CN"),
            treasury = j.optString("treasury", AppConfig.DEFAULT_TREASURY),
        )
    } catch (e: Exception) {
        AppConfig()
    }
}
