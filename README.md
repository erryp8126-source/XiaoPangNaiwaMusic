<p align="center">
  <img src="upstream/src/renderer/assets/icon.png" width="120" alt="小庞奶娃音乐" style="border-radius: 26px;" />
</p>

<h1 align="center">小庞奶娃音乐 · Android 版</h1>

<p align="center">
  基于开源音乐播放器 <a href="https://github.com/algerkong/AlgerMusicPlayer/releases/tag/v5.1.0">algerkong/AlgerMusicPlayer v5.1.0</a> 深度定制与移动端原生重构的 <b>Android 手机版音乐播放器</b>
</p>

<p align="center">
  <a href="https://github.com/erryp8126-source/XiaoPangNaiwaMusic/releases/latest">
    <img src="https://img.shields.io/badge/Download-Android%20APK-E89200?style=for-the-badge&logo=android&logoColor=white" alt="下载 Android APK" />
  </a>
</p>

---

## 核心特性

### 1. 全新「奶娃暖阳治愈风」移动 UI
- **专属暖阳琥珀金 × 晴空冰蓝配色体系**：提取奶娃头像的暖阳金与冰蓝微光，默认精致浅色磨砂玻璃质感，顶部一键 ☀️/🌙 切换暖夜星空暗黑模式。
- **悬浮磨砂玻璃交互**：悬浮胶囊底部 5 项图文导航栏（发现 / 歌单 / 排行 / 收藏 / 我的）、悬浮旋转唱片迷你播控条（带实时暖金进度细线与左右滑动切歌）。
- **沉浸式全屏播放器**：多层专辑封面极光流光背景、圆角封面呼吸动画（点击可切换方形 / 黑胶 / 全屏三种样式）、逐字歌词、翻译显示、倍速播放、定时关闭、播放队列底部抽屉。
- **清爽直达体验**：无启动免责与赞赏拦截弹窗，打开即听。

### 2. 手机内置本地网易云直连服务（免服务器，开箱即用）
- 原生 Kotlin 实现 `weapi` / `eapi` / `linuxapi` 加密协议与匿名 `MUSIC_A` 自动初始化，本地回环代理运行于 `127.0.0.1:30488`。
- 覆盖 80+ 网易云核心接口，本地 ZXing 实时生成扫码登录二维码，同时支持 Cookie 与 UID 登录。
- 支持在「设置 → 网络」中随时切换自建远程 `NeteaseCloudMusicApi` 地址与自定义音源解析接口。

### 3. 内置多音源解锁与插件兼容
- 内置酷我 / 酷狗 / 咪咕 / GD 音乐台多音源解析引擎。
- 通过原生 OkHttp 桥接绕过 WebView 跨域限制，支持导入落雪音源（LX Music `.js`）脚本与自定义 API（`.json`）配置。

### 4. Android 原生后台播放与系统体验
- 基于 **AndroidX Media3 ExoPlayer + MediaSession** 前台服务，支持熄屏后台播放、通知栏与锁屏控制（带封面与进度条拖动）、蓝牙耳机/车载线控切歌、拔耳机自动暂停与音频焦点管理。
- 接入 Android 硬件均衡器（`android.media.audiofx.Equalizer`），可在设置或全屏播放器「更多」菜单调节 10 段 EQ。
- 原生 **MediaStore 本地音乐扫描**（自动读取封面与同名 `.lrc` 歌词）与**离线歌曲/歌词下载管理**。
- 可选**系统桌面悬浮歌词窗**（支持拖拽定位与点击展开迷你切歌控制条）。
- Edge-to-Edge 全面屏安全区适配、系统状态栏深浅图标同步、系统返回键分层退出。

---

## 直接下载安装（Android 8.0+）

1. 打开本仓库的 [Releases 页面](https://github.com/erryp8126-source/XiaoPangNaiwaMusic/releases/latest) 下载 `小庞奶娃音乐-v5.1.0.apk`。
2. 传至安卓手机直接安装即可使用（如首次安装建议允许「通知权限」，以便锁屏与通知栏显示播放控制条）。
3. 如希望熄屏长时间后台播放更稳定，可在 App 内「设置 → 网络 → 后台播放保活」中开启电池优化白名单。

---

## 目录结构

```text
XiaoPangNaiwaMusic/
├── upstream/        # Vue 3 + Tailwind 移动端前端源码（含奶娃暖阳 UI 翻新与 Android 桥接）
├── android/         # Kotlin + Media3 ExoPlayer + NanoHTTPD Android Gradle 工程
├── releases/        # 本地打包输出目录（成品 APK 见 GitHub Releases）
└── build_apk.ps1    # Windows 一键构建前端并打包 APK 脚本
```

## 从源码构建

环境要求：Node.js 18+、JDK 17、Android SDK（API 35）。

```powershell
.\build_apk.ps1
```

构建完成后将在 `releases/小庞奶娃音乐-v5.1.0.apk` 输出已签名的安装文件。

## 致谢

本项目基于开源项目 [algerkong/AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer) 进行 Android 端原生架构移植与界面定制，遵循原项目开源协议。
