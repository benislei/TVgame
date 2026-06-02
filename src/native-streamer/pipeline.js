'use strict';

const PROFILES = {
  '720p60': {
    name: '720p60 低延迟',
    width: 1280,
    height: 720,
    fps: 60,
    bitrateKbps: 12000,
    keyframeInterval: 60
  },
  '1080p60': {
    name: '1080p60 推荐',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 25000,
    keyframeInterval: 60
  },
  '1440p60': {
    name: '1440p60 高画质',
    width: 2560,
    height: 1440,
    fps: 60,
    bitrateKbps: 45000,
    keyframeInterval: 60
  },
  '4k60': {
    name: '4K60 实验',
    width: 3840,
    height: 2160,
    fps: 60,
    bitrateKbps: 80000,
    keyframeInterval: 60
  }
};

function buildPipelineConfig(profile = PROFILES['1080p60'], overrides = {}) {
  return {
    encoder: 'nvh264enc',
    capture: 'd3d11screencapturesrc',
    width: overrides.width || profile.width,
    height: overrides.height || profile.height,
    fps: overrides.fps || profile.fps,
    bitrateKbps: overrides.bitrateKbps || profile.bitrateKbps,
    keyframeInterval: overrides.keyframeInterval || profile.keyframeInterval,
    room: overrides.room || 'game',
    signal: overrides.signal || 'ws://127.0.0.1:8080',
    displayIndex: overrides.displayIndex || 0
  };
}

function buildPipelineDescription(config) {
  const fps = `${config.fps}/1`;
  return [
    'webrtcbin name=webrtc bundle-policy=max-bundle latency=0',
    `${config.capture} show-cursor=true monitor-index=${config.displayIndex}`,
    '!',
    `video/x-raw(memory:D3D11Memory),framerate=${fps}`,
    '!',
    'd3d11convert',
    '!',
    `video/x-raw(memory:D3D11Memory),format=NV12,width=${config.width},height=${config.height},framerate=${fps}`,
    '!',
    `${config.encoder} preset=low-latency-hq rc-mode=cbr bitrate=${config.bitrateKbps} gop-size=${config.keyframeInterval} bframes=0 zero-reorder-delay=true`,
    '!',
    'h264parse config-interval=-1',
    '!',
    'rtph264pay pt=96 config-interval=-1 aggregate-mode=zero-latency',
    '!',
    'application/x-rtp,media=video,encoding-name=H264,payload=96',
    '!',
    'webrtc.'
  ].join(' ');
}

function listProfiles() {
  return Object.entries(PROFILES).map(([id, profile]) => ({ id, ...profile }));
}

module.exports = {
  PROFILES,
  buildPipelineConfig,
  buildPipelineDescription,
  listProfiles
};
