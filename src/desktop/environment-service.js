'use strict';

const { createStage2Report } = require('../stage2/tooling');
const {
  createStage2RepairPlan,
  runStage2RepairActions
} = require('../stage2/repair');

function isReady(value) {
  return Boolean(value && value.ready);
}

function encoderName(codec) {
  return codec && codec.ready && codec.encoder ? codec.encoder : '不可用';
}

function summarizeEnvironment(report, runtime = {}) {
  const gstreamerReady = isReady(report.gstreamer);
  const h264Ready = isReady(report.codecs && report.codecs.h264);
  const hevcReady = isReady(report.codecs && report.codecs.hevc);
  const inputBridgeReady = runtime.inputBridgeRuntimeReady === true || isReady(report.dotnet);
  const gamepadDriverReady = runtime.vigemBusReady === true;
  const ready = Boolean(gstreamerReady && h264Ready && inputBridgeReady);

  return {
    ready,
    raw: report,
    cards: {
      gstreamer: {
        state: gstreamerReady ? 'ok' : 'error',
        title: 'GStreamer',
        message: gstreamerReady ? '正常' : '缺少 GStreamer 或必要插件',
        detail: gstreamerReady ? 'GStreamer 运行时和必要插件可用' : '请安装 GStreamer runtime、devel 与必要插件'
      },
      encoder: {
        state: h264Ready ? (hevcReady ? 'ok' : 'warning') : 'error',
        title: '编码器',
        message: h264Ready
          ? (hevcReady ? 'H.264 和 HEVC 可用' : 'HEVC 档位暂不可用，H.264 可用')
          : '缺少可用 H.264 编码器',
        detail: `H.264: ${encoderName(report.codecs && report.codecs.h264)} / HEVC: ${encoderName(report.codecs && report.codecs.hevc)}`
      },
      inputBridge: {
        state: inputBridgeReady ? 'ok' : 'error',
        title: '输入桥',
        message: inputBridgeReady ? '正常' : '缺少输入桥运行时或 .NET',
        detail: inputBridgeReady ? '输入桥运行时可用' : '请安装输入桥运行时或 .NET'
      },
      gamepadDriver: {
        state: gamepadDriverReady ? 'ok' : 'warning',
        title: '手柄驱动',
        message: gamepadDriverReady
          ? 'ViGEmBus 已安装'
          : '需要安装 ViGEmBus 才能把电视端手柄注入为 Xbox 手柄',
        detail: gamepadDriverReady
          ? '电视端手柄可以注入为 Xbox 手柄'
          : '安装 ViGEmBus 后可启用 Xbox 手柄注入'
      }
    }
  };
}

function createEnvironmentService(options = {}) {
  const createReport = options.createReport || createStage2Report;
  const createRepairPlan = options.createRepairPlan || createStage2RepairPlan;
  const runRepairActions = options.runRepairActions || runStage2RepairActions;
  const getRuntime = options.getRuntime || (() => ({}));

  function check() {
    return summarizeEnvironment(createReport(), getRuntime());
  }

  function repair(projectRoot) {
    const report = createReport();
    const runtime = getRuntime();
    const repairOptions = {
      ...runtime,
      hasInputBridgeRuntime: runtime.inputBridgeRuntimeReady === true
    };
    const plan = createRepairPlan(report, repairOptions);
    runRepairActions(plan, { projectRoot });
    return check();
  }

  return {
    check,
    repair
  };
}

module.exports = {
  summarizeEnvironment,
  createEnvironmentService
};
