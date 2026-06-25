'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');

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

function assertRendererNoMojibake(source, label) {
  const commonFragments = [
    '\uFFFD',
    '\u951F',
    '\u95BF',
    '\u95AB',
    '\u93C9',
    '\u95B8',
    '\u7F01',
    '\u6FE1',
    '\u7F02',
    '\u95BA',
    '鍙',
    '佺',
    ''
  ];

  for (const fragment of commonFragments) {
    assert.doesNotMatch(source, new RegExp(fragment), `${label} contains mojibake fragment ${fragment}`);
  }
}

function runRendererProbe(probeSource) {
  const source = readProjectFile('src', 'desktop', 'renderer', 'app.js');
  const context = {
    window: {
      setInterval() {}
    },
    document: {
      addEventListener() {}
    }
  };

  vm.runInNewContext(`${source}\n;${probeSource}`, context);
  return context.window.__probeResult;
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
    nodeRuntimePath: 'D:/TVGame/TVGame Sender.exe',
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
    packageJson.scripts['desktop:runtime'],
    'dotnet publish InputBridge/InputBridge.csproj -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o InputBridgeRuntime'
  );
  assert.equal(
    packageJson.scripts['desktop:package'],
    'npm run desktop:runtime && electron-builder --config src/desktop/electron-builder.json'
  );
});

test('Electron builder config creates a small portable Windows sender package', () => {
  const builderConfig = JSON.parse(readProjectFile('src', 'desktop', 'electron-builder.json'));

  assert.equal(builderConfig.appId, 'com.tvgame.sender');
  assert.equal(builderConfig.productName, 'TVGame Sender');
  assert.equal(builderConfig.directories.output, 'dist-desktop');
  assert.equal(builderConfig.asar, false);
  assert.deepEqual(builderConfig.win.target, ['portable']);
  assert.equal(builderConfig.electronDownload.mirrorOptions.mirror, 'https://npmmirror.com/mirrors/electron/');

  for (const required of ['package.json', 'src/**', 'scripts/**', 'InputBridgeRuntime/**', 'InputBridge/**', 'docs/**']) {
    assert.ok(builderConfig.files.includes(required), `missing builder file include ${required}`);
  }

  for (const excluded of [
    '!node_modules/**',
    '!dist/**',
    '!dist-desktop/**',
    '!build/**',
    '!InputBridge/bin/**',
    '!InputBridge/obj/**'
  ]) {
    assert.ok(builderConfig.files.includes(excluded), `missing builder file exclude ${excluded}`);
  }
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
  assert.match(source, /services\.process\.startStream\(\{\s*projectRoot:\s*services\.projectRoot,\s*nodeRuntimePath:\s*services\.nodeRuntimePath,\s*device:\s*payload\.device,\s*quality:\s*payload\.quality,\s*performanceProtection:\s*payload\.performanceProtection\s*\}\)/s);
  assert.match(source, /services\.process\.stopStream\(\)/);
  assert.match(source, /services\.process\.status\(\)/);
  assert.match(source, /module\.exports\s*=\s*\{\s*registerIpcHandlers\s*\}/);
  assertNoMojibake(source, 'ipc-handlers.js');
});

test('renderer files exist and expose the Chinese sender UI shell', () => {
  const files = ['index.html', 'styles.css', 'app.js'];

  for (const file of files) {
    assert.ok(
      fs.existsSync(path.join(projectRoot, 'src', 'desktop', 'renderer', file)),
      `missing renderer ${file}`
    );
  }

  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const requiredChineseText = [
    'TVGame 发送端',
    '日常主屏',
    '首次配置',
    '电视设备',
    '画质档位',
    '环境诊断',
    '日志',
    '自动搜索电视',
    '手动输入 IP',
    '开始串流',
    '停止串流',
    '检查并修复环境'
  ];

  for (const text of requiredChineseText) {
    assert.match(html, new RegExp(text), `missing Chinese UI text: ${text}`);
  }

  const senderCodepoints = Array.from('发送端').map(char => char.codePointAt(0).toString(16));
  assert.deepEqual(senderCodepoints, ['53d1', '9001', '7aef']);
});

test('renderer script defines only the supported quality presets and uses the TVGame bridge API', () => {
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');
  const presetIds = [
    'h264720p30',
    'h264720p60',
    'h2641080p30',
    'h2641080p60',
    'hevc1080p30',
    'hevc1080p60'
  ];
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

  for (const presetId of presetIds) {
    assert.match(appJs, new RegExp(`['"]${presetId}['"]`), `missing preset ${presetId}`);
  }

  for (const apiName of apiNames) {
    assert.match(appJs, new RegExp(`window\\.tvgame\\.${apiName}\\(`), `missing window.tvgame.${apiName}`);
  }

  assert.match(appJs, /selectedQuality/);
  assert.match(appJs, /performanceProtection/);
  assert.match(appJs, /firstRunComplete/);
});

