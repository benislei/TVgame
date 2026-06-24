# Electron PC Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Electron desktop PC sender app for TVGame so users can run environment checks, repair dependencies, discover/select the TV, choose a preset quality profile, and start/stop streaming from a Chinese UI.

**Architecture:** Add an Electron control layer over the existing Node/GStreamer/InputBridge tooling. Keep stream pipelines and repair scripts in their current modules; expose them through focused desktop services, then bind those services to Electron IPC and a static renderer UI. Add Android TV LAN discovery broadcasting so the PC app can find receivers automatically while keeping manual IP entry as fallback.

**Tech Stack:** Node.js CommonJS, Electron, Electron Builder, node:test, Android Java, GStreamer CLI, InputBridge, PowerShell/Batch release tooling.

---

## File Structure

- Create `src/desktop/quality-presets.js`
  - Owns the six user-facing preset quality options and maps each option to existing RTP profile names.
- Create `src/desktop/config-store.js`
  - Reads and writes user config JSON for last selected device, quality profile, first-run state, and performance protection.
- Create `src/desktop/environment-service.js`
  - Wraps `createStage2Report`, `createStage2RepairPlan`, and repair actions into UI-friendly Chinese status objects.
- Create `src/desktop/process-service.js`
  - Starts/stops InputBridge and `native:rtp`, tracks child process state, and emits log lines.
- Create `src/desktop/device-discovery.js`
  - Listens for Android receiver UDP broadcasts and parses receiver capability messages.
- Create `src/desktop/ipc-handlers.js`
  - Registers Electron IPC handlers around the desktop services.
- Create `src/desktop/main.js`
  - Creates the Electron BrowserWindow and wires services to IPC.
- Create `src/desktop/preload.js`
  - Exposes a small safe `window.tvgame` bridge to the renderer.
- Create `src/desktop/renderer/index.html`
  - Defines the Chinese app shell, first-run wizard, main screen, device page, quality page, environment page, and logs page.
- Create `src/desktop/renderer/styles.css`
  - Quiet desktop-product styling for status cards and forms.
- Create `src/desktop/renderer/app.js`
  - Renderer state machine and UI event handlers.
- Create `src/desktop/electron-builder.json`
  - Portable Windows package config for trial distribution.
- Create `test/desktop-domain.test.js`
  - Unit tests for quality presets and config store.
- Create `test/desktop-environment.test.js`
  - Unit tests for environment summaries and repair confirmation flow.
- Create `test/desktop-process-service.test.js`
  - Unit tests for stream/input process command construction and lifecycle.
- Create `test/desktop-device-discovery.test.js`
  - Unit tests for receiver broadcast parsing and discovery list updates.
- Create `test/desktop-electron-static.test.js`
  - Static tests for Electron IPC surface and Chinese renderer labels.
- Create `android-tv-receiver/app/src/main/java/com/tvgame/receiver/DiscoveryBroadcaster.java`
  - Broadcasts receiver identity and capability information to the LAN.
- Modify `android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java`
  - Starts/stops the discovery broadcaster with the receiver lifecycle.
- Modify `test/android-tv-receiver.test.js`
  - Adds static and Java harness coverage for receiver discovery broadcasting.
- Modify `package.json`
  - Adds Electron dependencies and desktop scripts.
- Modify `src/release-package/tooling.js`
  - Includes the Electron sender package or launcher in the friend preview package.
- Modify `test/release-package.test.js`
  - Verifies the friend package includes the desktop app entry.
- Modify `README.md` and/or `docs/stage2-local-verify.md`
  - Adds Chinese usage notes for the Electron sender.

---

### Task 1: Desktop Quality Presets And Config Store

**Files:**
- Create: `test/desktop-domain.test.js`
- Create: `src/desktop/quality-presets.js`
- Create: `src/desktop/config-store.js`

- [ ] **Step 1: Write the failing quality/config tests**

Create `test/desktop-domain.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('desktop quality presets expose only user-approved preset profiles', () => {
  const { QUALITY_PRESETS, getQualityPreset } = require('../src/desktop/quality-presets');

  assert.deepEqual(QUALITY_PRESETS.map(item => item.id), [
    'h264720p30',
    'h264720p60',
    'h2641080p30',
    'h2641080p60',
    'hevc1080p30',
    'hevc1080p60'
  ]);
  assert.equal(getQualityPreset('hevc1080p30').label, 'HEVC 1080P30');
  assert.equal(getQualityPreset('hevc1080p30').recommended, true);
  assert.equal(getQualityPreset('missing'), null);
});

test('desktop config store creates defaults and persists selected device and quality', () => {
  const { createConfigStore } = require('../src/desktop/config-store');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tvgame-desktop-config-'));
  const store = createConfigStore({ appDataDir: root });

  assert.deepEqual(store.load(), {
    firstRunComplete: false,
    selectedDevice: null,
    selectedQuality: 'hevc1080p30',
    performanceProtection: true
  });

  store.save({
    firstRunComplete: true,
    selectedDevice: {
      id: '192.168.50.140',
      name: '小米盒子 5 Max',
      ip: '192.168.50.140',
      androidApi: 34,
      decoder: 'c2.amlogic.avc.decoder',
      recommendedProfile: 'hevc1080p60'
    },
    selectedQuality: 'hevc1080p60',
    performanceProtection: true
  });

  assert.equal(store.load().selectedDevice.name, '小米盒子 5 Max');
  assert.equal(store.load().selectedQuality, 'hevc1080p60');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- test/desktop-domain.test.js
```

Expected: FAIL with `Cannot find module '../src/desktop/quality-presets'`.

- [ ] **Step 3: Implement quality preset module**

Create `src/desktop/quality-presets.js`:

