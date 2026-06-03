'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  createAndroidBuildReport,
  createAndroidPaths,
  findAndroidSdkRoot
} = require('../src/android-build/tooling');

function createCliTestEnv() {
  return {
    SystemRoot: process.env.SystemRoot || 'C:\\Windows',
    ComSpec: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
    PATH: '',
    JAVA_HOME: '',
    ANDROID_HOME: '',
    ANDROID_SDK_ROOT: path.join('Z:', 'MissingSdk'),
    LOCALAPPDATA: path.join('Z:', 'MissingLocalAppData'),
    USERPROFILE: path.join('Z:', 'MissingUser')
  };
}

function createCliReportOverride({ ready, missing = [], receiverRoot = path.join('C:', 'repo', 'android-tv-receiver'), apkFound = false }) {
  const apkPath = path.join(receiverRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  const found = Boolean(ready);
  return {
    ready,
    missing,
    paths: { receiverRoot },
    jdk: {
      java: { found, path: found ? path.join('C:', 'Java', 'bin', 'java.exe') : null },
      javac: { found, path: found ? path.join('C:', 'Java', 'bin', 'javac.exe') : null }
    },
    sdk: {
      root: path.join('C:', 'Android', 'Sdk'),
      sdkmanager: { found, path: found ? path.join('C:', 'Android', 'Sdk', 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat') : null },
      adb: { found, path: found ? path.join('C:', 'Android', 'Sdk', 'platform-tools', 'adb.exe') : null }
    },
    packages: {
      android35: { found },
      buildTools35: { found }
    },
    gradleWrapper: {
      ready: found,
      path: found ? path.join(receiverRoot, 'gradlew.bat') : null
    },
    apk: {
      path: apkPath,
      found: apkFound
    }
  };
}

test('android build report finds configured SDK packages and wrapper', () => {
  const root = path.join('C:', 'repo');
  const sdkRoot = path.join('D:', 'Android', 'Sdk');
  const existing = new Set([
    path.join('C:', 'Java', 'bin', 'java.exe'),
    path.join('C:', 'Java', 'bin', 'javac.exe'),
    path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat'),
    path.join(sdkRoot, 'platform-tools', 'adb.exe'),
    path.join(sdkRoot, 'platforms', 'android-35', 'android.jar'),
    path.join(sdkRoot, 'build-tools', '35.0.0', 'aapt2.exe'),
    path.join(root, 'android-tv-receiver', 'gradlew.bat')
  ]);

  const report = createAndroidBuildReport({
    projectRoot: root,
    env: { JAVA_HOME: path.join('C:', 'Java'), ANDROID_SDK_ROOT: sdkRoot },
    exists: file => existing.has(file)
  });

  assert.equal(report.ready, true);
  assert.equal(report.jdk.ready, true);
  assert.equal(report.sdk.ready, true);
  assert.equal(report.gradleWrapper.ready, true);
  assert.deepEqual(report.missing, []);
});

test('android build report marks missing dependencies clearly', () => {
  const root = path.join('C:', 'repo');
  const sdkRoot = path.join('D:', 'Android', 'Sdk');
  const existing = new Set([
    path.join('C:', 'Java', 'bin', 'java.exe'),
    path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat')
  ]);

  const report = createAndroidBuildReport({
    projectRoot: root,
    env: { JAVA_HOME: path.join('C:', 'Java'), ANDROID_HOME: sdkRoot },
    exists: file => existing.has(file)
  });

  assert.equal(report.ready, false);
  assert.equal(report.jdk.javac.found, false);
  assert.equal(report.sdk.adb.found, false);
  assert.equal(report.packages.android35.found, false);
  assert.equal(report.packages.buildTools35.found, false);
  assert.equal(report.gradleWrapper.ready, false);
  assert.ok(report.missing.includes('JDK javac.exe'));
  assert.ok(report.missing.includes('Android SDK platform-tools adb.exe'));
  assert.ok(report.missing.includes('Android SDK platform android-35'));
  assert.ok(report.missing.includes('Android SDK build-tools 35.0.0'));
  assert.ok(report.missing.includes('Gradle Wrapper gradlew.bat'));
});

test('android build report falls back from invalid ANDROID_SDK_ROOT to valid ANDROID_HOME', () => {
  const root = path.join('C:', 'repo');
  const invalidSdkRoot = path.join('D:', 'MissingSdk');
  const sdkRoot = path.join('E:', 'Android', 'Sdk');
  const existing = new Set([
    path.join('C:', 'Java', 'bin', 'java.exe'),
    path.join('C:', 'Java', 'bin', 'javac.exe'),
    path.join(sdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat'),
    path.join(sdkRoot, 'platform-tools', 'adb.exe'),
    path.join(sdkRoot, 'platforms', 'android-35', 'android.jar'),
    path.join(sdkRoot, 'build-tools', '35.0.0', 'aapt2.exe'),
    path.join(root, 'android-tv-receiver', 'gradlew.bat')
  ]);

  const report = createAndroidBuildReport({
    projectRoot: root,
    env: {
      JAVA_HOME: path.join('C:', 'Java'),
      ANDROID_SDK_ROOT: invalidSdkRoot,
      ANDROID_HOME: sdkRoot
    },
    exists: file => existing.has(file)
  });

  assert.equal(report.paths.sdkRoot, sdkRoot);
  assert.equal(report.sdk.root, sdkRoot);
  assert.equal(report.ready, true);
  assert.deepEqual(report.missing, []);
});

test('android build report normalizes relative SDK roots before reporting ready', () => {
  const root = path.join('C:', 'repo');
  const relativeSdkRoot = path.join('relative', 'Sdk');
  const absoluteSdkRoot = path.resolve(relativeSdkRoot);
  const existing = new Set([
    path.join('C:', 'Java', 'bin', 'java.exe'),
    path.join('C:', 'Java', 'bin', 'javac.exe'),
    path.join(absoluteSdkRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat'),
    path.join(absoluteSdkRoot, 'platform-tools', 'adb.exe'),
    path.join(absoluteSdkRoot, 'platforms', 'android-35', 'android.jar'),
    path.join(absoluteSdkRoot, 'build-tools', '35.0.0', 'aapt2.exe'),
    path.join(root, 'android-tv-receiver', 'gradlew.bat')
  ]);

  const report = createAndroidBuildReport({
    projectRoot: root,
    env: {
      JAVA_HOME: path.join('C:', 'Java'),
      ANDROID_SDK_ROOT: `  ${relativeSdkRoot}  `
    },
    exists: file => existing.has(file)
  });

  assert.equal(path.isAbsolute(report.sdk.root), true);
  assert.equal(report.sdk.root, absoluteSdkRoot);
  assert.equal(report.ready, true);
});

test('android path helpers choose SDK roots from environment and default user profile', () => {
  const envRoot = path.join('E:', 'Sdk');
  const sdkmanager = path.join(envRoot, 'cmdline-tools', 'latest', 'bin', 'sdkmanager.bat');
  assert.equal(findAndroidSdkRoot({ ANDROID_SDK_ROOT: envRoot }, file => file === sdkmanager), envRoot);

  const home = path.join('C:', 'Users', 'Dev');
  const paths = createAndroidPaths(path.join('C:', 'repo'), { USERPROFILE: home });
  assert.equal(paths.sdkRoot, path.join(home, 'AppData', 'Local', 'Android', 'Sdk'));
  assert.equal(paths.receiverRoot, path.join('C:', 'repo', 'android-tv-receiver'));
  assert.equal(paths.apk, path.join('C:', 'repo', 'android-tv-receiver', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk'));
});

test('android check CLI prints a Chinese environment report', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'android-build', 'cli.js');
  const result = childProcess.spawnSync(process.execPath, [cliPath, 'check'], {
    encoding: 'utf8',
    env: createCliTestEnv()
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Android 构建环境检查/);
  assert.match(result.stdout, /缺失项/);
  assert.match(result.stdout, /可运行 npm\.cmd run android:install/);
});

test('android apk CLI prints the expected APK path in Chinese', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'android-build', 'cli.js');
  const result = childProcess.spawnSync(process.execPath, [cliPath, 'apk'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /预期 APK 路径/);
  assert.match(result.stdout, /app-debug\.apk/);
  assert.match(result.stdout, /当前状态/);
});

test('android build CLI reports missing dependencies and does not spawn Gradle', () => {
  const cli = require('../src/android-build/cli');
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const output = [];
  const spawned = [];
  let exitCode;

  console.log = message => output.push(String(message));
  console.error = message => output.push(String(message));
  process.exitCode = undefined;

  try {
    cli.main(['build'], {
      createReport() {
        return createCliReportOverride({
          ready: false,
          missing: ['JDK javac.exe', 'Android SDK platform-tools adb.exe']
        });
      },
      spawnSync(command, args, options) {
        spawned.push({ command, args, options });
        return { status: 0 };
      }
    });
    exitCode = process.exitCode;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }

  assert.equal(spawned.length, 0);
  assert.equal(exitCode, 1);
  assert.match(output.join('\n'), /Android TV APK 构建环境缺少依赖/);
  assert.match(output.join('\n'), /JDK javac\.exe/);
  assert.match(output.join('\n'), /Android SDK platform-tools adb\.exe/);
});

test('android build CLI runs gradlew.bat in receiver directory and prints APK output on success', () => {
  const cli = require('../src/android-build/cli');
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;
  const output = [];
  const calls = [];
  const receiverRoot = path.join('C:', 'repo', 'android-tv-receiver');
  const apkPath = path.join(receiverRoot, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
  let exitCode;

  console.log = message => output.push(String(message));
  console.error = message => output.push(String(message));
  process.exitCode = undefined;

  try {
    cli.main(['build'], {
      createReport() {
        return createCliReportOverride({ ready: true, receiverRoot, apkFound: true });
      },
      spawnSync(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0 };
      }
    });
    exitCode = process.exitCode;
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, path.join(receiverRoot, 'gradlew.bat'));
  assert.deepEqual(calls[0].args, [':app:assembleDebug', '--no-daemon']);
  assert.equal(calls[0].options.cwd, receiverRoot);
  assert.equal(calls[0].options.stdio, 'inherit');
  assert.equal(exitCode, 0);
  assert.match(output.join('\n'), new RegExp(`APK 输出：${apkPath.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')}`));
});

test('android build CLI preserves Gradle exit code when Gradle fails', () => {
  const cli = require('../src/android-build/cli');
  const originalLog = console.log;
  const originalError = console.error;
  const originalExitCode = process.exitCode;

  console.log = () => {};
  console.error = () => {};
  process.exitCode = undefined;

  try {
    cli.main(['build'], {
      createReport() {
        const receiverRoot = path.join('C:', 'repo', 'android-tv-receiver');
        return createCliReportOverride({ ready: true, receiverRoot, apkFound: false });
      },
      spawnSync() {
        return { status: 23 };
      }
    });
    assert.equal(process.exitCode, 23);
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exitCode = originalExitCode;
  }
});

test('android apk CLI reports whether the APK exists from injected report', () => {
  const cli = require('../src/android-build/cli');
  const originalLog = console.log;
  const output = [];
  const apkPath = path.join('C:', 'repo', 'android-tv-receiver', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

  console.log = message => output.push(String(message));

  try {
    cli.main(['apk'], {
      createReport() {
        return { apk: { path: apkPath, found: true } };
      }
    });
  } finally {
    console.log = originalLog;
  }

  assert.match(output.join('\n'), /预期 APK 路径/);
  assert.match(output.join('\n'), /是否存在：是/);
  assert.match(output.join('\n'), new RegExp(apkPath.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')));
});

test('android build installer script documents JDK, SDK download and required packages', () => {
  const script = fs.readFileSync(
    path.join(__dirname, '..', 'scripts', 'install-android-build-tools.ps1'),
    'utf8'
  );

  assert.match(script, /winget\s+install\s+--id\s+EclipseAdoptium\.Temurin\.17\.JDK/);
  assert.match(script, /--silent/);
  assert.match(script, /--accept-package-agreements/);
  assert.match(script, /--accept-source-agreements/);
  assert.match(script, /java\.exe/);
  assert.match(script, /javac\.exe/);
  assert.match(script, /commandlinetools-win-14742923_latest\.zip/);
  assert.match(script, /16b3f45ddb3d85ea6bbe6a1c0b47146daf0db450/);
  assert.match(script, /sdkmanager\.bat/);
  assert.match(script, /"platform-tools"/);
  assert.match(script, /"platforms;android-35"/);
  assert.match(script, /"build-tools;35\.0\.0"/);
  assert.match(script, /function\s+Find-TemurinJdk17/);
  assert.match(script, /function\s+Update-Jdk17Environment/);
  assert.match(script, /\$env:JAVA_HOME/);
  assert.match(script, /\$env:Path\s*=\s*"\$binPath;\$env:Path"/);
  assert.match(script, /function\s+Exit-WithFailure/);
  assert.match(script, /exit\s+\$ExitCode/);
});

test('android gradle wrapper files target Gradle 8.10.2 and include a non-empty jar', () => {
  const propertiesPath = path.join(__dirname, '..', 'android-tv-receiver', 'gradle', 'wrapper', 'gradle-wrapper.properties');
  const jarPath = path.join(__dirname, '..', 'android-tv-receiver', 'gradle', 'wrapper', 'gradle-wrapper.jar');
  const properties = fs.readFileSync(propertiesPath, 'utf8');
  const jar = fs.statSync(jarPath);
  const jarBytes = fs.readFileSync(jarPath);
  const sha256 = crypto.createHash('sha256').update(jarBytes).digest('hex');

  assert.match(properties, /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-8\.10\.2-bin\.zip/);
  assert.equal(sha256, '2db75c40782f5e8ba1fc278a5574bab070adccb2d21ca5a6e5ed840888448046');
  assert.equal(jar.size, 43583);
  assert.equal(jarBytes.includes(Buffer.from('gradle-wrapper.jar', 'utf8')), false);
});

test('android install CLI spawns the PowerShell installer script', () => {
  const cli = require('../src/android-build/cli');
  const originalLog = console.log;
  const originalExitCode = process.exitCode;
  const calls = [];

  console.log = () => {};
  process.exitCode = undefined;

  try {
    cli.main(['install'], {
      spawnSync(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0 };
      }
    });
  } finally {
    console.log = originalLog;
    process.exitCode = originalExitCode;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, 'powershell.exe');
  assert.deepEqual(calls[0].args, [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.resolve(__dirname, '..', 'scripts', 'install-android-build-tools.ps1')
  ]);
  assert.equal(path.isAbsolute(calls[0].args[4]), true);
  assert.equal(calls[0].options.stdio, 'inherit');
});

test('new android build production files do not contain replacement characters or obvious mojibake', () => {
  const files = [
    path.join(__dirname, '..', 'src', 'android-build', 'tooling.js'),
    path.join(__dirname, '..', 'src', 'android-build', 'cli.js'),
    path.join(__dirname, '..', 'scripts', 'install-android-build-tools.ps1'),
    path.join(__dirname, '..', 'android-tv-receiver', 'gradlew.bat'),
    path.join(__dirname, '..', 'android-tv-receiver', 'gradle', 'wrapper', 'gradle-wrapper.properties'),
    path.join(__dirname, '..', 'docs', 'android-build-setup.md'),
    path.join(__dirname, '..', 'docs', 'stage2-local-verify.md')
  ];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\uFFFD/);
    assert.doesNotMatch(text, /[閿涚粙闁艾濮╅弸鍕紦閻滎垰顣╙]{4,}/);
    assert.doesNotMatch(text, /[ÂÃÄÅ]{2,}/);
  }
});

test('android build setup docs describe install, check, build, APK path and TV install in Chinese', () => {
  const setup = fs.readFileSync(path.join(__dirname, '..', 'docs', 'android-build-setup.md'), 'utf8');
  const stage2 = fs.readFileSync(path.join(__dirname, '..', 'docs', 'stage2-local-verify.md'), 'utf8');

  assert.match(setup, /npm\.cmd run android:install/);
  assert.match(setup, /npm\.cmd run android:check/);
  assert.match(setup, /npm\.cmd run android:build/);
  assert.match(setup, /android-tv-receiver\\app\\build\\outputs\\apk\\debug\\app-debug\.apk/);
  assert.match(setup, /Android TV/);
  assert.match(setup, /adb install/);
  assert.match(stage2, /npm\.cmd run android:install/);
  assert.match(stage2, /npm\.cmd run android:build/);
  assert.doesNotMatch(stage2, /gradle` 不是可识别的/);
});
