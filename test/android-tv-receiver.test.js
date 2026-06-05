'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const javaRoot = 'android-tv-receiver/app/src/main/java/com/tvgame/receiver';

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assertFileExists(relativePath) {
  assert.equal(fs.existsSync(path.join(root, relativePath)), true, `${relativePath} should exist`);
}

function commandExists(command) {
  const lookup = process.platform === 'win32' ? 'where.exe' : 'which';
  const result = spawnSync(lookup, [command], { stdio: 'ignore' });
  return result.status === 0;
}

test('Android TV receiver skeleton and RTP receiver files exist', () => {
  const files = [
    'android-tv-receiver/settings.gradle',
    'android-tv-receiver/build.gradle',
    'android-tv-receiver/app/build.gradle',
    'android-tv-receiver/app/src/main/AndroidManifest.xml',
    'android-tv-receiver/app/src/main/res/values/styles.xml',
    `${javaRoot}/MainActivity.java`,
    `${javaRoot}/StatsModel.java`,
    `${javaRoot}/RtpPacket.java`,
    `${javaRoot}/H264RtpDepacketizer.java`,
    `${javaRoot}/H264VideoReceiver.java`,
    `${javaRoot}/L16AudioReceiver.java`,
    `${javaRoot}/InputClient.java`,
    'docs/stage2-local-verify.md'
  ];

  for (const file of files) {
    assertFileExists(file);
  }
});