```js
'use strict';

const QUALITY_PRESETS = Object.freeze([
  {
    id: 'h264720p30',
    label: '720P30',
    description: '稳定优先，适合电视盒子和弱解码设备',
    codec: 'H.264',
    profile: 'h264720p30',
    recommended: false
  },
  {
    id: 'h264720p60',
    label: '720P60',
    description: '流畅优先，适合网络稳定但解码一般的设备',
    codec: 'H.264',
    profile: 'h264720p60',
    recommended: false
  },
  {
    id: 'h2641080p30',
    label: '1080P30',
    description: '清晰稳定，适合电视盒子优先尝试',
    codec: 'H.264',
    profile: 'h2641080p30',
    recommended: false
  },
  {
    id: 'h2641080p60',
    label: '1080P60',
    description: '高性能，适合手机、高性能电视或盒子',
    codec: 'H.264',
    profile: 'h2641080p60',
    recommended: false
  },
  {
    id: 'hevc1080p30',
    label: 'HEVC 1080P30',
    description: '推荐，低码率高清，优先使用',
    codec: 'HEVC',
    profile: 'hevc1080p30',
    recommended: true
  },
  {
    id: 'hevc1080p60',
    label: 'HEVC 1080P60',
    description: '高性能，适合解码能力较强的 Android 11+ 设备',
    codec: 'HEVC',
    profile: 'hevc1080p60',
    recommended: false
  }
]);

function getQualityPreset(id) {
  return QUALITY_PRESETS.find(item => item.id === id) || null;
}

module.exports = {
  QUALITY_PRESETS,
  getQualityPreset
};
```

- [ ] **Step 4: Implement config store**

Create `src/desktop/config-store.js`:

```js
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CONFIG = Object.freeze({
  firstRunComplete: false,
  selectedDevice: null,
  selectedQuality: 'hevc1080p30',
  performanceProtection: true
});

function createConfigStore(options = {}) {
  const appDataDir = options.appDataDir || path.join(process.cwd(), '.tvgame-desktop');
  const file = path.join(appDataDir, 'config.json');

  function load() {
    if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        selectedDevice: parsed.selectedDevice || null
      };
    } catch {
      return { ...DEFAULT_CONFIG };
    }
  }

  function save(nextConfig) {
    fs.mkdirSync(appDataDir, { recursive: true });
    const merged = { ...DEFAULT_CONFIG, ...nextConfig };
    fs.writeFileSync(file, JSON.stringify(merged, null, 2), 'utf8');
    return merged;
  }

  return { file, load, save };
}

module.exports = {
  DEFAULT_CONFIG,
  createConfigStore
};
```

- [ ] **Step 5: Verify focused tests pass**

Run:

```powershell
npm.cmd test -- test/desktop-domain.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- test/desktop-domain.test.js src/desktop/quality-presets.js src/desktop/config-store.js
git commit -m "Add desktop quality presets and config store"
```

---

### Task 2: Environment Diagnosis Service

**Files:**
- Create: `test/desktop-environment.test.js`
- Create: `src/desktop/environment-service.js`

- [ ] **Step 1: Write failing environment service tests**

Create `test/desktop-environment.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('desktop environment service summarizes ready report for UI status cards', () => {
  const { summarizeEnvironment } = require('../src/desktop/environment-service');
  const summary = summarizeEnvironment({
    ready: true,
    gstreamer: { ready: true, gstLaunch: 'D:/gst/gst-launch-1.0.exe', gstInspect: 'D:/gst/gst-inspect-1.0.exe' },
    dotnet: { ready: true, path: 'C:/Program Files/dotnet/dotnet.exe' },
    codecs: {
      h264: { ready: true, encoder: 'nvh264enc', availableEncoders: ['nvh264enc'], missing: [] },
      hevc: { ready: true, encoder: 'nvh265enc', availableEncoders: ['nvh265enc'], missing: [] }
    },
    missing: { executables: [], plugins: [] }
  }, { inputBridgeRuntimeReady: true, vigemBusReady: true });

  assert.equal(summary.ready, true);
  assert.equal(summary.cards.gstreamer.state, 'ok');
  assert.equal(summary.cards.inputBridge.state, 'ok');
  assert.equal(summary.cards.gamepadDriver.state, 'ok');
  assert.equal(summary.cards.encoder.detail, 'H.264: nvh264enc / HEVC: nvh265enc');
});

test('desktop environment service explains missing HEVC without blocking H264 profiles', () => {
  const { summarizeEnvironment } = require('../src/desktop/environment-service');
  const summary = summarizeEnvironment({
    ready: true,
    gstreamer: { ready: true, gstLaunch: 'gst-launch-1.0', gstInspect: 'gst-inspect-1.0' },
    dotnet: { ready: true, path: 'dotnet' },
    codecs: {
      h264: { ready: true, encoder: 'amfh264enc', availableEncoders: ['amfh264enc'], missing: [] },
      hevc: { ready: false, encoder: null, availableEncoders: [], missing: ['amfh265enc|nvh265enc|mfh265enc'] }
    },
    missing: { executables: [], plugins: [] }
  }, { inputBridgeRuntimeReady: true, vigemBusReady: false });

  assert.equal(summary.ready, true);
  assert.equal(summary.cards.encoder.state, 'warning');
  assert.match(summary.cards.encoder.message, /HEVC 档位暂不可用/);
  assert.equal(summary.cards.gamepadDriver.state, 'warning');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- test/desktop-environment.test.js
```

Expected: FAIL with `Cannot find module '../src/desktop/environment-service'`.

- [ ] **Step 3: Implement UI environment summary**

Create `src/desktop/environment-service.js`:

