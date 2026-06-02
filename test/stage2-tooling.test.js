'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStage2Report } = require('../src/stage2/tooling');

test('stage2 report is ready when GStreamer RTP video and audio plugins exist', () => {
  const report = createStage2Report({
    findExecutable: name => {
      if (name === 'gst-launch-1.0' || name === 'gst-inspect-1.0') {
        return `D:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
      }
      if (name === 'dotnet') return 'C:/Program Files/dotnet/dotnet.exe';
      return null;
    },
    inspectPlugin: () => true
  });

  assert.equal(report.ready, true);
  assert.equal(report.gstreamer.ready, true);
  assert.equal(report.plugins.d3d11screencapturesrc, true);
  assert.equal(report.plugins.nvh264enc, true);
  assert.equal(report.plugins.wasapi2src, true);
  assert.equal(report.plugins.rtpL16pay, true);
});

test('stage2 report does not require Python GStreamer bindings', () => {
  const report = createStage2Report({
    findExecutable: name => name.startsWith('gst-') ? `D:/gstreamer/bin/${name}.exe` : 'C:/dotnet/dotnet.exe',
    inspectPlugin: plugin => plugin !== 'python-gi'
  });

  assert.equal(report.ready, true);
  assert.equal(report.missing.pythonModules.length, 0);
});

test('stage2 report explains missing audio capture plugin', () => {
  const report = createStage2Report({
    findExecutable: name => name.startsWith('gst-') ? `D:/gstreamer/bin/${name}.exe` : 'C:/dotnet/dotnet.exe',
    inspectPlugin: plugin => plugin !== 'wasapi2src'
  });

  assert.equal(report.ready, false);
  assert.deepEqual(report.missing.plugins, ['wasapi2src']);
});
