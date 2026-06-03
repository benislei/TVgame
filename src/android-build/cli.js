'use strict';

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
    console.log('可运行：npm.cmd run android:install');
  }
}

function printApk(report) {
  console.log('Android TV Debug APK');
  console.log('====================');
  console.log(`预期 APK 路径：${report.apk.path}`);
  console.log(`当前状态：${report.apk.found ? '已存在' : '尚未生成'}`);
}

function printHelp() {
  console.log('Android 构建命令');
  console.log('================');
  console.log('用法：node src/android-build/cli.js <命令>');
  console.log('');
  console.log('命令：');
  console.log('  check    检查 Android APK 构建环境');
  console.log('  install  预留安装入口');
  console.log('  build    预留构建入口');
  console.log('  apk      显示 Debug APK 路径');
}

function main(argv = process.argv.slice(2)) {
  const command = argv[0] || 'check';

  if (command === 'check') {
    printCheckReport(createAndroidBuildReport());
    return;
  }

  if (command === 'apk') {
    printApk(createAndroidBuildReport());
    return;
  }

  if (command === 'install') {
    console.log('Android 构建依赖安装命令已预留，后续任务会接入安装脚本。');
    console.log('当前可先运行：npm.cmd run android:check');
    return;
  }

  if (command === 'build') {
    console.log('Android APK 构建命令已预留，后续任务会接入 Gradle Wrapper。');
    console.log('当前可先运行：npm.cmd run android:check');
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

module.exports = { main, printCheckReport, printApk };
