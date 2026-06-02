'use strict';

const fs = require('node:fs');
const path = require('node:path');
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
  assert.match(appBuild, /minSdk\s+26/);
  assert.match(appBuild, /targetSdk\s+35/);
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
  assert.match(video, /stats\.videoPackets\+\+/);
  assert.match(video, /stats\.lastVideoAtMs\s*=\s*System\.currentTimeMillis\(\)/);
  assert.match(video, /stats\.videoFrames\+\+/);
  assert.match(video, /stats\.droppedFrames\+\+/);
  assert.match(video, /setSoTimeout\(/);
  assert.match(video, /public\s+void\s+stop\(\)/);
  assert.match(video, /socket\.close\(\)/);

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

test('Android TV receiver production text is real Chinese without mojibake fragments', () => {
  const files = [
    'android-tv-receiver/app/src/main/AndroidManifest.xml',
    `${javaRoot}/MainActivity.java`,
    `${javaRoot}/StatsModel.java`,
    'docs/stage2-local-verify.md'
  ];
  const combined = files.map(readProjectFile).join('\n');
  const forbiddenFragments = [
    '\uFFFD',
    '鐢',
    '闊',
    '瑙',
    '绛',
    '鏈',
    '姝',
    '瓒',
    '鈥',
    '銆'
  ];

  for (const fragment of forbiddenFragments) {
    assert.equal(combined.includes(fragment), false, `unexpected mojibake fragment: ${fragment}`);
  }

  for (const text of [
    '电视游戏接收端',
    '等待视频和音频',
    '视频包',
    '视频帧',
    '音频包',
    '音频字节',
    '丢帧',
    '视频状态',
    '音频状态',
    '未收到',
    '正常',
    '超过'
  ]) {
    assert.match(combined, new RegExp(text));
  }
});
