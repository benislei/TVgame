# Android 构建自动化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Windows-friendly automation path that checks, installs, and runs the Android TV receiver APK build.

**Architecture:** Add a focused Node Android build CLI for detection/build orchestration, a PowerShell installer for JDK/Android SDK/Gradle Wrapper preparation, and QuickVerify entries for users who prefer the executable menu. Keep generated/downloaded SDK files outside the repo; keep only wrapper files and scripts in source control.

**Tech Stack:** Node.js, PowerShell, Gradle Wrapper, Android Gradle Plugin 8.7.3, Android SDK 35, JDK 17, .NET QuickVerify.

---

## File Structure

- `src/android-build/tooling.js`: Pure detection helpers for JDK, Android SDK, sdkmanager, adb, SDK packages, Gradle Wrapper, and APK paths.
- `src/android-build/cli.js`: Chinese CLI commands `check`, `install`, `build`, and `apk`.
- `scripts/install-android-build-tools.ps1`: Windows installer for JDK 17, Android command-line tools, SDK packages, and Gradle Wrapper.
- `android-tv-receiver/gradlew.bat`: Windows Gradle Wrapper launcher.
- `android-tv-receiver/gradle/wrapper/gradle-wrapper.jar`: Gradle Wrapper bootstrap jar.
- `android-tv-receiver/gradle/wrapper/gradle-wrapper.properties`: Wrapper distribution config for Gradle 8.10.2.
- `QuickVerify/Program.cs`: Chinese menu entries for Android build automation.
- `docs/android-build-setup.md`: Chinese setup and APK build guide.
- `test/android-build-tooling.test.js`: Detection and CLI tests.
- `test/quickverify.test.js`: QuickVerify menu coverage.

---

### Task 1: Android Build Detection CLI

**Files:**
- Create: `src/android-build/tooling.js`
- Create: `src/android-build/cli.js`
- Modify: `package.json`
- Create: `test/android-build-tooling.test.js`

- [ ] **Step 1: Add failing detection tests**

Create `test/android-build-tooling.test.js` with tests that assert:

```js
const test = require('node:test');
const assert = require('node:assert');
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
});
```

- [ ] **Step 2: Implement tooling**

Implement exported helpers:

```js
function createAndroidPaths(projectRoot, env) {
  const home = env.USERPROFILE || env.HOME || '';
  const sdkRoot = findAndroidSdkRoot(env, file => false)
    || env.ANDROID_SDK_ROOT
    || env.ANDROID_HOME
    || (home ? path.join(home, 'AppData', 'Local', 'Android', 'Sdk') : '');
  return {
    projectRoot,
    receiverRoot: path.join(projectRoot, 'android-tv-receiver'),
    sdkRoot,
    apk: path.join(projectRoot, 'android-tv-receiver', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk')
  };
}
```

`createAndroidBuildReport(options)` must return `{ ready, jdk, sdk, packages, gradleWrapper, apk, missing }`, where `ready` means JDK, sdkmanager, adb, android-35, build-tools 35.0.0, and Gradle Wrapper are present.

- [ ] **Step 3: Add CLI and package scripts**

`src/android-build/cli.js` must support:

```powershell
npm.cmd run android:check
npm.cmd run android:install
npm.cmd run android:build
npm.cmd run android:apk
```

Add scripts:

```json
"android:check": "node src/android-build/cli.js check",
"android:install": "node src/android-build/cli.js install",
"android:build": "node src/android-build/cli.js build",
"android:apk": "node src/android-build/cli.js apk"
```

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm.cmd test
npm.cmd run android:check
git add src/android-build package.json test/android-build-tooling.test.js
git commit -m "Add Android build environment checks"
```

---

### Task 2: Android Build Installer and Gradle Wrapper

**Files:**
- Create: `scripts/install-android-build-tools.ps1`
- Create: `android-tv-receiver/gradlew.bat`
- Create: `android-tv-receiver/gradle/wrapper/gradle-wrapper.properties`
- Create: `android-tv-receiver/gradle/wrapper/gradle-wrapper.jar`
- Modify: `src/android-build/cli.js`
- Modify: `test/android-build-tooling.test.js`

- [ ] **Step 1: Add installer tests**

Add tests that verify the installer script contains:

```powershell
winget install --id EclipseAdoptium.Temurin.17.JDK
commandlinetools-win-14742923_latest.zip
sdkmanager.bat
"platform-tools"
"platforms;android-35"
"build-tools;35.0.0"
```

The test must also assert `gradle-wrapper.properties` contains:

```properties
distributionUrl=https\://services.gradle.org/distributions/gradle-8.10.2-bin.zip
```

- [ ] **Step 2: Implement installer**

Create `scripts/install-android-build-tools.ps1` that:

1. Checks `java.exe` and `javac.exe`.
2. Uses `winget install --id EclipseAdoptium.Temurin.17.JDK --silent --accept-package-agreements --accept-source-agreements` when JDK is missing.
3. Uses `$env:LOCALAPPDATA\Android\Sdk` as default SDK root.
4. Downloads `https://dl.google.com/android/repository/commandlinetools-win-14742923_latest.zip`.
5. Extracts command-line tools to `cmdline-tools\latest`.
6. Runs `sdkmanager.bat --licenses`.
7. Installs `platform-tools`, `platforms;android-35`, and `build-tools;35.0.0`.
8. Leaves clear Chinese console output.

- [ ] **Step 3: Add Gradle Wrapper**

Add wrapper files for Gradle 8.10.2. If generating locally is possible, use:

```powershell
gradle wrapper --gradle-version 8.10.2 --distribution-type bin
```

If global Gradle is unavailable, download `gradle-wrapper.jar` from the Gradle 8.10.2 distribution or use a verified wrapper jar generated by Gradle. Do not commit downloaded Android SDK files.

- [ ] **Step 4: Wire install CLI**

`npm.cmd run android:install` must spawn:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/install-android-build-tools.ps1
```

- [ ] **Step 5: Verify and commit**

Run:

```powershell
npm.cmd test
npm.cmd run android:check
git add scripts/install-android-build-tools.ps1 android-tv-receiver/gradlew.bat android-tv-receiver/gradle src/android-build test/android-build-tooling.test.js
git commit -m "Add Android build dependency installer"
```

---

### Task 3: APK Build Command and QuickVerify Integration

**Files:**
- Modify: `src/android-build/cli.js`
- Modify: `QuickVerify/Program.cs`
- Create: `docs/android-build-setup.md`
- Modify: `docs/stage2-local-verify.md`
- Modify: `test/android-build-tooling.test.js`
- Modify: `test/quickverify.test.js`

- [ ] **Step 1: Add build CLI behavior**

`npm.cmd run android:build` must:

1. Run `createAndroidBuildReport()`.
2. If dependencies are missing, print Chinese missing list and exit 1.
3. Run `android-tv-receiver\gradlew.bat :app:assembleDebug --no-daemon`.
4. Print `APK 输出：<path>\app-debug.apk` on success.

`npm.cmd run android:apk` must print the expected APK path and whether it exists.

- [ ] **Step 2: Add QuickVerify menu**

Add Chinese menu entries:

```text
14. 检查 Android TV APK 构建环境
15. 安装 Android TV APK 构建依赖
16. 构建 Android TV 接收端 APK
```

They must run:

```powershell
npm.cmd run android:check
npm.cmd run android:install
npm.cmd run android:build
```

- [ ] **Step 3: Add documentation**

Create `docs/android-build-setup.md` with:

- 一键命令：`npm.cmd run android:install`
- 检查命令：`npm.cmd run android:check`
- 构建命令：`npm.cmd run android:build`
- APK 路径：`android-tv-receiver\app\build\outputs\apk\debug\app-debug.apk`
- 电视安装提示：可用 Android TV 的文件管理器安装，或后续通过 `adb install` 自动安装。

Update `docs/stage2-local-verify.md` so Android 构建工具缺失记录变成新的安装/构建步骤。

- [ ] **Step 4: Verify and commit**

Run:

```powershell
npm.cmd test
npm.cmd run android:check
npm.cmd run android:apk
dotnet build QuickVerify\QuickVerify.csproj
git add src/android-build QuickVerify docs test package.json android-tv-receiver
git commit -m "Add Android APK build workflow"
```

---

## Plan Self-Review

- Spec coverage: Tasks cover check, install, build, QuickVerify, docs, tests, and Gradle Wrapper.
- Placeholder scan: No task uses unspecified TODOs; exact commands and files are provided.
- Type consistency: Script names use `android:*`; SDK paths and package names match the Android TV receiver project.
