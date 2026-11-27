package com.xiaopang.naiwamusic.player

import android.media.AudioDeviceInfo
import android.os.Build

internal data class BluetoothDeviceSnapshot(
    val id: Int,
    val type: Int,
    val isSink: Boolean
)

/**
 * 蓝牙耳机 / 车机（A2DP / LE Audio）重连自动续播判定器（无副作用纯逻辑，便于 JVM 单元测试）：
 * 1. 忽略 registerAudioDeviceCallback 注册瞬间系统立刻回传的“已连接设备列表”及宽限期内事件
 * 2. 屏蔽首次起播前尚无播放/断开上下文的冷启动场景
 * 3. 通话、振铃、音频焦点抢占期间触发的暂停绝不误续播
 * 4. 距上次断开蓝牙或主动播放/暂停超出 30 分钟窗口，或冷却时间内重复事件均不触发
 */
internal class BluetoothAutoResumeGuard(
    private val initialGraceMs: Long = INITIAL_CALLBACK_GRACE_MS,
    private val reconnectWindowMs: Long = RECONNECT_WINDOW_MS,
    private val cooldownMs: Long = RESUME_COOLDOWN_MS
) {
    companion object {
        const val INITIAL_CALLBACK_GRACE_MS = 1_500L
        const val RECONNECT_WINDOW_MS = 30L * 60L * 1000L
        const val RESUME_COOLDOWN_MS = 3_000L

        fun isBluetoothResumeDeviceType(type: Int, sdkInt: Int = Build.VERSION.SDK_INT): Boolean {
            if (type == AudioDeviceInfo.TYPE_BLUETOOTH_A2DP) return true
            if (sdkInt >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET) {
                return true
            }
            return false
        }
    }

    private var registeredAtMs: Long = 0L
    private var hasReceivedInitialSnapshot: Boolean = false
    private val knownBluetoothIds = HashSet<Int>()
    private var lastBluetoothDisconnectedAtMs: Long = 0L
    private var lastActivePlaybackAtMs: Long = 0L
    private var lastAutoResumeAtMs: Long = 0L

    @Volatile
    var pausedByAudioFocusLoss: Boolean = false

    @Volatile
    var isAudioFocusSuppressed: Boolean = false

    fun onRegistered(
        nowMs: Long,
        existingDevices: List<BluetoothDeviceSnapshot>,
        sdkInt: Int = Build.VERSION.SDK_INT
    ) {
        registeredAtMs = nowMs
        hasReceivedInitialSnapshot = false
        knownBluetoothIds.clear()
        existingDevices.forEach { device ->
            if (device.isSink && isBluetoothResumeDeviceType(device.type, sdkInt)) {
                knownBluetoothIds.add(device.id)
            }
        }
    }

    fun onPlaybackStarted(nowMs: Long) {
        lastActivePlaybackAtMs = nowMs
        lastBluetoothDisconnectedAtMs = 0L
        pausedByAudioFocusLoss = false
    }

    fun onPlaybackPaused(
        nowMs: Long,
        byAudioFocusLoss: Boolean,
        byBecomingNoisy: Boolean
    ) {
        if (byAudioFocusLoss) {
            pausedByAudioFocusLoss = true
        } else {
            pausedByAudioFocusLoss = false
            lastActivePlaybackAtMs = nowMs
        }
        if (byBecomingNoisy) {
            lastBluetoothDisconnectedAtMs = nowMs
        }
    }

    fun onPlaybackStopped() {
        lastBluetoothDisconnectedAtMs = 0L
        lastActivePlaybackAtMs = 0L
        pausedByAudioFocusLoss = false
    }

    fun onAudioDevicesRemoved(
        devices: List<BluetoothDeviceSnapshot>,
        nowMs: Long,
        hasActiveTrack: Boolean,
        sdkInt: Int = Build.VERSION.SDK_INT
    ): Boolean {
        val removedBt = devices.filter { it.isSink && isBluetoothResumeDeviceType(it.type, sdkInt) }
        if (removedBt.isEmpty()) return false
        removedBt.forEach { knownBluetoothIds.remove(it.id) }
        if (hasActiveTrack) {
            lastBluetoothDisconnectedAtMs = nowMs
        }
        return true
    }

    fun onAudioDevicesAdded(
        devices: List<BluetoothDeviceSnapshot>,
        nowMs: Long,
        featureEnabled: Boolean,
        hasActiveTrack: Boolean,
        isPlaying: Boolean,
        isPausedReadyState: Boolean,
        isInCallOrCommunication: Boolean,
        sdkInt: Int = Build.VERSION.SDK_INT
    ): Boolean {
        val btDevices = devices.filter { it.isSink && isBluetoothResumeDeviceType(it.type, sdkInt) }

        // registerAudioDeviceCallback 注册瞬间会立即回调当前已连接设备快照，必须无条件吸收并忽略
        if (!hasReceivedInitialSnapshot) {
            hasReceivedInitialSnapshot = true
            btDevices.forEach { knownBluetoothIds.add(it.id) }
            return false
        }

        val newBtDevices = btDevices.filter { it.id !in knownBluetoothIds }
        btDevices.forEach { knownBluetoothIds.add(it.id) }

        if (newBtDevices.isEmpty()) return false
        if (nowMs - registeredAtMs < initialGraceMs) return false
        if (!featureEnabled || !hasActiveTrack || isPlaying || !isPausedReadyState) return false
        if (pausedByAudioFocusLoss || isAudioFocusSuppressed || isInCallOrCommunication) return false
        if (lastAutoResumeAtMs > 0L && (nowMs - lastAutoResumeAtMs) < cooldownMs) return false

        val referenceTimeMs = if (lastBluetoothDisconnectedAtMs > 0L) {
            lastBluetoothDisconnectedAtMs
        } else {
            lastActivePlaybackAtMs
        }
        if (referenceTimeMs <= 0L || (nowMs - referenceTimeMs) > reconnectWindowMs) {
            return false
        }

        lastAutoResumeAtMs = nowMs
        return true
    }
}
