param(
  [string] $SdkRoot = $(if ([string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
    Join-Path $env:USERPROFILE 'AppData\Local\Android\Sdk'
  } else {
    Join-Path $env:LOCALAPPDATA 'Android\Sdk'
  })
)

$CommandLineToolsUrl = 'https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip'
$CommandLineToolsChecksum = '16b3f45ddb3d85ea6bbe6a1c0b47146daf0db450'
$RequiredPackages = @(
  "platform-tools",
  "platforms;android-35",
  "build-tools;35.0.0"
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Write-Step {
  param([string] $Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Exit-WithFailure {
  param(
    [string] $Message,
    [int] $ExitCode = 1
  )

  if ($ExitCode -eq 0) {
    $ExitCode = 1
  }

  Write-Host $Message
  exit $ExitCode
}

function Resolve-CommandPath {
  param([string] $Name)
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($null -eq $command) {
    return $null
  }
  return $command.Source
}

function Resolve-JavaTool {
  param([string] $Name)
  if (-not [string]::IsNullOrWhiteSpace($env:JAVA_HOME)) {
    $candidate = Join-Path $env:JAVA_HOME "bin\$Name.exe"
    if (Test-Path $candidate) {
      return $candidate
    }
  }
  return Resolve-CommandPath "$Name.exe"
}

function Get-JavaMajorVersion {
  param(
    [string] $ToolPath,
    [string] $ToolName
  )

  if ([string]::IsNullOrWhiteSpace($ToolPath) -or -not (Test-Path $ToolPath)) {
    return $null
  }

  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $ToolPath
  $startInfo.Arguments = '-version'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardOutput = $true
  $startInfo.RedirectStandardError = $true
  $process = [System.Diagnostics.Process]::Start($startInfo)
  $stdout = $process.StandardOutput.ReadToEnd()
  $stderr = $process.StandardError.ReadToEnd()
  $process.WaitForExit()
  $versionOutput = "$stdout`n$stderr"
  if ($versionOutput -match 'version\s+"(?<version>\d+)') {
    return [int] $Matches.version
  }
  if ($versionOutput -match "\b$ToolName\s+(?<version>\d+)") {
    return [int] $Matches.version
  }
  return $null
}

function Find-TemurinJdk17 {
  $roots = @(
    $(if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) { Join-Path $env:ProgramFiles 'Eclipse Adoptium' }),
    $(if (-not [string]::IsNullOrWhiteSpace(${env:ProgramFiles(x86)})) { Join-Path ${env:ProgramFiles(x86)} 'Eclipse Adoptium' }),
    'C:\Program Files\Eclipse Adoptium',
    'C:\Program Files\Java'
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique

  foreach ($root in $roots) {
    if (-not (Test-Path $root)) {
      continue
    }

    $candidates = Get-ChildItem -Path $root -Directory -Filter 'jdk-17*' -ErrorAction SilentlyContinue |
      Sort-Object -Property Name -Descending

    foreach ($candidate in $candidates) {
      $javaPath = Join-Path $candidate.FullName 'bin\java.exe'
      $javacPath = Join-Path $candidate.FullName 'bin\javac.exe'
      if ((Test-Path $javaPath) -and (Test-Path $javacPath)) {
        $javaMajor = Get-JavaMajorVersion -ToolPath $javaPath -ToolName 'java'
        $javacMajor = Get-JavaMajorVersion -ToolPath $javacPath -ToolName 'javac'
        if ($javaMajor -eq 17 -and $javacMajor -eq 17) {
          return $candidate.FullName
        }
      }
    }
  }

  return $null
}

function Update-Jdk17Environment {
  $jdkRoot = Find-TemurinJdk17
  if ([string]::IsNullOrWhiteSpace($jdkRoot)) {
    return $false
  }

  $binPath = Join-Path $jdkRoot 'bin'
  $env:JAVA_HOME = $jdkRoot
  $env:Path = "$binPath;$env:Path"
  Write-Host "已为当前 PowerShell 会话设置 JAVA_HOME：$env:JAVA_HOME"
  return $true
}

function Test-Jdk17 {
  $javaPath = Resolve-JavaTool 'java'
  $javacPath = Resolve-JavaTool 'javac'
  $javaMajor = Get-JavaMajorVersion -ToolPath $javaPath -ToolName 'java'
  $javacMajor = Get-JavaMajorVersion -ToolPath $javacPath -ToolName 'javac'

  if ($javaMajor -eq 17 -and $javacMajor -eq 17) {
    Write-Host "已检测到 JDK 17："
    Write-Host "  java.exe：$javaPath"
    Write-Host "  javac.exe：$javacPath"
    return $true
  }

  Write-Host "未检测到完整的 JDK 17。"
  if ($javaPath) {
    Write-Host "  java.exe：$javaPath，版本：$javaMajor"
  } else {
    Write-Host "  java.exe：缺失"
  }
  if ($javacPath) {
    Write-Host "  javac.exe：$javacPath，版本：$javacMajor"
  } else {
    Write-Host "  javac.exe：缺失"
  }
  return $false
}

function Install-Jdk17 {
  $wingetPath = Resolve-CommandPath 'winget.exe'
  if ([string]::IsNullOrWhiteSpace($wingetPath)) {
    Exit-WithFailure -Message '未找到 winget。请手动安装 JDK 17，或安装 Windows 应用安装程序后重试。' -ExitCode 1
  }

  Write-Step '正在通过 winget 安装 Temurin JDK 17'
  winget install --id EclipseAdoptium.Temurin.17.JDK --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    Exit-WithFailure -Message "winget 安装 JDK 17 失败，退出码：$LASTEXITCODE" -ExitCode $LASTEXITCODE
  }
}

function Get-ChecksumAlgorithm {
  param([string] $Checksum)
  if ($Checksum.Length -eq 64) {
    return 'SHA256'
  }
  if ($Checksum.Length -eq 40) {
    return 'SHA1'
  }
  throw "不支持的校验值长度：$($Checksum.Length)"
}

function Test-DownloadedFileHash {
  param([string] $FilePath)
  $algorithm = Get-ChecksumAlgorithm $CommandLineToolsChecksum
  Write-Host "正在校验 command-line tools 下载文件，算法：$algorithm"
  $actual = (Get-FileHash -Path $FilePath -Algorithm $algorithm).Hash.ToLowerInvariant()
  if ($actual -ne $CommandLineToolsChecksum.ToLowerInvariant()) {
    throw "command-line tools 校验失败。期望：$CommandLineToolsChecksum，实际：$actual"
  }
}

function Install-CommandLineTools {
  param([string] $AndroidSdkRoot)

  $sdkManager = Join-Path $AndroidSdkRoot 'cmdline-tools\latest\bin\sdkmanager.bat'
  if (Test-Path $sdkManager) {
    Write-Host "已检测到 sdkmanager.bat：$sdkManager"
    return $sdkManager
  }

  Write-Step '正在下载 Android command-line tools'
  New-Item -ItemType Directory -Path $AndroidSdkRoot -Force | Out-Null
  $downloadDir = Join-Path ([System.IO.Path]::GetTempPath()) 'lan-game-streaming-android-tools'
  $zipPath = Join-Path $downloadDir 'commandlinetools-win-14742923_latest.zip'
  $extractRoot = Join-Path $downloadDir 'extract'

  if (Test-Path $downloadDir) {
    Remove-Item -LiteralPath $downloadDir -Recurse -Force
  }
  New-Item -ItemType Directory -Path $downloadDir -Force | Out-Null

  Invoke-WebRequest -Uri $CommandLineToolsUrl -OutFile $zipPath
  Test-DownloadedFileHash -FilePath $zipPath

  Write-Step '正在解压 Android command-line tools'
  Expand-Archive -Path $zipPath -DestinationPath $extractRoot -Force
  $sourceTools = Join-Path $extractRoot 'cmdline-tools'
  if (-not (Test-Path $sourceTools)) {
    throw '下载包中未找到 cmdline-tools 目录。'
  }

  $toolsRoot = Join-Path $AndroidSdkRoot 'cmdline-tools'
  $latestRoot = Join-Path $toolsRoot 'latest'
  New-Item -ItemType Directory -Path $toolsRoot -Force | Out-Null
  if (Test-Path $latestRoot) {
    Remove-Item -LiteralPath $latestRoot -Recurse -Force
  }
  Move-Item -LiteralPath $sourceTools -Destination $latestRoot

  $sdkManager = Join-Path $latestRoot 'bin\sdkmanager.bat'
  if (-not (Test-Path $sdkManager)) {
    throw "解压后仍未找到 sdkmanager.bat：$sdkManager"
  }
  return $sdkManager
}

function Invoke-SdkManager {
  param(
    [string] $SdkManager,
    [string[]] $Arguments
  )
  & $SdkManager @Arguments
  if ($LASTEXITCODE -ne 0) {
    Exit-WithFailure -Message "sdkmanager.bat 执行失败，退出码：$LASTEXITCODE" -ExitCode $LASTEXITCODE
  }
}

function Accept-AndroidLicenses {
  param(
    [string] $SdkManager,
    [string] $AndroidSdkRoot
  )

  $licenseInput = Join-Path ([System.IO.Path]::GetTempPath()) 'lan-game-streaming-android-licenses.txt'
  try {
    (1..100 | ForEach-Object { 'y' }) | Set-Content -Path $licenseInput -Encoding ascii
    cmd.exe /d /s /c "type `"$licenseInput`" | `"$SdkManager`" --sdk_root=`"$AndroidSdkRoot`" --licenses"
    if ($LASTEXITCODE -ne 0) {
      Exit-WithFailure -Message "接受 Android SDK 许可证失败，退出码：$LASTEXITCODE" -ExitCode $LASTEXITCODE
    }
  } finally {
    if (Test-Path $licenseInput) {
      Remove-Item -LiteralPath $licenseInput -Force
    }
  }
}

Write-Host 'Android 构建依赖安装器'
Write-Host '======================'
Write-Host "Android SDK 根目录：$SdkRoot"

Write-Step '检查 JDK 17'
if (-not (Test-Jdk17)) {
  if (Update-Jdk17Environment) {
    Write-Host '已找到本机安装的 JDK 17，并已刷新当前安装脚本环境。'
  } else {
    Install-Jdk17
    Update-Jdk17Environment | Out-Null
  }
  if (-not (Test-Jdk17)) {
    Write-Host 'JDK 17 已安装或正在安装，但当前终端尚未刷新 PATH。请重新打开 PowerShell 后再次运行本命令。'
    exit 1
  }
}

Write-Step '准备 Android SDK command-line tools'
$sdkManagerPath = Install-CommandLineTools -AndroidSdkRoot $SdkRoot

Write-Step '接受 Android SDK 许可证'
Accept-AndroidLicenses -SdkManager $sdkManagerPath -AndroidSdkRoot $SdkRoot

Write-Step '安装 Android SDK 构建包'
Invoke-SdkManager -SdkManager $sdkManagerPath -Arguments (@("--sdk_root=$SdkRoot") + $RequiredPackages)

Write-Host ""
Write-Host 'Android 构建依赖安装完成。'
Write-Host '现在可以运行：npm.cmd run android:check'
