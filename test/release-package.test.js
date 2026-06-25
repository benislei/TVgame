'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function writeFile(file, text = 'placeholder') {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, 'utf8');
}

function createFakeProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvgame-release-package-'));
  writeFile(path.join(root, 'package.json'), JSON.stringify({
    name: 'lan-game-streaming-prototype',
    scripts: {
      'stage2:check': 'node src/native-streamer/cli.js stage2-check',
      'stage2:doctor': 'node src/native-streamer/cli.js stage2-doctor',
      'native:rtp': 'node src/native-streamer/cli.js rtp'
    }
  }, null, 2));
  writeFile(path.join(root, 'package-lock.json'), '{}');
  writeFile(path.join(root, 'README.md'), '# TVGame');
  writeFile(path.join(root, 'src', 'native-streamer', 'cli.js'), 'console.log("native");');
  writeFile(path.join(root, 'src', 'stage2', 'tooling.js'), 'module.exports = {};');
  writeFile(path.join(root, 'scripts', 'install-nodejs.ps1'), 'Write-Host "node"');
  writeFile(path.join(root, 'scripts', 'install-gstreamer.ps1'), 'Write-Host "install"');
  writeFile(path.join(root, 'scripts', 'install-vigembus.ps1'), 'Write-Host "vigem"');
  writeFile(path.join(root, 'InputBridge', 'InputBridge.csproj'), '<Project />');
  writeFile(path.join(root, 'InputBridge', 'Program.cs'), 'Console.WriteLine("bridge");');
  writeFile(path.join(root, 'InputBridge', 'bin', 'Debug', 'ignored.txt'), 'ignored');
  writeFile(path.join(root, 'docs', 'stage2-local-verify.md'), '# verify');
  writeFile(path.join(root, 'public', 'receiver-utils.js'), 'module.exports = {};');
  writeFile(path.join(root, 'node_modules', 'ignored', 'index.js'), 'ignored');
  writeFile(path.join(root, 'android-tv-receiver', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'), 'apk bytes');
  return root;
}

test('friend preview package copies APK, runtime app files and Chinese launchers', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const outputRoot = path.join(projectRoot, 'dist-test');

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot,
    createZip: false
  });

  assert.equal(report.packageName, 'TVGame-Friend-Preview');
  assert.equal(report.ready, true);
  assert.equal(report.apkTarget, path.join(report.packageDir, 'TVGameReceiver.apk'));
  assert.equal(fs.existsSync(report.apkTarget), true);
  assert.equal(fs.readFileSync(report.apkTarget, 'utf8'), 'apk bytes');

  const requiredFiles = [
    'README-朋友试用.md',
    '安装Node.js运行环境.bat',
    '安装npm依赖.bat',
    '安装GStreamer依赖.bat',
    '安装ViGEmBus手柄驱动.bat',
    '检查环境.bat',
    '启动输入桥.bat',
    '启动推荐发送.bat',
    '启动性能保护发送.bat',
    '启动发送端-选择画质.bat',
    path.join('app', 'package.json'),
    path.join('app', 'package-lock.json'),
    path.join('app', 'src', 'native-streamer', 'cli.js'),
    path.join('app', 'scripts', 'install-nodejs.ps1'),
    path.join('app', 'scripts', 'install-gstreamer.ps1'),
    path.join('app', 'scripts', 'install-vigembus.ps1'),
    path.join('app', 'InputBridge', 'InputBridge.csproj'),
    path.join('app', 'docs', 'stage2-local-verify.md'),
    path.join('app', 'public', 'receiver-utils.js')
  ];

  for (const relative of requiredFiles) {
    assert.equal(fs.existsSync(path.join(report.packageDir, relative)), true, `${relative} should exist`);
  }

  assert.equal(fs.existsSync(path.join(report.packageDir, 'app', 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'app', 'InputBridge', 'bin')), false);
});