test('Android TV receiver Gradle files use the required app identity and SDKs', () => {
  const settings = readProjectFile('android-tv-receiver/settings.gradle');
  const rootBuild = readProjectFile('android-tv-receiver/build.gradle');
  const appBuild = readProjectFile('android-tv-receiver/app/build.gradle');

  assert.match(settings, /rootProject\.name\s*=\s*"TVGameReceiver"/);
  assert.match(settings, /include\s+":app"/);
  assert.match(rootBuild, /com\.android\.application"\s+version\s+"8\.7\.3"/);
  assert.match(appBuild, /namespace\s+"com\.tvgame\.receiver"/);
  assert.match(appBuild, /applicationId\s+"com\.tvgame\.receiver"/);
  assert.match(appBuild, /compileSdk\s+35/);
  assert.match(appBuild, /minSdk\s+30/);
  assert.match(appBuild, /targetSdk\s+35/);
  assert.match(appBuild, /manifestPlaceholders/);
  assert.match(appBuild, /inputRelayHost/);
  assert.match(appBuild, /192\.168\.50\.148/);
  assert.match(appBuild, /versionName\s+"0\.1\.0"/);
});

test('Android TV manifest exposes Chinese Leanback app with required permissions', () => {
  const manifest = readProjectFile('android-tv-receiver/app/src/main/AndroidManifest.xml');

  assert.match(manifest, /android\.permission\.INTERNET/);
  assert.match(manifest, /android\.permission\.ACCESS_NETWORK_STATE/);
  assert.match(manifest, /android\.intent\.category\.LEANBACK_LAUNCHER/);
  assert.match(manifest, /android:screenOrientation="landscape"/);
  assert.match(manifest, /android:usesCleartextTraffic="true"/);
  assert.match(manifest, /android:label="电视游戏接收端"/);
  assert.match(manifest, /android:theme="@style\/AppTheme"/);
  assert.match(manifest, /android:name="com\.tvgame\.receiver\.INPUT_RELAY_HOST"/);
  assert.match(manifest, /android:value="\$\{inputRelayHost\}"/);
});

test('InputClient sends safe newline-delimited UTF-8 input JSON on a background thread', () => {
  const source = readProjectFile(`${javaRoot}/InputClient.java`);

  assert.match(source, /public\s+InputClient\(String\s+host,\s*int\s+port\)/);
  assert.match(source, /public\s+void\s+sendKey\(String\s+action,\s*int\s+keyCode\)/);
  assert.match(source, /static\s+String\s+buildKeyJsonLine\(String\s+action,\s*int\s+keyCode\)/);
  assert.match(source, /public\s+void\s+(close|stop)\(\)/);
  assert.match(source, /ExecutorService/);
  assert.match(source, /ThreadPoolExecutor/);
  assert.match(source, /ArrayBlockingQueue<\s*Runnable\s*>/);
  assert.match(source, /INPUT_QUEUE_CAPACITY\s*=\s*(16|32)/);
  assert.match(source, /DiscardOldestPolicy|DiscardPolicy/);
  assert.doesNotMatch(source, /newSingleThreadExecutor/);
  assert.match(source, /tvgame-input/);
  assert.match(source, /Socket/);
  assert.match(source, /connect\(.*CONNECT_TIMEOUT_MS\)/s);
  assert.match(source, /setSoTimeout\(SOCKET_TIMEOUT_MS\)/);
  assert.match(source, /StandardCharsets\.UTF_8/);
  assert.match(source, /\\"type\\":\\"input\\"/);
  assert.match(source, /\\"kind\\":\\"keyboard\\"/);
  assert.match(source, /\\n/);
  assert.match(source, /"down"\.equals\(action\)\s*\|\|\s*"up"\.equals\(action\)/);
  assert.match(source, /keyCode\s*<\s*0/);
  assert.match(source, /keyCode\s*>\s*MAX_KEY_CODE/);
  assert.match(source, /IllegalArgumentException/);
  assert.match(source, /if\s*\(\s*closed/);
  assert.match(source, /catch\s*\(\s*IOException\s+\w+\s*\)/);
});

test('InputClient validates key JSON before enqueue and keeps the UI path bounded', () => {
  const source = readProjectFile(`${javaRoot}/InputClient.java`);

  assert.match(source, /if\s*\(\s*closed\s*\)\s*\{\s*return;\s*\}\s*final\s+String\s+line;\s*try\s*\{\s*line\s*=\s*buildKeyJsonLine\(action,\s*keyCode\)/s);
  assert.match(source, /catch\s*\(\s*IllegalArgumentException\s+\w+\s*\)\s*\{\s*return;\s*\}/);
  assert.match(source, /catch\s*\(\s*RejectedExecutionException\s+\w+\s*\)/);
  assert.match(source, /new\s+ThreadPoolExecutor\(\s*1,\s*1,\s*0L,\s*TimeUnit\.MILLISECONDS/s);
  assert.match(source, /new\s+ArrayBlockingQueue<\s*Runnable\s*>\(INPUT_QUEUE_CAPACITY\)/);
});

test('InputClient keeps one TCP connection open with Nagle disabled for low latency input', () => {
  const source = readProjectFile(`${javaRoot}/InputClient.java`);

  assert.match(source, /private\s+Socket\s+socket/);
  assert.match(source, /private\s+OutputStream\s+output/);
  assert.match(source, /getOrCreateSocket\(\)/);
  assert.match(source, /setTcpNoDelay\(true\)/);
  assert.match(source, /socket\.isConnected\(\)/);
  assert.match(source, /!socket\.isClosed\(\)/);
  assert.match(source, /closeSocket\(\)/);
});

test('InputClient can send browser-style keyboard code JSON for mapped gamepad axes', () => {
  const source = readProjectFile(`${javaRoot}/InputClient.java`);

  assert.match(source, /public\s+void\s+sendCode\(String\s+action,\s*String\s+code\)/);
  assert.match(source, /buildCodeJsonLine\(action,\s*code\)/);
  assert.match(source, /MAX_CODE_LENGTH\s*=\s*32/);
  assert.match(source, /code\.matches\("\[A-Za-z0-9_\\\\-\]\+"\)/);
  assert.match(source, /\\",\\"code\\":\\"/);
  assert.match(source, /\+\s*code\s*\+\s*"\\?"/);
});

test('InputClient can send mouse JSON for mapped gamepad right stick and triggers', () => {
  const source = readProjectFile(`${javaRoot}/InputClient.java`);

  assert.match(source, /public\s+void\s+sendMouseMove\(int\s+dx,\s*int\s+dy\)/);
  assert.match(source, /public\s+void\s+sendMouseButton\(String\s+action,\s*int\s+button\)/);
  assert.match(source, /buildMouseMoveJsonLine\(dx,\s*dy\)/);
  assert.match(source, /buildMouseButtonJsonLine\(action,\s*button\)/);
  assert.match(source, /\\"kind\\":\\"mouse\\"/);
  assert.match(source, /\\"action\\":\\"move\\"/);
  assert.match(source, /\\"dx\\":/);
  assert.match(source, /\\"dy\\":/);
  assert.match(source, /button\s*<\s*0\s*\|\|\s*button\s*>\s*2/);
});

test('InputClient.buildKeyJsonLine returns exact JSON lines and rejects invalid input', (t) => {
  if (!commandExists('javac') || !commandExists('java')) {
    t.skip('javac/java not available; keeping InputClient behavior covered by static checks in this environment');
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tvgame-input-client-'));
  const packageDir = path.join(tempRoot, 'com', 'tvgame', 'receiver');
  const classDir = path.join(tempRoot, 'classes');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(classDir, { recursive: true });

  const inputClientSource = path.join(root, `${javaRoot}/InputClient.java`);
  const harnessSource = path.join(packageDir, 'InputClientHarness.java');
  fs.writeFileSync(harnessSource, `
package com.tvgame.receiver;

public final class InputClientHarness {
    public static void main(String[] args) {
        assertEquals("{\\"type\\":\\"input\\",\\"kind\\":\\"keyboard\\",\\"action\\":\\"down\\",\\"keyCode\\":66}\\n", InputClient.buildKeyJsonLine("down", 66));
        assertEquals("{\\"type\\":\\"input\\",\\"kind\\":\\"keyboard\\",\\"action\\":\\"up\\",\\"keyCode\\":23}\\n", InputClient.buildKeyJsonLine("up", 23));
        assertEquals("{\\"type\\":\\"input\\",\\"kind\\":\\"keyboard\\",\\"action\\":\\"down\\",\\"code\\":\\"KeyW\\"}\\n", InputClient.buildCodeJsonLine("down", "KeyW"));
        assertEquals("{\\"type\\":\\"input\\",\\"kind\\":\\"mouse\\",\\"action\\":\\"move\\",\\"dx\\":7,\\"dy\\":-5}\\n", InputClient.buildMouseMoveJsonLine(7, -5));
        assertEquals("{\\"type\\":\\"input\\",\\"kind\\":\\"mouse\\",\\"action\\":\\"down\\",\\"button\\":0}\\n", InputClient.buildMouseButtonJsonLine("down", 0));
        assertEquals("{\\"type\\":\\"input\\",\\"kind\\":\\"mouse\\",\\"action\\":\\"up\\",\\"button\\":2}\\n", InputClient.buildMouseButtonJsonLine("up", 2));
        assertThrows(new Runnable() {
            @Override
            public void run() {
                InputClient.buildKeyJsonLine("press", 1);
            }
        });
        assertThrows(new Runnable() {
            @Override
            public void run() {
                InputClient.buildKeyJsonLine("down", -1);
            }
        });
        assertThrows(new Runnable() {
            @Override
            public void run() {
                InputClient.buildKeyJsonLine("up", 10001);
            }
        });
        assertThrows(new Runnable() {
            @Override
            public void run() {
                InputClient.buildMouseButtonJsonLine("down", 3);
            }
        });
    }

    private static void assertEquals(String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError("Expected [" + expected + "] but got [" + actual + "]");
        }
    }

    private static void assertThrows(Runnable runnable) {
        try {
            runnable.run();
        } catch (IllegalArgumentException ex) {
            return;
        }
        throw new AssertionError("Expected IllegalArgumentException");
    }
}
`, 'utf8');

  execFileSync('javac', ['-encoding', 'UTF-8', '-d', classDir, inputClientSource, harnessSource], { stdio: 'pipe' });
  execFileSync('java', ['-cp', classDir, 'com.tvgame.receiver.InputClientHarness'], { stdio: 'pipe' });
});

test('StatsModel renders realtime one-second frame and drop metrics', (t) => {
  if (!commandExists('javac') || !commandExists('java')) {
    t.skip('javac/java not available; keeping StatsModel behavior covered by static checks in this environment');
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tvgame-stats-model-'));
  const packageDir = path.join(tempRoot, 'com', 'tvgame', 'receiver');
  const classDir = path.join(tempRoot, 'classes');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(classDir, { recursive: true });

  const statsSource = path.join(root, `${javaRoot}/StatsModel.java`);
  const harnessSource = path.join(packageDir, 'StatsModelHarness.java');
  fs.writeFileSync(harnessSource, `
package com.tvgame.receiver;

public final class StatsModelHarness {
    public static void main(String[] args) {
        StatsModel stats = new StatsModel();
        stats.lastVideoAtMs = 1000;
        stats.lastAudioAtMs = 1000;
        stats.videoFrames = 60;
        stats.droppedFrames = 6;
        stats.videoQueueDrops = 4;
        stats.videoDecoderDrops = 2;
        stats.videoRtpLossPackets = 1;
        stats.render(1000);

        stats.videoFrames = 120;
        stats.droppedFrames = 9;
        stats.videoQueueDrops = 6;
        stats.videoDecoderDrops = 3;
        stats.videoRtpLossPackets = 4;
        String text = stats.render(2000);

        assertContains(text, "实时FPS: 60");
        assertContains(text, "实时视频丢包: 3");
        assertContains(text, "实时丢帧: 3");
        assertContains(text, "实时丢帧率: 4.8%");
        assertContains(text, "实时队列丢帧: 2");
        assertContains(text, "实时解码丢帧: 1");
    }

    private static void assertContains(String text, String expected) {
        if (!text.contains(expected)) {
            throw new AssertionError("Expected text to contain [" + expected + "] but got [" + text + "]");
        }
    }
}
`, 'utf8');

  execFileSync('javac', ['-encoding', 'UTF-8', '-d', classDir, statsSource, harnessSource], { stdio: 'pipe' });
  execFileSync('java', ['-cp', classDir, 'com.tvgame.receiver.StatsModelHarness'], { stdio: 'pipe' });
});

test('StatsModel renders compact diagnostics for smaller TV overlay', (t) => {
  if (!commandExists('javac') || !commandExists('java')) {
    t.skip('javac/java not available; keeping StatsModel behavior covered by static checks in this environment');
    return;
  }

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tvgame-stats-model-compact-'));
  const packageDir = path.join(tempRoot, 'com', 'tvgame', 'receiver');
  const classDir = path.join(tempRoot, 'classes');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(classDir, { recursive: true });

  const statsSource = path.join(root, `${javaRoot}/StatsModel.java`);
  const harnessSource = path.join(packageDir, 'StatsModelCompactHarness.java');
  fs.writeFileSync(harnessSource, `
package com.tvgame.receiver;

public final class StatsModelCompactHarness {
    public static void main(String[] args) {
        StatsModel stats = new StatsModel();
        stats.lastVideoAtMs = 1000;
        stats.lastAudioAtMs = 1000;
        stats.videoPackets = 1000;
        stats.videoFrames = 60;
        stats.videoRtpLossPackets = 2;
        stats.videoRecoveryWaits = 3;
        stats.videoRecoveryDrops = 4;
        stats.videoQueueDrops = 5;
        stats.videoDecoderDrops = 6;
        stats.audioPackets = 700;
        stats.audioBytes = 1048576;
        stats.renderCompact(1000);

        stats.videoFrames = 120;
        stats.videoRtpLossPackets = 5;
        stats.videoQueueDrops = 8;
        stats.videoDecoderDrops = 7;
        String text = stats.renderCompact(2000);

        assertContains(text, "FPS 60");
        assertContains(text, "实时丢包 3");
        assertContains(text, "等待关键 3");
        assertContains(text, "恢复 4");
        assertContains(text, "队列 8");
        assertContains(text, "解码 7");
        assertContains(text, "音频 正常");

        int lines = text.split("\\\\n", -1).length;
        if (lines > 5) {
            throw new AssertionError("Compact stats should use at most 5 lines, got " + lines + ": " + text);
        }
    }

    private static void assertContains(String text, String expected) {
        if (!text.contains(expected)) {
            throw new AssertionError("Expected text to contain [" + expected + "] but got [" + text + "]");
        }
    }
}
`, 'utf8');

  execFileSync('javac', ['-encoding', 'UTF-8', '-d', classDir, statsSource, harnessSource], { stdio: 'pipe' });
  execFileSync('java', ['-cp', classDir, 'com.tvgame.receiver.StatsModelCompactHarness'], { stdio: 'pipe' });
});

test('MainActivity uses a compact smaller overlay by default', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /overlay\.setTextSize\(12\)/);
  assert.match(source, /overlay\.setPadding\(8,\s*6,\s*8,\s*6\)/);
  assert.match(source, /stats\.renderCompact\(\)/);
  assert.doesNotMatch(source, /stats\.render\(\)/);
});

test('MainActivity keeps the TV screen awake while the receiver is open', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /import\s+android\.view\.WindowManager/);
  assert.match(source, /getWindow\(\)\.addFlags\(WindowManager\.LayoutParams\.FLAG_KEEP_SCREEN_ON\)/);
});

test('RtpPacket parser handles RTP v2 headers, CSRC and copied payload', () => {
  const source = readProjectFile(`${javaRoot}/RtpPacket.java`);

  assert.match(source, /public\s+static\s+RtpPacket\s+parse\(byte\[\]\s+buffer,\s*int\s+length\)/);
  assert.match(source, /length\s*<\s*0\s*\|\|\s*length\s*>\s*buffer\.length/);
  assert.match(source, /version\s*!=\s*2/);
  assert.match(source, /IllegalArgumentException\("RTP/);
  assert.match(source, /csrcCount\s*\*\s*4/);
  assert.match(source, /12\s*\+\s*csrcCount\s*\*\s*4/);
  assert.match(source, /hasExtension/);
  assert.match(source, /extensionWords/);
  assert.match(source, /extensionBytes\s*=\s*extensionWords\s*\*\s*4/);
  assert.match(source, /hasPadding/);
  assert.match(source, /paddingLength/);
  assert.match(source, /payloadEnd\s*-=\s*paddingLength/);
  assert.match(source, /Arrays\.copyOfRange\(buffer,\s*payloadOffset,\s*payloadEnd\)/);
  assert.match(source, /payloadType/);
  assert.match(source, /sequenceNumber/);
  assert.match(source, /timestamp/);
  assert.match(source, /marker/);
});

test('H264 RTP depacketizer supports single NAL, STAP-A and FU-A safely', () => {
  const source = readProjectFile(`${javaRoot}/H264RtpDepacketizer.java`);

  assert.match(source, /START_CODE\s*=\s*new\s+byte\[\]\s*\{\s*0,\s*0,\s*0,\s*1\s*\}/);
  assert.match(source, /MAX_REASSEMBLED_NAL_SIZE\s*=\s*2\s*\*\s*1024\s*\*\s*1024/);
  assert.match(source, /nalType\s*>=\s*1\s*&&\s*nalType\s*<=\s*23/);
  assert.match(source, /nalType\s*==\s*24/);
  assert.match(source, /nalType\s*==\s*28/);
  assert.match(source, /startBit/);
  assert.match(source, /endBit/);
  assert.match(source, /expectedSequenceNumber/);
  assert.match(source, /fragmentTimestamp/);
  assert.match(source, /packet\.sequenceNumber/);
  assert.match(source, /packet\.timestamp/);
  assert.match(source, /nextSequenceNumber/);
  assert.match(source, /fragmentBuffer\.reset\(\)/);
  assert.match(source, /fragmentStarted/);
  assert.match(source, /resetFragment\(\)/);
  assert.match(source, /fragmentBuffer\.size\(\)\s*\+\s*payloadLength\s*-\s*2\s*>\s*MAX_REASSEMBLED_NAL_SIZE/);
  assert.match(source, /out\.clear\(\)/);
});

test('video and audio receivers use required ports, codecs and stats', () => {
  const video = readProjectFile(`${javaRoot}/H264VideoReceiver.java`);
  const audio = readProjectFile(`${javaRoot}/L16AudioReceiver.java`);

  assert.match(video, /VIDEO_PORT\s*=\s*5004/);
  assert.match(video, /MediaCodec\.createDecoderByType\("video\/avc"\)/);
  assert.match(video, /MediaFormat\.createVideoFormat\("video\/avc",\s*1920,\s*1080\)/);
  assert.match(video, /MediaFormat\.KEY_LOW_LATENCY/);
  assert.match(video, /MediaCodec\.PARAMETER_KEY_LOW_LATENCY/);
  assert.match(video, /setInteger\(MediaFormat\.KEY_PRIORITY,\s*0\)/);
  assert.match(video, /setInteger\(MediaFormat\.KEY_OPERATING_RATE,\s*60\)/);
  assert.match(video, /stats\.videoPackets\+\+/);
  assert.match(video, /recordVideoSequence\(packet\.sequenceNumber\)/);
  assert.match(video, /stats\.videoRtpLossPackets\s*\+=\s*lostPackets/);
  assert.match(video, /accessUnitDamaged\s*=\s*true/);
  assert.match(video, /waitingForKeyframe\s*=\s*true/);
  assert.match(video, /accessUnitContainsIdr\(accessUnit\)/);
  assert.match(video, /stats\.videoRecoveryWaits\+\+/);
  assert.match(video, /stats\.videoRecoveryDrops\+\+/);
  assert.match(video, /VIDEO_RECEIVE_BUFFER_BYTES\s*=\s*4\s*\*\s*1024\s*\*\s*1024/);
  assert.match(video, /socket\.setReceiveBufferSize\(VIDEO_RECEIVE_BUFFER_BYTES\)/);
  assert.match(video, /stats\.videoReceiveBufferBytes\s*=\s*socket\.getReceiveBufferSize\(\)/);
  assert.match(video, /ArrayBlockingQueue<\s*EncodedFrame\s*>/);
  assert.match(video, /MAX_PENDING_ACCESS_UNITS\s*=\s*1/);
  assert.match(video, /pendingAccessUnits\.offer/);
  assert.match(video, /stats\.videoQueueDrops\+\+/);
  assert.match(video, /stats\.videoDecoderDrops\+\+/);
  assert.match(video, /DECODER_INPUT_TIMEOUT_US\s*=\s*2000/);
  assert.match(video, /dequeueInputBuffer\(DECODER_INPUT_TIMEOUT_US\)/);
  assert.match(video, /new\s+Thread\([\s\S]*,\s*"H264 解码"\)/);
  assert.match(video, /stats\.lastVideoAtMs\s*=\s*System\.currentTimeMillis\(\)/);
  assert.match(video, /ByteArrayOutputStream\s+accessUnitBuffer/);
  assert.match(video, /MAX_ACCESS_UNIT_SIZE/);
  assert.match(video, /appendNalUnits\(packet\.timestamp,\s*nalUnits\)/);
  assert.match(video, /if\s*\(\s*packet\.marker\s*\)/);
  assert.match(video, /queueCurrentAccessUnit\(packet\.timestamp\)/);
  assert.match(video, /queueEncodedFrame\(accessUnit,\s*timestamp\)/);
  assert.match(video, /firstVideoTimestamp/);
  assert.match(video, /\(rtpTimestamp\s*-\s*firstVideoTimestamp\)\s*&\s*0xFFFFFFFFL/);
  assert.match(video, /stats\.videoFrames\+\+/);
  assert.match(video, /stats\.droppedFrames\+\+/);
  assert.match(video, /setSoTimeout\(/);
  assert.match(video, /public\s+void\s+stop\(\)/);
  assert.match(video, /closeSocket\(\)/);
  assert.match(video, /currentSocket\.close\(\)/);

  assert.match(audio, /AUDIO_PORT\s*=\s*5006/);
  assert.match(audio, /AudioAttributes\.USAGE_GAME/);
  assert.match(audio, /ENCODING_PCM_16BIT/);
  assert.match(audio, /SAMPLE_RATE\s*=\s*48000/);
  assert.match(audio, /CHANNEL_OUT_STEREO/);
  assert.match(audio, /MODE_STREAM/);
  assert.match(audio, /stats\.audioPackets\+\+/);
  assert.match(audio, /stats\.audioBytes\s*\+=/);
  assert.match(audio, /stats\.lastAudioAtMs\s*=\s*System\.currentTimeMillis\(\)/);
  assert.match(audio, /littleEndian\[i\]\s*=\s*payload\[i\s*\+\s*1\]/);
  assert.match(audio, /littleEndian\[i\s*\+\s*1\]\s*=\s*payload\[i\]/);
  assert.match(audio, /evenLength\s*=\s*payloadLength\s*&\s*~1/);
  assert.match(audio, /setSoTimeout\(/);
  assert.match(audio, /public\s+void\s+stop\(\)/);
  assert.match(audio, /socket\.close\(\)/);
});

test('H264 receiver waits for next IDR after dropping queued compressed frames', () => {
  const video = readProjectFile(`${javaRoot}/H264VideoReceiver.java`);

  assert.match(video, /stats\.videoQueueDrops\+\+;[\s\S]*?waitingForKeyframe\s*=\s*true/);
  assert.match(video, /if\s*\(\s*droppedQueuedFrame\s*&&\s*waitingForKeyframe\s*&&\s*!accessUnitContainsIdr\(accessUnit\)\s*\)[\s\S]*?stats\.videoRecoveryWaits\+\+/);
  assert.match(video, /if\s*\(\s*droppedQueuedFrame\s*&&\s*waitingForKeyframe\s*&&\s*accessUnitContainsIdr\(accessUnit\)\s*\)[\s\S]*?waitingForKeyframe\s*=\s*false/);
});

test('MainActivity starts receivers once and stops them on surface or activity teardown', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /implements\s+SurfaceHolder\.Callback/);
  assert.match(source, /surfaceView\.getHolder\(\)\.addCallback\(this\)/);
  assert.match(source, /surfaceView\.getHolder\(\)\.removeCallback\(this\)/);
  assert.match(source, /void\s+surfaceCreated\(SurfaceHolder\s+holder\)/);
  assert.match(source, /void\s+surfaceDestroyed\(SurfaceHolder\s+holder\)/);
  assert.match(source, /startReceivers\(holder\.getSurface\(\)\)/);
  assert.match(source, /lifecycleLock/);
  assert.match(source, /synchronized\s*\(\s*lifecycleLock\s*\)/);
  assert.match(source, /STOP_JOIN_MS/);
  assert.match(source, /waitForReceiverThread/);
  assert.match(source, /\.join\(STOP_JOIN_MS\)/);
  assert.match(source, /if\s*\(\s*videoThread\s*!=\s*null\s*&&\s*videoThread\.isAlive\(\)\s*\)/);
  assert.match(source, /audioThread\s*!=\s*null\s*&&\s*audioThread\.isAlive\(\)/);
  assert.match(source, /stopReceivers\(\)/);
  assert.match(source, /videoReceiver\.stop\(\)/);
  assert.match(source, /audioReceiver\.stop\(\)/);
  assert.match(source, /handler\.removeCallbacks\(updateOverlay\)/);
});

test('MainActivity wires key events to InputClient without disrupting receiver lifecycle', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /DEFAULT_INPUT_RELAY_HOST\s*=\s*"192\.168\.50\.148"/);
  assert.match(source, /INPUT_RELAY_PORT\s*=\s*8789/);
  assert.match(source, /INPUT_RELAY_HOST_METADATA\s*=\s*"com\.tvgame\.receiver\.INPUT_RELAY_HOST"/);
  assert.match(source, /InputClient\s+inputClient/);
  assert.match(source, /new\s+InputClient\(resolveInputRelayHost\(\),\s*INPUT_RELAY_PORT\)/);
  assert.match(source, /return\s+DEFAULT_INPUT_RELAY_HOST/);
  assert.match(source, /boolean\s+onKeyDown\(int\s+keyCode,\s*KeyEvent\s+event\)/);
  assert.match(source, /inputClient\.sendKey\("down",\s*keyCode\)/);
  assert.match(source, /return\s+super\.onKeyDown\(keyCode,\s*event\)/);
  assert.match(source, /boolean\s+onKeyUp\(int\s+keyCode,\s*KeyEvent\s+event\)/);
  assert.match(source, /inputClient\.sendKey\("up",\s*keyCode\)/);
  assert.match(source, /return\s+super\.onKeyUp\(keyCode,\s*event\)/);
  assert.match(source, /inputClient\.close\(\)/);
  assert.match(source, /stopReceivers\(\)/);
});

test('MainActivity consumes USB gamepad key events so the TV UI does not handle them', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /isGamepadKeyEvent\(event\)/);
  assert.match(source, /private\s+static\s+boolean\s+isGamepadKeyEvent\(KeyEvent\s+event\)/);
  assert.match(source, /InputDevice\.SOURCE_GAMEPAD/);
  assert.match(source, /InputDevice\.SOURCE_JOYSTICK/);
  assert.match(source, /sendGamepadButton\("down",\s*keyCode\)/);
  assert.match(source, /sendGamepadButton\("up",\s*keyCode\)/);
  assert.match(source, /if\s*\(\s*isGamepadKeyEvent\(event\)\s*\)[\s\S]*?return\s+true/);
});

