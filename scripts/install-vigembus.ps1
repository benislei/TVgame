$ErrorActionPreference = "Stop"

function Test-ViGEmBusInstalled {
  $service = Get-Service -Name "ViGEmBus" -ErrorAction SilentlyContinue
  if ($service) {
    return $true
  }

  return Test-Path "HKLM:\SYSTEM\CurrentControlSet\Services\ViGEmBus"
}

Write-Host "正在检查 ViGEmBus 虚拟手柄驱动..."

if (Test-ViGEmBusInstalled) {
  Write-Host "已检测到 ViGEmBus 虚拟手柄驱动。"
  exit 0
}

if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
  throw "未找到 winget。请先安装 App Installer，或手动安装 ViGEmBus：winget install --id ViGEm.ViGEmBus"
}

Write-Host "未检测到 ViGEmBus，正在通过 winget 安装..."
winget install --id ViGEm.ViGEmBus --silent --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if (Test-ViGEmBusInstalled) {
  Write-Host "ViGEmBus 安装完成。请重新启动输入桥。"
  exit 0
}

Write-Host "安装命令已完成，但尚未检测到 ViGEmBus 服务。请重启电脑后再启动输入桥。"
exit 0
