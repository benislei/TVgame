'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_NAME = 'TVGame-Friend-Preview';
const APK_SOURCE_RELATIVE = path.join('android-tv-receiver', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const DESKTOP_SENDER_SOURCE_RELATIVE = path.join('dist-desktop', 'win-unpacked');
const DESKTOP_SENDER_EXE = 'TVGame Sender.exe';
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

function copyDirectoryContents(source, target) {
  ensureDirectory(target);
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    if (entry.isDirectory()) {
      copyDirectoryContents(sourcePath, targetPath);
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

function copyDesktopSenderIfExists(projectRoot, packageDir) {
  const desktopSource = path.join(projectRoot, DESKTOP_SENDER_SOURCE_RELATIVE);
  const desktopExecutable = path.join(desktopSource, DESKTOP_SENDER_EXE);
  if (!fs.existsSync(desktopExecutable)) return null;

  const desktopTarget = path.join(packageDir, 'desktop');
  copyDirectoryContents(desktopSource, desktopTarget);
  return desktopTarget;
}

function publishInputBridgeRuntime(projectRoot, packageDir, spawnSync = childProcess.spawnSync) {
  const projectFile = path.join(projectRoot, 'InputBridge', 'InputBridge.csproj');
  if (!fs.existsSync(projectFile)) {
    throw new Error(`缺少输入桥项目文件：${projectFile}`);
  }

  const outputDir = path.join(packageDir, 'app', 'InputBridgeRuntime');
  ensureDirectory(outputDir);
  const result = spawnSync('dotnet', [
    'publish',
    projectFile,
    '-c',
    'Release',
    '-r',
    'win-x64',
    '--self-contained',
    'true',
    '-p:PublishSingleFile=true',
    '-o',
    outputDir
  ], {
    stdio: 'inherit',
    windowsHide: true
  });

  if (result.error) {
    throw new Error(`输入桥运行时发布失败：${result.error.message}`);
  }
  if (typeof result.status === 'number' && result.status !== 0) {
    throw new Error(`输入桥运行时发布失败，退出码：${result.status}`);
  }

  const executable = path.join(outputDir, 'InputBridge.exe');
  if (!fs.existsSync(executable)) {
    throw new Error(`输入桥运行时发布失败，未生成文件：${executable}`);
  }

  return outputDir;
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

function createDesktopSenderBatch() {
  const text = [
    '@echo off',
    'chcp 65001 >nul',
    'setlocal',
    'if not exist "%~dp0desktop\\TVGame Sender.exe" (',
    '  echo 未找到 desktop\\TVGame Sender.exe。',
    '  echo 请先运行 npm.cmd run desktop:package，再重新生成朋友试用包。',
    '  exit /b 1',
    ')',
    'cd /d "%~dp0desktop"',
    'start "" "TVGame Sender.exe"',
    ''
  ].join('\n');

  return toWindowsNewlines(text);
}

function createNpmGuardBody(nextCommand) {
  return `
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js/npm。
  echo 正在尝试安装 Node.js LTS...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\install-nodejs.ps1"
  if exist "%ProgramFiles%\\nodejs\\npm.cmd" set "PATH=%ProgramFiles%\\nodejs;%PATH%"
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo.
  echo 仍未检测到 Node.js/npm。
  echo 请关闭当前窗口，重新打开后再运行本脚本。
  echo 也可以手动运行：安装Node.js运行环境.bat
  exit /b 1
)
${nextCommand.trim()}
`;
}

function createSenderBatch(profileArgs) {
  return createBatchScript(createNpmGuardBody(`
echo 请输入电视或盒子的局域网 IP。
echo 注意：这里填电视/盒子自身 IP，不要填接收端左上角的“输入目标”。
echo 示例：192.168.50.140
set "TV_IP="
set /p "TV_IP=电视/盒子 IP（留空为 127.0.0.1）："
if "%TV_IP%"=="" set "TV_IP=127.0.0.1"
echo.
echo 正在启动发送端，目标：%TV_IP%
call npm.cmd run native:rtp -- --host "%TV_IP%"${profileArgs ? ` ${profileArgs}` : ''}
`));
}

function createQualitySelectorBatch() {
  return createBatchScript(createNpmGuardBody(`
echo(请选择发送画质档位：
echo(  1. 720P30 稳定优先，适合电视盒子和弱解码设备
echo(  2. 720P60 流畅优先，适合网络稳定但解码一般的设备
echo(  3. 1080P30 清晰稳定，适合电视盒子优先尝试
echo(  4. 1080P60 高性能，适合手机、高性能电视或盒子
echo(  5. HEVC 1080P30 推荐，低码率高清，优先使用
echo(  6. HEVC 1080P60 高性能，适合解码能力较强的 Android 11+ 设备
echo(  7. 性能保护推荐，HEVC 1080P30，并提高发送进程优先级
echo(
set "TV_PROFILE="
set /p "TV_PROFILE=请输入 1-7（默认 7 性能保护推荐）："
if "%TV_PROFILE%"=="" set "TV_PROFILE=7"
set "TV_PROFILE_CHOICE=%TV_PROFILE%"
if "%TV_PROFILE%"=="1" set "TV_PROFILE=h264720p30"
if "%TV_PROFILE%"=="2" set "TV_PROFILE=h264720p60"
if "%TV_PROFILE%"=="3" set "TV_PROFILE=h2641080p30"
if "%TV_PROFILE%"=="4" set "TV_PROFILE=h2641080p60"
if "%TV_PROFILE%"=="5" set "TV_PROFILE=hevc1080p30"
if "%TV_PROFILE%"=="6" set "TV_PROFILE=hevc1080p60"
if "%TV_PROFILE%"=="7" set "TV_PROFILE=hevc1080p30"
if "%TV_PROFILE%"=="h264720p30" goto :profile_ok
if "%TV_PROFILE%"=="h264720p60" goto :profile_ok
if "%TV_PROFILE%"=="h2641080p30" goto :profile_ok
if "%TV_PROFILE%"=="h2641080p60" goto :profile_ok
if "%TV_PROFILE%"=="hevc1080p30" goto :profile_ok
if "%TV_PROFILE%"=="hevc1080p60" goto :profile_ok
echo(输入无效，已改用 720P30 稳定档。
set "TV_PROFILE=h264720p30"
:profile_ok
set "TV_PROFILE_LABEL=%TV_PROFILE%"
set "TV_GAME_FPS_LIMIT=60"
set "TV_GAME_FPS_NOTE=建议先把游戏内 FPS 上限锁到 60；如果仍卡，再降到 45 或 30。"
if "%TV_PROFILE%"=="h264720p30" (
  set "TV_PROFILE_LABEL=720P30"
  set "TV_GAME_FPS_LIMIT=30"
  set "TV_GAME_FPS_NOTE=低性能设备优先锁 30 FPS，保证捕获和编码有余量。"
)
if "%TV_PROFILE%"=="h264720p60" (
  set "TV_PROFILE_LABEL=720P60"
  set "TV_GAME_FPS_LIMIT=60"
  set "TV_GAME_FPS_NOTE=建议锁 60 FPS；如果电脑负载很高，再降到 45 或 30。"
)
if "%TV_PROFILE%"=="h2641080p30" (
  set "TV_PROFILE_LABEL=1080P30"
  set "TV_GAME_FPS_LIMIT=45"
  set "TV_GAME_FPS_NOTE=建议先锁 45 FPS，想要更低输入延迟可试 60，卡顿时降到 30。"
)
if "%TV_PROFILE%"=="h2641080p60" (
  set "TV_PROFILE_LABEL=1080P60"
  set "TV_GAME_FPS_LIMIT=60"
  set "TV_GAME_FPS_NOTE=建议锁 60 FPS，给捕获、编码和发送留下稳定余量。"
)
if "%TV_PROFILE%"=="hevc1080p30" (
  set "TV_PROFILE_LABEL=HEVC 1080P30"
  set "TV_GAME_FPS_LIMIT=60"
  set "TV_GAME_FPS_NOTE=推荐先锁 60 FPS；大型游戏仍卡时降到 45 或 30。"
)
if "%TV_PROFILE%"=="hevc1080p60" (
  set "TV_PROFILE_LABEL=HEVC 1080P60"
  set "TV_GAME_FPS_LIMIT=60"
  set "TV_GAME_FPS_NOTE=高性能档建议锁 60 FPS，避免游戏把编码资源吃满。"
)
if "%TV_PROFILE_CHOICE%"=="7" (
  set "TV_PROFILE_LABEL=性能保护推荐 HEVC 1080P30"
  set "TV_GAME_FPS_LIMIT=60"
  set "TV_GAME_FPS_NOTE=大型游戏优先锁 60 FPS；显卡、显存或内存吃满时降到 45 或 30。"
)
echo(
echo(性能保护已开启：发送端进程将使用 High 优先级。
echo(建议游戏 FPS 上限：%TV_GAME_FPS_LIMIT%。%TV_GAME_FPS_NOTE%
echo(
echo(请选择电视或盒子的局域网 IP。
set "TV_IP="
set /p "TV_IP=电视/盒子 IP（留空为 127.0.0.1）："
if "%TV_IP%"=="" set "TV_IP=127.0.0.1"
echo(
echo(正在启动发送端，目标：%TV_IP%，档位：%TV_PROFILE_LABEL%
call npm.cmd run native:rtp -- --host "%TV_IP%" --encoder auto --encoder-preset auto --profile %TV_PROFILE% --process-priority high
`));
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
    '- 发送端：Windows 电脑，推荐 NVIDIA 或 AMD 独立显卡，并通过 `检查环境.bat` 自动检查和处理 Node.js、npm 依赖、GStreamer MSVC x86_64、硬件编码插件等运行环境；输入桥已随包发布到 `InputBridgeRuntime`，朋友电脑不需要额外安装 .NET SDK。如果要让电视端 USB 手柄控制 PC 游戏，还需要 ViGEmBus 虚拟手柄驱动。',
    '- 网络：电视/盒子和电脑在同一个局域网，优先使用有线或高质量 5GHz/6GHz Wi-Fi。',
    '',
    '## 文件说明',
    '',
    '- `TVGameReceiver.apk`：安装到电视或电视盒子的接收端 App。',
    '- `安装Node.js运行环境.bat`：安装发送端基础运行时 Node.js/npm。Node.js/npm 是发送端基础运行时依赖，没有它无法运行检查环境和发送端脚本。',
    '- `安装npm依赖.bat`：在电脑端安装项目 npm 依赖；如果没有 Node.js/npm，会先自动尝试安装 Node.js LTS。',
    '- `安装GStreamer依赖.bat`：尝试安装 GStreamer 依赖。',
    '- `安装ViGEmBus手柄驱动.bat`：安装 PC 端虚拟 Xbox 手柄驱动，电视或盒子上的 USB 手柄需要它才能被 PC 游戏识别。',
    '- `检查环境.bat`：推荐第一个运行。它会检查电脑端 Node.js/npm、npm 依赖、GStreamer、编码器、音频捕获和输入桥运行时；发现缺失后会先说明处理方案，确认后再一键处理。',
    '- `启动输入桥.bat`：启动键鼠输入和虚拟 Xbox 手柄输入回传桥，默认运行包内 `InputBridgeRuntime\\InputBridge.exe`。',
    '- `启动推荐发送.bat`：HEVC 1080P30 推荐档，并自动提高发送进程优先级。当前测试里清晰度、流畅度和延迟综合最好，优先从这里开始。',
    '- `启动性能保护发送.bat`：大型游戏优先使用。它会使用 HEVC 1080P30，同时把发送端 GStreamer 进程提高到 High 优先级，尽量给画面捕获、编码和传输保留响应时间。',
    '- `启动发送端-选择画质.bat`：统一画质选择入口，包含 720P30、720P60、1080P30、1080P60、HEVC 1080P30、HEVC 1080P60 和性能保护推荐。每个档位都会提高发送进程优先级，并显示对应的游戏 FPS 上限建议。默认选项是性能保护推荐档。',
    '',
    '## 快速验证步骤',
    '',
    '1. 把 `TVGameReceiver.apk` 安装到 Android 11+ 电视或电视盒子上，然后打开“电视游戏接收端”。接收端 App 打开期间会保持屏幕常亮，避免电视自动休眠后黑屏。',
    '2. 在电脑上运行 `检查环境.bat`。如果发现缺 Node.js/npm、npm 依赖、GStreamer 或编码器插件，脚本会先列出缺失项和处理方案，再询问是否一键处理；输入 Y 后自动安装/更新对应依赖。',
    '3. 一键处理完成后，关闭当前窗口，重新运行 `检查环境.bat`。如果仍缺硬件编码器，请优先更新 NVIDIA/AMD 显卡驱动，并确认 GStreamer runtime + devel 都已安装。',
    '   如果环境检查缺 `nvh264enc` 但电脑是 AMD 显卡，这是正常的；新版发送端会自动尝试 `amfh264enc`。如果 `amfh264enc` 也缺，优先通过 `检查环境.bat` 的一键处理安装 devel 包，并更新 AMD 显卡驱动。',
    '   N 卡优先使用 `nvh264enc`；A 卡优先使用 `amfh264enc`；两者都没有时会尝试 Windows Media Foundation 的 `mfh264enc` 兜底。',
    '4. 如果要测试电视端 USB 手柄，先以管理员权限运行 `安装ViGEmBus手柄驱动.bat`。安装完成后重新启动 `启动输入桥.bat`，窗口里应看到“虚拟 Xbox 手柄已连接”。',
    '5. 运行 `启动输入桥.bat`，保持这个窗口打开。如果游戏以管理员权限运行，输入桥也建议用管理员权限启动。',
    '6. 运行 `启动推荐发送.bat` 或 `启动性能保护发送.bat`，输入电视或盒子的局域网 IP。注意这里填的是电视/盒子自身 IP，不是接收端左上角显示的“输入目标”。接收端会从视频包来源自动识别电脑输入桥 IP。',
    '7. 电视上看到画面和声音后，优先用真实游戏验证移动、转向、开火、菜单等操作体感。游戏里请选择 Xbox 手柄或控制器输入。',
    '8. 如果想切换画质或排查设备性能，运行 `启动发送端-选择画质.bat`。建议顺序是：HEVC 1080P30、HEVC 1080P60、1080P60、1080P30、720P60、720P30。选择器里的每个档位都会启用发送端 High 优先级，并在启动前提示该档建议的游戏 FPS 上限。',
    '9. 如果出现花屏、FPS 归零或卡顿，先降到 1080P30；仍不稳定再降到 720P60 或 720P30。手机和高性能盒子可以优先尝试 HEVC 1080P60。大型游戏如果电脑端显卡或内存被吃满，按脚本提示把游戏内 FPS 上限设置到 60、45 或 30，关闭不必要的后台录屏/直播/叠加层，并使用 `启动性能保护发送.bat`。',
    '',
    '## 大型游戏性能保护',
    '',
    '性能保护模式不会降低游戏本身画质，它主要做两件事：把发送端 GStreamer 进程提升到 High 优先级，并给当前画质档位显示建议的游戏 FPS 上限。这样在游戏把 GPU、显存或内存吃满时，捕获、编码和 UDP 发送更不容易被系统调度挤掉。',
    '',
    '如果接收端 FPS 明显低于电脑端游戏 FPS，优先在游戏内开启帧率上限。脚本只会给出每个档位的建议值，不会自动修改游戏设置；真正的限帧需要在游戏内、显卡驱动或 RTSS 这类工具里手动设置。目标是给发送端留下 10% 到 20% 的 GPU/显存余量。这个余量比单纯追求电脑端游戏 FPS 更重要，因为串流链路需要稳定的帧时间。',
    '',
    '## 手柄输入',
    '',
    'USB 手柄会被接收端 App 消费，不再继续交给电视系统处理，避免手柄操作电视 UI。接收端会回传原始手柄状态，PC 端 InputBridge 通过 ViGEmBus 注入虚拟 Xbox 手柄。游戏里请选择 Xbox 手柄或控制器输入。',
    '',
    '手柄链路可以按三段判断：Steam 提示连接 Xbox 控制器，说明 PC 端虚拟手柄已启动；电视状态面板里的“手柄 包”随按键或摇杆增长，说明接收端 App 已截获手柄事件；面板里的“输入 发”增长且输入桥窗口打印“收到手柄状态”，说明电视到 PC 的回传已经到达。如果“输入失败”增长，请检查 APK 内的 PC IP、Windows 防火墙和输入桥窗口是否仍在运行。如果三段都正常但游戏仍不能操作，请在游戏或 Steam 中选择 Xbox 手柄/控制器输入，并尝试重启游戏。',
    '',
    '## 状态面板',
    '',
    '接收端左上角默认显示紧凑状态面板，保留实时FPS、实时丢包、实时丢帧、等待关键帧、恢复丢帧、队列丢帧、解码丢帧、音视频状态、设备、解码器、建议档、视频重启次数和输入诊断。菜单键或 F1 可以隐藏或显示状态面板。',
    '',
    '## 自动探测 NVENC preset',
    '',
    '朋友试用包里的发送脚本默认使用 `--encoder auto --encoder-preset auto`。编码器会按 `nvh264enc`、`amfh264enc`、`mfh264enc` 的顺序自动选择；N 卡 preset 会按游戏体验优先顺序自动尝试 `low-latency-hq`、`low-latency-hp`、`low-latency`、`hp`、`default`、`hq`，前面的 preset 不支持时会自动回退。需要排查兼容性时，可以在项目目录手动运行 `npm.cmd run native:rtp -- --host <电视IP> --encoder amf`、`--encoder mf`，或在 N 卡上固定 `--encoder-preset low-latency-hq`。',
    '',
    '## 端口',
    '',
    '- 视频：UDP 5004',
    '- 音频：UDP 5006',
    '- 输入回传：TCP 8789',
    '',
    '如果电视收不到画面，先确认 Windows 防火墙没有拦截 Node.js、GStreamer 或 InputBridge。',
    '',
    '## 画质档位',
    '',
    '- 720P30：稳定优先，适合电视盒子或解码能力偏弱的设备。',
    '- 720P60：流畅优先，适合网络稳定但不适合 1080P 的设备。',
    '- 1080P30：清晰稳定，适合电视盒子优先尝试。',
    '- 1080P60：高性能档，适合手机、高性能电视或盒子。',
    '- HEVC 1080P30：推荐档，码率更低，当前测试里清晰度、流畅度和延迟综合最好。',
    '- HEVC 1080P60：高性能实验档，适合 H.265 硬解稳定且性能更强的 Android 11+ 设备。',
    '',
    '接收端会按 16:9 等比居中显示画面，不再硬拉伸铺满屏幕；比例不一致时会保留黑边以避免画面变形。',
    ''
  ].join('\n');
}

function createEnvironmentCheckBatch() {
  return createBatchScript(`
echo 正在检查发送端环境...
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js/npm。
  echo 处理方案：安装 Node.js LTS，安装完成后脚本会尝试把 npm 加入当前 PATH。
  choice /C YN /N /M "是否现在安装 Node.js LTS？按 Y 开始，按 N 取消："
  if errorlevel 2 (
    echo 已取消 Node.js 自动安装。
  ) else (
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\install-nodejs.ps1"
    if exist "%ProgramFiles%\\nodejs\\npm.cmd" set "PATH=%ProgramFiles%\\nodejs;%PATH%"
  )
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 仍未检测到 Node.js/npm。请关闭当前窗口，重新打开后再运行 检查环境.bat。
  exit /b 1
)
if not exist "node_modules" (
  echo.
  echo 未检测到 npm 依赖目录 node_modules。
  echo 处理方案：运行 npm install，一次性安装发送端所需 Node 依赖。
  choice /C YN /N /M "是否现在安装/更新 npm 依赖？按 Y 开始，按 N 跳过："
  if errorlevel 2 (
    echo 已跳过 npm 依赖安装。
  ) else (
    call npm.cmd install
    if errorlevel 1 exit /b 1
  )
)
call npm.cmd run stage2:doctor
`);
}

function writeLaunchers(packageDir) {
  const launchers = {
    '安装Node.js运行环境.bat': createBatchScript('echo 正在安装 Node.js 运行环境...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\install-nodejs.ps1"\r\necho.\r\necho 如果刚安装 Node.js，请关闭当前窗口，重新打开后再运行 安装npm依赖.bat。'),
    '安装npm依赖.bat': createBatchScript(createNpmGuardBody('echo 正在安装 npm 依赖...\r\ncall npm.cmd install')),
    '安装GStreamer依赖.bat': createBatchScript('echo 正在安装 GStreamer 依赖...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\install-gstreamer.ps1" -InstallDevel'),
    '安装ViGEmBus手柄驱动.bat': createBatchScript('echo 正在安装 ViGEmBus 虚拟手柄驱动...\r\npowershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\\install-vigembus.ps1"'),
    '检查环境.bat': createBatchScript(`
echo 正在检查发送端环境...
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo 未检测到 Node.js/npm。
  echo 请先运行 安装Node.js运行环境.bat，安装完成后关闭当前窗口，重新打开再检查。
  exit /b 1
)
call npm.cmd run stage2:check
`),
    '启动输入桥.bat': createBatchScript(`
echo 正在启动输入桥，请保持此窗口打开。
if not exist "InputBridgeRuntime\\InputBridge.exe" (
  echo 未找到 InputBridgeRuntime\\InputBridge.exe。
  echo 请重新生成朋友试用包，或联系发送方获取完整包。
  exit /b 1
)
"InputBridgeRuntime\\InputBridge.exe"
exit /b %ERRORLEVEL%
`),
    '启动推荐发送.bat': createSenderBatch('--encoder auto --encoder-preset auto --profile hevc1080p30 --process-priority high'),
    '启动性能保护发送.bat': createSenderBatch('--encoder auto --encoder-preset auto --profile hevc1080p30 --process-priority high'),
    '启动发送端-选择画质.bat': createQualitySelectorBatch()
  };

  launchers['检查环境.bat'] = createEnvironmentCheckBatch();

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
  const publishInputBridge = options.publishInputBridge === true;

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
  const desktopPackagePath = copyDesktopSenderIfExists(projectRoot, packageDir);

  let inputBridgeRuntimePath = null;
  if (publishInputBridge) {
    inputBridgeRuntimePath = publishInputBridgeRuntime(projectRoot, packageDir, options.spawnSync);
  }

  const readmePath = path.join(packageDir, 'README-朋友试用.md');
  writeText(readmePath, createReadme());
  const launcherPaths = writeLaunchers(packageDir);
  if (desktopPackagePath) {
    const desktopLauncherPath = path.join(packageDir, '启动TVGame发送端.bat');
    writeText(desktopLauncherPath, createDesktopSenderBatch());
    launcherPaths.push(desktopLauncherPath);
  }

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
    inputBridgeRuntimePath,
    desktopPackagePath,
    appFiles
  };
}

module.exports = {
  createFriendPreviewPackage,
  createReadme,
  createZipArchive,
  publishInputBridgeRuntime,
  preparePackageDirectory
};