```js
'use strict';

const { createStage2Report } = require('../stage2/tooling');
const { createStage2RepairPlan, runStage2RepairActions } = require('../stage2/repair');

function card(state, title, message, detail = '') {
  return { state, title, message, detail };
}

function summarizeEnvironment(report, runtime = {}) {
  const h264 = report.codecs && report.codecs.h264;
  const hevc = report.codecs && report.codecs.hevc;
  const gstreamerOk = Boolean(report.gstreamer && report.gstreamer.ready);
  const inputBridgeOk = Boolean(runtime.inputBridgeRuntimeReady || (report.dotnet && report.dotnet.ready));
  const vigemOk = Boolean(runtime.vigemBusReady);
  const h264Ready = Boolean(h264 && h264.ready);
  const hevcReady = Boolean(hevc && hevc.ready);

  return {
    ready: Boolean(gstreamerOk && h264Ready && inputBridgeOk),
    raw: report,
    cards: {
      gstreamer: card(
        gstreamerOk ? 'ok' : 'error',
        'GStreamer',
        gstreamerOk ? '正常' : '缺少 GStreamer 或必要插件',
        report.gstreamer && report.gstreamer.gstLaunch ? report.gstreamer.gstLaunch : ''
      ),
      encoder: card(
        h264Ready && hevcReady ? 'ok' : h264Ready ? 'warning' : 'error',
        '编码器',
        h264Ready ? (hevcReady ? 'H.264 和 HEVC 可用' : 'HEVC 档位暂不可用，H.264 可用') : '缺少可用 H.264 编码器',
        `H.264: ${h264 && h264.encoder ? h264.encoder : '不可用'} / HEVC: ${hevc && hevc.encoder ? hevc.encoder : '不可用'}`
      ),
      inputBridge: card(
        inputBridgeOk ? 'ok' : 'error',
        '输入桥',
        inputBridgeOk ? '正常' : '缺少输入桥运行时或 .NET',
        runtime.inputBridgeRuntimeReady ? 'InputBridgeRuntime' : ((report.dotnet && report.dotnet.path) || '')
      ),
      gamepadDriver: card(
        vigemOk ? 'ok' : 'warning',
        '手柄驱动',
        vigemOk ? 'ViGEmBus 已安装' : '需要安装 ViGEmBus 才能把电视端手柄注入为 Xbox 手柄'
      )
    }
  };
}

function createEnvironmentService(options = {}) {
  const createReport = options.createReport || createStage2Report;
  const createRepairPlan = options.createRepairPlan || createStage2RepairPlan;
  const runRepairActions = options.runRepairActions || runStage2RepairActions;
  const getRuntime = options.getRuntime || (() => ({ inputBridgeRuntimeReady: false, vigemBusReady: false }));

  function check() {
    const report = createReport();
    const runtime = getRuntime();
    return summarizeEnvironment(report, runtime);
  }

  function repair(projectRoot) {
    const report = createReport();
    const plan = createRepairPlan(report, getRuntime());
    runRepairActions(plan, { projectRoot });
    return check();
  }

  return { check, repair };
}

module.exports = {
  summarizeEnvironment,
  createEnvironmentService
};
```

- [ ] **Step 4: Verify focused tests pass**

Run:

```powershell
npm.cmd test -- test/desktop-environment.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- test/desktop-environment.test.js src/desktop/environment-service.js
git commit -m "Add desktop environment service"
```

---

### Task 3: Process Service For InputBridge And RTP Sender

**Files:**
- Create: `test/desktop-process-service.test.js`
- Create: `src/desktop/process-service.js`

- [ ] **Step 1: Write failing process service tests**

Create `test/desktop-process-service.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('process service builds native RTP command from selected device and preset', () => {
  const { buildRtpCommand } = require('../src/desktop/process-service');

  const command = buildRtpCommand({
    projectRoot: 'C:/repo',
    device: { ip: '192.168.50.140' },
    quality: { profile: 'hevc1080p60' },
    performanceProtection: true
  });

  assert.equal(command.command, 'npm.cmd');
  assert.deepEqual(command.args, [
    'run',
    'native:rtp',
    '--',
    '--host',
    '192.168.50.140',
    '--encoder',
    'auto',
    '--encoder-preset',
    'auto',
    '--profile',
    'hevc1080p60',
    '--process-priority',
    'high'
  ]);
  assert.equal(command.options.cwd, 'C:/repo');
});

test('process service starts input bridge runtime when available', () => {
  const { buildInputBridgeCommand } = require('../src/desktop/process-service');

  const command = buildInputBridgeCommand({
    projectRoot: 'C:/repo',
    inputBridgeRuntimePath: 'C:/repo/InputBridgeRuntime/InputBridge.exe'
  });

  assert.equal(command.command, 'C:/repo/InputBridgeRuntime/InputBridge.exe');
  assert.deepEqual(command.args, []);
  assert.equal(command.options.cwd, 'C:/repo');
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- test/desktop-process-service.test.js
```

Expected: FAIL with `Cannot find module '../src/desktop/process-service'`.

- [ ] **Step 3: Implement command builders and process controller**

Create `src/desktop/process-service.js`:

```js
'use strict';

const childProcess = require('node:child_process');
const path = require('node:path');

function buildRtpCommand({ projectRoot, device, quality, performanceProtection }) {
  if (!device || !device.ip) throw new Error('缺少电视 IP');
  if (!quality || !quality.profile) throw new Error('缺少画质档位');

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
    options: { cwd: projectRoot, windowsHide: true }
  };
}

function buildInputBridgeCommand({ projectRoot, inputBridgeRuntimePath }) {
  const runtime = inputBridgeRuntimePath || path.join(projectRoot, 'InputBridgeRuntime', 'InputBridge.exe');
  return {
    command: runtime,
    args: [],
    options: { cwd: projectRoot, windowsHide: true }
  };
}

function createProcessService(options = {}) {
  const spawn = options.spawn || childProcess.spawn;
  const logs = [];
  let streamProcess = null;
  let inputBridgeProcess = null;

  function remember(prefix, chunk) {
    const line = `[${prefix}] ${String(chunk).trim()}`;
    if (line.trim().length > 0) logs.push(line);
  }

  function startChild(spec, prefix) {
    const child = spawn(spec.command, spec.args, spec.options);
    if (child.stdout) child.stdout.on('data', chunk => remember(prefix, chunk));
    if (child.stderr) child.stderr.on('data', chunk => remember(prefix, chunk));
    return child;
  }

  function startInputBridge(args) {
    if (inputBridgeProcess) return { alreadyRunning: true };
    inputBridgeProcess = startChild(buildInputBridgeCommand(args), '输入桥');
    inputBridgeProcess.on('exit', () => {
      inputBridgeProcess = null;
    });
    return { alreadyRunning: false };
  }

  function startStream(args) {
    if (streamProcess) throw new Error('发送端已经在运行');
    streamProcess = startChild(buildRtpCommand(args), '发送端');
    streamProcess.on('exit', () => {
      streamProcess = null;
    });
    return { started: true };
  }

  function stopStream() {
    if (!streamProcess) return { stopped: false };
    streamProcess.kill();
    streamProcess = null;
    return { stopped: true };
  }

  function status() {
    return {
      streamRunning: Boolean(streamProcess),
      inputBridgeRunning: Boolean(inputBridgeProcess),
      logs: logs.slice(-300)
    };
  }

  return { startInputBridge, startStream, stopStream, status };
}

module.exports = {
  buildRtpCommand,
  buildInputBridgeCommand,
  createProcessService
};
```

