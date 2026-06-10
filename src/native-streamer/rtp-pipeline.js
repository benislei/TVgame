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
  resilient1080: {
    codec: 'h264',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 22000,
    keyframeInterval: 5,
    encoderRcMode: 'cbr-ld-hq',
    h264ConfigInterval: -1,
    udpBufferSize: 4194304,
    strictGop: true
  },
  tvbox1080: {
    codec: 'h264',
    width: 1920,
    height: 1080,
    fps: 60,
    bitrateKbps: 16000,
    keyframeInterval: 5,
    encoderRcMode: 'cbr-ld-hq',
    h264ConfigInterval: -1,
    udpBufferSize: 4194304,
    strictGop: true
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

const NVENC_AUTO_PRESET_ORDER = [
  'low-latency-hq',
  'low-latency-hp',
  'low-latency',
  'hp',
  'default',
  'hq'
];

const H264_ENCODER_AUTO_ORDER = [
  'nvh264enc',
  'amfh264enc',
  'mfh264enc'
];

function buildRtpConfig(overrides = {}) {
  const profileName = overrides.profile || 'resilient1080';
  const profile = RTP_PROFILES[profileName] || RTP_PROFILES.resilient1080;
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
    encoderRcMode: overrides.encoderRcMode || profile.encoderRcMode || 'cbr',
    h264ConfigInterval: Number(overrides.h264ConfigInterval ?? profile.h264ConfigInterval ?? 1),
    udpBufferSize: Number(overrides.udpBufferSize ?? profile.udpBufferSize ?? 0),
    strictGop: Boolean(overrides.strictGop ?? profile.strictGop ?? false),
    encoder: overrides.encoder || 'nvh264enc',
    encoderPreset: overrides.encoderPreset || 'default',
    displayIndex: Number(overrides.displayIndex || 0)
  };
}

function splitPipeline(pipeline) {
  return pipeline.split(/\s+/).filter(Boolean);
}

function buildVideoRtpPipeline(config) {
  const fps = `${config.fps}/1`;
  const udpOptions = [
    `host=${config.host}`,
    `port=${config.videoPort}`,
    'sync=false',
    'async=false'
  ];
  if (config.udpBufferSize > 0) {
    udpOptions.push(`buffer-size=${config.udpBufferSize}`);
  }
  const encoder = buildH264EncoderElement(config);
  const needsSystemMemory = config.encoder === 'nvh264enc';
  const d3d11Steps = needsSystemMemory
    ? [
        'd3d11download',
        '!',
        `video/x-raw,format=NV12,width=${config.width},height=${config.height},framerate=${fps}`,
        '!'
      ]
    : [];

  return [
    `d3d11screencapturesrc show-cursor=true monitor-index=${config.displayIndex}`,
    '!',
    `video/x-raw(memory:D3D11Memory),framerate=${fps}`,
    '!',
    'd3d11convert',
    '!',
    `video/x-raw(memory:D3D11Memory),format=NV12,width=${config.width},height=${config.height},framerate=${fps}`,
    '!',
    ...d3d11Steps,
    'queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream',
    '!',
    encoder,
    '!',
    `h264parse config-interval=${config.h264ConfigInterval}`,
    '!',
    `rtph264pay pt=96 config-interval=${config.h264ConfigInterval} aggregate-mode=zero-latency`,
    '!',
    `udpsink ${udpOptions.join(' ')}`
  ].join(' ');
}

function buildH264EncoderElement(config) {
  if (config.encoder === 'amfh264enc') {
    return [
      'amfh264enc',
      'usage=ultra-low-latency',
      'rate-control=cbr',
      'preset=speed',
      `bitrate=${config.bitrateKbps}`,
      `gop-size=${config.keyframeInterval}`,
      'b-frames=0'
    ].join(' ');
  }

  if (config.encoder === 'mfh264enc') {
    return [
      'mfh264enc',
      'low-latency=true',
      'rc-mode=cbr',
      `bitrate=${config.bitrateKbps}`,
      `gop-size=${config.keyframeInterval}`
    ].join(' ');
  }

  const encoderOptions = [
    `preset=${config.encoderPreset}`,
    `rc-mode=${config.encoderRcMode}`,
    `bitrate=${config.bitrateKbps}`,
    `gop-size=${config.keyframeInterval}`,
    'bframes=0',
    'zerolatency=true'
  ];
  if (config.strictGop) {
    encoderOptions.push('strict-gop=true');
  }
  return `nvh264enc ${encoderOptions.join(' ')}`;
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

function buildNvencPresetProbePipeline(config, preset) {
  const fps = `${config.fps}/1`;
  return [
    'videotestsrc num-buffers=1',
    '!',
    `video/x-raw,format=NV12,width=${config.width},height=${config.height},framerate=${fps}`,
    '!',
    `nvh264enc preset=${preset} rc-mode=${config.encoderRcMode} bitrate=${config.bitrateKbps} gop-size=${config.keyframeInterval} bframes=0 zerolatency=true`,
    '!',
    'fakesink sync=false'
  ].join(' ');
}

function buildH264EncoderProbePipeline(config, encoder) {
  const fps = `${config.fps}/1`;
  const probeConfig = { ...config, encoder };
  return [
    'videotestsrc num-buffers=1',
    '!',
    `video/x-raw,format=NV12,width=${config.width},height=${config.height},framerate=${fps}`,
    '!',
    buildH264EncoderElement(probeConfig),
    '!',
    'fakesink sync=false'
  ].join(' ');
}

function buildH264EncoderProbeArgs(config, encoder) {
  return ['-q'].concat(splitPipeline(buildH264EncoderProbePipeline(config, encoder)));
}

function buildNvencPresetProbeArgs(config, preset) {
  return ['-q'].concat(splitPipeline(buildNvencPresetProbePipeline(config, preset)));
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
  H264_ENCODER_AUTO_ORDER,
  NVENC_ENCODER_PRESETS,
  NVENC_AUTO_PRESET_ORDER,
  buildRtpConfig,
  buildVideoRtpPipeline,
  buildH264EncoderElement,
  buildH264EncoderProbePipeline,
  buildH264EncoderProbeArgs,
  buildAudioRtpPipeline,
  buildNvencPresetProbePipeline,
  buildNvencPresetProbeArgs,
  buildRtpLaunchCommands
};
