'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createStage2Report } = require('../stage2/tooling');
const {
  createStage2RepairPlan,
  runStage2RepairActionsAsync
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

function environmentCardsAllOk(summary) {
  const cards = summary && summary.cards;
  if (!cards || typeof cards !== 'object') return false;
  return Object.values(cards).every(card => card && card.state === 'ok');
}

function executableExists(filePath) {
  try {
    return Boolean(filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile());
  } catch {
    return false;
  }
}

function detectVigemBus(spawnSync = childProcess.spawnSync) {
  try {
    const result = spawnSync('sc.exe', ['query', 'ViGEmBus'], {
      encoding: 'utf8',
      windowsHide: true
    });
    const output = `${result.stdout || ''}\n${result.stderr || ''}`;
    return result.status === 0 && /SERVICE_NAME:\s*ViGEmBus/i.test(output);
  } catch {
    return false;
  }
}

function createDesktopRuntimeDetector(options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const inputBridgeRuntimePath = options.inputBridgeRuntimePath
    || path.join(projectRoot, 'InputBridgeRuntime', 'InputBridge.exe');
  const spawnSync = options.spawnSync || childProcess.spawnSync;

  return () => ({
    inputBridgeRuntimeReady: executableExists(inputBridgeRuntimePath),
    vigemBusReady: detectVigemBus(spawnSync)
  });
}

function emitProgress(onProgress, event) {
  if (typeof onProgress === 'function') {
    onProgress(event);
  }
}

function createEnvironmentService(options = {}) {
  const createReport = options.createReport || createStage2Report;
  const createRepairPlan = options.createRepairPlan || createStage2RepairPlan;
  const runRepairActions = options.runRepairActions || runStage2RepairActionsAsync;
  const getRuntime = options.getRuntime || (() => ({}));

  function check() {
    return summarizeEnvironment(createReport(), getRuntime());
  }

  async function repair(projectRoot, options = {}) {
    const onProgress = options.onProgress;
    emitProgress(onProgress, {
      type: 'check',
      message: '正在检查发送端环境'
    });

    const report = createReport();
    const runtime = getRuntime();
    const repairOptions = {
      ...runtime,
      hasInputBridgeRuntime: runtime.inputBridgeRuntimeReady === true
    };
    const plan = createRepairPlan(report, repairOptions);

    emitProgress(onProgress, {
      type: 'plan',
      actions: plan.automaticActions,
      manualSteps: plan.manualSteps,
      message: plan.automaticActions.length > 0 ? '已生成可自动处理的修复计划' : '没有需要自动修复的项目'
    });

    await runRepairActions(plan, { projectRoot, onProgress });

    const summary = check();
    emitProgress(onProgress, {
      type: 'complete',
      summary,
      message: environmentCardsAllOk(summary) ? '环境已全部正常' : '环境修复完成，但仍有项目需要处理'
    });

    return {
      ...summary,
      repair: { plan }
    };
  }

  return {
    check,
    repair
  };
}

module.exports = {
  summarizeEnvironment,
  environmentCardsAllOk,
  detectVigemBus,
  createDesktopRuntimeDetector,
  createEnvironmentService
};
