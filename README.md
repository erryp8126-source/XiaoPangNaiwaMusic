<p align="center">
  <img src="upstream/src/renderer/assets/icon.png" width="120" alt="小庞奶娃音乐" style="border-radius: 26px;" />
</p>

<h1 align="center">小庞奶娃音乐 · Android 版</h1>

<p align="center">
  基于开源音乐播放器 <a href="https://github.com/algerkong/AlgerMusicPlayer/releases/tag/v5.1.0">algerkong/AlgerMusicPlayer v5.1.0</a> 构建的 <b>Vue 3 + AndroidX Media3 移动端音乐播放器学习项目</b>
</p>

<p align="center">
  <a href="https://github.com/erryp8126-source/XiaoPangNaiwaMusic/releases/latest">
    <img src="https://img.shields.io/badge/Download-Android%20APK-E89200?style=for-the-badge&logo=android&logoColor=white" alt="下载 Android APK" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/License-MIT-38BDF8?style=for-the-badge" alt="MIT License" />
  </a>
</p>

---

## 项目简介与功能特性

### 1. 「奶娃暖阳治愈风」移动端 UI 设计
- **暖阳琥珀金 × 晴空冰蓝主题体系**：默认精致浅色磨砂玻璃界面，顶部支持 ☀️/🌙 一键切换深色模式。
- **悬浮磨砂玻璃导航**：悬浮胶囊底部 5 项图文导航栏（发现 / 歌单 / 排行 / 收藏 / 我的）与悬浮旋转唱片迷你播控条（带实时进度细线与左右滑动切歌）。
- **沉浸式全屏播放器**：多层专辑封面极光流光背景、圆角封面呼吸动画（点击可切换方形 / 黑胶 / 全屏三种样式）、逐字歌词、歌词翻译、倍速播放、定时关闭、播放队列底部抽屉。

### 2. 本地网络服务层与自定义接口支持
- 使用 Kotlin + NanoHTTPD 在本地回环地址（`127.0.0.1:30488`）实现移动端接口适配层，支持扫码、Cookie 与 UID 登录。
- 支持在「设置 → 网络」中配置自建远程 API 地址及自定义音源插件。

### 3. Android 原生媒体播放与系统集成
- 基于 **AndroidX Media3 ExoPlayer + MediaSession** 前台服务，支持熄屏后台播放、通知栏与锁屏播控、蓝牙耳机线控切歌与音频焦点管理。
- 接入 Android 硬件均衡器（`android.media.audiofx.Equalizer`），支持 10 段频响调节与多种音效预设。
- 原生 **MediaStore 本地音频扫描**（自动解析封面与同名 `.lrc` 歌词）与**离线缓存管理**。
- 可选**系统桌面悬浮歌词窗**与全面屏 Edge-to-Edge 安全区适配。

---

## 下载与安装（Android 8.0+）

1. 前往 [Releases 页面](https://github.com/erryp8126-source/XiaoPangNaiwaMusic/releases/latest) 下载最新 `.apk` 安装包。
2. 首次启动建议允许「通知权限」，以便锁屏与通知栏显示播放控制条。
3. 如希望熄屏长时间后台播放更稳定，可在 App 内「设置 → 网络 → 后台播放保活」中开启电池优化白名单。

---

## 目录结构

```text
XiaoPangNaiwaMusic/
├── upstream/        # Vue 3 + TypeScript + Tailwind CSS 移动端前端源码
├── android/         # Kotlin + Media3 ExoPlayer + NanoHTTPD Android 工程
├── ci/              # GitHub Actions 云端自动构建与发布 APK 工作流模板
└── build_apk.ps1    # 本地一键构建前端并打包 APK 脚本
```

## 构建方式

### 方式一：GitHub Actions 云端自动构建
将 `ci/android-release.yml` 置于 `.github/workflows/android-release.yml` 后，推送 `v*` 标签或在 GitHub 仓库 `Actions -> Build & Release Android APK` 页面点击 **Run workflow**，即可由 GitHub 云端自动编译并发布 APK。

### 方式二：本地构建
环境要求：Node.js 18+、JDK 17、Android SDK（API 35）。

```powershell
.\build_apk.ps1
```

---

## 开源协议与免责声明

- 本项目基于 [algerkong/AlgerMusicPlayer](https://github.com/algerkong/AlgerMusicPlayer)（MIT License）进行移动端技术研究与界面改造，同样遵循 [MIT License](LICENSE) 开源。
- **免责声明**：本项目仅用于 Vue 3 与 Android Media3 跨平台混合开发技术学习与交流，不提供任何商业服务。请尊重音乐版权，支持正版音乐平台，下载测试后请于 24 小时内删除。
