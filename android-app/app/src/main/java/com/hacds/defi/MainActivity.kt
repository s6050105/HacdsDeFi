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

        // M-12 补充：禁止系统截屏与最近任务缩略图。
        //
        // 本应用会显示私钥（导出页）、助记词与交易详情，这些内容一旦进入
        // 最近任务缩略图或录屏，就等于明文外泄 —— 而 KeyStore 加密保护的是
        // 「磁盘上的私钥」，管不到「屏幕上的私钥」。
        //
        // FLAG_SECURE 会让：
        //   · 系统截图返回黑屏
        //   · 最近任务列表显示空白卡片
        //   · 录屏/投屏内容被遮挡
        // 代价：用户无法自行截图（对钱包类应用是合理取舍）。
        window.setFlags(
            android.view.WindowManager.LayoutParams.FLAG_SECURE,
            android.view.WindowManager.LayoutParams.FLAG_SECURE,
        )

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
