'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  buildRtpCommand,
  buildInputBridgeCommand,
  createProcessService
} = require('../src/desktop/process-service');

function createFakeChild(options = {}) {
  const child = new EventEmitter();
  if (options.stdout !== false) {
    child.stdout = new EventEmitter();
  }
  if (options.stderr !== false) {
    child.stderr = new EventEmitter();
  }
  child.killed = false;
  child.killCalls = 0;
  child.kill = () => {
    child.killCalls += 1;
    if (options.killError) {
      throw options.killError;
    }

    if (options.killResult === false) {
      return false;
    }

    child.killed = true;
    return true;
  };
  return child;
}

function createSpawnHarness(harnessOptions = {}) {
  const children = [];
  const calls = [];
  const spawn = (command, args, options) => {
    if (harnessOptions.throwOnCall === children.length + 1) {
      throw harnessOptions.throwError || new Error('spawn failed');
    }

    const childOptions = Array.isArray(harnessOptions.children) ? harnessOptions.children[children.length] : undefined;
    const child = createFakeChild(childOptions);
    children.push(child);
    calls.push({ command, args, options, child });
    return child;
  };

  return { spawn, children, calls };
}

test('RTP command includes host, encoder, profile and performance protection', () => {
  const command = buildRtpCommand({
    projectRoot: 'D:/project',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'hevc1080p30' },
    performanceProtection: true
  });

  assert.equal(command.command, 'npm.cmd');
  assert.deepEqual(command.args, [
    'run',
    'native:rtp',
    '--',
    '--host',
    '192.168.1.23',
    '--encoder',
    'auto',
    '--encoder-preset',
    'auto',
    '--profile',
    'hevc1080p30',
    '--process-priority',
    'high'
  ]);
  assert.equal(command.options.cwd, 'D:/project');
  assert.equal(command.options.windowsHide, true);
});

test('RTP command requires television IP and quality profile with Chinese errors', () => {
  assert.throws(
    () => buildRtpCommand({ projectRoot: 'D:/project', device: {}, quality: { profile: 'h264720p30' } }),
    /缺少电视 IP/
  );

  assert.throws(
    () => buildRtpCommand({ projectRoot: 'D:/project', device: { ip: '192.168.1.23' }, quality: {} }),
    /缺少画质档位/
  );
});

test('InputBridge command uses explicit runtime path or project default', () => {
  const explicit = buildInputBridgeCommand({
    projectRoot: 'D:/project',
    inputBridgeRuntimePath: 'D:/tools/InputBridge.exe'
  });

  assert.equal(explicit.command, 'D:/tools/InputBridge.exe');
  assert.deepEqual(explicit.args, []);
  assert.equal(explicit.options.cwd, 'D:/project');
  assert.equal(explicit.options.windowsHide, true);

  const fallback = buildInputBridgeCommand({ projectRoot: 'D:/project' });
  assert.equal(fallback.command, path.join('D:/project', 'InputBridgeRuntime', 'InputBridge.exe'));
  assert.deepEqual(fallback.args, []);
  assert.equal(fallback.options.cwd, 'D:/project');
  assert.equal(fallback.options.windowsHide, true);
});

test('process service starts processes, handles duplicate starts, logs output and restores state on close', () => {
  const harness = createSpawnHarness();
  const service = createProcessService({ spawn: harness.spawn });

  assert.deepEqual(service.startInputBridge({ projectRoot: 'D:/project' }), { alreadyRunning: false });
  assert.deepEqual(service.startInputBridge({ projectRoot: 'D:/project' }), { alreadyRunning: true });
  assert.deepEqual(service.startStream({
    projectRoot: 'D:/project',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'h2641080p60' },
    performanceProtection: false
  }), { started: true });

  assert.throws(() => service.startStream({
    projectRoot: 'D:/project',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'h2641080p60' }
  }), /发送端已经在运行/);

  harness.children[0].stdout.emit('data', Buffer.from('输入桥已启动\n\n'));
  harness.children[1].stderr.emit('data', Buffer.from('发送端警告\r\n'));

  assert.deepEqual(service.status(), {
    streamRunning: true,
    inputBridgeRunning: true,
    logs: ['[输入桥] 输入桥已启动', '[发送端] 发送端警告']
  });

  harness.children[0].emit('close', 0);
  harness.children[1].emit('close', 0);

  assert.equal(service.status().inputBridgeRunning, false);
  assert.equal(service.status().streamRunning, false);
});

test('process service stop methods kill running processes and report idle stops', () => {
  const harness = createSpawnHarness();
  const service = createProcessService({ spawn: harness.spawn });

  assert.deepEqual(service.stopInputBridge(), { stopped: false });
  assert.deepEqual(service.stopStream(), { stopped: false });

  service.startInputBridge({ projectRoot: 'D:/project' });
  service.startStream({
    projectRoot: 'D:/project',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'h264720p30' }
  });

  assert.deepEqual(service.stopInputBridge(), { stopped: true });
  assert.deepEqual(service.stopStream(), { stopped: true });
  assert.equal(harness.children[0].killCalls, 1);
  assert.equal(harness.children[1].killCalls, 1);
  assert.equal(service.status().inputBridgeRunning, true);
  assert.equal(service.status().streamRunning, true);
  assert.deepEqual(service.startInputBridge({ projectRoot: 'D:/project' }), { alreadyRunning: true });
  assert.throws(() => service.startStream({
    projectRoot: 'D:/project',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'h264720p30' }
  }), /发送端已经在运行/);

  harness.children[0].emit('close', 0);
  harness.children[1].emit('close', 0);

  assert.equal(service.status().inputBridgeRunning, false);
  assert.equal(service.status().streamRunning, false);
});

