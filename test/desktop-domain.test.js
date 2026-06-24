'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { QUALITY_PRESETS, getQualityPreset } = require('../src/desktop/quality-presets');
const { DEFAULT_CONFIG, createConfigStore } = require('../src/desktop/config-store');

test('desktop quality presets expose the six confirmed presets in order', () => {
  assert.deepEqual(QUALITY_PRESETS.map(preset => preset.id), [
    'h264720p30',
    'h264720p60',
    'h2641080p30',
    'h2641080p60',
    'hevc1080p30',
    'hevc1080p60'
  ]);

  assert.deepEqual(QUALITY_PRESETS.map(({ label, profile, codec, description }) => ({ label, profile, codec, description })), [
    {
      label: '720P30',
      profile: 'h264720p30',
      codec: 'H.264',
      description: '稳定优先，适合电视盒子和弱解码设备'
    },
    {
      label: '720P60',
      profile: 'h264720p60',
      codec: 'H.264',
      description: '流畅优先，适合网络稳定但解码一般的设备'
    },
    {
      label: '1080P30',
      profile: 'h2641080p30',
      codec: 'H.264',
      description: '清晰稳定，适合电视盒子优先尝试'
    },
    {
      label: '1080P60',
      profile: 'h2641080p60',
      codec: 'H.264',
      description: '高性能，适合手机、高性能电视或盒子'
    },
    {
      label: 'HEVC 1080P30',
      profile: 'hevc1080p30',
      codec: 'HEVC',
      description: '推荐，低码率高清，优先使用'
    },
    {
      label: 'HEVC 1080P60',
      profile: 'hevc1080p60',
      codec: 'HEVC',
      description: '高性能，适合解码能力较强的 Android 11+ 设备'
    }
  ]);
});

test('desktop quality preset lookup marks HEVC 1080P30 as recommended and returns null for missing presets', () => {
  assert.equal(getQualityPreset('hevc1080p30').recommended, true);
  assert.equal(getQualityPreset('missing'), null);
});

test('desktop config store loads defaults when no config file exists', () => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-config-defaults-'));
  const store = createConfigStore({ appDataDir });

  assert.deepEqual(DEFAULT_CONFIG, {
    firstRunComplete: false,
    selectedDevice: null,
    selectedQuality: 'hevc1080p30',
    performanceProtection: true
  });
  assert.deepEqual(store.load(), DEFAULT_CONFIG);
});

test('desktop config store saves and loads selected device and quality', () => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'desktop-config-save-'));
  const store = createConfigStore({ appDataDir });

  const saved = store.save({
    selectedDevice: '小米盒子 5 Max',
    selectedQuality: 'h2641080p60'
  });

  assert.deepEqual(saved, {
    firstRunComplete: false,
    selectedDevice: '小米盒子 5 Max',
    selectedQuality: 'h2641080p60',
    performanceProtection: true
  });
  assert.deepEqual(store.load(), saved);
});
