package com.hacds.defi

import android.app.Application
import com.hacds.defi.ui.Strings

/**
 * 全局 Application：注入 i18n 的 app context（供非 Composable 场景取词）。
 * 语言落实在 MainActivity.attachBaseContext（见 LocaleHelper）。
 */
class HacdsApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Strings.appContext = this
        // 冷启动即应用已保存的语言（写进程级 Resources）
        val saved = com.hacds.defi.ui.LocaleHelper.saved(this)
        if (saved.isNotEmpty()) com.hacds.defi.ui.LocaleHelper.applyToResources(this, saved)
    }
}
