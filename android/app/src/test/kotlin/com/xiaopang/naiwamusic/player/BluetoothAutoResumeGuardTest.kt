package com.xiaopang.naiwamusic.player

import android.media.AudioDeviceInfo
import android.os.Build
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BluetoothAutoResumeGuardTest {

    private fun a2dp(id: Int = 101) = BluetoothDeviceSnapshot(
        id = id,
        type = AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
        isSink = true
    )

    private fun bleHeadset(id: Int = 202) = BluetoothDeviceSnapshot(
        id = id,
        type = AudioDeviceInfo.TYPE_BLE_HEADSET,
        isSink = true
    )

    @Test
    fun identifiesSupportedBluetoothOutputDeviceTypesAcrossSdkLevels() {
        assertTrue(
            BluetoothAutoResumeGuard.isBluetoothResumeDeviceType(
                AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                sdkInt = Build.VERSION_CODES.O
            )
        )
        assertTrue(
            BluetoothAutoResumeGuard.isBluetoothResumeDeviceType(
                AudioDeviceInfo.TYPE_BLE_HEADSET,
                sdkInt = Build.VERSION_CODES.S
            )
        )
        assertFalse(
            BluetoothAutoResumeGuard.isBluetoothResumeDeviceType(
                AudioDeviceInfo.TYPE_BLE_HEADSET,
                sdkInt = Build.VERSION_CODES.R
            )
        )
        assertFalse(
            BluetoothAutoResumeGuard.isBluetoothResumeDeviceType(
                AudioDeviceInfo.TYPE_BUILTIN_SPEAKER,
                sdkInt = Build.VERSION_CODES.S
            )
        )
        assertFalse(
            BluetoothAutoResumeGuard.isBluetoothResumeDeviceType(
                AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
                sdkInt = Build.VERSION_CODES.S
            )
        )
        assertFalse(
            BluetoothAutoResumeGuard.isBluetoothResumeDeviceType(
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                sdkInt = Build.VERSION_CODES.S
            )
        )
    }

    @Test
    fun ignoresInitialCallbackSnapshotAndGraceWindowToPreventColdStartAutoplay() {
        val guard = BluetoothAutoResumeGuard()
        val existingBt = a2dp(11)
        guard.onRegistered(nowMs = 1_000L, existingDevices = listOf(existingBt))
        guard.onPlaybackStarted(1_200L)
        guard.onPlaybackPaused(1_400L, byAudioFocusLoss = false, byBecomingNoisy = false)

        // 1. 注册后系统的第一次快照回调即使带有有效播放上下文也必须被忽略
        assertFalse(
            guard.onAudioDevicesAdded(
                devices = listOf(existingBt),
                nowMs = 5_000L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )

        // 2. 冷启动宽限期内（< 1500ms）新设备回调也不得触发误播
        val guard2 = BluetoothAutoResumeGuard()
        guard2.onRegistered(nowMs = 1_000L, existingDevices = emptyList())
        // 消耗初始空快照回调
        assertFalse(
            guard2.onAudioDevicesAdded(
                devices = listOf(
                    BluetoothDeviceSnapshot(1, AudioDeviceInfo.TYPE_BUILTIN_SPEAKER, isSink = true)
                ),
                nowMs = 1_010L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )
        guard2.onPlaybackStarted(1_100L)
        guard2.onPlaybackPaused(1_200L, byAudioFocusLoss = false, byBecomingNoisy = true)
        assertFalse(
            guard2.onAudioDevicesAdded(
                devices = listOf(a2dp(22)),
                nowMs = 2_000L, // registeredAt=1000 -> elapsed=1000 < 1500
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )
    }

    @Test
    fun resumesPausedTrackOnGenuineBluetoothReconnectWithinWindowAndRespectsCooldown() {
        val guard = BluetoothAutoResumeGuard()
        val headset = a2dp(301)
        guard.onRegistered(nowMs = 1_000L, existingDevices = listOf(headset))
        // 消费系统首次回调
        assertFalse(
            guard.onAudioDevicesAdded(
                devices = listOf(headset),
                nowMs = 1_020L,
                featureEnabled = true,
                hasActiveTrack = false,
                isPlaying = false,
                isPausedReadyState = false,
                isInCallOrCommunication = false
            )
        )

        // 开始播放 -> 蓝牙断开导致噪音保护暂停 -> 5 分钟后重新连接同一蓝牙耳机
        guard.onPlaybackStarted(5_000L)
        assertTrue(guard.onAudioDevicesRemoved(listOf(headset), nowMs = 60_000L, hasActiveTrack = true))
        guard.onPlaybackPaused(60_020L, byAudioFocusLoss = false, byBecomingNoisy = true)

        assertTrue(
            guard.onAudioDevicesAdded(
                devices = listOf(headset),
                nowMs = 360_000L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )

        // 冷却窗口内（3s）同时收到 BLE Audio 补充通道回调，不再重复触发
        assertFalse(
            guard.onAudioDevicesAdded(
                devices = listOf(bleHeadset(302)),
                nowMs = 360_250L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false,
                sdkInt = Build.VERSION_CODES.S
            )
        )
    }

    @Test
    fun blocksAutoResumeWhenDisabledOrAudioFocusInterruptedOrInCallOrWindowExpired() {
        fun preparedGuard(): BluetoothAutoResumeGuard {
            val g = BluetoothAutoResumeGuard()
            g.onRegistered(nowMs = 1_000L, existingDevices = emptyList())
            g.onAudioDevicesAdded(
                devices = emptyList(),
                nowMs = 1_010L,
                featureEnabled = true,
                hasActiveTrack = false,
                isPlaying = false,
                isPausedReadyState = false,
                isInCallOrCommunication = false
            )
            g.onPlaybackStarted(5_000L)
            g.onPlaybackPaused(10_000L, byAudioFocusLoss = false, byBecomingNoisy = true)
            return g
        }

        // 开关关闭
        assertFalse(
            preparedGuard().onAudioDevicesAdded(
                devices = listOf(a2dp(1)),
                nowMs = 20_000L,
                featureEnabled = false,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )

        // 通话中或系统通信模式
        assertFalse(
            preparedGuard().onAudioDevicesAdded(
                devices = listOf(a2dp(2)),
                nowMs = 20_000L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = true
            )
        )

        // 被其他 App 或来电音频焦点抢占导致的暂停
        val focusLostGuard = preparedGuard()
        focusLostGuard.onPlaybackPaused(12_000L, byAudioFocusLoss = true, byBecomingNoisy = false)
        assertFalse(
            focusLostGuard.onAudioDevicesAdded(
                devices = listOf(a2dp(3)),
                nowMs = 20_000L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )

        // 瞬时音频焦点抑制（如电话振铃）
        val suppressedGuard = preparedGuard()
        suppressedGuard.isAudioFocusSuppressed = true
        assertFalse(
            suppressedGuard.onAudioDevicesAdded(
                devices = listOf(a2dp(4)),
                nowMs = 20_000L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )

        // 超出 30 分钟重连合理时间窗
        assertFalse(
            preparedGuard().onAudioDevicesAdded(
                devices = listOf(a2dp(5)),
                nowMs = 10_000L + BluetoothAutoResumeGuard.RECONNECT_WINDOW_MS + 1L,
                featureEnabled = true,
                hasActiveTrack = true,
                isPlaying = false,
                isPausedReadyState = true,
                isInCallOrCommunication = false
            )
        )

        // 用户手动 stop 后无活跃暂停状态
        val stoppedGuard = preparedGuard()
        stoppedGuard.onPlaybackStopped()
        assertFalse(
            stoppedGuard.onAudioDevicesAdded(
                devices = listOf(a2dp(6)),
                nowMs = 20_000L,
                featureEnabled = true,
                hasActiveTrack = false,
                isPlaying = false,
                isPausedReadyState = false,
                isInCallOrCommunication = false
            )
        )
    }
}
