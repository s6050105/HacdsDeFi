package com.hacds.defi.wallet

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity

/**
 * 生物识别解锁（D-A5 / 4.2 新增）。作为**可选项**：开启后打开钱包需指纹/面容。
 * 私钥仍由 Android Keystore 保护，生物识别只是额外的「准入闸门」。
 */
object Biometric {

    /** 设备是否支持并已录入生物识别。 */
    fun isAvailable(ctx: Context): Boolean {
        val mgr = BiometricManager.from(ctx)
        return mgr.canAuthenticate(
            BiometricManager.Authenticators.BIOMETRIC_WEAK or
                    BiometricManager.Authenticators.DEVICE_CREDENTIAL
        ) == BiometricManager.BIOMETRIC_SUCCESS
    }

    // ---- 生物识别开关的持久化（M-11 P0）----
    //
    // 原实现 `var useBio by remember { mutableStateOf(false) }`：
    //   · 默认 **false** → 默认不设防
    //   · 不持久化 → 每次重启复位成 false
    // 效果等于「生物识别这道门默认是开的」。
    //
    // 这里改为持久化 + 默认 true（首次安装即设防）。
    // 注意：真正的强制保护仍是 `setUserAuthenticationRequired(true)`（P1），
    // 本开关只是应用层的 UX 闸门，绕过它仍需系统认证才安全。
    private const val PREF = "hacds_bio"
    private const val KEY_ENABLED = "enabled"

    fun isEnabled(ctx: android.content.Context): Boolean =
        ctx.getSharedPreferences(PREF, android.content.Context.MODE_PRIVATE)
            .getBoolean(KEY_ENABLED, true)      // 默认开

    fun setEnabled(ctx: android.content.Context, on: Boolean) {
        ctx.getSharedPreferences(PREF, android.content.Context.MODE_PRIVATE)
            .edit().putBoolean(KEY_ENABLED, on).apply()
    }

    /**
     * 弹出生物识别提示。
     *
     * ⚠ 2026-11-15 审计 H-11：新增 [cipher] 参数，把 Cipher 绑进 CryptoObject。
     *
     *   原实现 `bp.authenticate(info)` **不传 CryptoObject** —— 内部的
     *   `setUserAuthenticationRequired(false)` 主密钥根本不看认证结果，
     *   任何能调用 [AndroidKeyVault.open] 的代码（root / Frida / 注入）
     *   都能直接解密，指纹只是 UI 上的装饰。
     *
     *   现在：调用方必须先 `AndroidKeyVault.prepareDecrypt(sealed)` 拿到
     *   Cipher，再传进来。认证通过后 [onOk] 收到的 `result.cryptoObject`
     *   里才是**被硬件解锁**的那个 Cipher，只有它能解出私钥。
     *
     * @param cipher 必须来自 [AndroidKeyVault.prepareDecrypt]；
     *               传 null 只用于"确认操作"类场景（不涉及解密）。
     */
    fun prompt(
        activity: FragmentActivity,
        title: String = "解锁钱包",
        subtitle: String = "验证指纹 / 面容",
        cipher: javax.crypto.Cipher? = null,
        onOk: (javax.crypto.Cipher?) -> Unit,
        onFail: (String) -> Unit,
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val bp = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                // 把被解锁的 Cipher 交回调用方，而不是只给一个布尔结果
                onOk(result.cryptoObject?.cipher)
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                onFail(errString.toString())
            }
        })
        val info = BiometricPrompt.PromptInfo.Builder()
            .setTitle(title)
            .setSubtitle(subtitle)
            .setAllowedAuthenticators(
                BiometricManager.Authenticators.BIOMETRIC_WEAK or
                        BiometricManager.Authenticators.DEVICE_CREDENTIAL
            )
            .build()

        if (cipher != null) {
            bp.authenticate(info, BiometricPrompt.CryptoObject(cipher))
        } else {
            bp.authenticate(info)
        }
    }
}
