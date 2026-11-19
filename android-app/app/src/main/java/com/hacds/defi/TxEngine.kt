package com.hacds.defi

/**
 * Rust 交易引擎的 Kotlin 绑定（JNI）。
 *
 * 与 PC 版 `hacds_txbuild.exe` **共用同一份 Rust 代码**（testkit::txbuild::run），
 * 因此同样的 key + 同样的参数 → 同样的 `signed_tx_hex`（字节级一致）。
 *
 * 约定（与 Rust 侧 `android-jni/src/lib.rs` 的导出符号一一对应）：
 *   Java_com_hacds_defi_TxEngine_nativeRun
 *   Java_com_hacds_defi_TxEngine_nativeRunWithKey
 *   Java_com_hacds_defi_TxEngine_nativeVersion
 *
 * 私钥安全：解密后的私钥只在**进程内存**里传给 Rust（nativeRunWithKey），
 * Rust 侧用后即清，**不落盘、不经网络、不进 WebView**。
 */
object TxEngine {

    /** 加载原生库；失败时抛异常，由上层给出可读提示（对应 PC D48 引擎模式自检）。 */
    @Volatile
    private var loaded = false
    private var loadError: String? = null

    /**
     * 已知的 .so 哈希（2026-11-15 审计 M-8 / A-50）。
     *
     * 为什么要校验：`.so` 里是**交易构造与签名**的全部逻辑。如果 APK 被二次打包
     * 换掉引擎，就能在用户不知情下构造出与 UI 显示不符的交易（改收款地址、
     * 改金额）。签名校验只保护 APK 完整性，root/注入场景下仍需这一层。
     *
     * ⚠ 重新编译 JNI 引擎后**必须同步更新**这里，否则应用会拒绝加载。
     * 校验值来源：`sha256sum app/src/main/jniLibs/<abi>/libhacds_txbuild.so`
     */
    private val KNOWN_SO_SHA256 = mapOf(
        "arm64-v8a" to "5009dc2b8fd1c52e423d983d3ded6dde2ac9a6e4da882e36cb4c906bb9e28593",
        "x86_64" to "7640b3d629920a6404b0be5c32915cbba15c8151a2f79c3cdff16a54585f2305",
    )

    /** 校验本机安装的 .so 是否与已知哈希一致。拿不到文件或哈希不符都返回 false。 */
    private fun verifySoHash(ctx: android.content.Context): Boolean {
        if (KNOWN_SO_SHA256.isEmpty()) return true          // 未配置则跳过（兼容旧构建）
        val abi = android.os.Build.SUPPORTED_ABIS.firstOrNull() ?: return false
        val expect = KNOWN_SO_SHA256[abi] ?: return true    // 未登记的 ABI 跳过
        val dir = ctx.applicationInfo.nativeLibraryDir ?: return false
        val f = java.io.File(dir, "libhacds_txbuild.so")
        if (!f.exists()) return false
        return try {
            val md = java.security.MessageDigest.getInstance("SHA-256")
            f.inputStream().use { ins ->
                val buf = ByteArray(8192)
                while (true) {
                    val n = ins.read(buf)
                    if (n <= 0) break
                    md.update(buf, 0, n)
                }
            }
            val got = md.digest().joinToString("") { "%02x".format(it) }
            got == expect
        } catch (t: Throwable) {
            false
        }
    }

    private var appCtx: android.content.Context? = null

    fun attachContext(ctx: android.content.Context) {
        appCtx = ctx.applicationContext
    }

    @Synchronized
    fun ensureLoaded(): Boolean {
        if (loaded) return true
        if (loadError != null) return false
        // 哈希校验（A-50）：不通过直接拒绝加载，不降级
        val ctx = appCtx
        if (ctx != null && !verifySoHash(ctx)) {
            loadError = "交易引擎校验失败：libhacds_txbuild.so 与已知版本不符，" +
                    "请从官方渠道重新安装"
            return false
        }
        return try {
            System.loadLibrary("hacds_txbuild")
            loaded = true
            true
        } catch (t: Throwable) {
            loadError = t.message ?: t.toString()
            false
        }
    }

    fun loadErrorMessage(): String? = loadError

    private external fun nativeRun(argv: Array<String>): String
    private external fun nativeRunWithKey(argv: Array<String>, keyHex: String, label: String): String
    private external fun nativeVersion(): String
    private external fun nativeSetOverrides(fee: String, gasMax: Int)
    private external fun nativeClearOverrides()

    /** 引擎版本（连通性自检用）。 */
    fun version(): String =
        if (ensureLoaded()) nativeVersion() else "engine-not-loaded: $loadError"

    /**
     * 执行一次引擎调用。[argv] 与 CLI 参数一一对齐，argv[0] 随便填（占位）。
     * 返回捕获的输出文本（等价 CLI stdout）。
     */
    fun run(argv: List<String>): String {
        if (!ensureLoaded()) return "[ENGINE ERROR] native library not loaded: $loadError"
        return nativeRun(argv.toTypedArray())
    }

    /**
     * 带私钥的调用：私钥以 64-hex 明文传入（内部转成 Rust 的进程内覆盖），
     * 用于构建即签名的模式（build/sign/combo ...）。[label] 仅用于回显。
     */
    fun runWithKey(argv: List<String>, keyHex: String, label: String = "<wallet>"): String {
        if (!ensureLoaded()) return "[ENGINE ERROR] native library not loaded: $loadError"
        return nativeRunWithKey(argv.toTypedArray(), keyHex, label)
    }

    /** 设置进程内 fee / gas_max 覆盖（Android 改不了 JVM 进程 env 的等价物）。 */
    fun setOverrides(fee: String?, gasMax: Int?) {
        if (!ensureLoaded()) return
        nativeSetOverrides(fee ?: "", gasMax ?: 0)
    }

    /** 清空全部进程内覆盖（用后即清）。 */
    fun clearOverrides() {
        if (!ensureLoaded()) return
        nativeClearOverrides()
    }
}
