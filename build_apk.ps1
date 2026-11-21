<#
.SYNOPSIS
    一键构建 AlgerMusicPlayer v5.1.0 Android 版 APK
#>
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$UpstreamDir = Join-Path $Root "upstream"
$AndroidDir = Join-Path $Root "android"
$AssetsWwwDir = Join-Path $AndroidDir "app\src\main\assets\www"
$ReleaseOutDir = Join-Path $Root "releases"

Write-Host "[1/3] 构建 小庞奶娃音乐 v5.1.2 Vue 3 移动端前端资源..." -ForegroundColor Cyan
Push-Location $UpstreamDir
try {
    if (-not (Test-Path "node_modules")) {
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
        npm install --ignore-scripts --legacy-peer-deps
    }
    npx vite build --outDir $AssetsWwwDir --emptyOutDir
} finally {
    Pop-Location
}

Write-Host "[2/3] 编译 Android Release APK..." -ForegroundColor Cyan
Push-Location $AndroidDir
try {
    if (-not $env:ANDROID_HOME) {
        $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    }
    .\gradlew.bat assembleRelease --no-daemon
} finally {
    Pop-Location
}

Write-Host "[3/3] 导出成品 APK 到 releases 目录..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $ReleaseOutDir | Out-Null
$BuiltApk = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
$DestApk = Join-Path $ReleaseOutDir "小庞奶娃音乐-v5.1.2.apk"
Copy-Item -Path $BuiltApk -Destination $DestApk -Force

Write-Host "构建完成！APK 路径: $DestApk" -ForegroundColor Green
