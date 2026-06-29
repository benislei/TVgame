'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_CONFIG = Object.freeze({
  firstRunComplete: false,
  selectedDevice: null,
  deviceMode: 'manual',
  manualIp: '',
  selectedQuality: 'hevc1080p30',
  performanceProtection: true
});

function normalizeConfig(config) {
  const nextConfig = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};
  const merged = {
    ...DEFAULT_CONFIG,
    ...nextConfig
  };

  if (merged.selectedDevice === undefined) {
    merged.selectedDevice = null;
  }

  if (merged.deviceMode !== 'auto') {
    merged.deviceMode = 'manual';
  }

  if (typeof merged.manualIp !== 'string') {
    merged.manualIp = '';
  }

  return merged;
}

function createConfigStore(options = {}) {
  const appDataDir = options.appDataDir || path.join(os.homedir(), '.lan-game-streaming-prototype');
  const file = path.join(appDataDir, 'config.json');

  function load() {
    let rawConfig;

    try {
      rawConfig = fs.readFileSync(file, 'utf8');
    } catch (error) {
      if (error && error.code === 'ENOENT') {
        return { ...DEFAULT_CONFIG };
      }

      throw error;
    }

    try {
      return normalizeConfig(JSON.parse(rawConfig));
    } catch (error) {
      if (error instanceof SyntaxError) {
        return { ...DEFAULT_CONFIG };
      }

      throw error;
    }
  }

  function save(nextConfig) {
    const config = normalizeConfig(nextConfig);
    fs.mkdirSync(appDataDir, { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    return config;
  }

  return {
    file,
    load,
    save
  };
}

module.exports = {
  DEFAULT_CONFIG,
  createConfigStore
};