test('friend preview package includes packaged Electron desktop sender when available', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'TVGame Sender.exe'), 'desktop exe');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'resources', 'app.asar'), 'asar');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'node_modules', 'large', 'index.js'), 'ignored');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'dist', 'old.zip'), 'ignored');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'dist-desktop', 'nested.exe'), 'ignored');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'InputBridge', 'bin', 'Debug', 'ignored.txt'), 'ignored');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'InputBridge', 'obj', 'Debug', 'ignored.txt'), 'ignored');

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  const desktopExe = path.join(report.packageDir, 'desktop', 'TVGame Sender.exe');
  const desktopAsar = path.join(report.packageDir, 'desktop', 'resources', 'app.asar');
  const primaryDesktopLauncher = path.join(report.packageDir, '00-打开TVGame图形界面.bat');
  const desktopLauncher = path.join(report.packageDir, '启动TVGame发送端.bat');
  assert.equal(fs.existsSync(desktopExe), true);
  assert.equal(fs.readFileSync(desktopExe, 'utf8'), 'desktop exe');
  assert.equal(fs.existsSync(desktopAsar), true);
  assert.equal(fs.existsSync(primaryDesktopLauncher), true);
  assert.equal(fs.existsSync(desktopLauncher), true);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'desktop', 'node_modules')), false);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'desktop', 'dist')), false);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'desktop', 'dist-desktop')), false);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'desktop', 'InputBridge', 'bin')), false);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'desktop', 'InputBridge', 'obj')), false);
  assert.match(fs.readFileSync(primaryDesktopLauncher, 'utf8'), /start "" "TVGame Sender\.exe"/);
  assert.match(fs.readFileSync(desktopLauncher, 'utf8'), /cd \/d "%~dp0desktop"/);
  assert.match(fs.readFileSync(desktopLauncher, 'utf8'), /start "" "TVGame Sender\.exe"/);
});

test('friend preview package injects InputBridge runtime into packaged Electron app resources', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'TVGame Sender.exe'), 'desktop exe');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'resources', 'app', 'src', 'desktop', 'main.js'), 'main');
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'resources', 'app', 'src', 'native-streamer', 'cli.js'), 'cli');

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false,
    publishInputBridge: true,
    spawnSync(command, args) {
      assert.equal(command, 'dotnet');
      const outputIndex = args.indexOf('-o');
      assert.notEqual(outputIndex, -1);
      writeFile(path.join(args[outputIndex + 1], 'InputBridge.exe'), 'published exe');
      return { status: 0 };
    }
  });

  const appRuntime = path.join(report.packageDir, 'app', 'InputBridgeRuntime', 'InputBridge.exe');
  const desktopRuntime = path.join(report.packageDir, 'desktop', 'resources', 'app', 'InputBridgeRuntime', 'InputBridge.exe');
  assert.equal(fs.existsSync(appRuntime), true);
  assert.equal(fs.existsSync(desktopRuntime), true);
  assert.equal(fs.readFileSync(desktopRuntime, 'utf8'), 'published exe');
  assert.equal(report.desktopInputBridgeRuntimePath, path.dirname(desktopRuntime));
});

test('friend preview package skips desktop sender files and launcher when desktop package is missing', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  assert.equal(report.desktopPackagePath, null);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'desktop')), false);
  assert.equal(fs.existsSync(path.join(report.packageDir, '00-打开TVGame图形界面.bat')), false);
  assert.equal(fs.existsSync(path.join(report.packageDir, '启动TVGame发送端.bat')), false);
});

