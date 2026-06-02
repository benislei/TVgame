param(
  [string]$Version = "1.24.13",
  [switch]$InstallDevel
)

$ErrorActionPreference = "Stop"

function Test-Command($Name) {
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

$baseUrl = "https://gstreamer.freedesktop.org/pkg/windows/$Version/msvc"
$runtimeUrl = "$baseUrl/gstreamer-1.0-msvc-x86_64-$Version.msi"
$develUrl = "$baseUrl/gstreamer-1.0-devel-msvc-x86_64-$Version.msi"
$downloadDir = Join-Path $env:TEMP "tvgame-gstreamer-$Version"
New-Item -ItemType Directory -Force -Path $downloadDir | Out-Null

Write-Host "电视游戏串流：GStreamer 安装器"
Write-Host "================================"
Write-Host "版本：$Version"
Write-Host ""

if (Test-Command "gst-launch-1.0") {
  Write-Host "已检测到 gst-launch-1.0，跳过 runtime 安装。"
} else {
  $runtimeMsi = Join-Path $downloadDir "gstreamer-runtime.msi"
  Write-Host "正在下载 GStreamer runtime..."
  Write-Host $runtimeUrl
  Invoke-WebRequest -Uri $runtimeUrl -OutFile $runtimeMsi
  Write-Host "正在安装 GStreamer runtime..."
  Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$runtimeMsi`" /passive /norestart" -Wait
}

if ($InstallDevel) {
  $develMsi = Join-Path $downloadDir "gstreamer-devel.msi"
  Write-Host "正在下载 GStreamer devel..."
  Write-Host $develUrl
  Invoke-WebRequest -Uri $develUrl -OutFile $develMsi
  Write-Host "正在安装 GStreamer devel..."
  Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$develMsi`" /passive /norestart" -Wait
}

if (Test-Command "python") {
  Write-Host "正在安装/更新 Python websockets 依赖..."
  & python -m pip install --user --upgrade websockets
} elseif (Test-Command "py") {
  Write-Host "正在安装/更新 Python websockets 依赖..."
  & py -3 -m pip install --user --upgrade websockets
} else {
  Write-Host "未检测到 python。原生发送端需要 Python 3，请先安装 Python 3 并重新运行本脚本。"
}

$defaultBin = "C:\gstreamer\1.0\msvc_x86_64\bin"
if (Test-Path $defaultBin) {
  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not ($currentPath -split ";" | Where-Object { $_ -eq $defaultBin })) {
    Write-Host "正在把 GStreamer 加入用户 PATH：$defaultBin"
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$defaultBin", "User")
  }
}

Write-Host ""
Write-Host "安装流程完成。请重新打开终端，或重启 QuickVerify。"
Write-Host "然后运行：npm run native:check"
