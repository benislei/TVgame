'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  summarizeEnvironment,
  createEnvironmentService,
  createWorkerEnvironmentService
} = require('../src/desktop/environment-service');

function createReadyReport() {
  return {
    ready: true,
    gstreamer: {
      ready: true,
      gstLaunch: 'D:/gstreamer/bin/gst-launch-1.0.exe',
      gstInspect: 'D:/gstreamer/bin/gst-inspect-1.0.exe'
    },
    dotnet: {
      ready: true,
      path: 'C:/Program Files/dotnet/dotnet.exe'
    },
    codecs: {
      h264: {
        ready: true,
        encoder: 'nvh264enc',
        availableEncoders: ['nvh264enc'],
        missing: []
      },
      hevc: {
        ready: true,
        encoder: 'nvh265enc',
        availableEncoders: ['nvh265enc'],
        missing: []
      }
    },
    missing: {
      executables: [],
      plugins: [],
      pythonModules: []
    }
  };
}

test('ready report returns real Chinese ok cards and encoder detail', () => {
  const report = createReadyReport();
  const summary = summarizeEnvironment(report, {
    inputBridgeRuntimeReady: true,
    vigemBusReady: true
  });

  assert.equal(summary.ready, true);
  assert.equal(summary.raw, report);
  assert.equal(summary.cards.gstreamer.state, 'ok');
  assert.equal(summary.cards.gstreamer.message, '正常');
  assert.equal(summary.cards.gstreamer.detail, 'GStreamer 运行时和必要插件可用');
  assert.equal(summary.cards.encoder.state, 'ok');
  assert.equal(summary.cards.encoder.title, '编码器');
  assert.equal(summary.cards.encoder.message, 'H.264 和 HEVC 可用');
  assert.equal(summary.cards.encoder.detail, 'H.264: nvh264enc / HEVC: nvh265enc');
  assert.equal(summary.cards.inputBridge.state, 'ok');
  assert.equal(summary.cards.inputBridge.title, '输入桥');
  assert.equal(summary.cards.inputBridge.message, '正常');
  assert.equal(summary.cards.inputBridge.detail, '输入桥运行时可用');
  assert.equal(summary.cards.gamepadDriver.state, 'ok');
  assert.equal(summary.cards.gamepadDriver.title, '手柄驱动');
  assert.equal(summary.cards.gamepadDriver.message, 'ViGEmBus 已安装');
  assert.equal(summary.cards.gamepadDriver.detail, '电视端手柄可以注入为 Xbox 手柄');
});

test('missing HEVC keeps overall ready with H264 and warns for encoder and gamepad driver', () => {
  const report = createReadyReport();
  report.codecs.hevc = {
    ready: false,
    encoder: null,
    availableEncoders: [],
    missing: ['nvh265enc|amfh265enc|mfh265enc']
  };

  const summary = summarizeEnvironment(report, {
    inputBridgeRuntimeReady: true,
    vigemBusReady: false
  });

  assert.equal(summary.ready, true);
  assert.equal(summary.cards.encoder.state, 'warning');
  assert.equal(summary.cards.encoder.message, 'HEVC 档位暂不可用，H.264 可用');
  assert.match(summary.cards.encoder.message, /HEVC 档位暂不可用/);
  assert.equal(summary.cards.encoder.detail, 'H.264: nvh264enc / HEVC: 不可用');
  assert.equal(summary.cards.gamepadDriver.state, 'warning');
  assert.equal(
    summary.cards.gamepadDriver.message,
    '需要安装 ViGEmBus 才能把电视端手柄注入为 Xbox 手柄'
  );
  assert.equal(summary.cards.gamepadDriver.detail, '安装 ViGEmBus 后可启用 Xbox 手柄注入');
});

test('input bridge can fall back to dotnet readiness', () => {
  const report = createReadyReport();

  const summary = summarizeEnvironment(report, {
    inputBridgeRuntimeReady: false,
    vigemBusReady: true
  });

  assert.equal(summary.ready, true);
  assert.equal(summary.cards.inputBridge.state, 'ok');
  assert.equal(summary.cards.inputBridge.message, '正常');
  assert.equal(summary.cards.inputBridge.detail, '输入桥运行时可用');
});

