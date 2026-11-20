<#
.SYNOPSIS
    一键构建 小庞奶娃音乐 Safari PWA / 跨平台网页版静态包
#>
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$UpstreamDir = Join-Path $Root "upstream"
$PwaOutDir = Join-Path $Root "releases\pwa"
$ZipPath = Join-Path $Root "releases\小庞奶娃音乐-v5.1.0-pwa.zip"

Write-Host "[1/2] 构建 Vue 3 + Safari PWA 静态资源..." -ForegroundColor Cyan
Push-Location $UpstreamDir
try {
    if (-not (Test-Path "node_modules")) {
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
        npm install --ignore-scripts --legacy-peer-deps
    }
    npx vite build --outDir $PwaOutDir --emptyOutDir
} finally {
    Pop-Location
}

Write-Host "[2/2] 打包 PWA 静态发布包..." -ForegroundColor Cyan
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path "$PwaOutDir\*" -DestinationPath $ZipPath -Force

Write-Host "构建完成！PWA 静态目录: $PwaOutDir" -ForegroundColor Green
Write-Host "PWA 压缩包: $ZipPath" -ForegroundColor Green
