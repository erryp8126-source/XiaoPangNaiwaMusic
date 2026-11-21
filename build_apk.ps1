<#
.SYNOPSIS
    一键构建 小庞奶娃音乐 Android 版 APK
#>
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$UpstreamDir = Join-Path $Root "upstream"
$AndroidDir = Join-Path $Root "android"
$AssetsWwwDir = Join-Path $AndroidDir "app\src\main\assets\www"
$ReleaseOutDir = Join-Path $Root "releases"

$PkgJson = Get-Content (Join-Path $UpstreamDir "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = if ($PkgJson.version) { $PkgJson.version } else { "5.1.3" }

$KeystoreProps = Join-Path $AndroidDir "keystore.properties"
if (Test-Path $KeystoreProps) {
    Write-Host "[签名] 检测到 android\keystore.properties，将使用正式发布签名。" -ForegroundColor Green
} else {
    Write-Host "[警告] 未检测到 android\keystore.properties，本次产物将回退为 Debug 测试签名（无法直接覆盖安装正式版）！" -ForegroundColor Yellow
}

Write-Host "[1/3] 构建 小庞奶娃音乐 v$Version Vue 3 移动端前端资源..." -ForegroundColor Cyan
Push-Location $UpstreamDir
try {
    if (-not (Test-Path "node_modules")) {
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
        npm install --ignore-scripts --legacy-peer-deps
        if ($LASTEXITCODE -ne 0) { throw "npm install 失败 (exit=$LASTEXITCODE)" }
    }
    npx vite build --outDir $AssetsWwwDir --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw "Vite 前端构建失败 (exit=$LASTEXITCODE)" }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $AssetsWwwDir "index.html"))) {
    throw "前端构建产物缺失：$AssetsWwwDir\index.html 不存在"
}

Write-Host "[2/3] 编译 Android Release APK..." -ForegroundColor Cyan
$BuiltApk = Join-Path $AndroidDir "app\build\outputs\apk\release\app-release.apk"
if (Test-Path $BuiltApk) { Remove-Item -Force $BuiltApk }

Push-Location $AndroidDir
try {
    if (-not $env:ANDROID_HOME) {
        $env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    }
    .\gradlew.bat assembleRelease --no-daemon
    if ($LASTEXITCODE -ne 0) { throw "Gradle assembleRelease 编译失败 (exit=$LASTEXITCODE)" }
} finally {
    Pop-Location
}

if (-not (Test-Path $BuiltApk)) {
    throw "未找到新生成的 APK：$BuiltApk"
}

Write-Host "[3/3] 导出成品 APK 到 releases 目录..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $ReleaseOutDir | Out-Null
$DestApk = Join-Path $ReleaseOutDir "小庞奶娃音乐-v$Version.apk"
Copy-Item -Path $BuiltApk -Destination $DestApk -Force

$SizeMb = [math]::Round((Get-Item $DestApk).Length / 1MB, 2)
Write-Host "构建完成！APK 路径: $DestApk ($SizeMb MB)" -ForegroundColor Green
