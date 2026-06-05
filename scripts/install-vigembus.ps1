$ErrorActionPreference = "Stop"

function Test-ViGEmBusInstalled {
  $service = Get-Service -Name "ViGEmBus" -ErrorAction SilentlyContinue
  if ($service) {
    return $true
  }

  return Test-Path "HKLM:\SYSTEM\CurrentControlSet\Services\ViGEmBus"
}

Write-Host "Checking ViGEmBus virtual gamepad driver..."

if (Test-ViGEmBusInstalled) {
  Write-Host "ViGEmBus is already installed."
  exit 0
}

if (-not (Get-Command winget.exe -ErrorAction SilentlyContinue)) {
  throw "winget was not found. Install App Installer first, or manually run: winget install --id ViGEm.ViGEmBus"
}

Write-Host "ViGEmBus was not found. Installing through winget..."
winget install --id ViGEm.ViGEmBus --silent --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

if (Test-ViGEmBusInstalled) {
  Write-Host "ViGEmBus installed. Restart the input bridge."
  exit 0
}

Write-Host "Install command finished, but ViGEmBus service was not detected yet."
Write-Host "Restart Windows, then start the input bridge again."
exit 0
