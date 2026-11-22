package com.xiaopang.naiwamusic.bridge

import android.media.AudioDeviceInfo
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AndroidJsBridgeAudioOutputTest {
    @Test
    fun detectsWiredAndBluetoothOutputsAsExternal() {
        assertTrue(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_WIRED_HEADSET))
        assertTrue(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_WIRED_HEADPHONES))
        assertTrue(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP))
        assertTrue(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_BLUETOOTH_SCO))
        assertTrue(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_USB_HEADSET))
        assertTrue(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_USB_DEVICE))
        assertTrue(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_AUX_LINE))
    }

    @Test
    fun rejectsBuiltInSpeakerAndEarpieceAsNonExternal() {
        assertFalse(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER))
        assertFalse(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_BUILTIN_EARPIECE))
        assertFalse(AndroidJsBridge.isExternalAudioDeviceType(AudioDeviceInfo.TYPE_UNKNOWN))
    }
}
