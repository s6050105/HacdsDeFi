package com.hacds.defi.engine

import com.hacds.defi.TxEngine

/**
 * 引擎进程内覆盖的便捷入口。
 *
 * Android 无法给 JVM 进程设置环境变量（`HACDS_FEE` / `HACDS_GAS_MAX`），
 * 故改为由 Rust 侧提供**进程内覆盖**（优先级高于 env），语义与 PC 完全一致。
 */
object EngineBridge {

    /** 同时设置 fee 与 gas_max（null 表示不覆盖该项）。 */
    fun setOverrides(fee: String?, gasMax: Int?) {
        TxEngine.setOverrides(fee, gasMax)
    }

    fun setFeeOverride(fee: String) = setOverrides(fee, null)
    fun setGasMaxOverride(gasMax: Int) = setOverrides(null, gasMax)

    fun clearOverrides() = TxEngine.clearOverrides()
}
