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
      check: () => ({
        cards: {
          gstreamer: { state: 'ok' },
          encoder: { state: 'ok' },
          inputBridge: { state: 'ok' },
          gamepadDriver: { state: 'ok' }
        }
      }),
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
    'onRepairProgress',
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
  assert.match(source, /ipcRenderer\.on\(['"]environment:repair-progress['"]/);
  assert.match(source, /ipcRenderer\.removeListener\(['"]environment:repair-progress['"]/);
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
  assert.match(source, /services\.environment\.repair\(services\.projectRoot/);
  assert.match(source, /environment:repair-progress/);
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
    '检查运行环境'
  ];

  for (const text of requiredChineseText) {
    assert.match(html, new RegExp(text), `missing Chinese UI text: ${text}`);
  }

  assert.match(html, /id="modeManual"\s+checked/);
  assert.doesNotMatch(html, /id="modeAuto"\s+checked/);

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
  assert.match(appJs, /deviceMode:\s*['"]manual['"]/);
  assert.match(appJs, /firstRunComplete/);
});

test('renderer starts quickly by deferring optional discovery and environment checks', () => {
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');

  assert.doesNotMatch(appJs, /Promise\.allSettled\(\[\s*refreshDevices\(\),\s*checkEnvironment\(\)/s);
  assert.match(appJs, /if\s*\(\s*state\.deviceMode\s*===\s*['"]auto['"]\s*\)\s*\{\s*refreshDevices\(\);/s);
  assert.match(appJs, /checkEnvironment\(\{\s*showBusy:\s*true,\s*showResult:\s*true\s*\}\)/s);
});

test('renderer main screen uses TVGame brand tokens instead of a generic purple blue theme', () => {
  const styles = readProjectFile('src', 'desktop', 'renderer', 'styles.css');

  assert.match(styles, /--bg:\s*#08100e/i);
  assert.match(styles, /--shell:\s*#0b1210/i);
  assert.match(styles, /--brand:\s*#1ac878/i);
  assert.match(styles, /--amber:\s*#efbf62/i);
  assert.match(styles, /font-family:\s*"Microsoft YaHei UI"/);
  assert.doesNotMatch(styles, /#1769aa|#0f578e|#4338ca|#4f46e5|#6366f1|#7c3aed/i);
});

test('renderer shell uses unified vector icons and no emoji functional icons', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const combined = [
    html,
    readProjectFile('src', 'desktop', 'renderer', 'app.js')
  ].join('\n');

  assert.match(html, /class="brand-mark"[\s\S]*<svg/);
  assert.match(html, /class="nav-item is-active"[\s\S]*aria-label="日常主屏"[\s\S]*<svg/);
  assert.match(html, /aria-label="电视设备"[\s\S]*<svg/);
  assert.doesNotMatch(html, /class="brand-mark">TV<\/span>/);
  assert.doesNotMatch(combined, /[\u{1F300}-\u{1FAFF}]/u);
});

test('renderer home screen presents the approved guided streaming workflow', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');

  for (const text of ['设备连接', '画质选择', '性能保护', '串流准备']) {
    assert.match(html, new RegExp(text), `missing workflow label ${text}`);
  }

  assert.match(html, /class="workflow-card"/);
  assert.match(html, /class="step-card"/);
  assert.doesNotMatch(html, /class="quick-status-panel"/);
  assert.doesNotMatch(html, /环境摘要/);
});

test('renderer home screen shows live streaming runtime information', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');

  for (const text of ['串流信息', '串流时长']) {
    assert.match(html, new RegExp(text), `missing runtime label ${text}`);
  }

  for (const id of ['streamRuntimeStatus', 'streamRuntimeText']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing runtime element ${id}`);
  }

  for (const id of ['homeHealthGrid', 'recentStatusText']) {
    assert.match(html, new RegExp(`id="${id}"`), `missing concept status element ${id}`);
  }

  for (const id of ['targetMetricText', 'gamepadMetricText', 'receiverSummaryText']) {
    assert.doesNotMatch(html, new RegExp(`id="${id}"`), `duplicated concept status element should be removed: ${id}`);
  }

  assert.doesNotMatch(html, /id="streamTargetText"/);
  assert.doesNotMatch(html, /id="streamQualityText"/);
  assert.doesNotMatch(html, /发送档位/);
  assert.match(appJs, /streamStartedAt/);
  assert.match(appJs, /function formatDuration\(/);
  assert.match(appJs, /function renderStreamRuntime\(/);
  assert.match(appJs, /function renderTargetSummary\(/);
  assert.match(appJs, /homeHealthGrid/);
});

test('renderer exposes repair progress and blocks stream start until every environment card is normal', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');
  const styles = readProjectFile('src', 'desktop', 'renderer', 'styles.css');

  assert.match(html, /id="homeRepairProgressPanel"/);
  assert.match(html, /id="homeRepairProgressSummary"/);
  assert.match(html, /id="homeRepairProgressPercent"/);
  assert.match(html, /id="homeRepairProgressBar"/);
  assert.match(html, /id="homeRepairCurrentStep"/);
  assert.match(html, /id="repairProgressPanel"/);
  assert.match(html, /id="repairProgressList"/);
  assert.match(html, /id="repairProgressSummary"/);
  assert.match(html, /id="repairProgressPercent"/);
  assert.match(html, /id="repairProgressBar"/);
  assert.match(html, /id="repairCurrentStep"/);
  assert.match(html, /环境处理进度/);
  assert.match(html, /修复进度/);
  assert.match(appJs, /function isEnvironmentFullyReady\(/);
  assert.match(appJs, /async function ensureEnvironmentReadyForStart\(/);
  assert.match(appJs, /await ensureEnvironmentReadyForStart\(\)/);
  assert.match(appJs, /window\.tvgame\.onRepairProgress/);
  assert.match(appJs, /handleRepairProgress/);
  assert.match(appJs, /await repairEnvironment\(/);
  assert.match(appJs, /function calculateRepairPercent\(/);
  assert.match(appJs, /function setRepairProgressPanel\(/);
  assert.match(appJs, /panel\.hidden = !visible/);
  assert.match(appJs, /barElement\.style\.width = `\$\{percent\}%`/);
  assert.match(styles, /\.repair-progress-panel--home/);
  assert.match(styles, /\.repair-progress-percent/);
  assert.match(styles, /\.repair-current-step/);
});

test('renderer home screen keeps the guided steps vertical and compact', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const styles = readProjectFile('src', 'desktop', 'renderer', 'styles.css');

  assert.doesNotMatch(html, /segment-option is-active/);
  assert.doesNotMatch(html, /stage-block stage-inline/);
  assert.doesNotMatch(html, /stage-block stage-action/);
  assert.doesNotMatch(html, /<span class="stage-index">4<\/span>/);
  assert.doesNotMatch(html, /<h4>启动串流<\/h4>/);
  assert.doesNotMatch(styles, /\.stage-block\.stage-inline/);
  assert.doesNotMatch(styles, /\.stage-block\.stage-action/);
  assert.doesNotMatch(styles, /\.control-stage\s*\{[^}]*grid-template-columns:\s*repeat\(2/s);
});

test('renderer navigation switches pages by data-page-panel', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');

  for (const page of ['home', 'setup', 'devices', 'quality', 'diagnostics', 'logs']) {
    assert.match(html, new RegExp(`data-page="${page}"`), `missing nav item ${page}`);
    assert.match(html, new RegExp(`data-page-panel="${page}"`), `missing page panel ${page}`);
  }

  assert.match(appJs, /PAGE_TITLES/);
  assert.match(appJs, /const nextPage = PAGE_TITLES\[pageName\] \? pageName : 'home'/);
  assert.match(appJs, /page\.dataset\.pagePanel === nextPage/);
  assert.doesNotMatch(appJs, /page\.id === `page-\$\{pageName\}`/);
});

test('renderer home screen places stream actions in the top right instead of duplicate status cards', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');

  assert.match(html, /<div class="topbar-actions">[\s\S]*id="startButton"[\s\S]*id="stopButton"[\s\S]*<\/div>\s*<\/header>/);
  assert.doesNotMatch(html, /class="topbar-meta"/);
  assert.doesNotMatch(html, /id="currentQualityText"/);
  assert.doesNotMatch(html, /id="streamStatusText"/);
  assert.doesNotMatch(appJs, /currentQualityText/);
  assert.doesNotMatch(appJs, /streamStatusText/);
});

test('renderer home quality choice is a compact dropdown without duplicate preset details', () => {
  const html = readProjectFile('src', 'desktop', 'renderer', 'index.html');
  const appJs = readProjectFile('src', 'desktop', 'renderer', 'app.js');

  assert.match(html, /id="qualityDropdown"/);
  assert.match(html, /id="qualityDropdownButton"[\s\S]*aria-haspopup="listbox"[\s\S]*aria-expanded="false"/);
  assert.match(html, /id="qualityMenu"[\s\S]*role="listbox"[\s\S]*hidden/);
  assert.match(html, /<select id="qualitySelect" aria-label="画质档位" tabindex="-1"><\/select>/);
  assert.match(html, /class="select-display-shell"[\s\S]*id="qualityDisplayLabel"[\s\S]*id="qualityMenu"/);
  assert.match(appJs, /function renderQualityMenu\(/);
  assert.match(appJs, /function toggleQualityDropdown\(/);
  assert.match(appJs, /role="option"/);
  assert.doesNotMatch(html, /id="selectedQualityDetails"/);
  assert.doesNotMatch(html, /class="selected-quality-details/);
  assert.doesNotMatch(html, /id="presetList"/);
  assert.doesNotMatch(appJs, /bindQualityList\(elements\.presetList\)/);
  assert.match(appJs, /function renderSelectedQualityDetails\(/);
});

test('renderer formats streaming runtime as stable clock text', () => {
  const durations = runRendererProbe(`
    window.__probeResult = {
      zero: formatDuration(0),
      minute: formatDuration(65000),
      hour: formatDuration(3661000)
    };
  `);

  assert.deepEqual(JSON.parse(JSON.stringify(durations)), {
    zero: '00:00:00',
    minute: '00:01:05',
    hour: '01:01:01'
  });
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
    if (label !== 'styles.css') {
      assert.match(source, /[\u4E00-\u9FFF]/, `${label} should contain real Chinese text or comments`);
    }
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

test('stream:start rejects malformed payload before starting input bridge', async () => {
  const { registerIpcHandlers } = require('../src/desktop/ipc-handlers');
  const ipcMain = createFakeIpcMain();
  const services = createFakeServices();

  registerIpcHandlers(ipcMain, services);

  await assert.rejects(() => ipcMain.handlers.get('stream:start')({}, null), /缺少电视 IP/);
  assert.deepEqual(services.calls, []);
});

test('stream:start refuses to launch when environment cards are not all normal', async () => {
  const { registerIpcHandlers } = require('../src/desktop/ipc-handlers');
  const ipcMain = createFakeIpcMain();
  const services = createFakeServices({
    environment: {
      check: () => ({
        cards: {
          gstreamer: { state: 'ok' },
          encoder: { state: 'warning' },
          inputBridge: { state: 'ok' },
          gamepadDriver: { state: 'ok' }
        }
      }),
      repair: () => ({})
    }
  });

  registerIpcHandlers(ipcMain, services);

  assert.deepEqual(
    await ipcMain.handlers.get('stream:start')({}, {
      device: { ip: '192.168.1.23' },
      quality: { profile: 'h264720p30' },
      performanceProtection: true
    }),
    {
      started: false,
      needsRepair: true,
      message: '环境未全部正常，请先修复环境'
    }
  );
  assert.deepEqual(services.calls, []);
});

test('stream:start rolls back input bridge when stream start throws', async () => {
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

  await assert.rejects(
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

test('stream:start rolls back input bridge when stream start reports failure', async () => {
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
    await ipcMain.handlers.get('stream:start')({}, {
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
  assert.match(source, /width:\s*1280/);
  assert.match(source, /height:\s*900/);
  assert.match(source, /minWidth:\s*1040/);
  assert.match(source, /minHeight:\s*680/);
  assert.match(source, /title:\s*['"]TVGame 发送端['"]/);
  assert.match(source, /preload:\s*path\.join\(__dirname,\s*['"]preload\.js['"]\)/);
  assert.match(source, /contextIsolation:\s*true/);
  assert.match(source, /nodeIntegration:\s*false/);
  assert.match(source, /setMenuBarVisibility\(false\)/);
  assert.match(source, /let\s+mainWindow\s*=\s*null/);
  assert.match(source, /mainWindow\s*=\s*createWindow\(\)/);
  assert.match(source, /window\.on\(['"]closed['"]/);
  assert.match(source, /process\.versions\.electron/);
  assert.match(source, /process\.type\s*===\s*['"]browser['"]/);
  assert.match(source, /createDeviceDiscovery\(/);
  assert.match(source, /createWorkerEnvironmentService\(/);
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
