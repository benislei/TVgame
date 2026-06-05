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
      'native:rtp': 'node src/native-streamer/cli.js rtp'
    }
  }, null, 2));
  writeFile(path.join(root, 'package-lock.json'), '{}');
  writeFile(path.join(root, 'README.md'), '# TVGame');
  writeFile(path.join(root, 'src', 'native-streamer', 'cli.js'), 'console.log("native");');
  writeFile(path.join(root, 'src', 'stage2', 'tooling.js'), 'module.exports = {};');
  writeFile(path.join(root, 'scripts', 'install-gstreamer.ps1'), 'Write-Host "install"');
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
    '安装npm依赖.bat',
    '安装GStreamer依赖.bat',
    '检查环境.bat',
    '启动输入桥.bat',
    '启动默认发送.bat',
    '启动高画质发送.bat',
    '启动抗花屏发送.bat',
    '启动720回退发送.bat',
    path.join('app', 'package.json'),
    path.join('app', 'package-lock.json'),
    path.join('app', 'src', 'native-streamer', 'cli.js'),
    path.join('app', 'scripts', 'install-gstreamer.ps1'),
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

test('friend preview launchers run the expected low-latency commands', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  const read = name => fs.readFileSync(path.join(report.packageDir, name), 'utf8');
  const installNpm = read('安装npm依赖.bat');
  const installGstreamer = read('安装GStreamer依赖.bat');
  const check = read('检查环境.bat');
  const bridge = read('启动输入桥.bat');
  const defaultSender = read('启动默认发送.bat');
  const qualitySender = read('启动高画质发送.bat');
  const resilientSender = read('启动抗花屏发送.bat');
  const fallbackSender = read('启动720回退发送.bat');

  for (const text of [installNpm, installGstreamer, check, bridge, defaultSender, qualitySender, resilientSender, fallbackSender]) {
    assert.match(text, /chcp 65001 >nul/);
    assert.doesNotMatch(text, /(?<!\r)\n/);
    assert.match(text, /if not exist "%~dp0app\\package\.json"/);
    assert.match(text, /请从完整的 TVGame-Friend-Preview 文件夹中运行本脚本/);
    assert.match(text, /cd \/d "%~dp0app"/);
  }

  assert.match(installNpm, /npm\.cmd install/);
  assert.match(installGstreamer, /powershell\.exe[\s\S]+scripts\\install-gstreamer\.ps1[\s\S]+-InstallDevel/);
  assert.match(check, /npm\.cmd run stage2:check/);
  assert.match(bridge, /dotnet run --project InputBridge\\InputBridge\.csproj/);
  assert.match(defaultSender, /npm\.cmd run native:rtp -- --host "%TV_IP%" --encoder-preset auto/);
  assert.match(qualitySender, /npm\.cmd run native:rtp -- --host "%TV_IP%" --encoder-preset auto --profile quality1080/);
  assert.match(resilientSender, /npm\.cmd run native:rtp -- --host "%TV_IP%" --encoder-preset auto --profile resilient1080/);
  assert.match(fallbackSender, /npm\.cmd run native:rtp -- --host "%TV_IP%" --encoder-preset auto --profile game720/);
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
  assert.match(readme, /启动输入桥\.bat/);
  assert.match(readme, /启动默认发送\.bat/);
  assert.match(readme, /启动高画质发送\.bat/);
  assert.match(readme, /启动抗花屏发送\.bat/);
  assert.match(readme, /短 GOP/);
  assert.match(readme, /紧凑状态面板/);
  assert.match(readme, /菜单键或 F1/);
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

  const script = path.join(report.packageDir, '启动默认发送.bat');
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
  assert.match(result.stdout, /npm:run native:rtp -- --host "192\.168\.50\.140" --encoder-preset auto/);
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
