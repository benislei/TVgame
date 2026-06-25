'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const { PassThrough } = require('node:stream');

function createBrokenReport() {
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

test('stage2 repair plan groups missing GStreamer pieces into one confirmed action', () => {
  const { createStage2RepairPlan, formatStage2RepairPlan } = require('../src/stage2/repair');
  const plan = createStage2RepairPlan(createBrokenReport(), {
    hasInputBridgeRuntime: true
  });
  const text = formatStage2RepairPlan(plan);

  assert.equal(plan.ready, false);
  assert.equal(plan.automaticActions.length, 1);
  assert.equal(plan.automaticActions[0].id, 'install-gstreamer-devel');
  assert.match(plan.automaticActions[0].title, /安装\/更新 GStreamer/);
  assert.match(plan.automaticActions[0].downloadStrategy, /aria2c 多连接/);
  assert.match(text, /可一键处理/);
  assert.match(text, /需要用户确认后才会执行/);
  assert.match(text, /d3d11download/);
  assert.match(text, /wasapi2src/);
  assert.match(text, /H\.264/);
  assert.match(text, /HEVC/);
  assert.match(text, /NVIDIA\/AMD 显卡驱动/);
  assert.doesNotMatch(text, /必须安装 \.NET SDK/);
});

test('stage2 repair plan includes ViGEmBus when the virtual gamepad driver is missing', () => {
  const { createStage2RepairPlan } = require('../src/stage2/repair');
  const report = createBrokenReport();
  report.gstreamer.ready = true;
  report.dotnet.ready = true;
  report.plugins = {
    d3d11screencapturesrc: true,
    d3d11download: true,
    wasapi2src: true,
    nvh264enc: true,
    amfh264enc: false,
    mfh264enc: false
  };
  report.optionalPlugins = {
    nvh265enc: true,
    amfh265enc: false,
    mfh265enc: false,
    h265parse: true,
    rtph265pay: true
  };
  report.codecs.h264 = {
    ready: true,
    encoder: 'nvh264enc',
    availableEncoders: ['nvh264enc'],
    missing: []
  };
  report.codecs.hevc = {
    ready: true,
    encoder: 'nvh265enc',
    availableEncoders: ['nvh265enc'],
    missing: []
  };
  report.missing = { executables: [], plugins: [], pythonModules: [] };

  const plan = createStage2RepairPlan(report, {
    hasInputBridgeRuntime: true,
    vigemBusReady: false
  });

  assert.equal(plan.ready, false);
  assert.deepEqual(plan.automaticActions.map(action => action.id), ['install-vigembus']);
  assert.match(plan.automaticActions[0].title, /ViGEmBus/);
});

test('stage2 repair plan explains dotnet only when the packaged input bridge runtime is missing', () => {
  const { createStage2RepairPlan, formatStage2RepairPlan } = require('../src/stage2/repair');
  const plan = createStage2RepairPlan(createBrokenReport(), {
    hasInputBridgeRuntime: false
  });
  const text = formatStage2RepairPlan(plan);

  assert.match(text, /\.NET SDK/);
  assert.match(text, /输入桥运行时/);
});

test('stage2 repair plan treats packaged input bridge runtime as enough without dotnet SDK', () => {
  const { createStage2RepairPlan, formatStage2RepairPlan } = require('../src/stage2/repair');
  const plan = createStage2RepairPlan({
    ready: false,
    gstreamer: { ready: true, gstLaunch: 'gst-launch-1.0.exe', gstInspect: 'gst-inspect-1.0.exe' },
    dotnet: { ready: false, path: null },
    plugins: {},
    optionalPlugins: {},
    codecs: {
      h264: { ready: true, missing: [] },
      hevc: { ready: true, missing: [] }
    },
    missing: { executables: ['dotnet'], plugins: [], pythonModules: [] }
  }, {
    hasInputBridgeRuntime: true
  });
  const text = formatStage2RepairPlan(plan);

  assert.equal(plan.ready, true);
  assert.match(text, /朋友包已包含输入桥运行时/);
  assert.doesNotMatch(text, /未检测到 \.NET SDK，且没有找到输入桥运行时/);
});

test('stage2 repair plan is empty when sender environment is ready', () => {
  const { createStage2RepairPlan, formatStage2RepairPlan } = require('../src/stage2/repair');
  const plan = createStage2RepairPlan({
    ready: true,
    gstreamer: { ready: true, gstLaunch: 'gst-launch-1.0.exe', gstInspect: 'gst-inspect-1.0.exe' },
    dotnet: { ready: true, path: 'dotnet.exe' },
    plugins: {},
    optionalPlugins: {},
    codecs: {
      h264: { ready: true, missing: [] },
      hevc: { ready: true, missing: [] }
    },
    missing: { executables: [], plugins: [], pythonModules: [] }
  });

  assert.equal(plan.ready, true);
  assert.deepEqual(plan.automaticActions, []);
  assert.match(formatStage2RepairPlan(plan), /环境已经可用/);
});

test('stage2 repair plan accepts one working hardware encoder without installing alternatives', () => {
  const { createStage2RepairPlan, formatStage2RepairPlan } = require('../src/stage2/repair');
  const plan = createStage2RepairPlan({
    ready: true,
    gstreamer: { ready: true, gstLaunch: 'gst-launch-1.0.exe', gstInspect: 'gst-inspect-1.0.exe' },
    dotnet: { ready: true, path: 'dotnet.exe' },
    plugins: {
      d3d11screencapturesrc: true,
      d3d11download: true,
      wasapi2src: true,
      nvh264enc: true,
      amfh264enc: false,
      mfh264enc: false
    },
    optionalPlugins: {
      nvh265enc: true,
      amfh265enc: false,
      mfh265enc: false,
      h265parse: true,
      rtph265pay: true
    },
    codecs: {
      h264: { ready: true, encoder: 'nvh264enc', missing: [] },
      hevc: { ready: true, encoder: 'nvh265enc', missing: [] }
    },
    missing: { executables: [], plugins: [], pythonModules: [] }
  });
  const text = formatStage2RepairPlan(plan);

  assert.equal(plan.ready, true);
  assert.deepEqual(plan.automaticActions, []);
  assert.doesNotMatch(text, /amfh264enc/);
});

test('stage2-doctor CLI prints repair plan and does not auto-install before confirmation', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'native-streamer', 'cli.js');
  const result = childProcess.spawnSync(process.execPath, [cliPath, 'stage2-doctor'], {
    encoding: 'utf8',
    input: 'N\r\n',
    env: {
      ...process.env,
      TVGAME_STAGE2_TEST_REPORT: 'missing-gstreamer'
    }
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /阶段 2 发送端环境检测/);
  assert.match(result.stdout, /可一键处理/);
  assert.match(result.stdout, /是否现在执行一键处理/);
  assert.match(result.stdout, /已取消自动处理/);
  assert.doesNotMatch(result.stdout, /正在执行：安装\/更新 GStreamer/);
});