test('MainActivity maps USB gamepad buttons to PC keyboard and mouse controls', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /private\s+void\s+sendGamepadButton\(String\s+action,\s*int\s+keyCode\)/);
  assert.match(source, /private\s+static\s+String\s+mapGamepadKeyCode\(int\s+keyCode\)/);
  assert.match(source, /KeyEvent\.KEYCODE_DPAD_UP[\s\S]*"KeyW"/);
  assert.match(source, /KeyEvent\.KEYCODE_DPAD_DOWN[\s\S]*"KeyS"/);
  assert.match(source, /KeyEvent\.KEYCODE_DPAD_LEFT[\s\S]*"KeyA"/);
  assert.match(source, /KeyEvent\.KEYCODE_DPAD_RIGHT[\s\S]*"KeyD"/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_A[\s\S]*"Space"/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_B[\s\S]*"Escape"/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_X[\s\S]*"KeyE"/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_Y[\s\S]*"KeyQ"/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_START[\s\S]*"Enter"/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_SELECT[\s\S]*"Tab"/);
  assert.match(source, /sendGamepadMouseButton\(action,\s*keyCode\)/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_R1[\s\S]*sendMouseButton\(action,\s*0\)/);
  assert.match(source, /KeyEvent\.KEYCODE_BUTTON_L1[\s\S]*sendMouseButton\(action,\s*2\)/);
});

