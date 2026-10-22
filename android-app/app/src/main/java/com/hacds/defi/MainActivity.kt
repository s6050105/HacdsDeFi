package com.hacds.defi

import android.content.Context
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.appcompat.app.AppCompatActivity
import com.hacds.defi.ui.AppRoot
import com.hacds.defi.ui.LocaleHelper

/**
 * 继承 [AppCompatActivity]（为了 BiometricPrompt）。
 *
 * 语言：用 [LocaleHelper] 自实现（`attachBaseContext` 包 Locale + `recreate()` 生效），
 * 不依赖 AppCompat 的 per-app locale —— 后者在本机模拟器（MuMu/API32）不生效（已实测）。
 */
class MainActivity : AppCompatActivity() {

    override fun attachBaseContext(newBase: Context) {
        // 关键：在任何资源解析前，把目标 Locale 注入 base context
        super.attachBaseContext(LocaleHelper.wrap(newBase))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // 调试/自动化：intent extra "lang"（zh-CN/en/tr）可直接切换语言并重启
        intent?.getStringExtra("lang")?.takeIf { it.isNotEmpty() }?.let { l ->
            com.hacds.defi.ui.LocaleHelper.switchAndRecreate(this, l)
            return
        }

        // tr() 也走 base context（已带 Locale），保证非 Composable 取词与 UI 一致
        com.hacds.defi.ui.Strings.appContext = baseContext
        setContent { AppRoot() }
    }
}