test('friend preview launchers run the expected low-latency commands', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  const read = name => fs.readFileSync(path.join(report.packageDir, name), 'utf8');
  const installNode = read('安装Node.js运行环境.bat');
  const installNpm = read('安装npm依赖.bat');
  const installGstreamer = read('安装GStreamer依赖.bat');
  const installVigemBus = read('安装ViGEmBus手柄驱动.bat');
  const check = read('检查环境.bat');
  const bridge = read('启动输入桥.bat');
  const recommendedSender = read('启动推荐发送.bat');
  const protectedSender = read('启动性能保护发送.bat');
  const selectorSender = read('启动发送端-选择画质.bat');

  for (const text of [installNode, installNpm, installGstreamer, installVigemBus, check, bridge, recommendedSender, protectedSender, selectorSender]) {
    assert.match(text, /chcp 65001 >nul/);
    assert.doesNotMatch(text, /(?<!\r)\n/);
    assert.match(text, /if not exist "%~dp0app\\package\.json"/);
    assert.match(text, /请从完整的 TVGame-Friend-Preview 文件夹中运行本脚本/);
    assert.match(text, /cd \/d "%~dp0app"/);
  }

  assert.match(installNode, /scripts\\install-nodejs\.ps1/);
  assert.match(installNode, /请关闭当前窗口，重新打开后再运行/);
  assert.match(installNpm, /where npm\.cmd/);
  assert.match(installNpm, /scripts\\install-nodejs\.ps1/);
  assert.match(installNpm, /npm\.cmd install/);
  assert.match(installGstreamer, /powershell\.exe[\s\S]+scripts\\install-gstreamer\.ps1[\s\S]+-InstallDevel/);
  assert.match(installVigemBus, /powershell\.exe[\s\S]+scripts\\install-vigembus\.ps1/);
  assert.match(check, /where npm\.cmd/);
  assert.match(check, /未检测到 Node\.js\/npm/);
  assert.match(check, /是否现在安装 Node\.js LTS/);
  assert.match(check, /scripts\\install-nodejs\.ps1/);
  assert.match(check, /未检测到 npm 依赖目录 node_modules/);
  assert.match(check, /是否现在安装\/更新 npm 依赖/);
  assert.match(check, /choice \/C YN \/N \/M/);
  assert.doesNotMatch(check, /set \/p "TV_FIX_/);
  assert.match(check, /npm\.cmd install/);
  assert.match(check, /npm\.cmd run stage2:doctor/);
  assert.match(bridge, /InputBridgeRuntime\\InputBridge\.exe/);
  assert.doesNotMatch(bridge, /dotnet run --project InputBridge\\InputBridge\.csproj/);
  assert.match(recommendedSender, /npm\.cmd run native:rtp -- --host "%TV_IP%" --encoder auto --encoder-preset auto --profile hevc1080p30 --process-priority high/);
  assert.match(protectedSender, /npm\.cmd run native:rtp -- --host "%TV_IP%" --encoder auto --encoder-preset auto --profile hevc1080p30 --process-priority high/);
  assert.match(recommendedSender, /不要填接收端左上角的“输入目标”/);
  assert.match(selectorSender, /--profile %TV_PROFILE%/);
  assert.match(selectorSender, /--process-priority high/);
});

test('friend preview package consolidates quality choices into one selector', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  const read = name => fs.readFileSync(path.join(report.packageDir, name), 'utf8');
  const selector = read('启动发送端-选择画质.bat');
  const readme = read('README-朋友试用.md');

  const removedLaunchers = [
    '启动默认发送.bat',
    '启动电视盒子稳定发送.bat',
    '启动高画质发送.bat',
    '启动抗花屏发送.bat',
    '启动低延迟实验发送.bat',
    '启动720回退发送.bat',
    '启动720P30稳定发送.bat',
    '启动720P60流畅发送.bat',
    '启动1080P30清晰发送.bat',
    '启动1080P60高性能发送.bat',
    '启动HEVC1080P30实验发送.bat',
    '启动HEVC1080P60高性能发送.bat'
  ];
  for (const name of removedLaunchers) {
    assert.equal(fs.existsSync(path.join(report.packageDir, name)), false, `${name} should be consolidated into selector`);
  }

  assert.match(selector, /1\. 720P30/);
  assert.match(selector, /2\. 720P60/);
  assert.match(selector, /3\. 1080P30/);
  assert.match(selector, /4\. 1080P60/);
  assert.match(selector, /5\. HEVC 1080P30/);
  assert.match(selector, /6\. HEVC 1080P60/);
  assert.match(selector, /7\. 性能保护推荐/);
  assert.match(selector, /if "%TV_PROFILE%"=="5" set "TV_PROFILE=hevc1080p30"/);
  assert.match(selector, /if "%TV_PROFILE%"=="6" set "TV_PROFILE=hevc1080p60"/);
  assert.match(selector, /if "%TV_PROFILE%"=="7" set "TV_PROFILE=hevc1080p30"/);
  assert.match(selector, /^echo\(  5\. HEVC 1080P30/m);
  assert.match(selector, /^echo\(  7\. 性能保护推荐/m);
  assert.match(readme, /720P30/);
  assert.match(readme, /HEVC 1080P30/);
  assert.match(readme, /HEVC 1080P60/);
  assert.match(readme, /安装ViGEmBus手柄驱动\.bat/);
});

test('friend preview quality selector gives every profile a game FPS protection hint', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  const selector = fs.readFileSync(path.join(report.packageDir, '启动发送端-选择画质.bat'), 'utf8');

  assert.match(selector, /set "TV_GAME_FPS_LIMIT=30"/);
  assert.match(selector, /set "TV_GAME_FPS_LIMIT=45"/);
  assert.match(selector, /set "TV_GAME_FPS_LIMIT=60"/);
  for (const profile of ['h264720p30', 'h264720p60', 'h2641080p30', 'h2641080p60', 'hevc1080p30', 'hevc1080p60']) {
    assert.match(selector, new RegExp(`if "%TV_PROFILE%"=="${profile}"`));
  }
  assert.match(selector, /TV_PROFILE_CHOICE/);
  assert.match(selector, /TV_GAME_FPS_NOTE/);
  assert.match(selector, /%TV_GAME_FPS_LIMIT%/);
  assert.match(selector, /--process-priority high/);
});

