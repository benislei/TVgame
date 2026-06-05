'use strict';

const EventEmitter = require('node:events');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GSTREAMER_VERSION,
  buildGStreamerDownloadUrls,
  createEnvironmentReport
} = require('../src/native-streamer/environment');
const {
  PROFILES,
  buildPipelineConfig,
  buildPipelineDescription
} = require('../src/native-streamer/pipeline');
const { parseArgs, runRtpSender } = require('../src/native-streamer/cli');

function withPatchedSpawn(spawn, fn) {
  const originalSpawn = childProcess.spawn;
  const originalExitCode = process.exitCode;
  childProcess.spawn = spawn;
  process.exitCode = undefined;
  try {
    return fn();
  } finally {
    childProcess.spawn = originalSpawn;
    process.exitCode = originalExitCode;
  }
}

function createReadyStage2Report(gstLaunch = 'D:/gstreamer/1.0/msvc_x86_64/bin/gst-launch-1.0.exe') {
  return {
    ready: true,
    gstreamer: {
      ready: true,
      gstLaunch,
      gstInspect: 'D:/gstreamer/1.0/msvc_x86_64/bin/gst-inspect-1.0.exe'
    },
    dotnet: { ready: true, path: 'C:/Program Files/dotnet/dotnet.exe' },
    plugins: {},
    missing: { executables: [], plugins: [] }
  };
}

function createSuccessfulPresetProbe() {
  return () => ({ status: 0, stdout: '', stderr: '' });
}

test('GStreamer download URLs point at official 64-bit MSVC installers', () => {
  const urls = buildGStreamerDownloadUrls();

  assert.equal(GSTREAMER_VERSION, '1.24.13');
  assert.match(urls.runtime, /^https:\/\/gstreamer\.freedesktop\.org\/pkg\/windows\/1\.24\.13\/msvc\/gstreamer-1\.0-msvc-x86_64-1\.24\.13\.msi$/);
  assert.match(urls.devel, /^https:\/\/gstreamer\.freedesktop\.org\/pkg\/windows\/1\.24\.13\/msvc\/gstreamer-1\.0-devel-msvc-x86_64-1\.24\.13\.msi$/);
});

test('GStreamer installer gives friend-package next steps without QuickVerify wording', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-gstreamer.ps1'), 'utf8');

  assert.match(source, /检查环境\.bat/);
  assert.match(source, /npm\.cmd run stage2:check/);
  assert.match(source, /nvh264enc/);
  assert.match(source, /NVIDIA/);
  assert.doesNotMatch(source, /QuickVerify/);
  assert.doesNotMatch(source, /native:check/);
});

test('environment report marks missing executables and plugins', () => {
  const report = createEnvironmentReport({
    findExecutable: () => null,
    inspectPlugin: () => false,
    checkPythonModule: () => false,
    env: {}
  });

  assert.equal(report.ready, false);
  assert.equal(report.executables.gstLaunch.found, false);
  assert.equal(report.executables.gstInspect.found, false);
  assert.equal(report.executables.python.found, false);
  assert.equal(report.plugins.webrtcbin, false);
  assert.equal(report.plugins.nvh264enc, false);
  assert.equal(report.python.websockets, false);
  assert.equal(report.python.gstreamerBindings, false);
});

test('environment report is ready when required executables, plugins, and Python modules exist', () => {
  const report = createEnvironmentReport({
    findExecutable: name => name === 'python'
      ? 'C:/Python312/python.exe'
      : `C:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`,
    inspectPlugin: () => true,
    checkPythonModule: () => true,
    env: { GSTREAMER_1_0_ROOT_MSVC_X86_64: 'C:/gstreamer/1.0/msvc_x86_64/' }
  });

  assert.equal(report.ready, true);
  assert.equal(report.gstreamerRoot, 'C:/gstreamer/1.0/msvc_x86_64/');
  assert.equal(report.executables.python.path, 'C:/Python312/python.exe');
  assert.equal(report.python.websockets, true);
  assert.equal(report.python.gstreamerBindings, true);
});

