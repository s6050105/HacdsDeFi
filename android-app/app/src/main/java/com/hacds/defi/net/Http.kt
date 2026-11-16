package com.hacds.defi.net

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * HTTP 访问节点 / 预言机 / 索引器。
 *
 * 【并发闸门】节点对 sandboxcall 有**每 IP 并发上限 = 2**（D45），超出即返回
 * `sandbox_per_ip_concurrency_exceeded`。钱包多个面板会一次性并发多个 sandboxcall，
 * 若不加闸门，被拒的请求会随机落到某个字段上 → UI 显示 `—`，且每次刷新失败的字段不同。
 * 因此把**所有 sandboxcall 串行化到单飞（并发 1）**，并针对忙碌类错误做指数退避重试。
 */
object Http {

    private val TEXT_PLAIN = "text/plain; charset=utf-8".toMediaType()

    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .writeTimeout(20, TimeUnit.SECONDS)
        .build()

    /** sandboxcall 单飞锁（全局并发 1）。 */
    private val sandboxLock = Mutex()

    private val RETRYABLE = Regex(
        "sandbox_(per_ip|global)_concurrency_exceeded|sandbox_busy|state changed|service unavailable",
        RegexOption.IGNORE_CASE,
    )

    class HttpError(message: String) : Exception(message)

    // ⚠ 2026-11-15 审计 H-10：所有出网请求统一挡在 https 上。
    //
    //   原实现只靠 Manifest 的 usesCleartextTraffic 控制，而那个开关当时是
    //   true（全放行）；且端点可在设置页自由填写，http:// 也能存进去。
    //   对签名应用来说，明文链路可被中间人篡改查询响应与交易构造数据 ——
    //   改一个"看起来正常的余额"或"目标合约地址"就是直接盗币。
    //
    //   现在在**唯一出口**校验：不是 https 就不发请求。
    //   接口串是 http:// 时给明确错误，而不是静默失败。
    private fun requireHttps(url: String) {
        val u = url.trim()
        if (!u.startsWith("https://", ignoreCase = true)) {
            throw HttpError(
                "只允许 HTTPS 端点（当前：${u.take(40)}…）。" +
                    "请到设置页把节点/索引器地址改成 https://"
            )
        }
    }

    private fun getRaw(url: String): JSONObject {
        requireHttps(url)
        return getRawUnchecked(url)
    }

    private fun getRawUnchecked(url: String): JSONObject = client.newCall(
        Request.Builder().url(url).get().build()
    ).execute().use { resp ->
        val body = resp.body?.string() ?: ""
        if (!resp.isSuccessful) throw HttpError("HTTP ${resp.code}: ${body.take(200)}")
        try {
            JSONObject(body)
        } catch (e: Exception) {
            throw HttpError("响应不是 JSON: ${body.take(200)}")
        }
    }

    /** 普通 GET（非 sandboxcall，不占闸门）。 */
    fun getJson(url: String): JSONObject = getRaw(url)

    /** 带指数退避重试的 GET：针对并发/忙碌类错误（最多 4 次）。 */
    private suspend fun getJsonRetry(url: String, tries: Int = 4): JSONObject {
        var last: String? = null
        for (i in 0 until tries) {
            try {
                val d = getRaw(url)
                val err = d.optString("err", "")
                if (err.isNotEmpty() && RETRYABLE.containsMatchIn(err)) {
                    last = err
                } else {
                    return d
                }
            } catch (e: Exception) {
                last = e.message ?: e.toString()
                if (!RETRYABLE.containsMatchIn(last)) throw e
            }
            delay((80L shl i))   // 80/160/320/640ms
        }
        throw HttpError(last ?: "请求失败")
    }

    /**
     * sandboxcall 统一入口：过并发闸门 + 退避重试。
     * **所有**沙箱查询都必须走这里，否则又会出现「刷新间字段随机为空」。
     */
    suspend fun sandboxGet(url: String): JSONObject = sandboxLock.withLock {
        withContext(Dispatchers.IO) { getJsonRetry(url) }
    }

    /** POST（广播 / 校验），body 为字符串。 */
    fun post(url: String, body: String): JSONObject {
        requireHttps(url)
        return postUnchecked(url, body)
    }

    private fun postUnchecked(url: String, body: String): JSONObject = client.newCall(
        Request.Builder().url(url)
            .post(body.toRequestBody(TEXT_PLAIN))
            .build()
    ).execute().use { resp ->
        val b = resp.body?.string() ?: ""
        try {
            JSONObject(b)
        } catch (e: Exception) {
            JSONObject().put("ret", resp.code).put("raw", b)
        }
    }

    suspend fun postAsync(url: String, body: String): JSONObject =
        withContext(Dispatchers.IO) { post(url, body) }

    suspend fun getJsonAsync(url: String): JSONObject = withContext(Dispatchers.IO) { getRaw(url) }

    /** URL 编码一个查询参数值。 */
    fun enc(s: String): String = java.net.URLEncoder.encode(s, "UTF-8")
}