test('missing required pieces return error cards and not ready', () => {
  const report = createReadyReport();
  report.gstreamer.ready = false;
  report.dotnet.ready = false;
  report.codecs.h264 = {
    ready: false,
    encoder: null,
    availableEncoders: [],
    missing: ['nvh264enc|amfh264enc|mfh264enc']
  };

  const summary = summarizeEnvironment(report, {});

  assert.equal(summary.ready, false);
  assert.equal(summary.cards.gstreamer.state, 'error');
  assert.equal(summary.cards.gstreamer.message, '缺少 GStreamer 或必要插件');
  assert.equal(summary.cards.gstreamer.detail, '请安装 GStreamer runtime、devel 与必要插件');
  assert.equal(summary.cards.encoder.state, 'error');
  assert.equal(summary.cards.encoder.message, '缺少可用 H.264 编码器');
  assert.equal(summary.cards.encoder.detail, 'H.264: 不可用 / HEVC: nvh265enc');
  assert.equal(summary.cards.inputBridge.state, 'error');
  assert.equal(summary.cards.inputBridge.message, '缺少输入桥运行时或 .NET');
  assert.equal(summary.cards.inputBridge.detail, '请安装输入桥运行时或 .NET');
});

test('environment service check and repair use injected dependencies and map runtime to repair options', async () => {
  const reports = [createReadyReport(), createReadyReport(), createReadyReport()];
  reports[0].gstreamer.ready = false;
  const repairRuntime = { inputBridgeRuntimeReady: true, vigemBusReady: false };
  const calls = [];
  const service = createEnvironmentService({
    createReport: () => {
      calls.push('createReport');
      return reports.shift();
    },
    createRepairPlan: (report, options) => {
      calls.push(['createRepairPlan', report.gstreamer.ready, options]);
      return { ready: false, automaticActions: [{ id: 'install-gstreamer-devel' }], manualSteps: [] };
    },
    runRepairActions: async (plan, options) => {
      options.onProgress({ type: 'action-start', actionId: plan.automaticActions[0].id });
      calls.push(['runRepairActions', plan.automaticActions[0].id, options.projectRoot]);
    },
    getRuntime: () => {
      calls.push('getRuntime');
      return repairRuntime;
    }
  });

  const first = service.check();
  const progress = [];
  const repaired = await service.repair('D:/workspace/project', {
    onProgress: event => progress.push(event)
  });

  assert.equal(first.ready, false);
  assert.equal(repaired.ready, true);
  assert.deepEqual(progress.map(event => event.type), ['check', 'plan', 'action-start', 'complete']);
  assert.deepEqual(calls, [
    'createReport',
    'getRuntime',
    'createReport',
    'getRuntime',
    ['createRepairPlan', true, {
      inputBridgeRuntimeReady: true,
      vigemBusReady: false,
      hasInputBridgeRuntime: true
    }],
    ['runRepairActions', 'install-gstreamer-devel', 'D:/workspace/project'],
    'createReport',
    'getRuntime'
  ]);
});

test('worker environment service delegates check and repair to a background worker runner', async () => {
  const calls = [];
  const service = createWorkerEnvironmentService({
    projectRoot: 'D:/project',
    inputBridgeRuntimePath: 'D:/project/InputBridgeRuntime/InputBridge.exe',
    runWorker: async (action, options) => {
      calls.push([action, options.projectRoot, options.inputBridgeRuntimePath, typeof options.onProgress]);
      if (action === 'repair' && typeof options.onProgress === 'function') {
        options.onProgress({ type: 'check', message: 'checking' });
      }
      return { cards: {}, action };
    }
  });

  const progress = [];
  const checked = await service.check();
  const repaired = await service.repair('D:/project', {
    onProgress: event => progress.push(event)
  });

  assert.equal(checked.action, 'check');
  assert.equal(repaired.action, 'repair');
  assert.deepEqual(progress, [{ type: 'check', message: 'checking' }]);
  assert.deepEqual(calls, [
    ['check', 'D:/project', 'D:/project/InputBridgeRuntime/InputBridge.exe', 'undefined'],
    ['repair', 'D:/project', 'D:/project/InputBridgeRuntime/InputBridge.exe', 'function']
  ]);
});

test('desktop environment service production text does not contain mojibake fragments', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'desktop', 'environment-service.js'), 'utf8');

  for (const fragment of ['姝ｅ父', '缂', '杈', '鎵', '涓嶅彲', '妗', '鍣']) {
    assert.doesNotMatch(source, new RegExp(fragment));
  }
});