test('MainActivity toggles overlay with MENU or F1 without forwarding those keys', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /import\s+android\.view\.View/);
  assert.match(source, /boolean\s+overlayVisible\s*=\s*true/);
  assert.match(source, /isOverlayToggleKey\(keyCode\)/);
  assert.match(source, /KeyEvent\.KEYCODE_MENU/);
  assert.match(source, /KeyEvent\.KEYCODE_F1/);
  assert.match(source, /toggleOverlay\(\)/);
  assert.match(source, /overlay\.setVisibility\(overlayVisible\s*\?\s*View\.VISIBLE\s*:\s*View\.GONE\)/);
  assert.match(source, /if\s*\(\s*event\.getRepeatCount\(\)\s*==\s*0\s*&&\s*isOverlayToggleKey\(keyCode\)\s*\)[\s\S]*?return\s+true/);
});

test('MainActivity shows Android 11 plus extreme receiver mode in Chinese', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /TITLE\s*=\s*"电视游戏接收端"/);
  assert.match(source, /RECEIVER_MODE\s*=\s*"接收端档位：Android 11\+ 极致模式"/);
  assert.match(source, /Build\.VERSION\.SDK_INT/);
  assert.match(source, /TITLE\s*\+\s*"\s*\|\s*Android 11\+（API "/);
});

