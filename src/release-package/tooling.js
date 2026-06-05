'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_NAME = 'TVGame-Friend-Preview';
const APK_SOURCE_RELATIVE = path.join('android-tv-receiver', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const APP_ITEMS = [
  'package.json',
  'package-lock.json',
  'README.md',
  'src',
  'scripts',
  'InputBridge',
  'docs',
  'public'
];
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.gradle',
  'node_modules',
  'dist',
  'build',
  'bin',
  'obj',
  'target',
  '__pycache__'
]);

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true });
}

function writeText(file, text) {
  ensureDirectory(path.dirname(file));
  fs.writeFileSync(file, text, 'utf8');
}

function copyFile(source, target) {
  ensureDirectory(path.dirname(target));
  fs.copyFileSync(source, target);
}

function shouldSkipDirectory(name) {
  return EXCLUDED_DIRECTORIES.has(name);
}

function copyDirectory(source, target) {
  ensureDirectory(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.isDirectory() && shouldSkipDirectory(entry.name)) continue;
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectory(sourcePath, targetPath);
    } else if (entry.isFile()) {
      copyFile(sourcePath, targetPath);
    }
  }
}

function copyItemIfExists(projectRoot, packageDir, relativePath) {
  const source = path.join(projectRoot, relativePath);
  if (!fs.existsSync(source)) return null;

  const target = path.join(packageDir, 'app', relativePath);
  const stat = fs.statSync(source);
  if (stat.isDirectory()) {
    copyDirectory(source, target);
  } else if (stat.isFile()) {
    copyFile(source, target);
  }
  return target;
}

function toWindowsNewlines(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .join('\r\n');
}

function createBatchScript(body) {
  const text = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'if not exist "%~dp0app\\package.json" (',
    '  echo 未找到 app\\package.json。',
    '  echo 请从完整的 TVGame-Friend-Preview 文件夹中运行本脚本，不要只复制单个 .bat 文件。',
    '  exit /b 1',
    ')',
    'cd /d "%~dp0app"',
    body.trim(),
    'echo.',
    'pause',
    ''
  ].join('\n');

  return toWindowsNewlines(text);
}

function createSenderBatch(profileArgs) {
  return createBatchScript(`
echo 请输入电视或盒子的局域网 IP。
echo 示例：192.168.50.140
set "TV_IP="
set /p "TV_IP=电视/盒子 IP（留空为 127.0.0.1）："
if "%TV_IP%"=="" set "TV_IP=127.0.0.1"
echo.
echo 正在启动发送端，目标：%TV_IP%
call npm.cmd run native:rtp -- --host "%TV_IP%"${profileArgs ? ` ${profileArgs}` : ''}
`);
}

