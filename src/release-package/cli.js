'use strict';

const { createFriendPreviewPackage } = require('./tooling');

function printHelp() {
  console.log('朋友试用包命令');
  console.log('================');
  console.log('用法：node src/release-package/cli.js friend');
  console.log('');
  console.log('命令：');
  console.log('  friend   生成朋友试用文件夹和 zip 包');
}

function printReport(report) {
  console.log('朋友试用包已生成');
  console.log('================');
  console.log(`文件夹：${report.packageDir}`);
  console.log(`压缩包：${report.zipPath}`);
  console.log(`APK：${report.apkTarget}`);
  console.log('');
  console.log('朋友优先阅读包内 README-朋友试用.md，然后安装 TVGameReceiver.apk 并运行对应 .bat 脚本。');
}

function main(argv = process.argv.slice(2), options = {}) {
  const command = argv[0] || 'friend';
  if (command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command !== 'friend') {
    console.error(`未知命令：${command}`);
    console.error('可用命令：friend');
    process.exitCode = 1;
    return;
  }

  try {
    const report = createFriendPreviewPackage(options);
    printReport(report);
  } catch (error) {
    console.error(`朋友试用包生成失败：${error.message}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { main, printHelp, printReport };
