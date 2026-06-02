'use strict';

const childProcess = require('child_process');
const path = require('path');
const {
  createEnvironmentReport,
  buildGStreamerDownloadUrls
} = require('./environment');
const {
  PROFILES,
  buildPipelineConfig,
  buildPipelineDescription,
  listProfiles
} = require('./pipeline');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const item = argv[i];
    if (!item.startsWith('--')) {
      args._.push(item);
      continue;
    }

    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

function printReport(report) {
  console.log('原生串流环境检测');
  console.log('================');
  console.log(`GStreamer 根目录：${report.gstreamerRoot || '未设置'}`);
  console.log(`gst-launch-1.0：${report.executables.gstLaunch.found ? report.executables.gstLaunch.path : '未找到'}`);
  console.log(`gst-inspect-1.0：${report.executables.gstInspect.found ? report.executables.gstInspect.path : '未找到'}`);
  console.log(`Python：${report.executables.python.found ? report.executables.python.path : '未找到'}`);
  console.log('');
  console.log('插件：');
  for (const [name, found] of Object.entries(report.plugins)) {
    console.log(`  ${found ? '通过' : '缺失'} ${name}`);
  }
  console.log('');
  console.log('Python 依赖：');
  console.log(`  ${report.python.websockets ? '通过' : '缺失'} websockets`);
  console.log(`  ${report.python.gstreamerBindings ? '通过' : '缺失'} GStreamer 绑定`);
  console.log('');
  console.log(report.ready ? '结果：可以启动原生 NVENC 串流。' : '结果：环境还未就绪。');
  if (!report.ready) {
    console.log('');
    console.log('缺失项：');
    for (const item of report.missing.executables) console.log(`  - ${item}`);
    for (const item of report.missing.plugins) console.log(`  - ${item}`);
    for (const item of report.missing.pythonModules) console.log(`  - ${item}`);
    console.log('');
    console.log('可运行：npm run native:install');
  }
}

function runInstallScript() {
  const script = path.join(__dirname, '..', '..', 'scripts', 'install-gstreamer.ps1');
  const result = childProcess.spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    script,
    '-InstallDevel'
  ], {
    stdio: 'inherit',
    windowsHide: false
  });
  process.exitCode = result.status || 0;
}

function printPipeline(args) {
  const profileId = args.profile || '1080p60';
  const profile = PROFILES[profileId];
  if (!profile) {
    console.error(`未知档位：${profileId}`);
    console.error(`可用档位：${Object.keys(PROFILES).join(', ')}`);
    process.exitCode = 1;
    return;
  }

  const config = buildPipelineConfig(profile, {
    room: args.room || 'game',
    signal: args.signal || 'ws://127.0.0.1:8080',
    displayIndex: Number(args.display || 0),
    bitrateKbps: args.bitrate ? Number(args.bitrate) : undefined
  });

  console.log('原生发送端管线配置');
  console.log('==================');
  console.log(JSON.stringify(config, null, 2));
  console.log('');
  console.log(buildPipelineDescription(config));
}

function printProfiles() {
  console.log('可用画质档位');
  console.log('============');
  for (const profile of listProfiles()) {
    console.log(`${profile.id}: ${profile.name} ${profile.width}x${profile.height}@${profile.fps} ${profile.bitrateKbps}kbps`);
  }
}

function printInstallUrls() {
  console.log(JSON.stringify(buildGStreamerDownloadUrls(), null, 2));
}

function runNativeSender(args) {
  const report = createEnvironmentReport();
  if (!report.ready) {
    printReport(report);
    console.log('');
    console.log('原生发送端无法启动：GStreamer 环境还未就绪。');
    process.exitCode = 1;
    return;
  }

  const profile = args.profile || '1080p60';
  const script = path.join(__dirname, '..', '..', 'native-streamer', 'gst_webrtc_sender.py');
  const python = report.executables.python.path;
  const pythonExecutable = path.basename(python).toLowerCase();
  const childArgs = [
    ...(pythonExecutable === 'py.exe' || pythonExecutable === 'py' ? ['-3'] : []),
    script,
    '--signal', args.signal || 'ws://127.0.0.1:8080',
    '--room', args.room || 'game',
    '--profile', profile,
    '--display', String(args.display || 0)
  ];
  const result = childProcess.spawnSync(python, childArgs, {
    stdio: 'inherit',
    windowsHide: false
  });
  process.exitCode = result.status || 0;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] || 'check';

  if (command === 'check') {
    printReport(createEnvironmentReport());
    return;
  }

  if (command === 'install') {
    runInstallScript();
    return;
  }

  if (command === 'pipeline') {
    printPipeline(args);
    return;
  }

  if (command === 'profiles') {
    printProfiles();
    return;
  }

  if (command === 'urls') {
    printInstallUrls();
    return;
  }

  if (command === 'run') {
    runNativeSender(args);
    return;
  }

  console.error(`未知命令：${command}`);
  console.error('可用命令：check, install, pipeline, profiles, urls, run');
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main };
