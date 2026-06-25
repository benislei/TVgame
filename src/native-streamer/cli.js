'use strict';

const childProcess = require('child_process');
const fs = require('fs');
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
const {
  createStage2RepairPlan,
  formatStage2RepairPlan,
  hasInputBridgeRuntime,
  runStage2RepairActions
} = require('../stage2/repair');
const {
  RTP_PROFILES,
  H264_ENCODER_AUTO_ORDER,
  H265_ENCODER_AUTO_ORDER,
  NVENC_ENCODER_PRESETS,
  NVENC_AUTO_PRESET_ORDER,
  buildRtpConfig,
  buildH264EncoderProbeArgs,
  buildH265EncoderProbeArgs,
  buildNvencPresetProbeArgs,
  buildRtpLaunchCommands
} = require('./rtp-pipeline');

const H264_ENCODER_ALIASES = {
  auto: 'auto',
  nvenc: 'nvh264enc',
  nvidia: 'nvh264enc',
  nvh264enc: 'nvh264enc',
  amf: 'amfh264enc',
  amd: 'amfh264enc',
  amfh264enc: 'amfh264enc',
  mf: 'mfh264enc',
  mediafoundation: 'mfh264enc',
  mfh264enc: 'mfh264enc'
};

const PROCESS_PRIORITY_CLASSES = {
  normal: null,
  'above-normal': 'AboveNormal',
  high: 'High'
};

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
  console.log('编码能力：');
  console.log(`  H.264：${report.codecs.h264.ready ? `通过（${report.codecs.h264.encoder}）` : `缺失 ${report.codecs.h264.missing.join(', ')}`}`);
  console.log(`  HEVC/4K60 预备：${report.codecs.hevc.ready ? `通过（${report.codecs.hevc.encoder}）` : `缺失 ${report.codecs.hevc.missing.join(', ')}`}`);
  console.log('');
  console.log(report.ready ? '结果：阶段 2 RTP 发送端环境已就绪。' : '结果：阶段 2 RTP 发送端环境未就绪。');
  if (!report.ready) {
    console.log('');
    console.log('缺失项：');
    for (const item of report.missing.executables) console.log(`  - ${item}`);
    for (const item of report.missing.plugins) console.log(`  - ${item}`);
  }
}

function createStage2DoctorTestReport(name) {
  if (name !== 'missing-gstreamer') return null;
  return {
    ready: false,
    gstreamer: {
      ready: false,
      gstLaunch: null,
      gstInspect: null
    },
    dotnet: {
      ready: false,
      path: null
    },
    plugins: {
      d3d11screencapturesrc: true,
      d3d11download: false,
      wasapi2src: false,
      nvh264enc: false,
      amfh264enc: false,
      mfh264enc: false
    },
    optionalPlugins: {
      nvh265enc: false,
      amfh265enc: false,
      mfh265enc: false,
      h265parse: false,
      rtph265pay: false
    },
    codecs: {
      h264: {
        ready: false,
        encoder: null,
        availableEncoders: [],
        missing: ['nvh264enc|amfh264enc|mfh264enc']
      },
      hevc: {
        ready: false,
        encoder: null,
        availableEncoders: [],
        missing: ['nvh265enc|amfh265enc|mfh265enc', 'h265parse', 'rtph265pay']
      }
    },
    missing: {
      executables: ['gst-launch-1.0', 'gst-inspect-1.0', 'dotnet'],
      plugins: ['d3d11download', 'wasapi2src', 'H.264 hardware encoder (nvh264enc/amfh264enc/mfh264enc)'],
      pythonModules: []
    }
  };
}

function printReadableStage2Report(report) {
  console.log('阶段 2 发送端环境检测');
  console.log('====================');
  console.log(`GStreamer：${report.gstreamer.ready ? '通过' : '未就绪'}`);
  console.log(`gst-launch-1.0：${report.gstreamer.gstLaunch || '未找到'}`);
  console.log(`gst-inspect-1.0：${report.gstreamer.gstInspect || '未找到'}`);
  console.log(`dotnet：${report.dotnet.ready ? report.dotnet.path : '未找到'}`);
  console.log('');
  console.log(`H.264：${report.codecs.h264.ready ? `通过（${report.codecs.h264.encoder}）` : `缺失 ${report.codecs.h264.missing.join(', ')}`}`);
  console.log(`HEVC：${report.codecs.hevc.ready ? `通过（${report.codecs.hevc.encoder}）` : `缺失 ${report.codecs.hevc.missing.join(', ')}`}`);
}

function readYesNoFromStdin() {
  const buffer = Buffer.alloc(1024);
  try {
    const bytes = fs.readSync(0, buffer, 0, buffer.length);
    return buffer.toString('utf8', 0, bytes).trim();
  } catch {
    return '';
  }
}

