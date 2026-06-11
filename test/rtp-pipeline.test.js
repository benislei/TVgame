'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RTP_PROFILES,
  H264_ENCODER_AUTO_ORDER,
  NVENC_AUTO_PRESET_ORDER,
  buildRtpConfig,
  buildVideoRtpPipeline,
  buildAudioRtpPipeline,
  buildRtpLaunchCommands
} = require('../src/native-streamer/rtp-pipeline');

test('RTP profiles include 720p fallback, 1080p game baseline, TV box stable mode and 4K roadmap', () => {
  assert.deepEqual(Object.keys(RTP_PROFILES), [
    'h264720p30',
    'h264720p60',
    'h2641080p30',
    'h2641080p60',
    'hevc1080p30',
    'hevc1080p60',
    'game720',
    'game1080',
    'quality1080',
    'resilient1080',
    'tvbox1080',
    'game4k'
  ]);
  assert.equal(RTP_PROFILES.game720.width, 1280);
  assert.equal(RTP_PROFILES.game720.height, 720);
  assert.equal(RTP_PROFILES.game1080.width, 1920);
  assert.equal(RTP_PROFILES.game1080.height, 1080);
  assert.equal(RTP_PROFILES.game1080.bitrateKbps, 24000);
  assert.equal(RTP_PROFILES.game1080.keyframeInterval, 10);
  assert.equal(RTP_PROFILES.quality1080.bitrateKbps, 30000);
  assert.equal(RTP_PROFILES.quality1080.keyframeInterval, 10);
  assert.equal(RTP_PROFILES.resilient1080.bitrateKbps, 22000);
  assert.equal(RTP_PROFILES.resilient1080.keyframeInterval, 5);
  assert.equal(RTP_PROFILES.resilient1080.h264ConfigInterval, -1);
  assert.equal(RTP_PROFILES.resilient1080.udpBufferSize, 4194304);
  assert.equal(RTP_PROFILES.resilient1080.encoderRcMode, 'cbr-ld-hq');
  assert.equal(RTP_PROFILES.tvbox1080.width, 1920);
  assert.equal(RTP_PROFILES.tvbox1080.height, 1080);
  assert.equal(RTP_PROFILES.tvbox1080.fps, 30);
  assert.equal(RTP_PROFILES.tvbox1080.bitrateKbps, 12000);
  assert.equal(RTP_PROFILES.tvbox1080.keyframeInterval, 5);
  assert.equal(RTP_PROFILES.tvbox1080.encoderRcMode, 'cbr-ld-hq');
  assert.equal(RTP_PROFILES.tvbox1080.h264ConfigInterval, -1);
  assert.equal(RTP_PROFILES.tvbox1080.udpBufferSize, 4194304);
  assert.equal(RTP_PROFILES.tvbox1080.strictGop, true);
  assert.equal(RTP_PROFILES.game4k.width, 3840);
  assert.equal(RTP_PROFILES.game4k.height, 2160);
  assert.equal(RTP_PROFILES.game4k.codec, 'h265');
});

test('RTP profiles expose explicit H264 quality ladder and HEVC 1080p30 experiment', () => {
  assert.equal(RTP_PROFILES.h264720p30.width, 1280);
  assert.equal(RTP_PROFILES.h264720p30.height, 720);
  assert.equal(RTP_PROFILES.h264720p30.fps, 30);
  assert.equal(RTP_PROFILES.h264720p30.bitrateKbps, 6000);
  assert.equal(RTP_PROFILES.h264720p30.codec, 'h264');

  assert.equal(RTP_PROFILES.h264720p60.width, 1280);
  assert.equal(RTP_PROFILES.h264720p60.height, 720);
  assert.equal(RTP_PROFILES.h264720p60.fps, 60);
  assert.equal(RTP_PROFILES.h264720p60.bitrateKbps, 10000);

  assert.equal(RTP_PROFILES.h2641080p30.width, 1920);
  assert.equal(RTP_PROFILES.h2641080p30.height, 1080);
  assert.equal(RTP_PROFILES.h2641080p30.fps, 30);
  assert.equal(RTP_PROFILES.h2641080p30.bitrateKbps, 10000);

  assert.equal(RTP_PROFILES.h2641080p60.width, 1920);
  assert.equal(RTP_PROFILES.h2641080p60.height, 1080);
  assert.equal(RTP_PROFILES.h2641080p60.fps, 60);
  assert.equal(RTP_PROFILES.h2641080p60.bitrateKbps, 18000);

  assert.equal(RTP_PROFILES.hevc1080p30.codec, 'h265');
  assert.equal(RTP_PROFILES.hevc1080p30.width, 1920);
  assert.equal(RTP_PROFILES.hevc1080p30.height, 1080);
  assert.equal(RTP_PROFILES.hevc1080p30.fps, 30);
  assert.equal(RTP_PROFILES.hevc1080p30.bitrateKbps, 7000);
  assert.equal(RTP_PROFILES.hevc1080p30.experimental, true);

  assert.equal(RTP_PROFILES.hevc1080p60.codec, 'h265');
  assert.equal(RTP_PROFILES.hevc1080p60.width, 1920);
  assert.equal(RTP_PROFILES.hevc1080p60.height, 1080);
  assert.equal(RTP_PROFILES.hevc1080p60.fps, 60);
  assert.equal(RTP_PROFILES.hevc1080p60.bitrateKbps, 12000);
  assert.equal(RTP_PROFILES.hevc1080p60.experimental, true);
});

