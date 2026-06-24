'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');

const projectRoot = path.join(__dirname, '..');

function readProjectFile(...segments) {
  return fs.readFileSync(path.join(projectRoot, ...segments), 'utf8');
}

function assertNoMojibake(source, label) {
  for (const fragment of ['�', '锛', '鐢', '杈', '鍙', '绔', '妗', '缂', '鏃']) {
    assert.doesNotMatch(source, new RegExp(fragment), `${label} contains mojibake fragment ${fragment}`);
  }
}

function createFakeIpcMain() {
  const handlers = new Map();

  return {
    handlers,
    handle(channel, handler) {
      handlers.set(channel, handler);
    }
  };
}

function createFakeServices(overrides = {}) {
  const calls = [];
  const process = {
    startInputBridge(args) {
      calls.push(['startInputBridge', args]);
      return { alreadyRunning: false };
    },
    startStream(args) {
      calls.push(['startStream', args]);
      return { started: true };
    },
    stopInputBridge() {
      calls.push(['stopInputBridge']);
      return { stopped: true };
    },
    stopStream() {
      calls.push(['stopStream']);
      return { stopped: true };
    },
    status() {
      calls.push(['status']);
      return { streamRunning: false, inputBridgeRunning: false, logs: [] };
    },
    ...overrides.process
  };

  return {
    calls,
    projectRoot: 'D:/project',
    inputBridgeRuntimePath: 'D:/project/InputBridgeRuntime/InputBridge.exe',
    config: {
      load: () => ({}),
      save: payload => payload
    },
    environment: {
      check: () => ({}),
      repair: () => ({})
    },
    discovery: {
      list: () => [],
      stop() {
        calls.push(['discovery.stop']);
      }
    },
    process,
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'process'))
  };
}

function requireMainWithElectronMock(electronMock) {
  const mainPath = path.join(projectRoot, 'src', 'desktop', 'main.js');
  const originalLoad = Module._load;

  delete require.cache[require.resolve(mainPath)];
  Module._load = function load(request, parent, isMain) {
    if (request === 'electron') {
      return electronMock;
    }

    return originalLoad.call(this, request, parent, isMain);
  };

  try {
    return require(mainPath);
  } finally {
    Module._load = originalLoad;
  }
}

test('package exposes Electron desktop scripts', () => {
  const packageJson = JSON.parse(readProjectFile('package.json'));

  assert.equal(packageJson.scripts.desktop, 'electron src/desktop/main.js');
  assert.equal(
    packageJson.scripts['desktop:package'],
    'electron-builder --config src/desktop/electron-builder.json'
  );
});

