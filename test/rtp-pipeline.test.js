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
  assert.match(pipeline, /d3d11download/);
  assert.match(pipeline, /video\/x-raw,format=NV12,width=1920,height=1080,framerate=60\/1/);
  assert.match(pipeline, /nvh264enc/);
  assert.match(pipeline, /bframes=0/);
  assert.match(pipeline, /bitrate=25000/);
  assert.match(pipeline, /gop-size=30/);
  assert.match(pipeline, /zerolatency=true/);
  assert.match(pipeline, /queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream/);
  assert.doesNotMatch(pipeline, /zero-reorder-delay/);
  assert.match(pipeline, /rtph264pay pt=96 config-interval=1/);
  assert.match(pipeline, /udpsink host=192\.168\.1\.50 port=5004 sync=false async=false/);
});

test('builds a lower latency 720p60 RTP video pipeline when configured', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    width: 1280,
    height: 720,
    bitrateKbps: 12000,
    keyframeInterval: 30
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.match(pipeline, /width=1280,height=720,framerate=60\/1/);
  assert.match(pipeline, /bitrate=12000/);
  assert.match(pipeline, /gop-size=30/);
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
