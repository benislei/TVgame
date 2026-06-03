'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const {
  createAndroidBuildReport,
  createAndroidPaths,
  findAndroidSdkRoot
} = require('../src/android-build/tooling');

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

test('android path helpers choose SDK roots from environment and default user profile', () => {
  const envRoot = path.join('E:', 'Sdk');
  assert.equal(findAndroidSdkRoot({ ANDROID_SDK_ROOT: envRoot }, file => file === envRoot), envRoot);

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
    env: { ...process.env, ANDROID_SDK_ROOT: path.join('Z:', 'MissingSdk') }
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Android 构建环境检查/);
  assert.match(result.stdout, /缺失项/);
  assert.match(result.stdout, /npm\.cmd run android:install/);
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

test('new android build production files do not contain replacement characters or obvious mojibake', () => {
  const files = [
    path.join(__dirname, '..', 'src', 'android-build', 'tooling.js'),
    path.join(__dirname, '..', 'src', 'android-build', 'cli.js')
  ];

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(text, /\uFFFD/);
    assert.doesNotMatch(text, /[锛绋閫氬姩鏋勫缓鐜]{4,}/);
  }
});
