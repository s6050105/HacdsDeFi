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

    /** 弹出生识别提示；[onOk] 认证通过时回调，[onFail] 取消/失败时回调。 */
    fun prompt(
        activity: FragmentActivity,
        title: String = "解锁钱包",
        subtitle: String = "验证指纹 / 面容",
        onOk: () -> Unit,
        onFail: (String) -> Unit,
    ) {
        val executor = ContextCompat.getMainExecutor(activity)
        val bp = BiometricPrompt(activity, executor, object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                onOk()
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
        bp.authenticate(info)
    }
}
