'use strict';

const childProcess = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function hasAnyMissing(report, names) {
  const executables = new Set((report.missing && report.missing.executables) || []);
  const plugins = new Set((report.missing && report.missing.plugins) || []);
  return names.some(name => executables.has(name) || plugins.has(name));
}

function missingPluginNames(report) {
  const encoderAlternatives = new Set([
    'nvh264enc',
    'amfh264enc',
    'mfh264enc',
    'nvh265enc',
    'amfh265enc',
    'mfh265enc'
  ]);

  return Object.entries(report.plugins || {})
    .filter(([, found]) => !found)
    .map(([name]) => name)
    .filter(name => !encoderAlternatives.has(name))
    .filter(name => !/hardware encoder/i.test(name))
    .filter(name => !/^H\.26[45]/i.test(name));
}

function missingHevcNames(report) {
  const hevc = report.codecs && report.codecs.hevc;
  return hevc && Array.isArray(hevc.missing) ? hevc.missing : [];
}

function createStage2RepairPlan(report, options = {}) {
  const automaticActions = [];
  const manualSteps = [];
  const missing = report.missing || { executables: [], plugins: [] };
  const missingExecutables = missing.executables || [];
  const missingPlugins = missing.plugins || [];
  const h264 = report.codecs && report.codecs.h264;
  const hevc = report.codecs && report.codecs.hevc;
  const reasons = [];

  if (hasAnyMissing(report, ['gst-launch-1.0', 'gst-inspect-1.0'])) {
    reasons.push('缺少 GStreamer 命令行工具：gst-launch-1.0 / gst-inspect-1.0');
  }

  const gstPluginMissing = unique(missingPluginNames(report).concat(missingPlugins));
  if (gstPluginMissing.length > 0) {
    reasons.push(`缺少 GStreamer 插件：${gstPluginMissing.join(', ')}`);
  }

  if (h264 && !h264.ready) {
    reasons.push(`H.264 硬件编码不可用：${(h264.missing || []).join(', ') || '未检测到可用编码器'}`);
  }

  if (hevc && !hevc.ready) {
    reasons.push(`HEVC 档位暂不可用：${missingHevcNames(report).join(', ') || '未检测到可用 HEVC 编码器'}`);
  }

  if (reasons.length > 0) {
    automaticActions.push({
      id: 'install-gstreamer-devel',
      title: '安装/更新 GStreamer runtime + devel',
      command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\install-gstreamer.ps1 -InstallDevel',
      downloadStrategy: '优先使用 aria2c 多连接下载；如果没有 aria2c，会先尝试通过 winget 安装 aria2；失败时回退 curl 断点续传。',
      reasons: unique(reasons)
    });
    manualSteps.push('如果一键安装后仍缺 nvh264enc/nvh265enc，请更新 NVIDIA 显卡驱动，并确认安装的是 GStreamer MSVC x86_64 runtime + devel。');
    manualSteps.push('如果是 AMD 显卡且仍缺 amfh264enc/amfh265enc，请更新 AMD Adrenalin 驱动，并确认安装的是 GStreamer MSVC x86_64 runtime + devel。');
    manualSteps.push('如果重新检查仍缺硬件编码器，请优先处理 NVIDIA/AMD 显卡驱动，再重新运行 检查环境.bat。');
  }

  if (missingExecutables.includes('dotnet') && !options.hasInputBridgeRuntime) {
    manualSteps.push('未检测到 .NET SDK，且没有找到输入桥运行时。朋友包请使用完整包内的 InputBridgeRuntime；源码开发模式需要安装 .NET 8 SDK。');
  }

  const onlyDotnetMissing = missingExecutables.length === 1
    && missingExecutables[0] === 'dotnet'
    && options.hasInputBridgeRuntime
    && automaticActions.length === 0;

  if (onlyDotnetMissing) {
    manualSteps.push('朋友包已包含输入桥运行时，普通验证不需要安装 .NET SDK；只有源码开发输入桥时才需要 .NET SDK。');
  }

  if (options.vigemBusReady === false) {
    automaticActions.push({
      id: 'install-vigembus',
      title: '安装 ViGEmBus 虚拟手柄驱动',
      command: 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts\\install-vigembus.ps1',
      downloadStrategy: '优先通过 winget 安装 ViGEmBus；安装后可能需要重启电脑才能让游戏识别虚拟 Xbox 手柄。',
      reasons: ['未检测到 ViGEmBus 服务，电视端手柄无法注入为电脑上的 Xbox 手柄。']
    });
  }

  const ready = Boolean((report.ready || onlyDotnetMissing) && automaticActions.length === 0);
  return {
    ready,
    automaticActions,
    manualSteps: unique(manualSteps)
  };
}

