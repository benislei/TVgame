'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GSTREAMER_VERSION,
  buildGStreamerDownloadUrls,
  createEnvironmentReport
} = require('../src/native-streamer/environment');
const {
  PROFILES,
  buildPipelineConfig,
  buildPipelineDescription
} = require('../src/native-streamer/pipeline');

test('GStreamer download URLs point at official 64-bit MSVC installers', () => {
  const urls = buildGStreamerDownloadUrls();

  assert.equal(GSTREAMER_VERSION, '1.24.13');
  assert.match(urls.runtime, /^https:\/\/gstreamer\.freedesktop\.org\/pkg\/windows\/1\.24\.13\/msvc\/gstreamer-1\.0-msvc-x86_64-1\.24\.13\.msi$/);
  assert.match(urls.devel, /^https:\/\/gstreamer\.freedesktop\.org\/pkg\/windows\/1\.24\.13\/msvc\/gstreamer-1\.0-devel-msvc-x86_64-1\.24\.13\.msi$/);
});

test('environment report marks missing executables and plugins', () => {
  const report = createEnvironmentReport({
    findExecutable: () => null,
    inspectPlugin: () => false,
    checkPythonModule: () => false,
    env: {}
  });

  assert.equal(report.ready, false);
  assert.equal(report.executables.gstLaunch.found, false);
  assert.equal(report.executables.gstInspect.found, false);
  assert.equal(report.executables.python.found, false);
  assert.equal(report.plugins.webrtcbin, false);
  assert.equal(report.plugins.nvh264enc, false);
  assert.equal(report.python.websockets, false);
  assert.equal(report.python.gstreamerBindings, false);
});

test('environment report is ready when required executables, plugins, and Python modules exist', () => {
  const report = createEnvironmentReport({
    findExecutable: name => name === 'python'
      ? 'C:/Python312/python.exe'
      : `C:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`,
    inspectPlugin: () => true,
    checkPythonModule: () => true,
    env: { GSTREAMER_1_0_ROOT_MSVC_X86_64: 'C:/gstreamer/1.0/msvc_x86_64/' }
  });

  assert.equal(report.ready, true);
  assert.equal(report.gstreamerRoot, 'C:/gstreamer/1.0/msvc_x86_64/');
  assert.equal(report.executables.python.path, 'C:/Python312/python.exe');
  assert.equal(report.python.websockets, true);
  assert.equal(report.python.gstreamerBindings, true);
});

test('environment report accepts the Windows py launcher as Python', () => {
  const report = createEnvironmentReport({
    findExecutable: name => {
      if (name === 'python' || name === 'python3') return null;
      if (name === 'py') return 'C:/Windows/py.exe';
      return `C:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
    },
    inspectPlugin: () => true,
    checkPythonModule: () => true,
    env: {}
  });

  assert.equal(report.ready, true);
  assert.equal(report.executables.python.path, 'C:/Windows/py.exe');
});

test('environment report searches the D drive GStreamer default install path', () => {
  const seen = [];
  const report = createEnvironmentReport({
    findExecutable: name => {
      seen.push(name);
      if (name === 'python' || name === 'python3') return null;
      if (name === 'py') return 'C:/Windows/py.exe';
      return `D:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
    },
    inspectPlugin: () => true,
    checkPythonModule: () => true,
    env: {}
  });

  assert.equal(report.ready, true);
  assert.equal(report.executables.gstLaunch.path, 'D:/gstreamer/1.0/msvc_x86_64/bin/gst-launch-1.0.exe');
  assert.ok(seen.includes('gst-launch-1.0'));
});

test('1080p60 profile builds low-latency NVENC pipeline settings', () => {
  const config = buildPipelineConfig(PROFILES['1080p60']);

  assert.equal(config.width, 1920);
  assert.equal(config.height, 1080);
  assert.equal(config.fps, 60);
  assert.equal(config.bitrateKbps, 25000);
  assert.equal(config.keyframeInterval, 60);
  assert.equal(config.encoder, 'nvh264enc');
});

test('pipeline description includes D3D11 capture, NVENC, RTP, and webrtcbin', () => {
  const description = buildPipelineDescription(buildPipelineConfig(PROFILES['1080p60']));

  assert.match(description, /d3d11screencapturesrc/);
  assert.match(description, /nvh264enc/);
  assert.match(description, /bframes=0/);
  assert.match(description, /bitrate=25000/);
  assert.match(description, /h264parse/);
  assert.match(description, /rtph264pay/);
  assert.match(description, /webrtcbin/);
});