test('GStreamer installer prefers aria2 multi-connection download and can install the accelerator', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'install-gstreamer.ps1'), 'utf8');

  assert.match(source, /Ensure-Aria2/);
  assert.match(source, /aria2\.aria2/);
  assert.match(source, /-x 16 -s 16/);
  assert.match(source, /curl\.exe/);
});

test('async stage2 repair hides PowerShell windows and reports action progress', async () => {
  const { runStage2RepairActionsAsync } = require('../src/stage2/repair');
  const spawnCalls = [];
  const progress = [];

  function spawn(command, args, options) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    spawnCalls.push({ command, args, options });

    process.nextTick(() => {
      child.stdout.write('正在下载 GStreamer runtime...\n');
      child.stdout.end();
      child.stderr.end();
      child.emit('close', 0);
    });

    return child;
  }

  await runStage2RepairActionsAsync({
    automaticActions: [{
      id: 'install-gstreamer-devel',
      title: '安装/更新 GStreamer runtime + devel'
    }]
  }, {
    projectRoot: 'D:/project',
    spawn,
    onProgress: event => progress.push(event)
  });

  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].command, 'powershell.exe');
  assert.equal(spawnCalls[0].options.windowsHide, true);
  assert.deepEqual(spawnCalls[0].options.stdio, ['ignore', 'pipe', 'pipe']);
  assert.deepEqual(
    progress.map(event => event.type),
    ['start', 'action-start', 'log', 'action-complete', 'complete']
  );
  assert.match(progress.find(event => event.type === 'log').message, /GStreamer runtime/);
});