test('preload exposes only the safe TVGame API through contextBridge', () => {
  const source = readProjectFile('src', 'desktop', 'preload.js');
  const apiNames = [
    'loadConfig',
    'saveConfig',
    'checkEnvironment',
    'repairEnvironment',
    'listDevices',
    'startStream',
    'stopStream',
    'getStatus'
  ];

  assert.match(source, /require\(['"]electron['"]\)/);
  assert.match(source, /contextBridge\.exposeInMainWorld\(['"]tvgame['"]/);
  assert.doesNotMatch(source, /exposeInMainWorld\(['"](?!tvgame['"])/);

  for (const apiName of apiNames) {
    assert.match(source, new RegExp(`${apiName}\\s*:`), `missing ${apiName}`);
  }

  assert.match(source, /ipcRenderer\.invoke\(['"]config:load['"]\)/);
  assert.match(source, /ipcRenderer\.invoke\(['"]config:save['"]\s*,\s*payload\)/);
  assert.match(source, /ipcRenderer\.invoke\(['"]environment:check['"]\)/);
  assert.match(source, /ipcRenderer\.invoke\(['"]environment:repair['"]\)/);
  assert.match(source, /ipcRenderer\.invoke\(['"]devices:list['"]\)/);
  assert.match(source, /ipcRenderer\.invoke\(['"]stream:start['"]\s*,\s*payload\)/);
  assert.match(source, /ipcRenderer\.invoke\(['"]stream:stop['"]\)/);
  assert.match(source, /ipcRenderer\.invoke\(['"]stream:status['"]\)/);
  assertNoMojibake(source, 'preload.js');
});

test('IPC handlers register the desktop channels and delegate to services', () => {
  const source = readProjectFile('src', 'desktop', 'ipc-handlers.js');
  const channels = [
    'config:load',
    'config:save',
    'environment:check',
    'environment:repair',
    'devices:list',
    'stream:start',
    'stream:stop',
    'stream:status'
  ];

  for (const channel of channels) {
    assert.match(source, new RegExp(`\\.handle\\(['"]${channel}['"]`), `missing ${channel}`);
  }

  assert.match(source, /services\.config\.load\(\)/);
  assert.match(source, /services\.config\.save\(payload\)/);
  assert.match(source, /services\.environment\.check\(\)/);
  assert.match(source, /services\.environment\.repair\(services\.projectRoot\)/);
  assert.match(source, /services\.discovery\.list\(\)/);
  assert.match(source, /services\.process\.startInputBridge\(\{\s*projectRoot:\s*services\.projectRoot,\s*inputBridgeRuntimePath:\s*services\.inputBridgeRuntimePath\s*\}\)/s);
  assert.match(source, /services\.process\.startStream\(\{\s*projectRoot:\s*services\.projectRoot,\s*device:\s*payload\.device,\s*quality:\s*payload\.quality,\s*performanceProtection:\s*payload\.performanceProtection\s*\}\)/s);
  assert.match(source, /services\.process\.stopStream\(\)/);
  assert.match(source, /services\.process\.status\(\)/);
  assert.match(source, /module\.exports\s*=\s*\{\s*registerIpcHandlers\s*\}/);
  assertNoMojibake(source, 'ipc-handlers.js');
});

test('stream:start rejects malformed payload before starting input bridge', () => {
  const { registerIpcHandlers } = require('../src/desktop/ipc-handlers');
  const ipcMain = createFakeIpcMain();
  const services = createFakeServices();

  registerIpcHandlers(ipcMain, services);

  assert.throws(() => ipcMain.handlers.get('stream:start')({}, null), /缺少电视 IP/);
  assert.deepEqual(services.calls, []);
});

test('stream:start rolls back input bridge when stream start throws', () => {
  const { registerIpcHandlers } = require('../src/desktop/ipc-handlers');
  const ipcMain = createFakeIpcMain();
  const services = createFakeServices({
    process: {
      startStream(args) {
        services.calls.push(['startStream', args]);
        throw new Error('stream failed');
      }
    }
  });

  registerIpcHandlers(ipcMain, services);

  assert.throws(
    () => ipcMain.handlers.get('stream:start')({}, {
      device: { ip: '192.168.1.23' },
      quality: { profile: 'h264720p30' },
      performanceProtection: true
    }),
    /stream failed/
  );
  assert.deepEqual(services.calls.map(call => call[0]), [
    'startInputBridge',
    'startStream',
    'stopInputBridge'
  ]);
});

test('stream:start rolls back input bridge when stream start reports failure', () => {
  const { registerIpcHandlers } = require('../src/desktop/ipc-handlers');
  const ipcMain = createFakeIpcMain();
  const services = createFakeServices({
    process: {
      startStream(args) {
        services.calls.push(['startStream', args]);
        return { started: false };
      }
    }
  });

  registerIpcHandlers(ipcMain, services);

  assert.deepEqual(
    ipcMain.handlers.get('stream:start')({}, {
      device: { ip: '192.168.1.23' },
      quality: { profile: 'h264720p30' },
      performanceProtection: true
    }),
    { started: false }
  );
  assert.deepEqual(services.calls.map(call => call[0]), [
    'startInputBridge',
    'startStream',
    'stopInputBridge'
  ]);
});

test('stream:stop stops stream and input bridge together', () => {
  const { registerIpcHandlers } = require('../src/desktop/ipc-handlers');
  const ipcMain = createFakeIpcMain();
  const services = createFakeServices();

  registerIpcHandlers(ipcMain, services);

  assert.deepEqual(ipcMain.handlers.get('stream:stop')(), {
    stream: { stopped: true },
    inputBridge: { stopped: true }
  });
  assert.deepEqual(services.calls.map(call => call[0]), ['stopStream', 'stopInputBridge']);
});

test('main creates the Electron window with secure webPreferences and starts discovery', () => {
  const source = readProjectFile('src', 'desktop', 'main.js');

  assert.match(source, /new BrowserWindow\(/);
  assert.match(source, /width:\s*1120/);
  assert.match(source, /height:\s*760/);
  assert.match(source, /minWidth:\s*960/);
  assert.match(source, /minHeight:\s*640/);
  assert.match(source, /title:\s*['"]TVGame 发送端['"]/);
  assert.match(source, /preload:\s*path\.join\(__dirname,\s*['"]preload\.js['"]\)/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /createDeviceDiscovery\(/);
  assert.match(source, /services\.discovery\.start\(\)/);
  assert.match(source, /loadFile\(path\.join\(__dirname,\s*['"]renderer['"],\s*['"]index\.html['"]\)\)/);
  assert.match(source, /app\.on\(['"]window-all-closed['"]/);
  assert.match(source, /app\.quit\(\)/);
  assertNoMojibake(source, 'main.js');

  const titleCodepoints = Array.from('TVGame 发送端').map(char => char.codePointAt(0).toString(16));
  assert.deepEqual(titleCodepoints, ['54', '56', '47', '61', '6d', '65', '20', '53d1', '9001', '7aef']);
});

test('main cleanup stops stream, input bridge and discovery', () => {
  const main = requireMainWithElectronMock({
    app: {},
    BrowserWindow: function BrowserWindow() {},
    ipcMain: {}
  });
  const services = createFakeServices();

  main.cleanupServices(services);

  assert.deepEqual(services.calls.map(call => call[0]), [
    'stopStream',
    'stopInputBridge',
    'discovery.stop'
  ]);
});
