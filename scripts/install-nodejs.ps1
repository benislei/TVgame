param(
  [string]$PackageId = "OpenJS.NodeJS.LTS"
)

$ErrorActionPreference = "Stop"

function Test-Command($Name) {
  $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Test-NodeReady {
  (Test-Command "node.exe") -and (Test-Command "npm.cmd")
}

Write-Host "TVGame Node.js installer"
Write-Host "========================"

if (Test-NodeReady) {
  Write-Host "Node.js and npm are already available."
  & node.exe -v
  & npm.cmd -v
  exit 0
}

if (-not (Test-Command "winget.exe")) {
  Write-Host "winget.exe was not found."
  Write-Host "Please install Node.js LTS manually from https://nodejs.org/ and then reopen this command window."
  exit 1
}

Write-Host "Installing Node.js LTS with winget..."
& winget.exe install --id $PackageId --exact --silent --accept-package-agreements --accept-source-agreements
if ($LASTEXITCODE -ne 0) {
  Write-Host "winget install failed. Exit code: $LASTEXITCODE"
  exit $LASTEXITCODE
}

$nodeDir = Join-Path $env:ProgramFiles "nodejs"
if (Test-Path (Join-Path $nodeDir "npm.cmd")) {
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if (-not (($userPath -split ";") | Where-Object { $_ -eq $nodeDir })) {
    [Environment]::SetEnvironmentVariable("Path", "$userPath;$nodeDir", "User")
  }
}

Write-Host ""
Write-Host "Node.js installation has finished."
Write-Host "Close this command window, open a new one, then run the TVGame script again."
