# Stage 2 Android TV MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first Android TV native streaming MVP that can verify 1080p60 game feel with PC system audio, low-latency input return, and a unified host dependency check/install path.

**Architecture:** The PC side will stop relying on Python GI and use `gst-launch-1.0` RTP pipelines as the first native sender path: H.264 RTP video on one UDP port and L16 PCM RTP audio on another. The Android TV app will receive RTP directly, feed H.264 NAL units into `MediaCodec`, play PCM through `AudioTrack`, and return input events to the existing `InputBridge` path through a PC control endpoint.

**Tech Stack:** Node.js test/CLI tools, GStreamer 1.24.13 MSVC x86_64, .NET 8 InputBridge, Java Android app, Android `MediaCodec`, Android `AudioTrack`, UDP RTP, WebSocket/JSON input return.

---

## File Structure

- `src/stage2/tooling.js`: Detect Stage 2 host dependencies without requiring Python GI.
- `test/stage2-tooling.test.js`: Unit tests for host dependency detection.
- `src/native-streamer/rtp-pipeline.js`: Build video/audio RTP `gst-launch-1.0` command lines.
- `test/rtp-pipeline.test.js`: Unit tests for RTP pipeline generation.
- `src/native-streamer/cli.js`: Add `rtp`, `stage2:check`, and Chinese diagnostics.
- `package.json`: Add `stage2:check` and `native:rtp` scripts.
- `QuickVerify/Program.cs`: Add Chinese menu entries for Stage 2 check and RTP sender.
- `android-tv-receiver/settings.gradle`: Android project settings.
- `android-tv-receiver/build.gradle`: Android Gradle plugin configuration.
- `android-tv-receiver/app/build.gradle`: Android app build configuration.
- `android-tv-receiver/app/src/main/AndroidManifest.xml`: Android TV permissions and activity.
- `android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java`: Main Android TV UI and receiver orchestration.
- `android-tv-receiver/app/src/main/java/com/tvgame/receiver/RtpPacket.java`: Minimal RTP parser.
- `android-tv-receiver/app/src/main/java/com/tvgame/receiver/H264RtpDepacketizer.java`: H.264 RTP packet to Annex B NAL units.
- `android-tv-receiver/app/src/main/java/com/tvgame/receiver/H264VideoReceiver.java`: UDP video receive loop and `MediaCodec` decode.
- `android-tv-receiver/app/src/main/java/com/tvgame/receiver/L16AudioReceiver.java`: UDP audio receive loop and `AudioTrack` playback.
- `android-tv-receiver/app/src/main/java/com/tvgame/receiver/InputClient.java`: Input event sender to PC.
- `android-tv-receiver/app/src/main/java/com/tvgame/receiver/StatsModel.java`: Runtime stats counters for UI.
- `docs/stage2-local-verify.md`: Chinese local verification guide.

---

### Task 1: Stage 2 Host Tooling Detection

**Files:**
- Create: `src/stage2/tooling.js`
- Create: `test/stage2-tooling.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `test/stage2-tooling.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStage2Report } = require('../src/stage2/tooling');