test('process service handles synchronous spawn failures without stale running state', () => {
  const inputHarness = createSpawnHarness({ throwOnCall: 1, throwError: new Error('cwd missing') });
  const inputService = createProcessService({ spawn: inputHarness.spawn });

  assert.deepEqual(inputService.startInputBridge({ projectRoot: 'D:/missing' }), {
    alreadyRunning: false,
    started: false
  });
  assert.deepEqual(inputService.status(), {
    streamRunning: false,
    inputBridgeRunning: false,
    logs: ['[输入桥] 启动失败：cwd missing']
  });

  const streamHarness = createSpawnHarness({ throwOnCall: 1, throwError: new Error('bad cwd') });
  const streamService = createProcessService({ spawn: streamHarness.spawn });

  assert.deepEqual(streamService.startStream({
    projectRoot: 'D:/missing',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'h264720p30' }
  }), { started: false });
  assert.deepEqual(streamService.status(), {
    streamRunning: false,
    inputBridgeRunning: false,
    logs: ['[发送端] 启动失败：bad cwd']
  });
});

test('process service logs child errors and restores running state', () => {
  const harness = createSpawnHarness();
  const service = createProcessService({ spawn: harness.spawn });

  service.startInputBridge({ projectRoot: 'D:/project' });
  service.startStream({
    projectRoot: 'D:/project',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'h264720p30' }
  });

  harness.children[0].emit('error', new Error('bridge missing'));
  harness.children[1].emit('error', new Error('rtp failed'));

  assert.deepEqual(service.status(), {
    streamRunning: false,
    inputBridgeRunning: false,
    logs: ['[输入桥] 启动失败：bridge missing', '[发送端] 启动失败：rtp failed']
  });
});

test('process service decodes split UTF-8 chunks without corrupting Chinese logs', () => {
  const harness = createSpawnHarness();
  const service = createProcessService({ spawn: harness.spawn });

  service.startInputBridge({ projectRoot: 'D:/project' });

  const message = Buffer.from('输入桥已启动\n');
  harness.children[0].stdout.emit('data', message.subarray(0, 5));
  harness.children[0].stdout.emit('data', message.subarray(5));

  assert.deepEqual(service.status().logs, ['[输入桥] 输入桥已启动']);
});

test('process service keeps running state when kill returns false', () => {
  const harness = createSpawnHarness({ children: [{ killResult: false }] });
  const service = createProcessService({ spawn: harness.spawn });

  service.startInputBridge({ projectRoot: 'D:/project' });

  assert.deepEqual(service.stopInputBridge(), { stopped: false });
  assert.equal(service.status().inputBridgeRunning, true);
  assert.deepEqual(service.status().logs, ['[输入桥] 停止请求失败']);
});

test('process service keeps running state when kill throws', () => {
  const harness = createSpawnHarness({ children: [{}, { killError: new Error('access denied') }] });
  const service = createProcessService({ spawn: harness.spawn });

  service.startInputBridge({ projectRoot: 'D:/project' });
  service.startStream({
    projectRoot: 'D:/project',
    device: { ip: '192.168.1.23' },
    quality: { profile: 'h264720p30' }
  });

  assert.deepEqual(service.stopStream(), { stopped: false });
  assert.equal(service.status().streamRunning, true);
  assert.deepEqual(service.status().logs, ['[发送端] 停止失败：access denied']);
});

test('process service does not crash when child streams are missing', () => {
  const harness = createSpawnHarness({ children: [{ stdout: false, stderr: false }] });
  const service = createProcessService({ spawn: harness.spawn });

  assert.deepEqual(service.startInputBridge({ projectRoot: 'D:/project' }), { alreadyRunning: false });
  harness.children[0].emit('close', 0);

  assert.equal(service.status().inputBridgeRunning, false);
});

test('process service flushes final logs on close after exit', () => {
  const harness = createSpawnHarness();
  const service = createProcessService({ spawn: harness.spawn });

  service.startInputBridge({ projectRoot: 'D:/project' });

  harness.children[0].stdout.emit('data', Buffer.from('输入桥已'));
  harness.children[0].emit('exit', 0);
  assert.equal(service.status().inputBridgeRunning, true);
  assert.deepEqual(service.status().logs, []);

  harness.children[0].stdout.emit('data', Buffer.from('启动'));
  harness.children[0].emit('close', 0);

  assert.equal(service.status().inputBridgeRunning, false);
  assert.deepEqual(service.status().logs, ['[输入桥] 输入桥已启动']);
});

test('process service keeps only the last 300 log lines', () => {
  const harness = createSpawnHarness();
  const service = createProcessService({ spawn: harness.spawn });

  service.startInputBridge({ projectRoot: 'D:/project' });

  for (let index = 1; index <= 305; index += 1) {
    harness.children[0].stdout.emit('data', `第 ${index} 行\n`);
  }

  const logs = service.status().logs;
  assert.equal(logs.length, 300);
  assert.equal(logs[0], '[输入桥] 第 6 行');
  assert.equal(logs[299], '[输入桥] 第 305 行');
});

test('desktop process service production text does not contain mojibake fragments', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'desktop', 'process-service.js'), 'utf8');

  for (const fragment of ['缂', '鍙', '杈', '妗', '姝', '鎵', '涓', '鐢', '閫', '绗']) {
    assert.doesNotMatch(source, new RegExp(fragment));
  }

  for (const fragment of ['缺少电视 IP', '输入桥', '发送端已经在运行']) {
    assert.match(source, new RegExp(fragment));
  }
});
