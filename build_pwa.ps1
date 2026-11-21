<#
.SYNOPSIS
    一键构建 小庞奶娃音乐 Safari PWA / 跨平台网页版静态包
#>
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$UpstreamDir = Join-Path $Root "upstream"
$PwaOutDir = Join-Path $Root "releases\pwa"

$PkgJson = Get-Content (Join-Path $UpstreamDir "package.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$Version = if ($PkgJson.version) { $PkgJson.version } else { "5.1.3" }
$ZipPath = Join-Path $Root "releases\小庞奶娃音乐-v$Version-pwa.zip"

Write-Host "[1/2] 构建 小庞奶娃音乐 v$Version Vue 3 + Safari PWA 静态资源..." -ForegroundColor Cyan
Push-Location $UpstreamDir
try {
    if (-not (Test-Path "node_modules")) {
        $env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
        npm install --ignore-scripts --legacy-peer-deps
        if ($LASTEXITCODE -ne 0) { throw "npm install 失败 (exit=$LASTEXITCODE)" }
    }
    npx vite build --outDir $PwaOutDir --emptyOutDir
    if ($LASTEXITCODE -ne 0) { throw "Vite PWA 构建失败 (exit=$LASTEXITCODE)" }
} finally {
    Pop-Location
}

if (-not (Test-Path (Join-Path $PwaOutDir "index.html"))) {
    throw "PWA 构建产物缺失：$PwaOutDir\index.html 不存在，已中止打包"
}

Write-Host "[2/2] 打包 PWA 静态发布包..." -ForegroundColor Cyan
if (Test-Path $ZipPath) { Remove-Item $ZipPath -Force }
Compress-Archive -Path "$PwaOutDir\*" -DestinationPath $ZipPath -Force
if (-not (Test-Path $ZipPath) -or (Get-Item $ZipPath).Length -lt 1024) {
    throw "PWA 压缩包生成异常：$ZipPath"
}

$SizeMb = [math]::Round((Get-Item $ZipPath).Length / 1MB, 2)
Write-Host "构建完成！PWA 静态目录: $PwaOutDir" -ForegroundColor Green
Write-Host "PWA 压缩包: $ZipPath ($SizeMb MB)" -ForegroundColor Green