test('friend preview package can publish InputBridge runtime so friends do not need the .NET SDK', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const outputRoot = path.join(projectRoot, 'dist-test');
  const calls = [];

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot,
    createZip: false,
    publishInputBridge: true,
    spawnSync(command, args) {
      calls.push({ command, args });
      assert.equal(command, 'dotnet');
      assert.equal(args[0], 'publish');
      const outputIndex = args.indexOf('-o');
      assert.notEqual(outputIndex, -1);
      writeFile(path.join(args[outputIndex + 1], 'InputBridge.exe'), 'published exe');
      return { status: 0 };
    }
  });

  assert.equal(calls.length, 1);
  assert.equal(
    fs.existsSync(path.join(report.packageDir, 'app', 'InputBridgeRuntime', 'InputBridge.exe')),
    true
  );
});

test('ViGEmBus installer script stays ASCII-safe for Windows PowerShell 5.1', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-vigembus.ps1'), 'utf8');
  assert.match(source, /winget install --id ViGEm\.ViGEmBus/);
  assert.match(source, /Test-ViGEmBusInstalled/);
  assert.doesNotMatch(source, /[^\x00-\x7F]/);
});

test('Node.js installer script stays ASCII-safe and uses winget LTS package', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-nodejs.ps1'), 'utf8');
  assert.match(source, /OpenJS\.NodeJS\.LTS/);
  assert.match(source, /winget\.exe install --id \$PackageId/);
  assert.match(source, /Test-NodeReady/);
  assert.match(source, /npm\.cmd/);
  assert.doesNotMatch(source, /[^\x00-\x7F]/);
});

test('friend preview README explains Chinese validation steps and overlay hiding', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  const readme = fs.readFileSync(path.join(report.packageDir, 'README-朋友试用.md'), 'utf8');
  assert.match(readme, /Android 11\+/);
  assert.match(readme, /TVGameReceiver\.apk/);
  assert.match(readme, /00-打开TVGame图形界面\.bat/);
  assert.match(readme, /desktop\\TVGame Sender\.exe/);
  assert.match(readme, /安装Node\.js运行环境\.bat/);
  assert.match(readme, /检查环境\.bat/);
  assert.match(readme, /先说明处理方案，确认后再一键处理/);
  assert.match(readme, /输入 Y 后自动安装\/更新对应依赖/);
  assert.match(readme, /N 卡优先使用 `nvh264enc`/);
  assert.match(readme, /A 卡优先使用 `amfh264enc`/);
  assert.match(readme, /`mfh264enc` 兜底/);
  assert.match(readme, /ViGEmBus/);
  assert.match(readme, /InputBridgeRuntime/);
  assert.match(readme, /\.NET SDK/);
  assert.match(readme, /虚拟 Xbox 手柄/);
  assert.match(readme, /安装ViGEmBus手柄驱动\.bat/);
  assert.match(readme, /启动输入桥\.bat/);
  assert.match(readme, /启动推荐发送\.bat/);
  assert.match(readme, /启动性能保护发送\.bat/);
  assert.match(readme, /启动发送端-选择画质\.bat/);
  assert.match(readme, /统一画质选择入口/);
  assert.doesNotMatch(readme, /启动默认发送\.bat/);
  assert.doesNotMatch(readme, /启动电视盒子稳定发送\.bat/);
  assert.doesNotMatch(readme, /启动高画质发送\.bat/);
  assert.doesNotMatch(readme, /启动抗花屏发送\.bat/);
  assert.doesNotMatch(readme, /启动低延迟实验发送\.bat/);
  assert.match(readme, /建议顺序是：HEVC 1080P30/);
  assert.match(readme, /FPS 归零或卡顿/);
  assert.match(readme, /HEVC 1080P60/);
  assert.match(readme, /紧凑状态面板/);
  assert.match(readme, /设备/);
  assert.match(readme, /解码器/);
  assert.match(readme, /建议档/);
  assert.match(readme, /视频重启/);
  assert.match(readme, /菜单键或 F1/);
  assert.match(readme, /USB 手柄会被接收端 App 消费/);
  assert.match(readme, /回传原始手柄状态/);
  assert.match(readme, /游戏里请选择 Xbox 手柄或控制器输入/);
  assert.match(readme, /Steam 提示连接 Xbox 控制器/);
  assert.match(readme, /手柄 包/);
  assert.match(readme, /输入 发/);
  assert.match(readme, /收到手柄状态/);
  assert.match(readme, /输入失败/);
  assert.doesNotMatch(readme, /左摇杆和 D-pad 映射 WASD/);
  assert.doesNotMatch(readme, /右摇杆映射鼠标移动/);
  assert.match(readme, /自动探测 NVENC preset/);
  assert.match(readme, /--encoder-preset low-latency-hq/);
  assert.match(readme, /UDP 5004/);
  assert.match(readme, /UDP 5006/);
  assert.match(readme, /TCP 8789/);
});