function formatStage2RepairPlan(plan) {
  const lines = [];
  lines.push('');
  lines.push('环境处理方案');
  lines.push('============');

  if (plan.ready && plan.automaticActions.length === 0 && plan.manualSteps.length === 0) {
    lines.push('环境已经可用，不需要自动处理。');
    return lines.join('\n');
  }

  if (plan.automaticActions.length > 0) {
    lines.push('可一键处理（需要用户确认后才会执行）：');
    for (const action of plan.automaticActions) {
      lines.push(`  - ${action.title}`);
      for (const reason of action.reasons) {
        lines.push(`    原因：${reason}`);
      }
      lines.push(`    下载方式：${action.downloadStrategy}`);
    }
  } else {
    lines.push('没有检测到可自动处理的缺失项。');
  }

  if (plan.manualSteps.length > 0) {
    lines.push('');
    lines.push('仍需要用户确认或手动调整的内容：');
    for (const step of plan.manualSteps) {
      lines.push(`  - ${step}`);
    }
  }

  return lines.join('\n');
}

function hasInputBridgeRuntime(projectRoot) {
  return fs.existsSync(path.join(projectRoot, 'InputBridgeRuntime', 'InputBridge.exe'));
}

function commandForRepairAction(action, projectRoot) {
  if (action.id === 'install-gstreamer-devel') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(projectRoot, 'scripts', 'install-gstreamer.ps1'),
        '-InstallDevel'
      ]
    };
  }

  if (action.id === 'install-vigembus') {
    return {
      command: 'powershell.exe',
      args: [
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(projectRoot, 'scripts', 'install-vigembus.ps1')
      ]
    };
  }

  return null;
}

function emitProgress(onProgress, event) {
  if (typeof onProgress === 'function') {
    onProgress(event);
  }
}

function runStage2RepairActions(plan, options = {}) {
  const spawnSync = options.spawnSync || childProcess.spawnSync;
  const projectRoot = options.projectRoot || process.cwd();

  for (const action of plan.automaticActions) {
    const executable = commandForRepairAction(action, projectRoot);
    if (!executable) continue;

    console.log(`正在执行：${action.title}`);
    const result = spawnSync(executable.command, executable.args, {
      stdio: 'inherit',
      windowsHide: false
    });

    if (result.error) {
      throw new Error(`执行失败：${result.error.message}`);
    }
    if (typeof result.status === 'number' && result.status !== 0) {
      throw new Error(`执行失败，退出码：${result.status}`);
    }
  }
}

function runRepairProcess(action, executable, options) {
  const spawn = options.spawn || childProcess.spawn;
  const onProgress = options.onProgress;
  const projectRoot = options.projectRoot || process.cwd();

  emitProgress(onProgress, {
    type: 'action-start',
    actionId: action.id,
    title: action.title,
    message: `正在处理：${action.title}`
  });

  return new Promise((resolve, reject) => {
    const child = spawn(executable.command, executable.args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true
    });

    function handleOutput(source, chunk) {
      const message = String(chunk || '').trim();
      if (!message) return;
      emitProgress(onProgress, {
        type: 'log',
        actionId: action.id,
        source,
        message
      });
    }

    if (child.stdout) {
      child.stdout.on('data', chunk => handleOutput('stdout', chunk));
    }

    if (child.stderr) {
      child.stderr.on('data', chunk => handleOutput('stderr', chunk));
    }

    child.on('error', error => {
      emitProgress(onProgress, {
        type: 'action-error',
        actionId: action.id,
        title: action.title,
        message: error.message
      });
      reject(new Error(`执行失败：${error.message}`));
    });

    child.on('close', code => {
      if (code === 0) {
        emitProgress(onProgress, {
          type: 'action-complete',
          actionId: action.id,
          title: action.title,
          message: `${action.title} 已完成`
        });
        resolve();
        return;
      }

      const message = `执行失败，退出码：${code}`;
      emitProgress(onProgress, {
        type: 'action-error',
        actionId: action.id,
        title: action.title,
        message
      });
      reject(new Error(message));
    });
  });
}

async function runStage2RepairActionsAsync(plan, options = {}) {
  const projectRoot = options.projectRoot || process.cwd();
  const onProgress = options.onProgress;
  const actions = Array.isArray(plan.automaticActions) ? plan.automaticActions : [];

  emitProgress(onProgress, {
    type: 'start',
    total: actions.length,
    message: actions.length > 0 ? '开始修复环境' : '没有需要自动修复的项目'
  });

  for (const action of actions) {
    const executable = commandForRepairAction(action, projectRoot);
    if (!executable) continue;
    await runRepairProcess(action, executable, { ...options, projectRoot });
  }

  emitProgress(onProgress, {
    type: 'complete',
    message: '环境修复流程已完成'
  });
}

module.exports = {
  createStage2RepairPlan,
  formatStage2RepairPlan,
  hasInputBridgeRuntime,
  runStage2RepairActions,
  runStage2RepairActionsAsync
};
