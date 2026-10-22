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
        const val DEFAULT_NODE = "http://43.251.101.101:8082"
        const val DEFAULT_ORACLE = "http://43.251.101.101:8123"
        const val DEFAULT_CONTRACT = "VKNwXFFMCEn9XfMrhyHhd5rHqBnEyM3m1"
        const val DEFAULT_INDEXER = "http://43.251.101.101:8124"
        const val DEFAULT_TREASURY = "1FbwjELGMmaomNQq3ZZ6hdgQ17GRGwzAzK"
        const val HACDS_SERIAL = 2000L
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