test('default RTP profile uses resilient 1080p anti-artifact settings', () => {
  const config = buildRtpConfig({ host: '192.168.1.50' });

  assert.equal(config.profile, 'resilient1080');
  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.fps, 60);
  assert.equal(config.bitrateKbps, 22000);
  assert.equal(config.keyframeInterval, 5);
  assert.equal(config.codec, 'h264');
  assert.equal(config.encoderRcMode, 'cbr-ld-hq');
  assert.equal(config.h264ConfigInterval, -1);
  assert.equal(config.udpBufferSize, 4194304);
  assert.equal(config.strictGop, true);
  assert.equal(config.encoderPreset, 'default');
});

test('NVENC auto preset order prioritizes game feel before compatibility fallback', () => {
  assert.deepEqual(NVENC_AUTO_PRESET_ORDER, [
    'low-latency-hq',
    'low-latency-hp',
    'low-latency',
    'hp',
    'default',
    'hq'
  ]);
});

test('H264 encoder auto order prioritizes NVENC, then AMD AMF, then generic Windows fallback', () => {
  assert.deepEqual(H264_ENCODER_AUTO_ORDER, ['nvh264enc', 'amfh264enc', 'mfh264enc']);
});

test('builds default resilient 1080p H264 RTP video pipeline for Android TV', () => {
  const config = buildRtpConfig({ host: '192.168.1.50' });
  const pipeline = buildVideoRtpPipeline(config);

  assert.match(pipeline, /d3d11screencapturesrc show-cursor=true/);
  assert.match(pipeline, /video\/x-raw\(memory:D3D11Memory\),framerate=60\/1/);
  assert.match(pipeline, /d3d11download/);
  assert.match(pipeline, /video\/x-raw,format=NV12,width=1920,height=1080,framerate=60\/1/);
  assert.match(pipeline, /nvh264enc/);
  assert.match(pipeline, /preset=default/);
  assert.match(pipeline, /rc-mode=cbr-ld-hq/);
  assert.match(pipeline, /bframes=0/);
  assert.match(pipeline, /bitrate=22000/);
  assert.match(pipeline, /gop-size=5/);
  assert.match(pipeline, /zerolatency=true/);
  assert.match(pipeline, /strict-gop=true/);
  assert.match(pipeline, /queue max-size-buffers=1 max-size-bytes=0 max-size-time=0 leaky=downstream/);
  assert.doesNotMatch(pipeline, /zero-reorder-delay/);
  assert.match(pipeline, /h264parse config-interval=-1/);
  assert.match(pipeline, /rtph264pay pt=96 config-interval=-1 aggregate-mode=zero-latency/);
  assert.match(pipeline, /udpsink host=192\.168\.1\.50 port=5004 sync=false async=false buffer-size=4194304/);
});

test('video RTP pipeline preserves source aspect ratio while scaling to target frame', () => {
  const config = buildRtpConfig({ host: '192.168.1.50', profile: 'h264720p30' });
  const pipeline = buildVideoRtpPipeline(config);

  assert.match(pipeline, /videoscale add-borders=true/);
  assert.match(pipeline, /video\/x-raw,format=NV12,width=1280,height=720,framerate=30\/1/);
});

test('builds HEVC 1080p30 RTP video pipeline for experimental receiver validation', () => {
  const config = buildRtpConfig({ host: '192.168.1.50', profile: 'hevc1080p30' });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.codec, 'h265');
  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.fps, 30);
  assert.equal(config.bitrateKbps, 7000);
  assert.match(pipeline, /nvh265enc/);
  assert.match(pipeline, /bitrate=7000/);
  assert.match(pipeline, /gop-size=5/);
  assert.match(pipeline, /h265parse config-interval=-1/);
  assert.match(pipeline, /rtph265pay pt=98 config-interval=-1 aggregate-mode=zero-latency/);
  assert.doesNotMatch(pipeline, /h264parse/);
  assert.doesNotMatch(pipeline, /rtph264pay/);
});

test('builds HEVC 1080p60 RTP video pipeline for high performance receivers', () => {
  const config = buildRtpConfig({ host: '192.168.1.50', profile: 'hevc1080p60' });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.codec, 'h265');
  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.fps, 60);
  assert.equal(config.bitrateKbps, 12000);
  assert.match(pipeline, /width=1920,height=1080,framerate=60\/1/);
  assert.match(pipeline, /nvh265enc/);
  assert.match(pipeline, /bitrate=12000/);
  assert.match(pipeline, /gop-size=5/);
  assert.match(pipeline, /rtph265pay pt=98 config-interval=-1 aggregate-mode=zero-latency/);
});