- [ ] **Step 4: Verify focused tests pass**

Run:

```powershell
npm.cmd test -- test/desktop-process-service.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- test/desktop-process-service.test.js src/desktop/process-service.js
git commit -m "Add desktop process service"
```

---

### Task 4: Android Receiver LAN Discovery Broadcast

**Files:**
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/DiscoveryBroadcaster.java`
- Modify: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java`
- Modify: `test/android-tv-receiver.test.js`

- [ ] **Step 1: Add failing Android discovery tests**

Append to `test/android-tv-receiver.test.js`:

```js
test('Android TV receiver broadcasts LAN discovery metadata for the PC sender app', () => {
  assertFileExists(`${javaRoot}/DiscoveryBroadcaster.java`);
  const source = readProjectFile(`${javaRoot}/DiscoveryBroadcaster.java`);

  assert.match(source, /DISCOVERY_PORT\s*=\s*8790/);
  assert.match(source, /DatagramSocket/);
  assert.match(source, /setBroadcast\(true\)/);
  assert.match(source, /255\.255\.255\.255/);
  assert.match(source, /\\"app\\":\\"TVGameReceiver\\"/);
  assert.match(source, /\\"deviceName\\":/);
  assert.match(source, /\\"androidApi\\":/);
  assert.match(source, /\\"decoder\\":/);
  assert.match(source, /\\"recommendedProfile\\":/);
});

test('MainActivity starts and stops receiver discovery broadcaster with lifecycle', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /private\s+DiscoveryBroadcaster\s+discoveryBroadcaster/);
  assert.match(source, /discoveryBroadcaster\s*=\s*new\s+DiscoveryBroadcaster/);
  assert.match(source, /discoveryBroadcaster\.start\(\)/);
  assert.match(source, /discoveryBroadcaster\.stop\(\)/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- test/android-tv-receiver.test.js
```

Expected: FAIL because `DiscoveryBroadcaster.java` does not exist.

- [ ] **Step 3: Implement `DiscoveryBroadcaster.java`**

Create `android-tv-receiver/app/src/main/java/com/tvgame/receiver/DiscoveryBroadcaster.java`:

```java
package com.tvgame.receiver;

import android.os.Build;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.nio.charset.StandardCharsets;
import java.util.Locale;

public final class DiscoveryBroadcaster {
    private static final int DISCOVERY_PORT = 8790;
    private static final long BROADCAST_INTERVAL_MS = 2000;

    private final StatsModel stats;
    private volatile boolean running;
    private Thread thread;

    public DiscoveryBroadcaster(StatsModel stats) {
        this.stats = stats;
    }

    public void start() {
        if (running) return;
        running = true;
        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                runLoop();
            }
        }, "tvgame-discovery");
        thread.setDaemon(true);
        thread.start();
    }

    public void stop() {
        running = false;
        Thread current = thread;
        thread = null;
        if (current != null) {
            current.interrupt();
        }
    }

    private void runLoop() {
        while (running) {
            try {
                byte[] payload = buildPayload().getBytes(StandardCharsets.UTF_8);
                DatagramPacket packet = new DatagramPacket(
                    payload,
                    payload.length,
                    InetAddress.getByName("255.255.255.255"),
                    DISCOVERY_PORT
                );
                DatagramSocket socket = new DatagramSocket();
                try {
                    socket.setBroadcast(true);
                    socket.send(packet);
                } finally {
                    socket.close();
                }
                Thread.sleep(BROADCAST_INTERVAL_MS);
            } catch (InterruptedException ex) {
                Thread.currentThread().interrupt();
                return;
            } catch (Exception ignored) {
            }
        }
    }

    String buildPayload() {
        return "{"
            + "\"app\":\"TVGameReceiver\","
            + "\"version\":1,"
            + "\"deviceName\":\"" + escape(Build.MANUFACTURER + " " + Build.MODEL) + "\","
            + "\"androidApi\":" + Build.VERSION.SDK_INT + ","
            + "\"decoder\":\"" + escape(stats.videoDecoderName) + "\","
            + "\"recommendedProfile\":\"" + escape(profileFromAdvice(stats.receiverAdvice)) + "\""
            + "}";
    }

    private static String profileFromAdvice(String advice) {
        if (advice == null) return "h2641080p30";
        String normalized = advice.toLowerCase(Locale.US);
        if (normalized.contains("hevc") && normalized.contains("60")) return "hevc1080p60";
        if (normalized.contains("hevc")) return "hevc1080p30";
        if (normalized.contains("720") && normalized.contains("60")) return "h264720p60";
        if (normalized.contains("720")) return "h264720p30";
        if (normalized.contains("60")) return "h2641080p60";
        return "h2641080p30";
    }

    private static String escape(String value) {
        if (value == null) return "";
        return value.replace("\\", "\\\\").replace("\"", "\\\"");
    }
}
```

- [ ] **Step 4: Wire broadcaster in `MainActivity`**

Modify `MainActivity.java`:

```java
private DiscoveryBroadcaster discoveryBroadcaster;
```

In `onCreate`, after `stats.receiverAdvice = buildReceiverAdvice();`:

```java
discoveryBroadcaster = new DiscoveryBroadcaster(stats);
discoveryBroadcaster.start();
```

In `onDestroy`, before `super.onDestroy();`:

```java
if (discoveryBroadcaster != null) {
    discoveryBroadcaster.stop();
    discoveryBroadcaster = null;
}
```

- [ ] **Step 5: Verify Android receiver tests pass**

Run:

```powershell
npm.cmd test -- test/android-tv-receiver.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add -- android-tv-receiver/app/src/main/java/com/tvgame/receiver/DiscoveryBroadcaster.java android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java test/android-tv-receiver.test.js
git commit -m "Add Android receiver discovery broadcast"
```

---

### Task 5: Desktop Device Discovery Service

**Files:**
- Create: `test/desktop-device-discovery.test.js`
- Create: `src/desktop/device-discovery.js`

- [ ] **Step 1: Write failing discovery service tests**

