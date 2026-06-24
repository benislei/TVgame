'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

const MAX_LOG_LINES = 300;

function buildRtpCommand({ projectRoot, device, quality, performanceProtection }) {
  if (!device || !device.ip) {
    throw new Error('缺少电视 IP');
  }

  if (!quality || !quality.profile) {
    throw new Error('缺少画质档位');
  }

  const args = [
    'run',
    'native:rtp',
    '--',
    '--host',
    device.ip,
    '--encoder',
    'auto',
    '--encoder-preset',
    'auto',
    '--profile',
    quality.profile
  ];

  if (performanceProtection) {
    args.push('--process-priority', 'high');
  }

  return {
    command: process.platform === 'win32' ? 'npm.cmd' : 'npm',
    args,
    options: {
      cwd: projectRoot,
      windowsHide: true
    }
  };
}

function buildInputBridgeCommand({ projectRoot, inputBridgeRuntimePath }) {
  return {
    command: inputBridgeRuntimePath || path.join(projectRoot, 'InputBridgeRuntime', 'InputBridge.exe'),
    args: [],
    options: {
      cwd: projectRoot,
      windowsHide: true
    }
  };
}

function createProcessService(options = {}) {
  const spawn = options.spawn || childProcess.spawn;
  const logs = [];
  let inputBridgeProcess = null;
  let streamProcess = null;

  function appendLog(prefix, chunk) {
    const lines = String(chunk).split(/\r?\n/);

    for (const line of lines) {
      const text = line.trim();
      if (!text) {
        continue;
      }

      logs.push(`${prefix} ${text}`);
      if (logs.length > MAX_LOG_LINES) {
        logs.splice(0, logs.length - MAX_LOG_LINES);
      }
    }
  }

  function attachProcess(child, prefix, onExit) {
    if (child.stdout && typeof child.stdout.on === 'function') {
      child.stdout.on('data', data => appendLog(prefix, data));
    }

    if (child.stderr && typeof child.stderr.on === 'function') {
      child.stderr.on('data', data => appendLog(prefix, data));
    }

    child.on('exit', onExit);
  }

  function startInputBridge(args) {
    if (inputBridgeProcess) {
      return { alreadyRunning: true };
    }

    const command = buildInputBridgeCommand(args);
    const child = spawn(command.command, command.args, command.options);
    inputBridgeProcess = child;
    attachProcess(child, '[输入桥]', () => {
      if (inputBridgeProcess === child) {
        inputBridgeProcess = null;
      }
    });

    return { alreadyRunning: false };
  }

  function stopInputBridge() {
    if (!inputBridgeProcess) {
      return { stopped: false };
    }

    const child = inputBridgeProcess;
    inputBridgeProcess = null;
    child.kill();

    return { stopped: true };
  }

  function startStream(args) {
    if (streamProcess) {
      throw new Error('发送端已经在运行');
    }

    const command = buildRtpCommand(args);
    const child = spawn(command.command, command.args, command.options);
    streamProcess = child;
    attachProcess(child, '[发送端]', () => {
      if (streamProcess === child) {
        streamProcess = null;
      }
    });

    return { started: true };
  }

  function stopStream() {
    if (!streamProcess) {
      return { stopped: false };
    }

    const child = streamProcess;
    streamProcess = null;
    child.kill();

    return { stopped: true };
  }

  function status() {
    return {
      streamRunning: Boolean(streamProcess),
      inputBridgeRunning: Boolean(inputBridgeProcess),
      logs: logs.slice(-MAX_LOG_LINES)
    };
  }

  return {
    startInputBridge,
    stopInputBridge,
    startStream,
    stopStream,
    status
  };
}

module.exports = {
  buildRtpCommand,
  buildInputBridgeCommand,
  createProcessService
};