test('builds AMD AMF H264 RTP video pipeline without NVIDIA encoder', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    encoder: 'amfh264enc'
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.encoder, 'amfh264enc');
  assert.match(pipeline, /amfh264enc/);
  assert.match(pipeline, /usage=ultra-low-latency/);
  assert.match(pipeline, /rate-control=cbr/);
  assert.match(pipeline, /b-frames=0/);
  assert.match(pipeline, /bitrate=22000/);
  assert.match(pipeline, /gop-size=5/);
  assert.match(pipeline, /videoscale add-borders=true/);
  assert.match(pipeline, /video\/x-raw,format=NV12,width=1920,height=1080,framerate=60\/1/);
  assert.doesNotMatch(pipeline, /nvh264enc/);
  assert.match(pipeline, /d3d11download/);
});

test('builds Media Foundation H264 RTP video pipeline as generic Windows fallback', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    encoder: 'mfh264enc'
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.encoder, 'mfh264enc');
  assert.match(pipeline, /mfh264enc/);
  assert.match(pipeline, /low-latency=true/);
  assert.match(pipeline, /rc-mode=cbr/);
  assert.match(pipeline, /bitrate=22000/);
  assert.match(pipeline, /gop-size=5/);
  assert.doesNotMatch(pipeline, /nvh264enc/);
  assert.match(pipeline, /videoscale add-borders=true/);
  assert.match(pipeline, /d3d11download/);
});

test('builds explicit NVENC encoder preset when configured', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    encoderPreset: 'low-latency-hq'
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.encoderPreset, 'low-latency-hq');
  assert.match(pipeline, /nvh264enc preset=low-latency-hq/);
});

test('builds explicit 1080p60 RTP video pipeline when configured', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    width: 1920,
    height: 1080,
    bitrateKbps: 25000,
    keyframeInterval: 15
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.match(pipeline, /width=1920,height=1080,framerate=60\/1/);
  assert.match(pipeline, /bitrate=25000/);
  assert.match(pipeline, /gop-size=15/);
});

test('builds explicit 720p fallback profile when selected', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    profile: 'game720'
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.width, 1280);
  assert.equal(config.height, 720);
  assert.equal(config.bitrateKbps, 18000);
  assert.match(pipeline, /width=1280,height=720,framerate=60\/1/);
  assert.match(pipeline, /bitrate=18000/);
});

test('builds quality 1080p profile with short recovery GOP for game streaming', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    profile: 'quality1080'
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.bitrateKbps, 30000);
  assert.equal(config.keyframeInterval, 10);
  assert.match(pipeline, /bitrate=30000/);
  assert.match(pipeline, /gop-size=10/);
});

test('builds resilient 1080p profile to reduce visible artifact recovery time', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    profile: 'resilient1080'
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.bitrateKbps, 22000);
  assert.equal(config.keyframeInterval, 5);
  assert.equal(config.encoderRcMode, 'cbr-ld-hq');
  assert.match(pipeline, /rc-mode=cbr-ld-hq/);
  assert.match(pipeline, /bitrate=22000/);
  assert.match(pipeline, /gop-size=5/);
  assert.match(pipeline, /strict-gop=true/);
  assert.match(pipeline, /h264parse config-interval=-1/);
  assert.match(pipeline, /rtph264pay pt=96 config-interval=-1 aggregate-mode=zero-latency/);
  assert.match(pipeline, /udpsink host=192\.168\.1\.50 port=5004 sync=false async=false buffer-size=4194304/);
});

test('builds TV box compatible 1080p30 profile with reduced decoder pressure', () => {
  const config = buildRtpConfig({
    host: '192.168.1.50',
    profile: 'tvbox1080'
  });
  const pipeline = buildVideoRtpPipeline(config);

  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.fps, 30);
  assert.equal(config.bitrateKbps, 12000);
  assert.equal(config.keyframeInterval, 5);
  assert.equal(config.encoderRcMode, 'cbr-ld-hq');
  assert.equal(config.h264ConfigInterval, -1);
  assert.equal(config.udpBufferSize, 4194304);
  assert.equal(config.strictGop, true);
  assert.match(pipeline, /framerate=30\/1/);
  assert.match(pipeline, /bitrate=12000/);
  assert.match(pipeline, /gop-size=5/);
  assert.match(pipeline, /rc-mode=cbr-ld-hq/);
  assert.match(pipeline, /strict-gop=true/);
  assert.match(pipeline, /h264parse config-interval=-1/);
  assert.match(pipeline, /udpsink host=192\.168\.1\.50 port=5004 sync=false async=false buffer-size=4194304/);
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