Create `test/desktop-device-discovery.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('desktop discovery parser accepts TVGame receiver broadcast payload', () => {
  const { parseDiscoveryMessage } = require('../src/desktop/device-discovery');
  const device = parseDiscoveryMessage(Buffer.from(JSON.stringify({
    app: 'TVGameReceiver',
    version: 1,
    deviceName: 'Xiaomi MiTV-AZFU0',
    androidApi: 34,
    decoder: 'c2.amlogic.avc.decoder',
    recommendedProfile: 'hevc1080p60'
  })), { address: '192.168.50.140' });

  assert.deepEqual(device, {
    id: '192.168.50.140',
    name: 'Xiaomi MiTV-AZFU0',
    ip: '192.168.50.140',
    androidApi: 34,
    decoder: 'c2.amlogic.avc.decoder',
    recommendedProfile: 'hevc1080p60',
    lastSeenAt: device.lastSeenAt
  });
  assert.equal(typeof device.lastSeenAt, 'number');
});

test('desktop discovery parser rejects unrelated UDP payloads', () => {
  const { parseDiscoveryMessage } = require('../src/desktop/device-discovery');

  assert.equal(parseDiscoveryMessage(Buffer.from('not json'), { address: '1.1.1.1' }), null);
  assert.equal(parseDiscoveryMessage(Buffer.from('{"app":"Other"}'), { address: '1.1.1.1' }), null);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- test/desktop-device-discovery.test.js
```

Expected: FAIL with `Cannot find module '../src/desktop/device-discovery'`.

- [ ] **Step 3: Implement discovery parser and listener**

Create `src/desktop/device-discovery.js`:

```js
'use strict';

const dgram = require('node:dgram');

const DISCOVERY_PORT = 8790;

function parseDiscoveryMessage(message, remote) {
  try {
    const parsed = JSON.parse(Buffer.isBuffer(message) ? message.toString('utf8') : String(message));
    if (!parsed || parsed.app !== 'TVGameReceiver') return null;
    const ip = remote && remote.address ? remote.address : parsed.ip;
    if (!ip) return null;
    return {
      id: ip,
      name: String(parsed.deviceName || '未知电视设备'),
      ip,
      androidApi: Number(parsed.androidApi || 0),
      decoder: String(parsed.decoder || '未知'),
      recommendedProfile: String(parsed.recommendedProfile || 'h2641080p30'),
      lastSeenAt: Date.now()
    };
  } catch {
    return null;
  }
}

function createDeviceDiscovery(options = {}) {
  const socketFactory = options.socketFactory || (() => dgram.createSocket('udp4'));
  const devices = new Map();
  let socket = null;

  function start(onUpdate) {
    if (socket) return;
    socket = socketFactory();
    socket.on('message', (message, remote) => {
      const device = parseDiscoveryMessage(message, remote);
      if (!device) return;
      devices.set(device.id, device);
      if (onUpdate) onUpdate(list());
    });
    socket.bind(DISCOVERY_PORT);
  }

  function stop() {
    if (!socket) return;
    socket.close();
    socket = null;
  }

  function list() {
    return Array.from(devices.values()).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
  }

  return { start, stop, list };
}

module.exports = {
  DISCOVERY_PORT,
  parseDiscoveryMessage,
  createDeviceDiscovery
};
```

- [ ] **Step 4: Verify focused tests pass**

Run:

```powershell
npm.cmd test -- test/desktop-device-discovery.test.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add -- test/desktop-device-discovery.test.js src/desktop/device-discovery.js
git commit -m "Add desktop device discovery service"
```

---

### Task 6: Electron Shell And IPC Contract

**Files:**
- Modify: `package.json`
- Create: `test/desktop-electron-static.test.js`
- Create: `src/desktop/ipc-handlers.js`
- Create: `src/desktop/main.js`
- Create: `src/desktop/preload.js`

- [ ] **Step 1: Add Electron development dependencies**

Run:

```powershell
npm.cmd install --save-dev electron electron-builder
```

Expected: `package.json` and `package-lock.json` update with `electron` and `electron-builder`.

- [ ] **Step 2: Add desktop scripts to `package.json`**

Modify `package.json` scripts:

```json
"desktop": "electron src/desktop/main.js",
"desktop:package": "electron-builder --config src/desktop/electron-builder.json"
```

- [ ] **Step 3: Write static Electron contract tests**

Create `test/desktop-electron-static.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('Electron preload exposes a small tvgame API surface', () => {
  const source = read('src/desktop/preload.js');

  assert.match(source, /contextBridge\.exposeInMainWorld\('tvgame'/);
  assert.match(source, /checkEnvironment/);
  assert.match(source, /repairEnvironment/);
  assert.match(source, /listDevices/);
  assert.match(source, /startStream/);
  assert.match(source, /stopStream/);
  assert.match(source, /getStatus/);
});

test('Electron IPC handlers cover environment, device, config and streaming actions', () => {
  const source = read('src/desktop/ipc-handlers.js');

  for (const channel of [
    'config:load',
    'config:save',
    'environment:check',
    'environment:repair',
    'devices:list',
    'stream:start',
    'stream:stop',
    'stream:status'
  ]) {
    assert.match(source, new RegExp(`ipcMain\\.handle\\('${channel}'`));
  }
});
```

- [ ] **Step 4: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- test/desktop-electron-static.test.js
```

Expected: FAIL because Electron files do not exist.

- [ ] **Step 5: Implement IPC handlers**

Create `src/desktop/ipc-handlers.js`:

```js
'use strict';

function registerIpcHandlers(ipcMain, services) {
  ipcMain.handle('config:load', () => services.config.load());
  ipcMain.handle('config:save', (event, nextConfig) => services.config.save(nextConfig));
  ipcMain.handle('environment:check', () => services.environment.check());
  ipcMain.handle('environment:repair', () => services.environment.repair(services.projectRoot));
  ipcMain.handle('devices:list', () => services.discovery.list());
  ipcMain.handle('stream:start', (event, payload) => {
    services.process.startInputBridge({
      projectRoot: services.projectRoot,
      inputBridgeRuntimePath: services.inputBridgeRuntimePath
    });
    return services.process.startStream({
      projectRoot: services.projectRoot,
      device: payload.device,
      quality: payload.quality,
      performanceProtection: payload.performanceProtection
    });
  });
  ipcMain.handle('stream:stop', () => services.process.stopStream());
  ipcMain.handle('stream:status', () => services.process.status());
}

module.exports = {
  registerIpcHandlers
};
```

- [ ] **Step 6: Implement preload bridge**

Create `src/desktop/preload.js`:

```js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvgame', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: config => ipcRenderer.invoke('config:save', config),
  checkEnvironment: () => ipcRenderer.invoke('environment:check'),
  repairEnvironment: () => ipcRenderer.invoke('environment:repair'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  startStream: payload => ipcRenderer.invoke('stream:start', payload),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  getStatus: () => ipcRenderer.invoke('stream:status')
});
```

- [ ] **Step 7: Implement Electron main process**

Create `src/desktop/main.js`:

```js
'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { registerIpcHandlers } = require('./ipc-handlers');
const { createConfigStore } = require('./config-store');
const { createEnvironmentService } = require('./environment-service');
const { createProcessService } = require('./process-service');
const { createDeviceDiscovery } = require('./device-discovery');

