package com.hacds.defi.wallet

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/**
 * 当前解锁会话（单例）。私钥只在此进程内存中驻留，锁定 / 退出即清空
 * （与 PC 版 `sessionKeyHex` 同语义；D32「锁定/退出」文案）。
 */
object WalletSession {

    data class State(
        val unlocked: Boolean = false,
        val address: String? = null,
        val label: String? = null,
        val keyHex: String? = null,     // 仅内存；不外泄
    )

    private val _state = MutableStateFlow(State())
    val state: StateFlow<State> = _state

    val isUnlocked: Boolean get() = _state.value.unlocked
    val address: String? get() = _state.value.address
    val keyHex: String? get() = _state.value.keyHex

    fun unlock(address: String, keyHex: String, label: String? = null) {
        _state.value = State(true, address, label, keyHex)
    }

    fun lock() {
        _state.value = State()
    }
}