test('stage2 report is ready when GStreamer RTP video and audio plugins exist', () => {
  const report = createStage2Report({
    findExecutable: name => {
      if (name === 'gst-launch-1.0' || name === 'gst-inspect-1.0') {
        return `D:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
      }
      if (name === 'dotnet') return 'C:/Program Files/dotnet/dotnet.exe';
      return null;
    },
    inspectPlugin: () => true
  });

  assert.equal(report.ready, true);
  assert.equal(report.gstreamer.ready, true);
  assert.equal(report.plugins.d3d11screencapturesrc, true);
  assert.equal(report.plugins.nvh264enc, true);
  assert.equal(report.plugins.wasapi2src, true);
  assert.equal(report.plugins.rtpL16pay, true);
});

test('stage2 report does not require Python GStreamer bindings', () => {
  const report = createStage2Report({
    findExecutable: name => name.startsWith('gst-') ? `D:/gstreamer/bin/${name}.exe` : 'C:/dotnet/dotnet.exe',
    inspectPlugin: plugin => plugin !== 'python-gi'
  });

  assert.equal(report.ready, true);
  assert.equal(report.missing.pythonModules.length, 0);
});

test('stage2 report explains missing audio capture plugin', () => {
  const report = createStage2Report({
    findExecutable: name => name.startsWith('gst-') ? `D:/gstreamer/bin/${name}.exe` : 'C:/dotnet/dotnet.exe',
    inspectPlugin: plugin => plugin !== 'wasapi2src'
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.missing.plugins, ['wasapi2src']);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```powershell
npm.cmd test
```

Expected: FAIL because `../src/stage2/tooling` does not exist.

- [ ] **Step 3: Implement Stage 2 detection**

Create `src/stage2/tooling.js`:

```js
'use strict';

const { findExecutable, inspectPlugin } = require('../native-streamer/environment');

const REQUIRED_PLUGINS = [
  'd3d11screencapturesrc',
  'nvh264enc',
  'rtph264pay',
  'h264parse',
  'wasapi2src',
  'audioconvert',
  'audioresample',
  'rtpL16pay',
  'udpsink'
];

function createStage2Report(options = {}) {
  const find = options.findExecutable || findExecutable;
  const inspect = options.inspectPlugin || inspectPlugin;
  const gstLaunch = find('gst-launch-1.0');
  const gstInspect = find('gst-inspect-1.0');
  const dotnet = find('dotnet');
  const plugins = Object.fromEntries(REQUIRED_PLUGINS.map(name => [name, inspect(name)]));
  const missingPlugins = REQUIRED_PLUGINS.filter(name => !plugins[name]);

  return {
    ready: Boolean(gstLaunch && gstInspect && dotnet && missingPlugins.length === 0),
    gstreamer: {
      ready: Boolean(gstLaunch && gstInspect && missingPlugins.length === 0),
      gstLaunch,
      gstInspect
    },
    dotnet: { ready: Boolean(dotnet), path: dotnet },
    plugins,
    missing: {
      executables: [
        !gstLaunch && 'gst-launch-1.0',
        !gstInspect && 'gst-inspect-1.0',
        !dotnet && 'dotnet'
      ].filter(Boolean),
      plugins: missingPlugins,
      pythonModules: []
    }
  };
}

module.exports = { REQUIRED_PLUGINS, createStage2Report };
```

Modify `package.json` scripts:

```json
"stage2:check": "node src/native-streamer/cli.js stage2-check"
```

- [ ] **Step 4: Run the tests to verify they pass**

Run:

```powershell
npm.cmd test
```

Expected: PASS, including the three new Stage 2 tooling tests.

- [ ] **Step 5: Commit**

```powershell
git add package.json src/stage2/tooling.js test/stage2-tooling.test.js
git commit -m "Add stage 2 host tooling detection"
```

---

### Task 2: RTP Video and Audio Pipeline Builder

**Files:**
- Create: `src/native-streamer/rtp-pipeline.js`
- Create: `test/rtp-pipeline.test.js`
- Modify: `package.json`

- [ ] **Step 1: Write the failing tests**

Create `test/rtp-pipeline.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildRtpConfig,
  buildVideoRtpPipeline,
  buildAudioRtpPipeline,
  buildRtpLaunchCommands
} = require('../src/native-streamer/rtp-pipeline');

test('builds 1080p60 H264 RTP video pipeline for Android TV', () => {
  const config = buildRtpConfig({ host: '192.168.1.50' });
  const pipeline = buildVideoRtpPipeline(config);

  assert.match(pipeline, /d3d11screencapturesrc show-cursor=true/);
  assert.match(pipeline, /video\/x-raw\(memory:D3D11Memory\),framerate=60\/1/);
  assert.match(pipeline, /nvh264enc/);
  assert.match(pipeline, /bframes=0/);
  assert.match(pipeline, /bitrate=25000/);
  assert.match(pipeline, /rtph264pay pt=96 config-interval=1/);
  assert.match(pipeline, /udpsink host=192\.168\.1\.50 port=5004 sync=false async=false/);
});

test('builds low latency system audio RTP L16 pipeline', () => {
  const config = buildRtpConfig({ host: '192.168.1.50' });
  const pipeline = buildAudioRtpPipeline(config);

  assert.match(pipeline, /wasapi2src loopback=true low-latency=true/);
  assert.match(pipeline, /audio\/x-raw,format=S16BE,rate=48000,channels=2/);
  assert.match(pipeline, /rtpL16pay pt=97/);
  assert.match(pipeline, /udpsink host=192\.168\.1\.50 port=5006 sync=false async=false/);
});

test('launch commands use gst-launch and separate video and audio ports', () => {
  const commands = buildRtpLaunchCommands(buildRtpConfig({ host: '192.168.1.50' }));

  assert.equal(commands.length, 2);
  assert.equal(commands[0].title, '视频 RTP 发送端');
  assert.equal(commands[1].title, '音频 RTP 发送端');
  assert.equal(commands[0].args[0], '-v');
  assert.ok(commands[0].args.includes('d3d11screencapturesrc'));
  assert.ok(commands[1].args.includes('wasapi2src'));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```powershell
npm.cmd test
```

Expected: FAIL because `src/native-streamer/rtp-pipeline.js` does not exist.

- [ ] **Step 3: Implement the RTP pipeline builder**

Create `src/native-streamer/rtp-pipeline.js`:

```js
'use strict';

function buildRtpConfig(overrides = {}) {
  return {
    host: overrides.host || '127.0.0.1',
    videoPort: Number(overrides.videoPort || 5004),
    audioPort: Number(overrides.audioPort || 5006),
    width: Number(overrides.width || 1920),
    height: Number(overrides.height || 1080),
    fps: Number(overrides.fps || 60),
    bitrateKbps: Number(overrides.bitrateKbps || 25000),
    keyframeInterval: Number(overrides.keyframeInterval || 60),
    displayIndex: Number(overrides.displayIndex || 0)
  };
}

function splitPipeline(pipeline) {
  return pipeline.split(/\s+/).filter(Boolean);
}

function buildVideoRtpPipeline(config) {
  const fps = `${config.fps}/1`;
  return [
    `d3d11screencapturesrc show-cursor=true monitor-index=${config.displayIndex}`,
    '!',
    `video/x-raw(memory:D3D11Memory),framerate=${fps}`,
    '!',
    'd3d11convert',
    '!',
    `video/x-raw(memory:D3D11Memory),format=NV12,width=${config.width},height=${config.height},framerate=${fps}`,
    '!',
    `nvh264enc preset=low-latency-hq rc-mode=cbr bitrate=${config.bitrateKbps} gop-size=${config.keyframeInterval} bframes=0 zero-reorder-delay=true`,
    '!',
    'h264parse config-interval=1',
    '!',
    'rtph264pay pt=96 config-interval=1 aggregate-mode=zero-latency',
    '!',
    `udpsink host=${config.host} port=${config.videoPort} sync=false async=false`
  ].join(' ');
}

function buildAudioRtpPipeline(config) {
  return [
    'wasapi2src loopback=true low-latency=true buffer-time=10000',
    '!',
    'audioconvert',
    '!',
    'audioresample',
    '!',
    'audio/x-raw,format=S16BE,rate=48000,channels=2',
    '!',
    'rtpL16pay pt=97',
    '!',
    `udpsink host=${config.host} port=${config.audioPort} sync=false async=false`
  ].join(' ');
}

function buildRtpLaunchCommands(config) {
  return [
    {
      title: '视频 RTP 发送端',
      executable: 'gst-launch-1.0',
      args: ['-v'].concat(splitPipeline(buildVideoRtpPipeline(config)))
    },
    {
      title: '音频 RTP 发送端',
      executable: 'gst-launch-1.0',
      args: ['-v'].concat(splitPipeline(buildAudioRtpPipeline(config)))
    }
  ];
}

module.exports = {
  buildRtpConfig,
  buildVideoRtpPipeline,
  buildAudioRtpPipeline,
  buildRtpLaunchCommands
};
```

Modify `package.json` scripts:

```json
"native:rtp": "node src/native-streamer/cli.js rtp"
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```powershell
npm.cmd test
```

Expected: PASS, including RTP pipeline tests.

- [ ] **Step 5: Commit**

```powershell
git add package.json src/native-streamer/rtp-pipeline.js test/rtp-pipeline.test.js
git commit -m "Add RTP video and audio pipeline builder"
```

---

### Task 3: CLI and QuickVerify Stage 2 Entries

**Files:**
- Modify: `src/native-streamer/cli.js`
- Modify: `QuickVerify/Program.cs`
- Modify: `test/native-streamer.test.js`

- [ ] **Step 1: Write the failing CLI tests**

Append to `test/native-streamer.test.js`:

```js
const { parseArgs } = require('../src/native-streamer/cli');

test('parseArgs accepts Android TV RTP target options', () => {
  const args = parseArgs(['rtp', '--host', '192.168.1.50', '--video-port', '5004', '--audio-port', '5006']);

  assert.deepEqual(args._, ['rtp']);
  assert.equal(args.host, '192.168.1.50');
  assert.equal(args['video-port'], '5004');
  assert.equal(args['audio-port'], '5006');
});
```

- [ ] **Step 2: Run test to verify it fails or exposes missing behavior**

Run:

```powershell
npm.cmd test
```

Expected: FAIL if `parseArgs` is not exported or PASS for parsing but later manual CLI command lacks `rtp`.

- [ ] **Step 3: Implement `stage2-check` and `rtp` commands**

In `src/native-streamer/cli.js`, add imports:

```js
const { createStage2Report } = require('../stage2/tooling');
const { buildRtpConfig, buildRtpLaunchCommands } = require('./rtp-pipeline');
```

Add functions:

```js
function printStage2Report(report) {
  console.log('阶段 2 发送端环境检测');
  console.log('====================');
  console.log(`GStreamer：${report.gstreamer.ready ? '通过' : '未就绪'}`);
  console.log(`dotnet：${report.dotnet.ready ? report.dotnet.path : '未找到'}`);
  console.log('');
  console.log('插件：');
  for (const [name, found] of Object.entries(report.plugins)) {
    console.log(`  ${found ? '通过' : '缺失'} ${name}`);
  }
  if (!report.ready) {
    console.log('');
    console.log('缺失项：');
    for (const item of report.missing.executables) console.log(`  - ${item}`);
    for (const item of report.missing.plugins) console.log(`  - ${item}`);
  }
}

function runRtpSender(args) {
  const report = createStage2Report();
  if (!report.ready) {
    printStage2Report(report);
    process.exitCode = 1;
    return;
  }

  const config = buildRtpConfig({
    host: args.host,
    videoPort: args['video-port'],
    audioPort: args['audio-port'],
    bitrateKbps: args.bitrate,
    displayIndex: args.display
  });
  const commands = buildRtpLaunchCommands(config);
  const children = commands.map(command => {
    console.log(`启动：${command.title}`);
    return childProcess.spawn(command.executable, command.args, {
      stdio: 'inherit',
      windowsHide: false
    });
  });

  for (const child of children) {
    child.on('exit', code => {
      if (code && process.exitCode !== 1) process.exitCode = code;
    });
  }
}
```

In `main`, add:

```js
if (command === 'stage2-check') {
  printStage2Report(createStage2Report());
  return;
}

if (command === 'rtp') {
  runRtpSender(args);
  return;
}
```

In `QuickVerify/Program.cs`, add menu entries:

```csharp
Console.WriteLine(" 11. 检测阶段 2 原生发送端环境");
Console.WriteLine(" 12. 启动阶段 2 RTP 发送端（需要填写电视 IP）");
```

For choice `11`:

```csharp
StartCommandWindow("阶段 2 环境检测", $"{Quote(NpmCmd())} run stage2:check", root);
Console.WriteLine("已打开阶段 2 环境检测窗口。");
```

For choice `12`, prompt for TV IP and launch:

```csharp
Console.Write("请输入 Android TV IP：");
var tvIp = Console.ReadLine()?.Trim();
if (string.IsNullOrWhiteSpace(tvIp))
{
    Console.WriteLine("电视 IP 不能为空。");
}
else
{
    StartCommandWindow(
        "阶段 2 RTP 发送端",
        $"{Quote(NpmCmd())} run native:rtp -- --host {tvIp}",
        root);
    Console.WriteLine("已打开阶段 2 RTP 发送端窗口。");
}
```

- [ ] **Step 4: Run verification**

Run:

```powershell
npm.cmd test
dotnet build QuickVerify\QuickVerify.csproj
npm.cmd run stage2:check
```

Expected: tests pass; QuickVerify builds; `stage2:check` reports GStreamer RTP video/audio plugins and dotnet status in Chinese.

- [ ] **Step 5: Commit**

```powershell
git add src/native-streamer/cli.js QuickVerify/Program.cs test/native-streamer.test.js
git commit -m "Add stage 2 RTP sender CLI entries"
```

---

### Task 4: Android TV App Skeleton and Metrics UI

**Files:**
- Create: `android-tv-receiver/settings.gradle`
- Create: `android-tv-receiver/build.gradle`
- Create: `android-tv-receiver/app/build.gradle`
- Create: `android-tv-receiver/app/src/main/AndroidManifest.xml`
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java`
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/StatsModel.java`
- Create: `docs/stage2-local-verify.md`

- [ ] **Step 1: Create Android project files**

Create `android-tv-receiver/settings.gradle`:

```gradle
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "TVGameReceiver"
include ":app"
```

Create `android-tv-receiver/build.gradle`:

```gradle
plugins {
    id "com.android.application" version "8.7.3" apply false
}
```

Create `android-tv-receiver/app/build.gradle`:

```gradle
plugins {
    id "com.android.application"
}

android {
    namespace "com.tvgame.receiver"
    compileSdk 35

    defaultConfig {
        applicationId "com.tvgame.receiver"
        minSdk 26
        targetSdk 35
        versionCode 1
        versionName "0.1.0"
    }
}
```

- [ ] **Step 2: Create Android manifest**

Create `android-tv-receiver/app/src/main/AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />
    <uses-feature android:name="android.software.leanback" android:required="false" />

    <application
        android:theme="@style/AppTheme"
        android:label="电视游戏接收端"
        android:usesCleartextTraffic="true">
        <activity
            android:name=".MainActivity"
            android:screenOrientation="landscape"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
                <category android:name="android.intent.category.LEANBACK_LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

Also create `android-tv-receiver/app/src/main/res/values/styles.xml`:

```xml
<resources>
    <style name="AppTheme" parent="android:style/Theme.Material.NoActionBar">
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowNoTitle">true</item>
        <item name="android:fontFamily">sans</item>
        <item name="android:colorAccent">#3B82F6</item>
    </style>
</resources>
```

- [ ] **Step 3: Create metrics model**

Create `StatsModel.java`:

```java
package com.tvgame.receiver;

public final class StatsModel {
    public volatile long videoPackets;
    public volatile long videoFrames;
    public volatile long audioPackets;
    public volatile long audioBytes;
    public volatile long droppedFrames;
    public volatile long lastVideoAtMs;
    public volatile long lastAudioAtMs;

    public String render() {
        return "视频包: " + videoPackets
            + "\n视频帧: " + videoFrames
            + "\n音频包: " + audioPackets
            + "\n音频字节: " + audioBytes
            + "\n丢帧: " + droppedFrames
            + "\n视频状态: " + ageText(lastVideoAtMs)
            + "\n音频状态: " + ageText(lastAudioAtMs);
    }

    private static String ageText(long timestampMs) {
        if (timestampMs <= 0) return "未收到";
        long age = System.currentTimeMillis() - timestampMs;
        return age < 1000 ? "正常" : "超过 " + age + "ms 未更新";
    }
}
```

- [ ] **Step 4: Create MainActivity**

Create `MainActivity.java`:

```java
package com.tvgame.receiver;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.view.SurfaceView;
import android.widget.FrameLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private final StatsModel stats = new StatsModel();
    private TextView overlay;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        SurfaceView surfaceView = new SurfaceView(this);
        overlay = new TextView(this);
        overlay.setTextColor(0xFFFFFFFF);
        overlay.setTextSize(16);
        overlay.setBackgroundColor(0x88000000);
        overlay.setPadding(16, 12, 16, 12);
        overlay.setText("电视游戏接收端\n等待视频和音频");

        FrameLayout root = new FrameLayout(this);
        root.addView(surfaceView, new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.MATCH_PARENT,
            FrameLayout.LayoutParams.MATCH_PARENT
        ));
        FrameLayout.LayoutParams overlayParams = new FrameLayout.LayoutParams(
            FrameLayout.LayoutParams.WRAP_CONTENT,
            FrameLayout.LayoutParams.WRAP_CONTENT,
            Gravity.TOP | Gravity.START
        );
        root.addView(overlay, overlayParams);
        setContentView(root);

        overlay.postDelayed(new Runnable() {
            @Override
            public void run() {
                overlay.setText("电视游戏接收端\n" + stats.render());
                overlay.postDelayed(this, 500);
            }
        }, 500);
    }
}
```

- [ ] **Step 5: Add local verification guide**

Create `docs/stage2-local-verify.md`:

```md
# 阶段 2 本地验证

## 目标

第一版验证 1080p60 画面、PC 系统声音、输入回传和接收端指标。

## PC 端

```powershell
npm.cmd run stage2:check
npm.cmd run native:rtp -- --host <Android TV IP>
```

## Android TV 端

安装 `android-tv-receiver` 生成的 APK，打开“电视游戏接收端”。第一版默认监听：

- 视频 RTP：UDP 5004
- 音频 RTP：UDP 5006
- 输入回传：TCP 8789，由 Task 6 接入 Android 按键事件和 PC relay
```

- [ ] **Step 6: Verify file presence**

Run:

```powershell
Test-Path android-tv-receiver\settings.gradle
Test-Path android-tv-receiver\app\src\main\java\com\tvgame\receiver\MainActivity.java
```

Expected: both commands print `True`.

- [ ] **Step 7: Commit**

```powershell
git add android-tv-receiver docs/stage2-local-verify.md
git commit -m "Add Android TV receiver app skeleton"
```

---

### Task 5: Android RTP Video and Audio Receivers

**Files:**
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/RtpPacket.java`
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/H264RtpDepacketizer.java`
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/H264VideoReceiver.java`
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/L16AudioReceiver.java`
- Modify: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java`

- [ ] **Step 1: Create RTP packet parser**

Create `RtpPacket.java`:

```java
package com.tvgame.receiver;

public final class RtpPacket {
    public final int payloadType;
    public final int sequenceNumber;
    public final long timestamp;
    public final boolean marker;
    public final byte[] payload;
    public final int payloadLength;

    private RtpPacket(int payloadType, int sequenceNumber, long timestamp, boolean marker, byte[] payload, int payloadLength) {
        this.payloadType = payloadType;
        this.sequenceNumber = sequenceNumber;
        this.timestamp = timestamp;
        this.marker = marker;
        this.payload = payload;
        this.payloadLength = payloadLength;
    }

    public static RtpPacket parse(byte[] buffer, int length) {
        if (length < 12) throw new IllegalArgumentException("RTP 包太短");
        int version = (buffer[0] >> 6) & 0x03;
        if (version != 2) throw new IllegalArgumentException("RTP 版本不是 2");
        int csrcCount = buffer[0] & 0x0F;
        int headerLength = 12 + csrcCount * 4;
        if (length < headerLength) throw new IllegalArgumentException("RTP 头不完整");
        boolean marker = (buffer[1] & 0x80) != 0;
        int payloadType = buffer[1] & 0x7F;
        int sequenceNumber = ((buffer[2] & 0xFF) << 8) | (buffer[3] & 0xFF);
        long timestamp = ((long)(buffer[4] & 0xFF) << 24)
            | ((long)(buffer[5] & 0xFF) << 16)
            | ((long)(buffer[6] & 0xFF) << 8)
            | (long)(buffer[7] & 0xFF);
        int payloadLength = length - headerLength;
        byte[] payload = new byte[payloadLength];
        System.arraycopy(buffer, headerLength, payload, 0, payloadLength);
        return new RtpPacket(payloadType, sequenceNumber, timestamp, marker, payload, payloadLength);
    }
}
```

- [ ] **Step 2: Create H.264 depacketizer**

Create `H264RtpDepacketizer.java`:

```java
package com.tvgame.receiver;

import java.io.ByteArrayOutputStream;
import java.util.ArrayList;
import java.util.List;

public final class H264RtpDepacketizer {
    private final ByteArrayOutputStream fuBuffer = new ByteArrayOutputStream(128 * 1024);
    private static final byte[] START_CODE = new byte[] {0, 0, 0, 1};

    public List<byte[]> accept(RtpPacket packet) {
        List<byte[]> nalUnits = new ArrayList<>();
        if (packet.payloadLength == 0) return nalUnits;

        int nalType = packet.payload[0] & 0x1F;
        if (nalType >= 1 && nalType <= 23) {
            nalUnits.add(withStartCode(packet.payload, packet.payloadLength));
            return nalUnits;
        }

        if (nalType == 24) {
            int offset = 1;
            while (offset + 2 <= packet.payloadLength) {
                int size = ((packet.payload[offset] & 0xFF) << 8) | (packet.payload[offset + 1] & 0xFF);
                offset += 2;
                if (offset + size > packet.payloadLength) break;
                byte[] nal = new byte[size];
                System.arraycopy(packet.payload, offset, nal, 0, size);
                nalUnits.add(withStartCode(nal, size));
                offset += size;
            }
            return nalUnits;
        }

        if (nalType == 28 && packet.payloadLength >= 2) {
            int fuIndicator = packet.payload[0] & 0xFF;
            int fuHeader = packet.payload[1] & 0xFF;
            boolean start = (fuHeader & 0x80) != 0;
            boolean end = (fuHeader & 0x40) != 0;
            int reconstructedNal = (fuIndicator & 0xE0) | (fuHeader & 0x1F);
            if (start) {
                fuBuffer.reset();
                fuBuffer.write(reconstructedNal);
            }
            fuBuffer.write(packet.payload, 2, packet.payloadLength - 2);
            if (end) {
                nalUnits.add(withStartCode(fuBuffer.toByteArray(), fuBuffer.size()));
                fuBuffer.reset();
            }
        }

        return nalUnits;
    }

    private static byte[] withStartCode(byte[] nal, int length) {
        byte[] out = new byte[START_CODE.length + length];
        System.arraycopy(START_CODE, 0, out, 0, START_CODE.length);
        System.arraycopy(nal, 0, out, START_CODE.length, length);
        return out;
    }
}
```

- [ ] **Step 3: Create video receiver**

Create `H264VideoReceiver.java` with a UDP loop that parses RTP and feeds `MediaCodec`:

```java
package com.tvgame.receiver;

import android.media.MediaCodec;
import android.media.MediaFormat;
import android.view.Surface;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.util.List;

public final class H264VideoReceiver implements Runnable {
    private final Surface surface;
    private final StatsModel stats;
    private volatile boolean running = true;

    public H264VideoReceiver(Surface surface, StatsModel stats) {
        this.surface = surface;
        this.stats = stats;
    }

    public void stop() {
        running = false;
    }

    @Override
    public void run() {
        try {
            MediaCodec decoder = MediaCodec.createDecoderByType("video/avc");
            MediaFormat format = MediaFormat.createVideoFormat("video/avc", 1920, 1080);
            decoder.configure(format, surface, null, 0);
            decoder.start();
            H264RtpDepacketizer depacketizer = new H264RtpDepacketizer();
            DatagramSocket socket = new DatagramSocket(5004);
            byte[] buffer = new byte[1500];

            while (running) {
                DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
                socket.receive(datagram);
                stats.videoPackets++;
                stats.lastVideoAtMs = System.currentTimeMillis();
                RtpPacket packet = RtpPacket.parse(datagram.getData(), datagram.getLength());
                List<byte[]> nalUnits = depacketizer.accept(packet);
                for (byte[] nal : nalUnits) {
                    int input = decoder.dequeueInputBuffer(0);
                    if (input < 0) {
                        stats.droppedFrames++;
                        continue;
                    }
                    decoder.getInputBuffer(input).clear();
                    decoder.getInputBuffer(input).put(nal);
                    decoder.queueInputBuffer(input, 0, nal.length, System.nanoTime() / 1000, 0);
                    MediaCodec.BufferInfo info = new MediaCodec.BufferInfo();
                    int output;
                    while ((output = decoder.dequeueOutputBuffer(info, 0)) >= 0) {
                        decoder.releaseOutputBuffer(output, true);
                        stats.videoFrames++;
                    }
                }
            }
            socket.close();
            decoder.stop();
            decoder.release();
        } catch (Exception ex) {
            stats.droppedFrames++;
        }
    }
}
```

- [ ] **Step 4: Create L16 audio receiver**

Create `L16AudioReceiver.java`:

```java
package com.tvgame.receiver;

import android.media.AudioAttributes;
import android.media.AudioFormat;
import android.media.AudioTrack;
import java.net.DatagramPacket;
import java.net.DatagramSocket;

public final class L16AudioReceiver implements Runnable {
    private final StatsModel stats;
    private volatile boolean running = true;

    public L16AudioReceiver(StatsModel stats) {
        this.stats = stats;
    }

    public void stop() {
        running = false;
    }

    @Override
    public void run() {
        try {
            int sampleRate = 48000;
            int minBuffer = AudioTrack.getMinBufferSize(
                sampleRate,
                AudioFormat.CHANNEL_OUT_STEREO,
                AudioFormat.ENCODING_PCM_16BIT
            );
            AudioTrack track = new AudioTrack.Builder()
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                .setAudioFormat(new AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(sampleRate)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_STEREO)
                    .build())
                .setBufferSizeInBytes(Math.max(minBuffer, 4096))
                .setTransferMode(AudioTrack.MODE_STREAM)
                .build();
            track.play();
            DatagramSocket socket = new DatagramSocket(5006);
            byte[] buffer = new byte[1500];

            while (running) {
                DatagramPacket datagram = new DatagramPacket(buffer, buffer.length);
                socket.receive(datagram);
                RtpPacket packet = RtpPacket.parse(datagram.getData(), datagram.getLength());
                byte[] littleEndian = convertBigEndianToLittleEndian(packet.payload, packet.payloadLength);
                track.write(littleEndian, 0, littleEndian.length);
                stats.audioPackets++;
                stats.audioBytes += littleEndian.length;
                stats.lastAudioAtMs = System.currentTimeMillis();
            }
            socket.close();
            track.stop();
            track.release();
        } catch (Exception ex) {
            stats.lastAudioAtMs = 0;
        }
    }

    private static byte[] convertBigEndianToLittleEndian(byte[] input, int length) {
        byte[] out = new byte[length];
        for (int i = 0; i + 1 < length; i += 2) {
            out[i] = input[i + 1];
            out[i + 1] = input[i];
        }
        return out;
    }
}
```

- [ ] **Step 5: Wire receivers into MainActivity**

Modify `MainActivity.java` so `surfaceCreated` starts video/audio threads:

```java
surfaceView.getHolder().addCallback(new android.view.SurfaceHolder.Callback() {
    @Override
    public void surfaceCreated(android.view.SurfaceHolder holder) {
        new Thread(new H264VideoReceiver(holder.getSurface(), stats), "tvgame-video").start();
        new Thread(new L16AudioReceiver(stats), "tvgame-audio").start();
    }

    @Override public void surfaceChanged(android.view.SurfaceHolder holder, int format, int width, int height) {}
    @Override public void surfaceDestroyed(android.view.SurfaceHolder holder) {}
});
```

- [ ] **Step 6: Build or record missing Android tooling**

Run:

```powershell
cd android-tv-receiver
gradle :app:assembleDebug
```

Expected on the current machine: FAIL until Java/Gradle/Android SDK are installed. Record the exact error in `docs/stage2-local-verify.md` under “Android 构建工具缺失时”.

- [ ] **Step 7: Commit**

```powershell
git add android-tv-receiver docs/stage2-local-verify.md
git commit -m "Add Android RTP video and audio receivers"
```

---

### Task 6: Input Return and Verification Flow

**Files:**
- Create: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/InputClient.java`
- Modify: `android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java`
- Modify: `docs/stage2-local-verify.md`

- [ ] **Step 1: Create input client**

Create `InputClient.java`:

```java
package com.tvgame.receiver;

import java.io.OutputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;

public final class InputClient {
    private final String host;
    private final int port;

    public InputClient(String host, int port) {
        this.host = host;
        this.port = port;
    }

    public void sendKey(String action, int keyCode) {
        sendJson("{\"type\":\"input\",\"kind\":\"keyboard\",\"action\":\""
            + action + "\",\"keyCode\":" + keyCode + "}");
    }

    private void sendJson(String json) {
        new Thread(() -> {
            try (Socket socket = new Socket(host, port)) {
                OutputStream out = socket.getOutputStream();
                out.write((json + "\n").getBytes(StandardCharsets.UTF_8));
                out.flush();
            } catch (Exception ignored) {
            }
        }, "tvgame-input").start();
    }
}
```

- [ ] **Step 2: Capture Android key events**

Modify `MainActivity.java`:

```java
private InputClient inputClient;

@Override
protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);
    inputClient = new InputClient("192.168.1.178", 8789);
    // 保留 Task 4 已创建的 SurfaceView、状态面板和接收线程初始化代码。
}

@Override
public boolean onKeyDown(int keyCode, android.view.KeyEvent event) {
    inputClient.sendKey("down", keyCode);
    return true;
}

@Override
public boolean onKeyUp(int keyCode, android.view.KeyEvent event) {
    inputClient.sendKey("up", keyCode);
    return true;
}
```

- [ ] **Step 3: Add PC-side input relay plan note**

Update `docs/stage2-local-verify.md`:

```md
## 输入回传

Android TV 第一版会把按键事件发到 PC `8789`。PC 端需要一个小型 TCP/JSON relay，把这些事件转给现有 `InputBridge` 或直接调用 `SendInput`。如果 relay 还未实现，视频和声音验证不受影响。
```

- [ ] **Step 4: Manual verification checklist**

Append to `docs/stage2-local-verify.md`:

```md
## 验收记录

- [ ] Android TV App 能启动并显示中文状态面板
- [ ] PC `stage2:check` 显示 GStreamer 视频/音频插件通过
- [ ] PC `native:rtp -- --host <电视IP>` 能启动视频和音频发送进程
- [ ] 电视能显示视频包计数增长
- [ ] 电视能显示音频包计数增长
- [ ] 电视能播放 PC 系统声音
- [ ] 输入回传能到达 PC relay
```

- [ ] **Step 5: Commit**

```powershell
git add android-tv-receiver docs/stage2-local-verify.md
git commit -m "Add Android input return skeleton"
```

---

## Plan Self-Review

- Spec coverage: The plan covers Android TV receiver, PC sender without Python GI, system audio, metrics, input return, and dependency detection. It does not fully productize `TVGame-Host-Setup.exe`; it creates the first unified dependency check and QuickVerify entries, matching the Stage 2 MVP rather than the long-term productization target.
- Placeholder scan: No task uses placeholder markers or unspecified test instructions. Each task includes files, code, commands, and expected outcomes.
- Type consistency: Java classes use the package `com.tvgame.receiver`; Node functions exported in tests are defined in the planned implementation files; script names match `package.json` additions.