const projectRoot = path.resolve(__dirname, '..', '..');

function createWindow() {
  const win = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: 'TVGame 发送端',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  const discovery = createDeviceDiscovery();
  const services = {
    projectRoot,
    inputBridgeRuntimePath: path.join(projectRoot, 'InputBridgeRuntime', 'InputBridge.exe'),
    config: createConfigStore({ appDataDir: path.join(app.getPath('userData')) }),
    environment: createEnvironmentService(),
    process: createProcessService(),
    discovery
  };
  registerIpcHandlers(ipcMain, services);
  discovery.start();
  createWindow();
});

app.on('window-all-closed', () => {
  app.quit();
});
```

- [ ] **Step 8: Verify focused tests pass**

Run:

```powershell
npm.cmd test -- test/desktop-electron-static.test.js
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add -- package.json package-lock.json test/desktop-electron-static.test.js src/desktop/ipc-handlers.js src/desktop/main.js src/desktop/preload.js
git commit -m "Add Electron desktop shell"
```

---

### Task 7: Renderer UI For Wizard And Main Screen

**Files:**
- Modify: `test/desktop-electron-static.test.js`
- Create: `src/desktop/renderer/index.html`
- Create: `src/desktop/renderer/styles.css`
- Create: `src/desktop/renderer/app.js`

- [ ] **Step 1: Add renderer static tests**

Append to `test/desktop-electron-static.test.js`:

```js
test('desktop renderer uses Chinese product screens and preset-only quality choices', () => {
  const html = read('src/desktop/renderer/index.html');
  const js = read('src/desktop/renderer/app.js');

  assert.match(html, /TVGame 发送端/);
  assert.match(html, /首次配置向导/);
  assert.match(html, /日常主屏/);
  assert.match(html, /检查并修复环境/);
  assert.match(html, /自动搜索电视/);
  assert.match(html, /手动输入 IP/);
  assert.match(html, /开始串流/);
  assert.match(html, /日志/);
  assert.match(js, /h264720p30/);
  assert.match(js, /hevc1080p60/);
  assert.doesNotMatch(html, /GOP/);
  assert.doesNotMatch(html, /码率/);
});
```

- [ ] **Step 2: Run the focused test and verify failure**

Run:

```powershell
npm.cmd test -- test/desktop-electron-static.test.js
```

Expected: FAIL because renderer files do not exist.

- [ ] **Step 3: Create renderer HTML**

Create `src/desktop/renderer/index.html`:

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>TVGame 发送端</title>
    <link rel="stylesheet" href="./styles.css">
  </head>
  <body>
    <aside class="sidebar">
      <div class="brand">TVGame 发送端</div>
      <button data-page="main">日常主屏</button>
      <button data-page="wizard">首次配置向导</button>
      <button data-page="devices">电视设备</button>
      <button data-page="quality">画质档位</button>
      <button data-page="environment">环境诊断</button>
      <button data-page="logs">日志</button>
    </aside>
    <main>
      <section id="page-main" class="page active">
        <header>
          <h1>日常主屏</h1>
          <p>选择电视和画质后，一键开始局域网游戏串流。</p>
        </header>
        <div class="main-grid">
          <section class="panel">
            <h2>启动</h2>
            <label>电视设备</label>
            <select id="deviceSelect"></select>
            <label>手动输入 IP</label>
            <input id="manualIp" placeholder="例如 192.168.50.140">
            <label>画质档位</label>
            <select id="qualitySelect"></select>
            <label class="check"><input id="performanceProtection" type="checkbox" checked> 启用性能保护</label>
            <div class="actions">
              <button id="startStream" class="primary">开始串流</button>
              <button id="stopStream">停止</button>
            </div>
          </section>
          <section class="panel">
            <h2>状态</h2>
            <div id="statusCards" class="status-grid"></div>
          </section>
        </div>
      </section>
      <section id="page-wizard" class="page">
        <h1>首次配置向导</h1>
        <ol class="wizard">
          <li>准备电视端 App</li>
          <li>检查环境</li>
          <li>一键修复</li>
          <li>自动搜索电视，也支持手动输入 IP</li>
          <li>选择推荐画质</li>
        </ol>
      </section>
      <section id="page-devices" class="page">
        <h1>电视设备</h1>
        <button id="refreshDevices">自动搜索电视</button>
        <div id="deviceList"></div>
      </section>
      <section id="page-quality" class="page">
        <h1>画质档位</h1>
        <div id="qualityList" class="quality-list"></div>
      </section>
      <section id="page-environment" class="page">
        <h1>环境诊断</h1>
        <button id="checkEnvironment">检查环境</button>
        <button id="repairEnvironment">检查并修复环境</button>
        <div id="environmentResult"></div>
      </section>
      <section id="page-logs" class="page">
        <h1>日志</h1>
        <pre id="logs"></pre>
      </section>
    </main>
    <script src="./app.js"></script>
  </body>
</html>
```

- [ ] **Step 4: Create renderer CSS**

Create `src/desktop/renderer/styles.css`:

```css
:root {
  color-scheme: dark;
  font-family: "Microsoft YaHei", "Segoe UI", sans-serif;
  background: #0f1115;
  color: #f3f6fb;
}

body {
  margin: 0;
  display: grid;
  grid-template-columns: 220px 1fr;
  min-height: 100vh;
}

.sidebar {
  background: #151922;
  border-right: 1px solid #283142;
  padding: 18px;
}

.brand {
  font-size: 20px;
  font-weight: 700;
  margin-bottom: 18px;
}

button, input, select {
  font: inherit;
}

.sidebar button {
  width: 100%;
  margin: 6px 0;
  padding: 10px;
  text-align: left;
  border: 1px solid #2b3548;
  background: #1c2330;
  color: #f3f6fb;
  border-radius: 8px;
}

main {
  padding: 24px;
  overflow: auto;
}

.page {
  display: none;
}

.page.active {
  display: block;
}

.main-grid {
  display: grid;
  grid-template-columns: minmax(360px, 480px) 1fr;
  gap: 18px;
}

.panel {
  background: #171d28;
  border: 1px solid #2a3447;
  border-radius: 8px;
  padding: 18px;
}

label {
  display: block;
  margin-top: 12px;
  margin-bottom: 6px;
}

input, select {
  width: 100%;
  box-sizing: border-box;
  padding: 10px;
  border-radius: 8px;
  border: 1px solid #3a465c;
  background: #10151e;
  color: #f3f6fb;
}

.check {
  display: flex;
  gap: 8px;
  align-items: center;
}

.check input {
  width: auto;
}

.actions {
  display: flex;
  gap: 10px;
  margin-top: 16px;
}

.primary {
  background: #2f7cff;
  color: white;
}

.status-grid, .quality-list {
  display: grid;
  gap: 10px;
}

.status-card, .quality-card {
  border: 1px solid #2d374b;
  background: #10151e;
  border-radius: 8px;
  padding: 12px;
}

pre {
  white-space: pre-wrap;
  background: #090c12;
  border: 1px solid #2d374b;
  border-radius: 8px;
  padding: 14px;
}
```

- [ ] **Step 5: Create renderer JS**

Create `src/desktop/renderer/app.js`:

```js
'use strict';

const QUALITY_PRESETS = [
  ['h264720p30', '720P30', '稳定优先，适合电视盒子和弱解码设备'],
  ['h264720p60', '720P60', '流畅优先，适合网络稳定但解码一般的设备'],
  ['h2641080p30', '1080P30', '清晰稳定，适合电视盒子优先尝试'],
  ['h2641080p60', '1080P60', '高性能，适合手机、高性能电视或盒子'],
  ['hevc1080p30', 'HEVC 1080P30', '推荐，低码率高清，优先使用'],
  ['hevc1080p60', 'HEVC 1080P60', '高性能，适合解码能力较强的 Android 11+ 设备']
];

let config = null;
let devices = [];

function $(id) {
  return document.getElementById(id);
}

function showPage(page) {
  for (const element of document.querySelectorAll('.page')) element.classList.remove('active');
  $(`page-${page}`).classList.add('active');
}

function renderQualityOptions() {
  $('qualitySelect').innerHTML = QUALITY_PRESETS
    .map(([id, label]) => `<option value="${id}">${label}</option>`)
    .join('');
  $('qualityList').innerHTML = QUALITY_PRESETS
    .map(([id, label, description]) => `<div class="quality-card"><strong>${label}</strong><p>${description}</p></div>`)
    .join('');
}

function renderDevices() {
  $('deviceSelect').innerHTML = devices
    .map(device => `<option value="${device.ip}">${device.name} | ${device.ip}</option>`)
    .join('');
  $('deviceList').innerHTML = devices
    .map(device => `<div class="status-card"><strong>${device.name}</strong><p>${device.ip} | Android API ${device.androidApi} | ${device.decoder}</p></div>`)
    .join('');
}

function renderEnvironment(summary) {
  const cards = summary && summary.cards ? Object.values(summary.cards) : [];
  $('statusCards').innerHTML = cards
    .map(card => `<div class="status-card"><strong>${card.title}</strong><p>${card.message}</p><small>${card.detail || ''}</small></div>`)
    .join('');
  $('environmentResult').innerHTML = $('statusCards').innerHTML;
}

async function refreshDevices() {
  devices = await window.tvgame.listDevices();
  renderDevices();
}

async function refreshEnvironment() {
  const summary = await window.tvgame.checkEnvironment();
  renderEnvironment(summary);
}

async function startStream() {
  const selectedIp = $('manualIp').value.trim() || $('deviceSelect').value;
  const selectedQuality = $('qualitySelect').value;
  const device = devices.find(item => item.ip === selectedIp) || { ip: selectedIp, name: selectedIp };
  const quality = QUALITY_PRESETS.find(item => item[0] === selectedQuality);
  await window.tvgame.startStream({
    device,
    quality: { id: quality[0], profile: quality[0], label: quality[1] },
    performanceProtection: $('performanceProtection').checked
  });
  await refreshStatus();
}

async function refreshStatus() {
  const status = await window.tvgame.getStatus();
  $('logs').textContent = (status.logs || []).join('\n');
}

async function boot() {
  config = await window.tvgame.loadConfig();
  renderQualityOptions();
  await refreshDevices();
  await refreshEnvironment();
  if (config.selectedQuality) $('qualitySelect').value = config.selectedQuality;
  if (!config.firstRunComplete) showPage('wizard');
}

for (const button of document.querySelectorAll('[data-page]')) {
  button.addEventListener('click', () => showPage(button.dataset.page));
}

$('refreshDevices').addEventListener('click', refreshDevices);
$('checkEnvironment').addEventListener('click', refreshEnvironment);
$('repairEnvironment').addEventListener('click', async () => {
  const summary = await window.tvgame.repairEnvironment();
  renderEnvironment(summary);
});
$('startStream').addEventListener('click', startStream);
$('stopStream').addEventListener('click', async () => {
  await window.tvgame.stopStream();
  await refreshStatus();
});

setInterval(refreshStatus, 1000);
boot();
```

- [ ] **Step 6: Verify renderer static tests pass**

Run:

```powershell
npm.cmd test -- test/desktop-electron-static.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- test/desktop-electron-static.test.js src/desktop/renderer/index.html src/desktop/renderer/styles.css src/desktop/renderer/app.js
git commit -m "Add Electron sender renderer UI"
```