test('renderer main screen uses TVGame brand tokens instead of a generic purple blue theme', () => {
  const styles = readProjectFile('src', 'desktop', 'renderer', 'styles.css');

  assert.match(styles, /--ink-950:\s*#0b1114/i);
  assert.match(styles, /--brand-signal:\s*#18a058/i);
  assert.match(styles, /--brand-amber:\s*#d99a26/i);
  assert.match(styles, /--font-ui:\s*"Microsoft YaHei UI"/);
  assert.doesNotMatch(styles, /#1769aa|#0f578e|#4338ca|#4f46e5|#6366f1|#7c3aed/i);
});

test('renderer shell uses unified vector icons and no emoji functional icons', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const combined = [
    html,
    readProjectFile('src', 'desktop', 'renderer', 'app.js')
  ].join('\n');

  assert.match(html, /<svg[^>]+class="brand-glyph"/);
  assert.match(html, /class="icon icon-home"/);
  assert.match(html, /class="icon icon-device"/);
  assert.doesNotMatch(html, /class="brand-mark">TV<\/span>/);
  assert.doesNotMatch(combined, /[\u{1F300}-\u{1FAFF}]/u);
});

test('renderer home screen presents the approved guided streaming workflow', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');

  for (const text of ['设备连接', '画质选择', '性能保护', '启动串流', '串流准备']) {
    assert.match(html, new RegExp(text), `missing workflow label ${text}`);
  }

  assert.match(html, /class="workflow-panel"/);
  assert.match(html, /class="control-stage"/);
  assert.match(html, /class="quick-status-grid"/);
});

test('renderer supports clickable quality cards and busy start button feedback', () => {
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');

  assert.match(appJs, /function selectQuality\(/);
  assert.match(appJs, /function setBusyState\(/);
  assert.match(appJs, /data-quality-id/);
  assert.match(appJs, /aria-pressed/);
  assert.match(appJs, /quality-card/);
});

test('renderer avoids advanced custom streaming controls and mojibake', () => {
  const rendererSources = {
    'index.html': readProjectFile('src', 'desktop', 'renderer', 'index.html'),
    'styles.css': readProjectFile('src', 'desktop', 'renderer', 'styles.css'),
    'app.js': readProjectFile('src', 'desktop', 'renderer', 'app.js')
  };
  const combined = Object.values(rendererSources).join('\n');

  assert.doesNotMatch(combined, /GOP/i);
  assert.doesNotMatch(combined, /码率/);
  assert.doesNotMatch(combined, /自定义帧率/);
  assert.doesNotMatch(combined, /bitrate/i);
  assert.doesNotMatch(combined, /custom\s*frame\s*rate/i);

  for (const [label, source] of Object.entries(rendererSources)) {
    assertRendererNoMojibake(source, label);
    assert.match(source, /[\u4E00-\u9FFF]/, `${label} should contain real Chinese text or comments`);
  }
});

test('renderer maps real environment cards state into diagnostics', () => {
  const diagnostics = runRendererProbe(`
    state.environment = normalizeEnvironment({
      ready: false,
      raw: {},
      cards: {
        gstreamer: {
          state: 'ok',
          title: 'GStreamer',
          message: '已安装',
          detail: 'gst-launch 可用'
        },
        encoder: {
          state: 'warning',
          title: '编码器',
          message: 'HEVC 不可用',
          detail: '将使用 H.264'
        }
      }
    });
    window.__probeResult = {
      gstreamer: resolveDiagnostic({ key: 'gstreamer', label: 'GStreamer' }),
      encoder: resolveDiagnostic({ key: 'encoder', label: '编码器' })
    };
  `);

  assert.equal(diagnostics.gstreamer.ok, true);
  assert.equal(diagnostics.gstreamer.message, '已安装');
  assert.equal(diagnostics.gstreamer.detail, 'gst-launch 可用');
  assert.equal(diagnostics.gstreamer.state, 'ok');
  assert.equal(diagnostics.encoder.ok, false);
  assert.equal(diagnostics.encoder.message, 'HEVC 不可用');
  assert.equal(diagnostics.encoder.detail, '将使用 H.264');
  assert.equal(diagnostics.encoder.state, 'warning');
});

test('renderer escapes untrusted device discovery fields before using innerHTML', () => {
  const rendered = runRendererProbe(`
    const select = { innerHTML: '', value: '' };
    const list = { innerHTML: '', textContent: '' };
    elements.deviceSelect = select;
    elements.deviceList = list;
    state.selectedDevice = '';
    state.devices = [{
      id: 'evil-device',
      name: '<img src=x onerror=alert(1)>',
      model: '<script>alert(2)</script>',
      ip: '192.168.1.5"><script>alert(3)</script>'
    }];
    renderDevices();
    window.__probeResult = {
      select: select.innerHTML,
      list: list.innerHTML
    };
  `);

  assert.doesNotMatch(rendered.select, /<img/i);
  assert.doesNotMatch(rendered.select, /<script/i);
  assert.doesNotMatch(rendered.list, /<img/i);
  assert.doesNotMatch(rendered.list, /<script/i);
  assert.match(rendered.select, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(rendered.list, /&lt;script&gt;alert\(2\)&lt;\/script&gt;/);
  assert.match(rendered.list, /192\.168\.1\.5&quot;&gt;&lt;script&gt;alert\(3\)&lt;\/script&gt;/);
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
  assert.match(source, /setMenuBarVisibility\(false\)/);
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

test('main resolves project root and InputBridge runtime in dev and packaged layouts', () => {
  const main = requireMainWithElectronMock({
    app: {},
    BrowserWindow: function BrowserWindow() {},
    ipcMain: {}
  });

  assert.equal(
    main.resolveProjectRoot('D:/repo/src/desktop'),
    path.normalize('D:/repo')
  );
  assert.equal(
    main.resolveProjectRoot('D:/TVGame/resources/app/src/desktop'),
    path.normalize('D:/TVGame/resources/app')
  );
  assert.equal(
    main.resolveProjectRoot('D:/TVGame/resources/app.asar/src/desktop'),
    path.normalize('D:/TVGame/resources/app')
  );

  const services = main.createServices({
    getPath() {
      return 'D:/user-data';
    }
  }, {
    desktopDir: 'D:/TVGame/resources/app/src/desktop'
  });

  assert.equal(services.projectRoot, path.normalize('D:/TVGame/resources/app'));
  assert.equal(services.nodeRuntimePath, process.execPath);
  assert.equal(
    services.inputBridgeRuntimePath,
    path.normalize('D:/TVGame/resources/app/InputBridgeRuntime/InputBridge.exe')
  );
});
