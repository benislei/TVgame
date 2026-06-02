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
    `nvh264enc preset=low-latency-hq rc-mode=cbr bitrate=${config.bitrateKbps} gop-size=${config.keyframeInterval} bframes=0 zerolatency=true`,
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
