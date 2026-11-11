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
        const val DEFAULT_CONTRACT = "T1A8kaeWqK6wMUw5UMHCA6tMQ1iBdECyH"
        const val DEFAULT_INDEXER = "https://indexer.hacds.com"
        const val DEFAULT_TREASURY = "1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK"
        // ⚠ #3000 已删除预言机（评分改由合约链上直读基因）。这个字段只为
        //   **向后兼容旧配置文件**保留：老版本存过 oracle 键，删掉常量会让
        //   反序列化在 DEFAULT_ORACLE 上崩。留空串，任何代码都不该再使用它。
        @Deprecated("预言机在 #3000 已移除；此常量仅为兼容旧配置文件保留")
        const val DEFAULT_ORACLE = ""
        // #3000 版资产 serial。旧版 #2000 已作废（契约、预言机、资产均已停用）。
        // ⚠ 部署新合约并发行新资产后，此值必须与链上实际 serial 一致。
        const val HACDS_SERIAL = 3000L
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
        return AppConfig(
            node = sp.getString("node", AppConfig.DEFAULT_NODE) ?: AppConfig.DEFAULT_NODE,
            oracle = sp.getString("oracle", AppConfig.DEFAULT_ORACLE) ?: AppConfig.DEFAULT_ORACLE,
            contract = sp.getString("contract", AppConfig.DEFAULT_CONTRACT) ?: AppConfig.DEFAULT_CONTRACT,
            indexer = sp.getString("indexer", AppConfig.DEFAULT_INDEXER) ?: AppConfig.DEFAULT_INDEXER,
            lang = sp.getString("lang", "zh-CN") ?: "zh-CN",
            treasury = sp.getString("treasury", AppConfig.DEFAULT_TREASURY) ?: AppConfig.DEFAULT_TREASURY,
        )
    }

    fun save(cfg: AppConfig) {
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