test('environment report accepts the Windows py launcher as Python', () => {
  const report = createEnvironmentReport({
    findExecutable: name => {
      if (name === 'python' || name === 'python3') return null;
      if (name === 'py') return 'C:/Windows/py.exe';
      return `C:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
    },
    inspectPlugin: () => true,
    checkPythonModule: () => true,
    env: {}
  });

  assert.equal(report.ready, true);
  assert.equal(report.executables.python.path, 'C:/Windows/py.exe');
});

test('environment report searches the D drive GStreamer default install path', () => {
  const seen = [];
  const report = createEnvironmentReport({
    findExecutable: name => {
      seen.push(name);
      if (name === 'python' || name === 'python3') return null;
      if (name === 'py') return 'C:/Windows/py.exe';
      return `D:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
    },
    inspectPlugin: () => true,
    checkPythonModule: () => true,
    env: {}
  });

  assert.equal(report.ready, true);
  assert.equal(report.executables.gstLaunch.path, 'D:/gstreamer/1.0/msvc_x86_64/bin/gst-launch-1.0.exe');
  assert.ok(seen.includes('gst-launch-1.0'));
});

test('1080p60 profile builds low-latency NVENC pipeline settings', () => {
  const config = buildPipelineConfig(PROFILES['1080p60']);

  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.fps, 60);
  assert.equal(config.bitrateKbps, 25000);
  assert.equal(config.keyframeInterval, 60);
  assert.equal(config.encoder, 'nvh264enc');
});

test('pipeline description includes D3D11 capture, NVENC, RTP, and webrtcbin', () => {
  const description = buildPipelineDescription(buildPipelineConfig(PROFILES['1080p60']));

  assert.match(description, /d3d11screencapturesrc/);
  assert.match(description, /nvh264enc/);
  assert.match(description, /bframes=0/);
  assert.match(description, /bitrate=25000/);
  assert.match(description, /h264parse/);
  assert.match(description, /rtph264pay/);
  assert.match(description, /webrtcbin/);
});

test('parseArgs accepts Android TV RTP target options', () => {
  const args = parseArgs([
    'rtp',
    '--host',
    '192.168.1.50',
    '--video-port',
    '5004',
    '--audio-port',
    '5006',
    '--width',
    '1280',
    '--height',
    '720',
    '--profile',
    'game720',
    '--fps',
    '60',
    '--gop',
    '30'
  ]);

  assert.deepEqual(args._, ['rtp']);
  assert.equal(args.host, '192.168.1.50');
  assert.equal(args['video-port'], '5004');
  assert.equal(args['audio-port'], '5006');
  assert.equal(args.width, '1280');
  assert.equal(args.height, '720');
  assert.equal(args.profile, 'game720');
  assert.equal(args.fps, '60');
  assert.equal(args.gop, '30');
});

test('runRtpSender default RTP options use resilient anti-artifact profile', () => {
  const spawnedCommands = [];

  withPatchedSpawn((executable, args) => {
    spawnedCommands.push({ executable, args });
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50']),
      {
        createReport: () => createReadyStage2Report(),
        spawnSync: createSuccessfulPresetProbe()
      }
    );
  });

  const videoArgs = spawnedCommands[0].args.join(' ');
  assert.match(videoArgs, /width=1920,height=1080,framerate=60\/1/);
  assert.match(videoArgs, /preset=low-latency-hq/);
  assert.match(videoArgs, /bitrate=22000/);
  assert.match(videoArgs, /gop-size=5/);
  assert.match(videoArgs, /strict-gop=true/);
  assert.match(videoArgs, /h264parse config-interval=-1/);
  assert.match(videoArgs, /buffer-size=4194304/);
});

test('runRtpSender auto probes NVENC presets in game-feel order and launches first supported', () => {
  const spawnedCommands = [];
  const probedPresets = [];

  withPatchedSpawn((executable, args) => {
    spawnedCommands.push({ executable, args });
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50', '--encoder-preset', 'auto']),
      {
        createReport: () => createReadyStage2Report(),
        spawnSync(executable, args) {
          const joined = args.join(' ');
          const match = joined.match(/preset=([\w-]+)/);
          probedPresets.push(match && match[1]);
          return { status: probedPresets.length === 1 ? 1 : 0, stdout: '', stderr: 'Selected preset not supported' };
        }
      }
    );
  });

  assert.deepEqual(probedPresets.slice(0, 2), ['low-latency-hq', 'low-latency-hp']);
  const videoArgs = spawnedCommands[0].args.join(' ');
  assert.match(videoArgs, /preset=low-latency-hp/);
});

