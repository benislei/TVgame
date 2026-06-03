'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { createAndroidBuildReport } = require('./tooling');

function statusText(found) {
  return found ? '通过' : '缺失';
}

function printCheckReport(report) {
  console.log('Android 构建环境检查');
  console.log('====================');
  console.log(`JDK java.exe：${statusText(report.jdk.java.found)}${report.jdk.java.path ? `（${report.jdk.java.path}）` : ''}`);
  console.log(`JDK javac.exe：${statusText(report.jdk.javac.found)}${report.jdk.javac.path ? `（${report.jdk.javac.path}）` : ''}`);
  console.log(`Android SDK 根目录：${report.sdk.root || '未设置'}`);
  console.log(`sdkmanager.bat：${statusText(report.sdk.sdkmanager.found)}${report.sdk.sdkmanager.path ? `（${report.sdk.sdkmanager.path}）` : ''}`);
  console.log(`adb.exe：${statusText(report.sdk.adb.found)}${report.sdk.adb.path ? `（${report.sdk.adb.path}）` : ''}`);
  console.log(`platforms/android-35/android.jar：${statusText(report.packages.android35.found)}`);
  console.log(`build-tools/35.0.0/aapt2.exe：${statusText(report.packages.buildTools35.found)}`);
  console.log(`Gradle Wrapper：${statusText(report.gradleWrapper.ready)}${report.gradleWrapper.path ? `（${report.gradleWrapper.path}）` : ''}`);
  console.log('');
  console.log(report.ready ? '结果：Android TV APK 构建环境已就绪。' : '结果：Android TV APK 构建环境尚未就绪。');

  if (!report.ready) {
    console.log('');
    console.log('缺失项：');
    for (const item of report.missing) {
      console.log(`  - ${item}`);
    }
    console.log('');
    console.log('可运行 npm.cmd run android:install 安装 JDK 17、Android SDK 构建工具和 Gradle Wrapper 依赖。');
  }
}

function printApk(report) {
  console.log('Android TV Debug APK');
  console.log('====================');
  console.log(`预期 APK 路径：${report.apk.path}`);
  console.log(`是否存在：${report.apk.found ? '是' : '否'}`);
  console.log(`当前状态：${report.apk.found ? '已存在' : '尚未生成'}`);
}

function printHelp() {
  console.log('Android 构建命令');
  console.log('================');
  console.log('用法：node src/android-build/cli.js <命令>');
  console.log('');
  console.log('命令：');
  console.log('  check    检查 Android APK 构建环境');
  console.log('  install  安装 Android APK 构建依赖');
  console.log('  build    构建 Android TV 接收端 Debug APK');
  console.log('  apk      显示 Debug APK 路径');
}

function runInstall(spawnSync = childProcess.spawnSync) {
  const scriptPath = path.resolve(__dirname, '..', '..', 'scripts', 'install-android-build-tools.ps1');
  console.log('正在启动 Android 构建依赖安装脚本...');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    scriptPath
  ], {
    stdio: 'inherit'
  });

  if (result.error) {
    console.error(`安装脚本启动失败：${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  process.exitCode = typeof result.status === 'number' ? result.status : 1;
}

function runBuild(report, spawnSync = childProcess.spawnSync) {
  printCheckReport(report);

  if (!report.ready) {
    console.error('');
    console.error('Android TV APK 构建环境缺少依赖，无法开始构建。');
    console.error('缺失项：');
    for (const item of report.missing) {
      console.error(`  - ${item}`);
    }
    console.error('');
    console.error('请先运行 npm.cmd run android:install，或按上面的缺失项手动安装后重试。');
    process.exitCode = 1;
    return;
  }

  const gradleWrapperJar = path.join(report.paths.receiverRoot, 'gradle', 'wrapper', 'gradle-wrapper.jar');
  console.log('');
  console.log('正在构建 Android TV 接收端 Debug APK...');
  const result = spawnSync(report.jdk.java.path, [
    '-classpath',
    gradleWrapperJar,
    'org.gradle.wrapper.GradleWrapperMain',
    ':app:assembleDebug',
    '--no-daemon'
  ], {
    cwd: report.paths.receiverRoot,
    stdio: 'inherit',
    env: buildGradleEnv(report)
  });

  if (result.error) {
    console.error(`Gradle Wrapper 启动失败：${result.error.message}`);
    process.exitCode = 1;
    return;
  }

  const exitCode = typeof result.status === 'number' ? result.status : 1;
  process.exitCode = exitCode;

  if (exitCode === 0) {
    console.log(`APK 输出：${report.apk.path}`);
  }
}

function buildGradleEnv(report, baseEnv = process.env) {
  if (!report.jdk || !report.jdk.home) {
    return baseEnv;
  }

  const javaBin = path.join(report.jdk.home, 'bin');
  const sdkRoot = report.sdk && report.sdk.root ? report.sdk.root : baseEnv.ANDROID_SDK_ROOT || baseEnv.ANDROID_HOME;
  const env = {
    ...baseEnv,
    JAVA_HOME: report.jdk.home,
    PATH: `${javaBin}${path.delimiter}${baseEnv.PATH || baseEnv.Path || ''}`
  };

  if (sdkRoot) {
    env.ANDROID_HOME = sdkRoot;
    env.ANDROID_SDK_ROOT = sdkRoot;
  }

  return env;
}

function main(argv = process.argv.slice(2), options = {}) {
  const command = argv[0] || 'check';
  const createReport = options.createReport || createAndroidBuildReport;

  if (command === 'check') {
    printCheckReport(createReport());
    return;
  }

  if (command === 'apk') {
    printApk(createReport());
    return;
  }

  if (command === 'install') {
    runInstall(options.spawnSync);
    return;
  }

  if (command === 'build') {
    runBuild(createReport(), options.spawnSync);
    return;
  }

  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  console.error(`未知命令：${command}`);
  console.error('可用命令：check, install, build, apk');
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { main, printCheckReport, printApk, runInstall, runBuild, buildGradleEnv };