---

### Task 8: Desktop Packaging And Friend Package Integration

**Files:**
- Create: `src/desktop/electron-builder.json`
- Modify: `package.json`
- Modify: `src/release-package/tooling.js`
- Modify: `test/release-package.test.js`
- Modify: `README.md`

- [ ] **Step 1: Add failing release package test for desktop sender entry**

Append to `test/release-package.test.js`:

```js
test('friend preview package includes Electron sender launcher when desktop build exists', () => {
  const { createFriendPreviewPackage } = require('../src/release-package/tooling');
  const projectRoot = createFakeProject();
  writeFile(path.join(projectRoot, 'dist-desktop', 'win-unpacked', 'TVGame Sender.exe'), 'exe');

  const report = createFriendPreviewPackage({
    projectRoot,
    outputRoot: path.join(projectRoot, 'dist-test'),
    createZip: false
  });

  assert.equal(fs.existsSync(path.join(report.packageDir, '启动TVGame发送端.bat')), true);
  assert.equal(fs.existsSync(path.join(report.packageDir, 'desktop', 'TVGame Sender.exe')), true);
});
```

- [ ] **Step 2: Run focused release package test and verify failure**

Run:

```powershell
npm.cmd test -- test/release-package.test.js
```

Expected: FAIL because desktop build is not copied yet.

- [ ] **Step 3: Add Electron Builder config**

Create `src/desktop/electron-builder.json`:

```json
{
  "appId": "com.tvgame.sender",
  "productName": "TVGame Sender",
  "directories": {
    "output": "dist-desktop"
  },
  "files": [
    "package.json",
    "src/**",
    "scripts/**",
    "InputBridgeRuntime/**",
    "InputBridge/**",
    "docs/**"
  ],
  "win": {
    "target": [
      "portable"
    ]
  }
}
```

- [ ] **Step 4: Update release package tooling**

Modify `src/release-package/tooling.js`:

```js
function copyDesktopBuildIfExists(projectRoot, packageDir) {
  const source = path.join(projectRoot, 'dist-desktop', 'win-unpacked');
  if (!fs.existsSync(source)) return null;
  const target = path.join(packageDir, 'desktop');
  copyDirectory(source, target);
  writeText(path.join(packageDir, '启动TVGame发送端.bat'), createBatchScript(`
cd /d "%~dp0desktop"
"TVGame Sender.exe"
`));
  return target;
}
```

Call `copyDesktopBuildIfExists(projectRoot, packageDir);` inside `createFriendPreviewPackage` after launcher files are written.

- [ ] **Step 5: Update README**

Add a Chinese section to `README.md`:

```md
## Electron 发送端软件

第一版桌面软件用于替代手动运行多个 bat：它提供首次配置向导、日常一键主屏、自动搜索电视、预设画质、环境诊断和日志页。底层仍复用当前已验证的 GStreamer、InputBridge 和环境修复脚本。

开发运行：

```powershell
npm.cmd run desktop
```

打包：

```powershell
npm.cmd run desktop:package
```
```

- [ ] **Step 6: Verify packaging tests pass**

Run:

```powershell
npm.cmd test -- test/release-package.test.js
```

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add -- src/desktop/electron-builder.json package.json package-lock.json src/release-package/tooling.js test/release-package.test.js README.md
git commit -m "Add Electron sender package integration"
```

---

### Task 9: Full Verification And Trial Build

**Files:**
- Generated: `android-tv-receiver/app/build/outputs/apk/debug/app-debug.apk`
- Generated: `dist-desktop/`
- Generated: `dist/TVGame-Friend-Preview/`
- Generated: `dist/TVGame-Friend-Preview.zip`

- [ ] **Step 1: Run full Node tests**

Run:

```powershell
npm.cmd test
```

Expected: all tests pass.

- [ ] **Step 2: Build Android receiver APK**

Run:

```powershell
npm.cmd run android:build
```

Expected: `BUILD SUCCESSFUL` and APK path printed.

- [ ] **Step 3: Build Electron desktop package**

Run:

```powershell
npm.cmd run desktop:package
```

Expected: `dist-desktop` contains a Windows portable Electron sender build.

- [ ] **Step 4: Build friend preview package**

Run:

```powershell
npm.cmd run package:friend
```

Expected: friend preview package includes `TVGameReceiver.apk`, existing scripts, and `启动TVGame发送端.bat` if the desktop build exists.

- [ ] **Step 5: Smoke test Electron in development mode**

Run:

```powershell
npm.cmd run desktop
```

Expected:

- Window title is `TVGame 发送端`.
- First-run wizard is visible when config is empty.
- Sidebar contains `日常主屏`, `首次配置向导`, `电视设备`, `画质档位`, `环境诊断`, `日志`.
- `画质档位` shows only the six approved presets.
- `检查环境` returns status cards instead of raw terminal output.

- [ ] **Step 6: Commit generated-lock or docs-only changes if any remain**

Run:

```powershell
git status --short
```

Expected: only intentional files are changed. If `package-lock.json` changed during dependency install and was not committed in Task 6 or Task 8, commit it now:

```powershell
git add -- package-lock.json
git commit -m "Update desktop dependency lockfile"
```

- [ ] **Step 7: Push**

```powershell
git push origin main
```

Expected: GitHub branch `main` contains all Electron sender commits.

---

## Self-Review Notes

- Spec coverage:
  - First-run wizard: Task 7 renderer and Task 6 IPC.
  - Daily one-click screen: Task 7 renderer and Task 3 process service.
  - Preset-only quality choices: Task 1 and Task 7.
  - Automatic TV discovery with manual IP fallback: Task 4, Task 5, Task 7.
  - Environment diagnosis and one-key repair confirmation: Task 2 and Task 7.
  - Automatic InputBridge startup: Task 3 and Task 6.
  - Logs page: Task 3 process logs and Task 7 renderer.
  - Friend package: Task 8.
- Scope boundary:
  - This plan does not rewrite RTP pipelines, InputBridge injection, or the Android decoder pipeline.
  - This plan does not add account systems, cloud relay, STUN/TURN, or automatic updates.
- Verification:
  - Every task has a focused test command and a commit point.
  - Final verification includes Node tests, Android build, Electron package, and friend package.
