# 打包 Chrome 扩展为 zip 安装包
# 用法（仓库根目录执行）：
#   powershell -ExecutionPolicy Bypass -File extension/build.ps1
# 产物：extension/release/artdb-extension-v<版本>.zip
# 分发：把 zip 发给用户 → 解压到任意目录 → chrome://extensions 开发者模式 →「加载已解压的扩展程序」选中该目录。
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$ext = Join-Path $root "extension"
# 必须按 UTF-8 读取 manifest（Windows PowerShell 默认 ANSI 会乱码导致 JSON 解析失败）
$manifest = [System.IO.File]::ReadAllText((Join-Path $ext "manifest.json"), [System.Text.Encoding]::UTF8) | ConvertFrom-Json
$releaseDir = Join-Path $ext "release"
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
$zipPath = Join-Path $releaseDir "artdb-extension-v$($manifest.version).zip"
if (Test-Path $zipPath) { Remove-Item $zipPath }

# zip 根目录直接是扩展文件（manifest.json 在根），解压后即可作为「已解压的扩展程序」加载
$files = Get-ChildItem $ext -File | Where-Object { $_.Name -ne "build.ps1" }
Compress-Archive -Path $files.FullName -DestinationPath $zipPath
Write-Host "已生成安装包: $zipPath"
