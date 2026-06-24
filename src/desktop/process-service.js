'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');
const { StringDecoder } = require('node:string_decoder');

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
    command: 'npm.cmd',
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

  function appendLogLine(prefix, line) {
    const text = line.trim();
    if (!text) {
      return;
    }

    logs.push(`${prefix} ${text}`);
    if (logs.length > MAX_LOG_LINES) {
      logs.splice(0, logs.length - MAX_LOG_LINES);
    }
  }

  function createLogSink(prefix) {
    const decoder = new StringDecoder('utf8');
    let pending = '';

    function appendText(text) {
      pending += text;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop();

      for (const line of lines) {
        appendLogLine(prefix, line);
      }
    }

    function write(chunk) {
      if (typeof chunk === 'string') {
        appendText(chunk);
        return;
      }

      appendText(decoder.write(chunk));
    }

    function flush() {
      appendText(decoder.end());
      appendLogLine(prefix, pending);
      pending = '';
    }

    return { write, flush };
  }

  function attachProcess(child, prefix, onExit) {
    const sinks = [];
    let finalized = false;

    if (child.stdout && typeof child.stdout.on === 'function') {
      const stdoutSink = createLogSink(prefix);
      sinks.push(stdoutSink);
      child.stdout.on('data', data => stdoutSink.write(data));
    }

    if (child.stderr && typeof child.stderr.on === 'function') {
      const stderrSink = createLogSink(prefix);
      sinks.push(stderrSink);
      child.stderr.on('data', data => stderrSink.write(data));
    }

    function flushSinks() {
      for (const sink of sinks) {
        sink.flush();
      }
    }

    function finalize() {
      if (finalized) {
        return;
      }

      finalized = true;
      flushSinks();
      onExit();
    }

    child.on('close', () => {
      finalize();
    });

    child.on('error', error => {
      if (finalized) {
        return;
      }

      finalized = true;
      flushSinks();
      appendLogLine(prefix, `启动失败：${error && error.message ? error.message : String(error)}`);
      onExit();
    });
  }

  function startInputBridge(args) {
    if (inputBridgeProcess) {
      return { alreadyRunning: true };
    }

    const command = buildInputBridgeCommand(args);
    let child;
    try {
      child = spawn(command.command, command.args, command.options);
    } catch (error) {
      appendLogLine('[输入桥]', `启动失败：${error && error.message ? error.message : String(error)}`);
      return { alreadyRunning: false, started: false };
    }

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
    try {
      if (!child.kill()) {
        appendLogLine('[输入桥]', '停止请求失败');
        return { stopped: false };
      }
    } catch (error) {
      appendLogLine('[输入桥]', `停止失败：${error && error.message ? error.message : String(error)}`);
      return { stopped: false };
    }

    return { stopped: true };
  }

  function startStream(args) {
    if (streamProcess) {
      throw new Error('发送端已经在运行');
    }

    const command = buildRtpCommand(args);
    let child;
    try {
      child = spawn(command.command, command.args, command.options);
    } catch (error) {
      appendLogLine('[发送端]', `启动失败：${error && error.message ? error.message : String(error)}`);
      throw error;
    }

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
    try {
      if (!child.kill()) {
        appendLogLine('[发送端]', '停止请求失败');
        return { stopped: false };
      }
    } catch (error) {
      appendLogLine('[发送端]', `停止失败：${error && error.message ? error.message : String(error)}`);
      return { stopped: false };
    }

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
