'use strict';

const childProcess = require('child_process');
const net = require('net');
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
const { createStage2Report } = require('../stage2/tooling');
const { buildRtpConfig, buildRtpLaunchCommands } = require('./rtp-pipeline');

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

function printStage2Report(report) {
  console.log('阶段 2 发送端环境检测');
  console.log('====================');
  console.log(`GStreamer：${report.gstreamer.ready ? '通过' : '未就绪'}`);
  console.log(`gst-launch-1.0：${report.gstreamer.gstLaunch || '未找到'}`);
  console.log(`gst-inspect-1.0：${report.gstreamer.gstInspect || '未找到'}`);
  console.log(`dotnet：${report.dotnet.ready ? report.dotnet.path : '未找到'}`);
  console.log('');
  console.log('插件：');
  for (const [name, found] of Object.entries(report.plugins)) {
    console.log(`  ${found ? '通过' : '缺失'} ${name}`);
  }
  console.log('');
  console.log(report.ready ? '结果：阶段 2 RTP 发送端环境已就绪。' : '结果：阶段 2 RTP 发送端环境未就绪。');
  if (!report.ready) {
    console.log('');
    console.log('缺失项：');
    for (const item of report.missing.executables) console.log(`  - ${item}`);
    for (const item of report.missing.plugins) console.log(`  - ${item}`);
  }
}

function printRtpHelp() {
  console.log('阶段 2 RTP 发送端');
  console.log('================');
  console.log('用法：node src/native-streamer/cli.js rtp --host <Android TV IP> [选项]');
  console.log('');
  console.log('选项：');
  console.log('  --host <IP>           Android TV IP，默认 127.0.0.1');
  console.log('  --video-port <端口>   视频 RTP UDP 端口，默认 5004');
  console.log('  --audio-port <端口>   音频 RTP UDP 端口，默认 5006');
  console.log('  --width <宽度>        视频宽度，默认 1280');
  console.log('  --height <高度>       视频高度，默认 720');
  console.log('  --fps <帧率>          视频帧率，默认 60');
  console.log('  --bitrate <kbps>      H.264 码率，默认 18000');
  console.log('  --gop <帧数>          关键帧间隔，默认 15');
  console.log('  --display <索引>      Windows 显示器索引，默认 0');
}

function parseIntegerOption(value, label, min, max, errors) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) {
    errors.push(`${label}必须是整数。`);
    return null;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    errors.push(`${label}必须在 ${min}-${max} 之间。`);
    return null;
  }

  return parsed;
}

function validateRtpArgs(args) {
  const errors = [];
  const host = args.host === undefined ? '127.0.0.1' : args.host;
  if (typeof host !== 'string' || net.isIP(host) !== 4) {
    errors.push('host 必须是合法的 IPv4 地址。');
  }

  const videoPort = parseIntegerOption(args['video-port'] || '5004', 'video-port ', 1, 65535, errors);
  const audioPort = parseIntegerOption(args['audio-port'] || '5006', 'audio-port ', 1, 65535, errors);
  const bitrateKbps = parseIntegerOption(args.bitrate || '18000', 'bitrate ', 1, Number.MAX_SAFE_INTEGER, errors);
  const width = parseIntegerOption(args.width || '1280', 'width ', 320, 7680, errors);
  const height = parseIntegerOption(args.height || '720', 'height ', 240, 4320, errors);
  const fps = parseIntegerOption(args.fps || '60', 'fps ', 1, 240, errors);
  const keyframeInterval = parseIntegerOption(args.gop || '15', 'gop ', 1, 600, errors);
  const displayIndex = parseIntegerOption(args.display || '0', 'display ', 0, Number.MAX_SAFE_INTEGER, errors);

  return {
    ok: errors.length === 0,
    errors,
    config: {
      host: typeof host === 'string' ? host : '',
      videoPort,
      audioPort,
      bitrateKbps,
      width,
      height,
      fps,
      keyframeInterval,
      displayIndex
    }
  };
}

function printRtpValidationErrors(errors) {
  console.error('RTP 参数无效：');
  for (const error of errors) {
    console.error(`  - ${error}`);
  }
  console.error('');
  printRtpHelp();
}

function stopRtpChildren(children, failedChild) {
  for (const child of children) {
    if (child === failedChild) continue;
    if (!child || child.killed || typeof child.kill !== 'function') continue;
    child.kill();
  }
}

function runRtpSender(args, options = {}) {
  if (args.help) {
    printRtpHelp();
    return;
  }

  const validation = validateRtpArgs(args);
  if (!validation.ok) {
    printRtpValidationErrors(validation.errors);
    process.exitCode = 1;
    return;
  }

  const createReport = options.createReport || createStage2Report;
  const spawn = options.spawn || childProcess.spawn;
  const report = createReport();
  if (!report.ready) {
    printStage2Report(report);
    process.exitCode = 1;
    return;
  }

  const config = buildRtpConfig(validation.config);
  const commands = buildRtpLaunchCommands(config);
  const gstLaunch = report.gstreamer.gstLaunch || 'gst-launch-1.0';
  const children = [];
  for (const command of commands) {
    console.log(`启动：${command.title}`);
    let child;
    try {
      child = spawn(gstLaunch, command.args, {
        stdio: 'inherit',
        windowsHide: false
      });
    } catch (error) {
      console.error(`启动失败：${command.title}：${error.message}`);
      process.exitCode = 1;
      stopRtpChildren(children, null);
      return;
    }

    children.push(child);
    if (options.onChild) options.onChild(child, command);
    child.on('error', error => {
      console.error(`启动失败：${command.title}：${error.message}`);
      process.exitCode = 1;
      stopRtpChildren(children, child);
    });
    child.on('exit', code => {
      if (code) {
        console.error(`发送端退出异常：${command.title}，退出码 ${code}`);
        if (process.exitCode !== 1) process.exitCode = code;
        stopRtpChildren(children, child);
      }
    });
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

  if (command === 'stage2-check') {
    printStage2Report(createStage2Report());
    return;
  }

  if (command === 'rtp') {
    runRtpSender(args);
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
  console.error('可用命令：check, stage2-check, install, pipeline, profiles, urls, run, rtp');
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main, printReport, printStage2Report, printRtpHelp, validateRtpArgs, runRtpSender };
