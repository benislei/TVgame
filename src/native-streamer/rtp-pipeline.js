'use strict';

const RTP_PROFILES = {
  game720: {
    codec: 'h264',
    width: 1280,
    height: 720,
    fps: 60,
    bitrateKbps: 18000,
    keyframeInterval: 15
  },
  game1080: {
    codec: 'h264',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 24000,
    keyframeInterval: 10
  },
  quality1080: {
    codec: 'h264',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 30000,
    keyframeInterval: 10
  },
  game4k: {
    codec: 'h265',
    width: 3840,
    height: 2160,
    fps: 60,
    bitrateKbps: 65000,
    keyframeInterval: 30
  }
};

const NVENC_ENCODER_PRESETS = [
  'default',
  'hp',
  'hq',
  'low-latency',
  'low-latency-hq',
  'low-latency-hp',
  'lossless',
  'lossless-hp'
];

function buildRtpConfig(overrides = {}) {
  const profileName = overrides.profile || 'game1080';
  const profile = RTP_PROFILES[profileName] || RTP_PROFILES.game1080;
  return {
    profile: profileName,
    host: overrides.host || '127.0.0.1',
    videoPort: Number(overrides.videoPort || 5004),
    audioPort: Number(overrides.audioPort || 5006),
    codec: overrides.codec || profile.codec,
    width: Number(overrides.width || profile.width),
    height: Number(overrides.height || profile.height),
    fps: Number(overrides.fps || profile.fps),
    bitrateKbps: Number(overrides.bitrateKbps || profile.bitrateKbps),
    keyframeInterval: Number(overrides.keyframeInterval || profile.keyframeInterval),
    encoderPreset: overrides.encoderPreset || 'default',
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
    'd3d11download',
    '!',
    `video/x-raw,format=NV12,width=${config.width},height=${config.height},framerate=${fps}`,
    '!',
    'queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream',
    '!',
    `nvh264enc preset=${config.encoderPreset} rc-mode=cbr bitrate=${config.bitrateKbps} gop-size=${config.keyframeInterval} bframes=0 zerolatency=true`,
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
  RTP_PROFILES,
  NVENC_ENCODER_PRESETS,
  buildRtpConfig,
  buildVideoRtpPipeline,
  buildAudioRtpPipeline,
  buildRtpLaunchCommands
};
