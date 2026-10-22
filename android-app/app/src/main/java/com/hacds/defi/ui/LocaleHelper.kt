package com.hacds.defi.ui

import android.app.Activity
import android.content.Context
import android.content.res.Configuration
import android.os.Build
import android.os.LocaleList
import java.util.Locale

/**
 * 语言切换的**自实现**方案（不依赖 AppCompat / 系统 per-app locale）。
 *
 * 为什么不用 `AppCompatDelegate.setApplicationLocales`：本机模拟器（MuMu，API 32 非标准）
 * 缺 `locale` 系统服务，per-app locale 完全不生效（已实测）。
 *
 * ⚠ 关键教训：只在 `attachBaseContext` 里包 Locale **不够** —— `recreate()` 时传入的
 * `newBase` 仍带旧 configuration，导致切换后文案不变（已实测踩坑）。
 * 正确做法：**同时**改写 `Resources` 的全局 configuration（[applyToResources]），再 recreate。
 */
object LocaleHelper {

    private const val PREF = "hacds_cfg"
    private const val KEY = "lang"

    fun localeOf(lang: String): Locale = when (lang) {
        "en" -> Locale.ENGLISH
        "tr" -> Locale("tr", "TR")
        else -> Locale.SIMPLIFIED_CHINESE
    }

    fun saved(ctx: Context): String =
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).getString(KEY, "") ?: ""

    /**
     * 保存语言偏好。
     * ⚠ 必须用 `commit()`（同步写盘）而非 `apply()`：切换流程末尾会立即杀进程重启，
     * `apply()` 是异步的，进程一死写盘就丢（实测踩坑：prefs 始终停在旧语言）。
     */
    fun save(ctx: Context, lang: String) {
        ctx.getSharedPreferences(PREF, Context.MODE_PRIVATE).edit().putString(KEY, lang).commit()
    }

    /** 用目标 Locale 包装 base context（在 Activity.attachBaseContext 里调）。 */
    fun wrap(base: Context): Context {
        val lang = saved(base)
        if (lang.isEmpty()) return base   // 跟随系统
        val loc = localeOf(lang)
        Locale.setDefault(loc)
        val cfg = Configuration(base.resources.configuration)
        cfg.setLocale(loc)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            cfg.setLocales(LocaleList(loc))
        }
        return base.createConfigurationContext(cfg)
    }

    /**
     * 把 Locale 写到**进程级 Resources**（`updateConfiguration` 的现代替代），
     * 之后 `recreate()` 才会真正用新语言重建。
     */
    fun applyToResources(ctx: Context, lang: String) {
        val loc = localeOf(lang)
        Locale.setDefault(loc)
        val res = ctx.resources
        val cfg = Configuration(res.configuration)
        cfg.setLocale(loc)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) cfg.setLocales(LocaleList(loc))
        @Suppress("DEPRECATION")
        res.updateConfiguration(cfg, res.displayMetrics)
    }

    /**
     * 切换语言并**重启应用进程**，使新语言生效。
     *
     * 为什么不是单纯 `recreate()`：本机模拟器（MuMu/API32）上 `recreate()` 不重新解析资源
     * （实测：选中标记变了、文案不变）。重启进程最可靠，且此处切换是低频操作，代价可接受。
     */
    fun switchAndRecreate(ctx: Context, lang: String) {
        save(ctx, lang)
        applyToResources(ctx, lang)
        val app = ctx.applicationContext
        val intent = app.packageManager.getLaunchIntentForPackage(app.packageName)
        intent?.addFlags(
            android.content.Intent.FLAG_ACTIVITY_NEW_TASK or
                    android.content.Intent.FLAG_ACTIVITY_CLEAR_TASK
        )
        app.startActivity(intent)
        Runtime.getRuntime().exit(0)
    }
}
