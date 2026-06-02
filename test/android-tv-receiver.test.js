'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('Android TV receiver skeleton files exist', () => {
  const files = [
    'android-tv-receiver/settings.gradle',
    'android-tv-receiver/build.gradle',
    'android-tv-receiver/app/build.gradle',
    'android-tv-receiver/app/src/main/AndroidManifest.xml',
    'android-tv-receiver/app/src/main/res/values/styles.xml',
    'android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java',
    'android-tv-receiver/app/src/main/java/com/tvgame/receiver/StatsModel.java',
    'docs/stage2-local-verify.md'
  ];

  for (const file of files) {
    assert.equal(fs.existsSync(path.join(root, file)), true, `${file} should exist`);
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

test('Android TV receiver Java UI renders Chinese metrics without mojibake', () => {
  const statsModel = readProjectFile('android-tv-receiver/app/src/main/java/com/tvgame/receiver/StatsModel.java');
  const mainActivity = readProjectFile('android-tv-receiver/app/src/main/java/com/tvgame/receiver/MainActivity.java');
  const combined = `${statsModel}\n${mainActivity}`;
  const forbiddenFragments = [
    '\uFFFD',
    '鐢佃',
    '瑙嗛',
    '闊抽',
    '鏈',
    '鍙戦',
    '绔�'
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
    '超过 '
  ]) {
    assert.match(combined, new RegExp(text));
  }

  assert.match(mainActivity, /new SurfaceView\(this\)/);
  assert.match(mainActivity, /postDelayed\(.*500/s);
});
