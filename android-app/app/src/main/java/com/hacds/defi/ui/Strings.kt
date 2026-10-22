package com.hacds.defi.ui

import android.content.Context
import com.hacds.defi.R

/**
 * i18n 取词（D28/D36/D47）。键与 PC 版 `i18n.js` 一一对应（475 条 × 中/英/土），
 * 资源名 = 键里的 `.` 换成 `_`。文案里的 {x} 占位在 PC 侧已转成 %1$s。
 *
 * 文案中可能残留 web 的 HTML 标签（如 &lt;b&gt;），显示前统一剥离。
 */
object Strings {

    /** 全局 Application context（MainActivity 启动时注入），供非 Composable 场景取词。 */
    @Volatile
    var appContext: Context? = null

    private val cache = HashMap<String, Int>()
    private val TAG_RE = Regex("<[^>]*>")

    fun t(ctx: Context, key: String, vararg args: Any?): String {
        val id = cache.getOrPut(key) {
            ctx.resources.getIdentifier(key.replace('.', '_'), "string", ctx.packageName)
        }
        val raw = if (id != 0) {
            try {
                if (args.isEmpty()) ctx.getString(id) else ctx.getString(id, *args)
            } catch (e: Exception) {
                ctx.getString(id)
            }
        } else {
            key
        }
        return TAG_RE.replace(raw, "").replace("&lt;", "<").replace("&gt;", ">").replace("&amp;", "&")
    }
}

/**
 * 取词（**非 Composable**，可在 onClick / 协程 / 普通函数里用）。
 * 语言切换时 AppCompat 会重建 Activity，整个 UI 重新取词，故无需靠重组刷新。
 */
fun tr(key: String, vararg args: Any?): String {
    val ctx = Strings.appContext ?: return key
    return Strings.t(ctx, key, *args)
}

/**
 * 语言切换（D28/D36/D47）。
 *
 * 用 **AndroidX per-app language**（`AppCompatDelegate.setApplicationLocales`）：
 *  - API 33+ 走系统原生 per-app locale（在系统设置里也会显示）
 *  - API <33 由 AppCompat 在本进程内维护并**自动重建 Activity** —— 切换**即时生效**，无需手动重启
 *
 * 备选（已弃用）：`Resources.updateConfiguration` 在 API 25+ 已废弃，且不会触发 Compose 重组。
 */
object LangManager {

    /** 语言码 → Locale。 */
    fun localeOf(lang: String): java.util.Locale = when (lang) {
        "en" -> java.util.Locale.ENGLISH
        "tr" -> java.util.Locale("tr", "TR")
        else -> java.util.Locale.SIMPLIFIED_CHINESE
    }

    /**
     * 应用语言。切换后系统/AppCompat 会自动重建 Activity → 文案**立即**变成新语言。
     * [persist] 同时写入 SharedPreferences（供本 App 自己读回）。
     */
    fun apply(ctx: Context, lang: String, persist: Boolean = true) {
        val locales = androidx.core.os.LocaleListCompat.forLanguageTags(lang)
        androidx.appcompat.app.AppCompatDelegate.setApplicationLocales(locales)
        if (persist) {
            ctx.getSharedPreferences("hacds_cfg", Context.MODE_PRIVATE)
                .edit().putString("lang", lang).apply()
        }
    }

    /** 当前生效的语言码（优先取自 AppCompat，其次配置）。 */
    fun current(): String {
        val tags = androidx.appcompat.app.AppCompatDelegate.getApplicationLocales()
        val t = if (!tags.isEmpty) tags.toLanguageTags() else ""
        return when {
            t.startsWith("en") -> "en"
            t.startsWith("tr") -> "tr"
            t.startsWith("zh") -> "zh-CN"
            else -> ""
        }
    }

    /** 已保存的语言标签；未设置时跟随系统（返回空串表示"系统默认"）。 */
    fun currentTagOrSystem(ctx: Context): String {
        val cur = current()
        if (cur.isNotEmpty()) return cur
        return ctx.getSharedPreferences("hacds_cfg", Context.MODE_PRIVATE)
            .getString("lang", "") ?: ""
    }
}