test('runRtpSender accepts explicit NVENC encoder preset for advanced tuning', () => {
  const spawnedCommands = [];
  let probeCount = 0;

  withPatchedSpawn((executable, args) => {
    spawnedCommands.push({ executable, args });
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50', '--encoder-preset', 'low-latency-hq']),
      {
        createReport: () => createReadyStage2Report(),
        spawnSync() {
          probeCount += 1;
          return { status: 0, stdout: '', stderr: '' };
        }
      }
    );
  });

  assert.equal(probeCount, 0);
  const videoArgs = spawnedCommands[0].args.join(' ');
  assert.match(videoArgs, /preset=low-latency-hq/);
});

test('runRtpSender can select 720p fallback profile explicitly', () => {
  const spawnedCommands = [];

  withPatchedSpawn((executable, args) => {
    spawnedCommands.push({ executable, args });
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50', '--profile', 'game720']),
      {
        createReport: () => createReadyStage2Report(),
        spawnSync: createSuccessfulPresetProbe()
      }
    );
  });

  const videoArgs = spawnedCommands[0].args.join(' ');
  assert.match(videoArgs, /width=1280,height=720,framerate=60\/1/);
  assert.match(videoArgs, /bitrate=18000/);
  assert.match(videoArgs, /gop-size=15/);
});

test('runRtpSender rejects unknown RTP profiles before spawning', () => {
  let spawnCount = 0;

  withPatchedSpawn(() => {
    spawnCount += 1;
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50', '--profile', 'fastish']),
      { createReport: () => createReadyStage2Report() }
    );

    assert.equal(spawnCount, 0);
    assert.equal(process.exitCode, 1);
  });
});

test('runRtpSender rejects HEVC roadmap profile until receiver support exists', () => {
  let spawnCount = 0;

  withPatchedSpawn(() => {
    spawnCount += 1;
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50', '--profile', 'game4k']),
      { createReport: () => createReadyStage2Report() }
    );

    assert.equal(spawnCount, 0);
    assert.equal(process.exitCode, 1);
  });
});

test('runRtpSender rejects invalid RTP options without spawning', () => {
  let spawnCount = 0;

  withPatchedSpawn(() => {
    spawnCount += 1;
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50 & calc', '--video-port', '70000', '--bitrate', '0', '--display', '-1']),
      { createReport: () => createReadyStage2Report() }
    );

    assert.equal(spawnCount, 0);
    assert.equal(process.exitCode, 1);
  });
});

test('runRtpSender rejects unsupported NVENC encoder preset before spawning', () => {
  let spawnCount = 0;

  withPatchedSpawn(() => {
    spawnCount += 1;
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50', '--encoder-preset', 'magic-fast']),
      { createReport: () => createReadyStage2Report() }
    );

    assert.equal(spawnCount, 0);
    assert.equal(process.exitCode, 1);
  });
});

test('runRtpSender uses the resolved gst-launch path from stage2 report', () => {
  const executables = [];
  const gstLaunch = 'D:/gstreamer/1.0/msvc_x86_64/bin/gst-launch-1.0.exe';

  withPatchedSpawn((executable) => {
    executables.push(executable);
    return new EventEmitter();
  }, () => {
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50']),
      {
        createReport: () => createReadyStage2Report(gstLaunch),
        spawnSync: createSuccessfulPresetProbe()
      }
    );
  });

  assert.deepEqual(executables, [gstLaunch, gstLaunch]);
});

test('runRtpSender stops sibling RTP process when spawn errors', () => {
  const firstChild = new EventEmitter();
  const secondChild = new EventEmitter();
  firstChild.kill = () => { firstChild.killed = true; };
  secondChild.kill = () => { secondChild.killed = true; };
  const children = [firstChild, secondChild];

  withPatchedSpawn(() => children.shift(), () => {
    const spawned = [];
    runRtpSender(
      parseArgs(['rtp', '--host', '192.168.1.50']),
      {
        createReport: () => createReadyStage2Report(),
        spawnSync: createSuccessfulPresetProbe(),
        onChild: child => spawned.push(child)
      }
    );

    assert.doesNotThrow(() => spawned[0].emit('error', new Error('spawn failed')));
    assert.equal(secondChild.killed, true);
    assert.equal(process.exitCode, 1);
  });
});
