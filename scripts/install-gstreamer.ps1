param(
  [string]$Version = "1.24.13",
  [switch]$InstallDevel
)

$ErrorActionPreference = "Stop"
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding

function Test-Command($Name) {
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Install-Msi($Path, $Name) {
  Write-Host "正在安装 $Name..."
  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList "/i `"$Path`" /passive /norestart" -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "$Name 安装失败，退出码：$($process.ExitCode)"
  }
}

function Ensure-Aria2 {
  if (Test-Command "aria2c") {
    return $true
  }

  if (-not (Test-Command "winget.exe")) {
    Write-Host "未检测到 aria2c，也没有 winget，稍后回退到 curl 断点续传。"
    return $false
  }

  Write-Host "未检测到 aria2c，正在尝试安装 aria2 下载加速器..."
  & winget.exe install --id aria2.aria2 --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Write-Host "aria2 安装失败，稍后回退到 curl 断点续传。退出码：$LASTEXITCODE"
    return $false
  }

  $aria2Candidate = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\aria2c.exe"
  if (Test-Path $aria2Candidate) {
    $linkDir = Split-Path $aria2Candidate
    if (-not (($env:PATH -split ";") | Where-Object { $_ -eq $linkDir })) {
      $env:PATH = "$linkDir;$env:PATH"
    }
  }

  return (Test-Command "aria2c")
}

function Download-File($Url, $Path) {
  if ((Test-Path $Path) -and ((Get-Item $Path).Length -gt 0)) {
    Write-Host "检测到已有下载文件，尝试断点续传：$Path"
  }

  Ensure-Aria2 | Out-Null

  if (Test-Command "aria2c") {
    Write-Host "使用 aria2c 下载/续传..."
    & aria2c -c -x 16 -s 16 -k 1M --summary-interval=30 --connect-timeout=20 --timeout=60 --retry-wait=5 --max-tries=20 -d (Split-Path $Path) -o (Split-Path $Path -Leaf) $Url
    if ($LASTEXITCODE -ne 0) { throw "aria2c 下载失败，退出码：$LASTEXITCODE" }
    return
  }

  if (Test-Command "curl.exe") {
    Write-Host "使用 curl 下载/续传..."
    & curl.exe -L -C - --connect-timeout 20 --retry 5 --retry-delay 5 --output $Path $Url
    if ($LASTEXITCODE -ne 0) { throw "curl 下载失败，退出码：$LASTEXITCODE" }
    return
  }

  Write-Host "使用 Invoke-WebRequest 下载..."
  Invoke-WebRequest -Uri $Url -OutFile $Path
}

function Find-GStreamerRoot {
  $candidates = @(
    $env:GSTREAMER_1_0_ROOT_MSVC_X86_64,
    "C:\gstreamer\1.0\msvc_x86_64",
    "D:\gstreamer\1.0\msvc_x86_64"
  ) | Where-Object { $_ }

  foreach ($root in $candidates) {
    if (Test-Path (Join-Path $root "bin\gst-launch-1.0.exe")) {
      return $root
    }
  }

  return $null
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
  Download-File -Url $runtimeUrl -Path $runtimeMsi
  Install-Msi -Path $runtimeMsi -Name "GStreamer runtime"
}

if ($InstallDevel) {
  $develMsi = Join-Path $downloadDir "gstreamer-devel.msi"
  Write-Host "正在下载 GStreamer devel..."
  Write-Host $develUrl
  Download-File -Url $develUrl -Path $develMsi
  Install-Msi -Path $develMsi -Name "GStreamer devel"
}

if (Test-Command "python") {
  Write-Host "正在安装/更新 Python websockets 依赖..."
  & python -m pip install --user --upgrade websockets
} elseif (Test-Command "py") {
  Write-Host "正在安装/更新 Python websockets 依赖..."
  & py -3 -m pip install --user --upgrade websockets
} else {
  Write-Host "未检测到 Python 3。原生发送端需要 Python 3，请先安装 Python 3 并重新运行本脚本。"
}

$gstreamerRoot = Find-GStreamerRoot
if ($gstreamerRoot) {
  [Environment]::SetEnvironmentVariable("GSTREAMER_1_0_ROOT_MSVC_X86_64", $gstreamerRoot, "User")
  $defaultBin = Join-Path $gstreamerRoot "bin"
  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not ($currentPath -split ";" | Where-Object { $_ -eq $defaultBin })) {
    Write-Host "正在把 GStreamer 加入用户 PATH：$defaultBin"
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$defaultBin", "User")
  }
} else {
  Write-Host "未找到 GStreamer 安装目录。请关闭当前窗口，重新打开一个新的命令窗口后再运行检查。"
}

Write-Host ""
Write-Host "安装流程完成。"
Write-Host "请关闭当前 .bat/PowerShell 窗口，重新打开一个新的命令窗口。"
Write-Host "朋友试用包用户：重新运行 检查环境.bat。"
Write-Host "项目目录用户：运行 npm.cmd run stage2:check。"
Write-Host "如果 N 卡缺 nvh264enc，请确认安装的是 MSVC x86_64 runtime + devel，并更新 NVIDIA 显卡驱动。"
Write-Host "如果 A 卡缺 amfh264enc，请确认安装的是 MSVC x86_64 runtime + devel，并更新 AMD 显卡驱动。"
Write-Host "如果两者都没有，发送端会尝试使用 Windows Media Foundation 的 mfh264enc 作为兜底。"