function createReadme() {
  return [
    '# TVGame 朋友试用包',
    '',
    '这个包用于快速验证“电脑游戏画面和声音串流到 Android TV/电视盒子，并把输入回传到电脑”的当前基础可玩版本。',
    '',
    '## 适用设备',
    '',
    '- 接收端：Android 11+ 电视或电视盒子，推荐小米盒子 5 Max、同级或更高性能设备。',
    '- 发送端：Windows 电脑，推荐 NVIDIA 显卡，并已安装 Node.js、.NET SDK、GStreamer MSVC x86_64 运行环境；如果要让电视端 USB 手柄控制 PC 游戏，还需要 ViGEmBus 虚拟手柄驱动。',
    '- 网络：电视/盒子和电脑在同一个局域网，优先使用有线或高质量 5GHz/6GHz Wi-Fi。',
    '',
    '## 文件说明',
    '',
    '- `TVGameReceiver.apk`：安装到电视或电视盒子的接收端 App。',
    '- `安装npm依赖.bat`：在电脑端安装 Node.js 依赖。',
    '- `安装GStreamer依赖.bat`：尝试安装 GStreamer 依赖。',
    '- `安装ViGEmBus手柄驱动.bat`：安装 PC 端虚拟 Xbox 手柄驱动，电视或盒子上的 USB 手柄需要它才能被 PC 游戏识别。',
    '- `检查环境.bat`：检查电脑端 GStreamer、编码器、音频捕获和 .NET 环境。',
    '- `启动输入桥.bat`：启动键鼠输入和虚拟 Xbox 手柄输入回传桥。',
    '- `启动默认发送.bat`：1080p60 默认抗花屏推荐档，包含短 GOP、参数集随 IDR 发送和更大的 UDP 发送缓冲，也就是当前测试里画面、花屏和操作延迟综合最佳的档位。',
    '- `启动高画质发送.bat`：1080p60 高画质档，画质更高但对网络和解码更敏感。',
    '- `启动抗花屏发送.bat`：1080p60 抗花屏档，和默认发送使用同一套参数，保留这个入口方便明确选择。',
    '- `启动低延迟实验发送.bat`：1080p60 旧默认低延迟实验档，主要用于和默认抗花屏档做 A/B 对比。',
    '- `启动720回退发送.bat`：720p60 回退档，用于排查网络或设备压力。',
    '',
    '## 快速验证步骤',
    '',
    '1. 把 `TVGameReceiver.apk` 安装到 Android 11+ 电视或电视盒子上，然后打开“电视游戏接收端”。接收端 App 打开期间会保持屏幕常亮，避免电视自动休眠后黑屏。',
    '2. 在电脑上运行 `安装npm依赖.bat`。',
    '3. 如果 `检查环境.bat` 提示 GStreamer 缺失，先运行 `安装GStreamer依赖.bat`，完成后重新打开一个命令窗口再检查。',
    '4. 如果要测试电视端 USB 手柄，先以管理员权限运行 `安装ViGEmBus手柄驱动.bat`。安装完成后重新启动 `启动输入桥.bat`，窗口里应看到“虚拟 Xbox 手柄已连接”。',
    '5. 运行 `启动输入桥.bat`，保持这个窗口打开。如果游戏以管理员权限运行，输入桥也建议用管理员权限启动。',
    '6. 运行 `启动默认发送.bat`，输入电视或盒子的局域网 IP。',
    '7. 电视上看到画面和声音后，优先用真实游戏验证移动、转向、开火、菜单等操作体感。游戏里请选择 Xbox 手柄或控制器输入。',
    '8. 默认档已经是抗花屏推荐档。想追求更清晰时再试 `启动高画质发送.bat`；想和旧低延迟参数对比时试 `启动低延迟实验发送.bat`；如果仍然花屏或卡顿，试 `启动720回退发送.bat` 判断是不是接收端或网络压力。',
    '',
    '## 手柄输入',
    '',
    'USB 手柄会被接收端 App 消费，不再继续交给电视系统处理，避免手柄操作电视 UI。接收端会回传原始手柄状态，PC 端 InputBridge 通过 ViGEmBus 注入虚拟 Xbox 手柄。游戏里请选择 Xbox 手柄或控制器输入。',
    '',
    '## 状态面板',
    '',
    '接收端左上角默认显示紧凑状态面板，保留实时FPS、实时丢包、实时丢帧、等待关键帧、恢复丢帧、队列丢帧、解码丢帧和音视频状态。菜单键或 F1 可以隐藏或显示状态面板。',
    '',
    '## 自动探测 NVENC preset',
    '',
    '朋友试用包里的发送脚本默认使用 `--encoder-preset auto`，会按游戏体验优先顺序自动尝试 `low-latency-hq`、`low-latency-hp`、`low-latency`、`hp`、`default`、`hq`，前面的 preset 不支持时会自动回退。需要排查兼容性时，可以在项目目录手动运行 `npm.cmd run native:rtp -- --host <电视IP> --encoder-preset default`；如果确认显卡和驱动支持更激进的低延迟 preset，也可以手动指定 `--encoder-preset low-latency-hq`。',
    '',
    '## 端口',
    '',
    '- 视频：UDP 5004',
    '- 音频：UDP 5006',
    '- 输入回传：TCP 8789',
    '',
    '如果电视收不到画面，先确认 Windows 防火墙没有拦截 Node.js、GStreamer 或 InputBridge。',
    ''
  ].join('\n');
}

