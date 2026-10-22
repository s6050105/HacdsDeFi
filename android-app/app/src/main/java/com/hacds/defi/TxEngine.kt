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

    @Synchronized
    fun ensureLoaded(): Boolean {
        if (loaded) return true
        if (loadError != null) return false
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