test('friend preview sender launcher waits for TV IP input and forwards it to native:rtp', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });
  writeFile(path.join(report.packageDir, 'app', 'npm.cmd'), '@echo off\r\necho npm:%*\r\nexit /b 0\r\n');

  const script = path.join(report.packageDir, '启动推荐发送.bat');
  const result = childProcess.spawnSync('cmd.exe', [
    '/d',
    '/c',
    script
  ], {
    encoding: 'utf8',
    input: '192.168.50.140\r\n\r\n',
    timeout: 10000
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /npm:run native:rtp -- --host "192\.168\.50\.140" --encoder auto --encoder-preset auto --profile hevc1080p30 --process-priority high/);
});

test('friend preview quality selector prints HEVC choices safely and forwards selected profile', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });
  writeFile(path.join(report.packageDir, 'app', 'npm.cmd'), '@echo off\r\necho npm:%*\r\nexit /b 0\r\n');

  const script = path.join(report.packageDir, '启动发送端-选择画质.bat');
  const result = childProcess.spawnSync('cmd.exe', [
    '/d',
    '/c',
    script
  ], {
    encoding: 'utf8',
    input: '\r\n\r\n',
    timeout: 10000
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /5\. HEVC 1080P30/);
  assert.match(result.stdout, /6\. HEVC 1080P60/);
  assert.doesNotMatch(result.stdout, /is not recognized as an internal or external command/);
  assert.match(result.stdout, /7\. 性能保护推荐/);
  assert.match(result.stdout, /npm:run native:rtp -- --host "127\.0\.0\.1" --encoder auto --encoder-preset auto --profile hevc1080p30 --process-priority high/);
});

test('friend preview package can request a zip archive through PowerShell Compress-Archive', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const calls = [];

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: true,
    spawnSync(command, args, options) {
      calls.push({ command, args, options });
      return { status: 0 };
    }
  });

  assert.equal(report.zipPath, path.join(path.dirname(report.packageDir), 'TVGame-Friend-Preview.zip'));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.deepEqual(calls[0].args.slice(0, 3), ['-NoProfile', '-ExecutionPolicy', 'Bypass']);
  assert.match(calls[0].args.join(' '), /Compress-Archive/);
  assert.match(calls[0].args.join(' '), /TVGame-Friend-Preview\.zip/);
});

test('friend preview package falls back to a numbered folder when the old package is locked', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const outputRoot = path.join(projectRoot, 'dist-test');
  const lockedDir = path.join(outputRoot, 'TVGame-Friend-Preview');
  fs.mkdirSync(lockedDir, { recursive: true });

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot,
    createZip: false,
    rmSync(target, options) {
      if (target === lockedDir) {
        const error = new Error('locked');
        error.code = 'EBUSY';
        throw error;
      }
      fs.rmSync(target, options);
    }
  });

  assert.equal(report.packageName, 'TVGame-Friend-Preview-2');
  assert.equal(report.packageDir, path.join(outputRoot, 'TVGame-Friend-Preview-2'));
  assert.equal(fs.existsSync(path.join(report.packageDir, 'TVGameReceiver.apk')), true);
});

test('package.json exposes package:friend script', () => {
  const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
  assert.equal(packageJson.scripts['package:friend'], 'node src/release-package/cli.js friend');
});