function writeLaunchers(packageDir) {
  const launchers = {
    '安装npm依赖.bat': createBatchScript('echo 正在安装 Node.js 依赖...\r\ncall npm.cmd install'),
    '安装GStreamer依赖.bat': createBatchScript('echo 正在安装 GStreamer 依赖...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\install-gstreamer.ps1" -InstallDevel'),
    '安装ViGEmBus手柄驱动.bat': createBatchScript('echo 正在安装 ViGEmBus 虚拟手柄驱动...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\install-vigembus.ps1"'),
    '检查环境.bat': createBatchScript('echo 正在检查发送端环境...\r\ncall npm.cmd run stage2:check'),
    '启动输入桥.bat': createBatchScript('echo 正在启动输入桥，请保持此窗口打开。\r\ndotnet run --project InputBridge\\InputBridge.csproj'),
    '启动默认发送.bat': createSenderBatch('--encoder-preset auto --profile resilient1080'),
    '启动高画质发送.bat': createSenderBatch('--encoder-preset auto --profile quality1080'),
    '启动抗花屏发送.bat': createSenderBatch('--encoder-preset auto --profile resilient1080'),
    '启动低延迟实验发送.bat': createSenderBatch('--encoder-preset auto --profile game1080'),
    '启动720回退发送.bat': createSenderBatch('--encoder-preset auto --profile game720')
  };

  for (const [name, text] of Object.entries(launchers)) {
    writeText(path.join(packageDir, name), text);
  }
  return Object.keys(launchers).map(name => path.join(packageDir, name));
}

function powershellQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function createZipArchive(packageDir, zipPath, spawnSync = childProcess.spawnSync) {
  const packageGlob = path.join(packageDir, '*');
  const command = [
    '$ErrorActionPreference = "Stop";',
    `$ProgressPreference = "SilentlyContinue";`,
    `if (Test-Path -LiteralPath ${powershellQuote(zipPath)}) { Remove-Item -LiteralPath ${powershellQuote(zipPath)} -Force }`,
    `Compress-Archive -Path ${powershellQuote(packageGlob)} -DestinationPath ${powershellQuote(zipPath)} -Force`
  ].join(' ');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command
  ], {
    stdio: 'inherit',
    windowsHide: true
  });

  if (result.error) {
    throw new Error(`压缩包生成失败：${result.error.message}`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`压缩包生成失败，退出码：${result.status}`);
  }
  return zipPath;
}

function isBusyRemovalError(error) {
  return error && ['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code);
}

function preparePackageDirectory(outputRoot, basePackageName, rmSync = fs.rmSync) {
  for (let index = 0; index < 100; index++) {
    const packageName = index === 0 ? basePackageName : `${basePackageName}-${index + 1}`;
    const packageDir = path.join(outputRoot, packageName);
    try {
      rmSync(packageDir, { recursive: true, force: true });
      return { packageName, packageDir };
    } catch (error) {
      if (!isBusyRemovalError(error)) throw error;
    }
  }

  throw new Error(`无法准备试用包目录：${path.join(outputRoot, basePackageName)}`);
}

function createFriendPreviewPackage(options = {}) {
  const projectRoot = path.resolve(options.projectRoot || path.join(__dirname, '..', '..'));
  const outputRoot = path.resolve(options.outputRoot || path.join(projectRoot, 'dist'));
  const basePackageName = options.packageName || PACKAGE_NAME;
  const apkSource = options.apkSource || path.join(projectRoot, APK_SOURCE_RELATIVE);
  const createZip = options.createZip !== false;

  if (!fs.existsSync(apkSource)) {
    throw new Error(`缺少 Android TV APK，请先运行 npm.cmd run android:build。缺失文件：${apkSource}`);
  }

  const prepared = preparePackageDirectory(outputRoot, basePackageName, options.rmSync);
  const { packageName, packageDir } = prepared;
  const zipPath = path.join(outputRoot, `${packageName}.zip`);
  const apkTarget = path.join(packageDir, 'TVGameReceiver.apk');
  ensureDirectory(packageDir);
  ensureDirectory(path.join(packageDir, 'app'));
  copyFile(apkSource, apkTarget);

  const appFiles = [];
  for (const item of APP_ITEMS) {
    const copied = copyItemIfExists(projectRoot, packageDir, item);
    if (copied) appFiles.push(copied);
  }

  const readmePath = path.join(packageDir, 'README-朋友试用.md');
  writeText(readmePath, createReadme());
  const launcherPaths = writeLaunchers(packageDir);

  let archivePath = null;
  if (createZip) {
    archivePath = createZipArchive(packageDir, zipPath, options.spawnSync);
  }

  return {
    ready: true,
    packageName,
    projectRoot,
    outputRoot,
    packageDir,
    zipPath: archivePath || zipPath,
    apkSource,
    apkTarget,
    readmePath,
    launcherPaths,
    appFiles
  };
}

module.exports = {
  createFriendPreviewPackage,
  createReadme,
  createZipArchive,
  preparePackageDirectory
};