function runStage2Doctor(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const createReport = options.createReport || (() => (
    createStage2DoctorTestReport(process.env.TVGAME_STAGE2_TEST_REPORT) || createStage2Report()
  ));
  const report = createReport();
  const plan = createStage2RepairPlan(report, {
    hasInputBridgeRuntime: hasInputBridgeRuntime(projectRoot)
  });

  printReadableStage2Report(report);
  console.log(formatStage2RepairPlan(plan));

  if (plan.automaticActions.length === 0) return;

  console.log('');
  process.stdout.write('是否现在执行一键处理？输入 Y 后开始，其它输入取消：');
  const answer = options.answer === undefined ? readYesNoFromStdin() : options.answer;
  if (!/^y(es)?$/i.test(answer)) {
    console.log('已取消自动处理。');
    return;
  }

  try {
    runStage2RepairActions(plan, {
      projectRoot,
      spawnSync: options.spawnSync
    });
    console.log('');
    console.log('自动处理已执行完成。请关闭当前窗口，重新打开后再次运行 检查环境.bat。');
  } catch (error) {
    console.error(`自动处理失败：${error.message}`);
    process.exitCode = 1;
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
  console.log('  --profile <档位>      默认 resilient1080，可选 h264720p30, h264720p60, h2641080p30, h2641080p60, hevc1080p30, hevc1080p60, game720, game1080, quality1080, resilient1080, tvbox1080, game4k');
  console.log('  --width <宽度>        视频宽度，默认 1920');
  console.log('  --height <高度>       视频高度，默认 1080');
  console.log('  --fps <帧率>          视频帧率，默认 60');
  console.log('  --bitrate <kbps>      H.264/HEVC 码率，默认 22000');
  console.log('  --gop <帧数>          关键帧间隔，默认 5');
  console.log('  --encoder <编码器>    硬件编码器偏好，默认 auto；可选 nvenc, amf, mf');
  console.log('  --encoder-preset <值> NVENC preset，默认 auto；按体验优先自动探测，可手动指定 low-latency-hq 或 default');
  console.log('  --process-priority <值> 发送进程优先级，默认 normal；可选 normal, above-normal, high');
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

function normalizeH264Encoder(value) {
  if (typeof value !== 'string') return null;
  return H264_ENCODER_ALIASES[value.toLowerCase()] || null;
}

function normalizeHevcEncoderPreference(encoder) {
  if (encoder === 'auto') return 'auto';
  if (encoder === 'nvh264enc') return 'nvh265enc';
  if (encoder === 'amfh264enc') return 'amfh265enc';
  if (encoder === 'mfh264enc') return 'mfh265enc';
  return encoder;
}

function validateRtpArgs(args) {
  const errors = [];
  const host = args.host === undefined ? '127.0.0.1' : args.host;
  if (typeof host !== 'string' || net.isIP(host) !== 4) {
    errors.push('host 必须是合法的 IPv4 地址。');
  }

  const profile = args.profile === undefined ? 'resilient1080' : args.profile;
  const profileConfig = RTP_PROFILES[profile];
  if (typeof profile !== 'string' || !profileConfig) {
    errors.push(`profile 必须是以下之一：${Object.keys(RTP_PROFILES).join(', ')}`);
  }
  const fallbackProfile = profileConfig || RTP_PROFILES.resilient1080;
  if (profile === 'game4k') {
    errors.push(`${profile} 需要 HEVC 接收端支持，当前先用于 4K60 路线能力检测。`);
  }

  const videoPort = parseIntegerOption(args['video-port'] || '5004', 'video-port ', 1, 65535, errors);
  const audioPort = parseIntegerOption(args['audio-port'] || '5006', 'audio-port ', 1, 65535, errors);
  const bitrateKbps = parseIntegerOption(args.bitrate || String(fallbackProfile.bitrateKbps), 'bitrate ', 1, Number.MAX_SAFE_INTEGER, errors);
  const width = parseIntegerOption(args.width || String(fallbackProfile.width), 'width ', 320, 7680, errors);
  const height = parseIntegerOption(args.height || String(fallbackProfile.height), 'height ', 240, 4320, errors);
  const fps = parseIntegerOption(args.fps || String(fallbackProfile.fps), 'fps ', 1, 240, errors);
  const keyframeInterval = parseIntegerOption(args.gop || String(fallbackProfile.keyframeInterval), 'gop ', 1, 600, errors);
  const displayIndex = parseIntegerOption(args.display || '0', 'display ', 0, Number.MAX_SAFE_INTEGER, errors);
  const encoderPreset = args['encoder-preset'] === undefined ? 'auto' : args['encoder-preset'];
  const validEncoderPresets = ['auto'].concat(NVENC_ENCODER_PRESETS);
  if (typeof encoderPreset !== 'string' || !validEncoderPresets.includes(encoderPreset)) {
    errors.push(`encoder-preset 必须是以下之一：${validEncoderPresets.join(', ')}`);
  }
  const encoder = args.encoder === undefined ? 'auto' : normalizeH264Encoder(args.encoder);
  if (!encoder) {
    errors.push('encoder 必须是以下之一：auto, nvenc, amf, mf, nvh264enc, amfh264enc, mfh264enc');
  }
  const processPriority = args['process-priority'] === undefined ? 'normal' : args['process-priority'];
  if (typeof processPriority !== 'string' || !Object.prototype.hasOwnProperty.call(PROCESS_PRIORITY_CLASSES, processPriority)) {
    errors.push('process-priority 必须是以下之一：normal, above-normal, high');
  }

  return {
    ok: errors.length === 0,
    errors,
    config: {
      profile,
      host: typeof host === 'string' ? host : '',
      videoPort,
      audioPort,
      codec: fallbackProfile.codec,
      bitrateKbps,
      width,
      height,
      fps,
      keyframeInterval,
      encoder,
      encoderPreset,
      processPriority,
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

function setChildProcessPriority(child, priority, spawnSync, platform) {
  const priorityClass = PROCESS_PRIORITY_CLASSES[priority];
  if (!priorityClass || platform !== 'win32' || !child || !child.pid) return true;

  const command = [
    '$ErrorActionPreference = "Stop";',
    `$process = Get-Process -Id ${child.pid};`,
    `$process.PriorityClass = '${priorityClass}';`
  ].join(' ');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    command
  ], {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  });

  if (result && result.status === 0) {
    console.log(`发送进程优先级：${priorityClass}（PID ${child.pid}）`);
    return true;
  }

  console.error(`设置发送进程优先级失败：PID ${child.pid}，优先级 ${priorityClass}`);
  return false;
}

function selectAutoEncoderPreset(config, gstLaunch, spawnSync) {
  console.log(`自动探测 NVENC preset，体验优先顺序：${NVENC_AUTO_PRESET_ORDER.join(' -> ')}`);

  for (const preset of NVENC_AUTO_PRESET_ORDER) {
    const args = buildNvencPresetProbeArgs(config, preset);
    const result = spawnSync(gstLaunch, args, {
      encoding: 'utf8',
      stdio: 'pipe',
      windowsHide: true
    });

    if (result && result.status === 0) {
      console.log(`NVENC preset 自动选择：${preset}`);
      return preset;
    }

    console.log(`NVENC preset 不可用，继续回退：${preset}`);
  }

  console.error('自动探测 NVENC preset 失败：当前显卡、驱动或 GStreamer 无法启动 H.264 NVENC 编码。');
  console.error('可先更新 NVIDIA 驱动，或运行“检查环境.bat”确认 GStreamer nvcodec 插件状态。');
  return null;
}

function probeH264Encoder(config, encoder, gstLaunch, spawnSync) {
  const args = buildH264EncoderProbeArgs(config, encoder);
  const result = spawnSync(gstLaunch, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  });
  return Boolean(result && result.status === 0);
}

function probeH265Encoder(config, encoder, gstLaunch, spawnSync) {
  const args = buildH265EncoderProbeArgs(config, encoder);
  const result = spawnSync(gstLaunch, args, {
    encoding: 'utf8',
    stdio: 'pipe',
    windowsHide: true
  });
  return Boolean(result && result.status === 0);
}

function selectH264Encoder(config, report, gstLaunch, spawnSync) {
  const availableEncoders = new Set(
    report.codecs && report.codecs.h264 && Array.isArray(report.codecs.h264.availableEncoders)
      ? report.codecs.h264.availableEncoders
      : H264_ENCODER_AUTO_ORDER.filter(name => report.plugins && report.plugins[name])
  );
  const requested = config.encoder || 'auto';
  const candidates = requested === 'auto'
    ? H264_ENCODER_AUTO_ORDER.filter(name => availableEncoders.has(name))
    : [requested];

  if (candidates.length === 0) {
    console.error('未检测到可用的 H.264 硬件编码器：需要 nvh264enc、amfh264enc 或 mfh264enc 之一。');
    return false;
  }

  for (const encoder of candidates) {
    if (!availableEncoders.has(encoder)) {
      console.error(`指定的编码器不可用：${encoder}`);
      continue;
    }

    if (encoder === 'nvh264enc') {
      config.encoder = encoder;
      if (config.encoderPreset === 'auto') {
        const selectedPreset = selectAutoEncoderPreset(config, gstLaunch, spawnSync);
        if (!selectedPreset) continue;
        config.encoderPreset = selectedPreset;
      }
      console.log(`H.264 编码器自动选择：${encoder}`);
      return true;
    }

    console.log(`正在探测 H.264 编码器：${encoder}`);
    if (probeH264Encoder(config, encoder, gstLaunch, spawnSync)) {
      config.encoder = encoder;
      console.log(`H.264 编码器自动选择：${encoder}`);
      return true;
    }
    console.log(`H.264 编码器不可用，继续回退：${encoder}`);
  }

  console.error('自动探测 H.264 编码器失败：当前显卡、驱动或 GStreamer 无法启动硬件 H.264 编码。');
  return false;
}

function selectHevcEncoder(config, report, gstLaunch, spawnSync) {
  if (!report.codecs || !report.codecs.hevc || !report.codecs.hevc.ready) {
    const missing = report.codecs && report.codecs.hevc && report.codecs.hevc.missing
      ? report.codecs.hevc.missing.join(', ')
      : 'nvh265enc|amfh265enc|mfh265enc, h265parse, rtph265pay';
    console.error(`HEVC 实验档不可用：缺少 ${missing}`);
    return false;
  }

  const availableEncoders = new Set(
    report.codecs && report.codecs.hevc && Array.isArray(report.codecs.hevc.availableEncoders)
      ? report.codecs.hevc.availableEncoders
      : H265_ENCODER_AUTO_ORDER.filter(name => (
        report.optionalPlugins && report.optionalPlugins[name]
      ) || (
        report.plugins && report.plugins[name]
      ))
  );
  const requested = normalizeHevcEncoderPreference(config.encoder || 'auto');
  const candidates = requested === 'auto'
    ? H265_ENCODER_AUTO_ORDER.filter(name => availableEncoders.has(name))
    : [requested];

  if (candidates.length === 0) {
    console.error('未检测到可用的 HEVC 硬件编码器：需要 nvh265enc、amfh265enc 或 mfh265enc 之一。');
    return false;
  }

  for (const encoder of candidates) {
    if (!availableEncoders.has(encoder)) {
      console.error(`指定的 HEVC 编码器不可用：${encoder}`);
      continue;
    }

    if (encoder === 'nvh265enc') {
      config.encoder = encoder;
      if (config.encoderPreset === 'auto') {
        const selectedPreset = selectAutoEncoderPreset(config, gstLaunch, spawnSync);
        if (!selectedPreset) continue;
        config.encoderPreset = selectedPreset;
      }
      console.log(`HEVC 编码器自动选择：${encoder}`);
      return true;
    }

    console.log(`正在探测 HEVC 编码器：${encoder}`);
    if (probeH265Encoder(config, encoder, gstLaunch, spawnSync)) {
      config.encoder = encoder;
      console.log(`HEVC 编码器自动选择：${encoder}`);
      return true;
    }
    console.log(`HEVC 编码器不可用，继续回退：${encoder}`);
  }

  console.error('自动探测 HEVC 编码器失败：当前显卡、驱动或 GStreamer 无法启动硬件 HEVC 编码。');
  return false;
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
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const platform = options.platform || process.platform;
  const report = createReport();
  if (!report.ready) {
    printStage2Report(report);
    process.exitCode = 1;
    return;
  }

  const config = buildRtpConfig(validation.config);
  config.processPriority = validation.config.processPriority;
  const gstLaunch = report.gstreamer.gstLaunch || 'gst-launch-1.0';
  const encoderReady = config.codec === 'h265'
    ? selectHevcEncoder(config, report, gstLaunch, spawnSync)
    : selectH264Encoder(config, report, gstLaunch, spawnSync);
  if (!encoderReady) {
    process.exitCode = 1;
    return;
  }

  const commands = buildRtpLaunchCommands(config);
  const children = [];
  for (const command of commands) {
    console.log(`启动：${command.title}`);
    let child;
    try {
      child = spawn(gstLaunch, command.args, {
        stdio: 'inherit',
        windowsHide: true
      });
    } catch (error) {
      console.error(`启动失败：${command.title}：${error.message}`);
      process.exitCode = 1;
      stopRtpChildren(children, null);
      return;
    }

    children.push(child);
    setChildProcessPriority(child, config.processPriority, spawnSync, platform);
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

  if (command === 'stage2-doctor') {
    runStage2Doctor();
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
  console.error('可用命令：check, stage2-check, stage2-doctor, install, pipeline, profiles, urls, run, rtp');
  process.exitCode = 1;
}

if (require.main === module) {
  main();
}

module.exports = { parseArgs, main, printReport, printStage2Report, printRtpHelp, validateRtpArgs, runRtpSender, runStage2Doctor };