test('MainActivity maps USB gamepad joystick axes to WASD input codes', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /import\s+android\.view\.MotionEvent/);
  assert.match(source, /boolean\s+onGenericMotionEvent\(MotionEvent\s+event\)/);
  assert.match(source, /SOURCE_JOYSTICK/);
  assert.match(source, /SOURCE_GAMEPAD/);
  assert.match(source, /AXIS_X/);
  assert.match(source, /AXIS_Y/);
  assert.match(source, /GAMEPAD_AXIS_DEADZONE/);
  assert.match(source, /updateMappedKey\("KeyA"/);
  assert.match(source, /updateMappedKey\("KeyD"/);
  assert.match(source, /updateMappedKey\("KeyW"/);
  assert.match(source, /updateMappedKey\("KeyS"/);
});

test('MainActivity maps USB gamepad right stick and triggers to PC mouse input', () => {
  const source = readProjectFile(`${javaRoot}/MainActivity.java`);

  assert.match(source, /AXIS_Z/);
  assert.match(source, /AXIS_RZ/);
  assert.match(source, /AXIS_RX/);
  assert.match(source, /AXIS_RY/);
  assert.match(source, /AXIS_LTRIGGER/);
  assert.match(source, /AXIS_RTRIGGER/);
  assert.match(source, /GAMEPAD_MOUSE_SCALE/);
  assert.match(source, /axisToMouseDelta\(rightX\)/);
  assert.match(source, /axisToMouseDelta\(rightY\)/);
  assert.match(source, /inputClient\.sendMouseMove\(mouseDx,\s*mouseDy\)/);
  assert.match(source, /updateMappedMouseButton\(2,\s*leftTriggerActive/);
  assert.match(source, /updateMappedMouseButton\(0,\s*rightTriggerActive/);
});

test('stage 2 verification guide documents input return and acceptance checklist in Chinese', () => {
  const doc = readProjectFile('docs/stage2-local-verify.md');

  assert.match(doc, /## Android 版本基线/);
  assert.match(doc, /当前接收端以 Android 11\+（API 30\+）作为最低运行版本/);
  assert.match(doc, /Android 9\/10 暂不作为当前优化目标/);
  assert.match(doc, /## 输入回传/);
  assert.match(doc, /Android TV App 会把遥控器、键盘和 USB 手柄事件发送到 PC 端 TCP 8789/);
  assert.match(doc, /接收端 App 打开期间会保持屏幕常亮/);
  assert.match(doc, /USB 手柄会被接收端 App 消费/);
  assert.match(doc, /左摇杆和 D-pad 映射 WASD/);
  assert.match(doc, /右摇杆映射鼠标移动/);
  assert.match(doc, /R1\/右扳机映射鼠标左键/);
  assert.match(doc, /L1\/左扳机映射鼠标右键/);
  assert.match(doc, /PC 端需要启动 InputBridge\/SendInput/);
  assert.match(doc, /BACK 也可能被发给 PC relay/);
  assert.match(doc, /菜单键或 F1 可以隐藏或显示状态面板/);
  assert.match(doc, /## 验收记录/);
  for (const item of [
    'App 启动中文状态面板',
    '`stage2:check` 通过',
    '`native:rtp` 启动视频音频发送',
    '电视视频包计数增长',
    '音频包计数增长',
    '播放 PC 系统声音',
    '输入回传到达 PC relay'
  ]) {
    assert.match(doc, new RegExp(item));
  }
});

test('Android TV receiver production text is real Chinese without mojibake fragments', () => {
  const files = [
    'android-tv-receiver/app/src/main/AndroidManifest.xml',
    `${javaRoot}/MainActivity.java`,
    `${javaRoot}/StatsModel.java`,
    `${javaRoot}/InputClient.java`,
    'docs/stage2-local-verify.md'
  ];
  const combined = files.map(readProjectFile).join('\n');
  const forbiddenFragments = [
    '\uFFFD',
    '鐢',
    '闊',
    '瑙',
    '绛',
    '閻',
    '闂',
    '鐟',
    '缁',
    '閺',
    '濮',
    '鐡',
    '閳',
    '閵',
    '鈥',
    '楠',
    '鍥炰紶'
  ];

  for (const fragment of forbiddenFragments) {
    assert.equal(combined.includes(fragment), false, `unexpected mojibake fragment: ${fragment}`);
  }

  for (const text of [
    '电视游戏接收端',
    '等待视频和音频',
    '视频包',
    '视频帧',
    '视频丢包',
    '等待关键帧',
    '恢复丢帧',
    '接收缓冲',
    '队列丢帧',
    '解码丢帧',
    '音频包',
    '音频字节',
    '丢帧',
    '视频状态',
    '音频状态',
    '未收到',
    '正常',
    '超过',
    '输入回传'
  ]) {
    assert.match(combined, new RegExp(text));
  }
});
