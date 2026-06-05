'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
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
  assert.equal(report.plugins.d3d11download, true);
  assert.equal(report.plugins.nvh264enc, true);
  assert.equal(report.optionalPlugins.nvh265enc, true);
  assert.equal(report.codecs.hevc.ready, true);
  assert.equal(report.plugins.wasapi2src, true);
  assert.equal(report.plugins.rtpL16pay, true);
});

test('stage2 report keeps H264 ready when optional HEVC plugins are missing', () => {
  const report = createStage2Report({
    findExecutable: name => {
      if (name === 'gst-launch-1.0' || name === 'gst-inspect-1.0') {
        return `D:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
      }
      if (name === 'dotnet') return 'C:/Program Files/dotnet/dotnet.exe';
      return null;
    },
    inspectPlugin: plugin => !['nvh265enc', 'h265parse', 'rtph265pay'].includes(plugin)
  });

  assert.equal(report.ready, true);
  assert.equal(report.codecs.h264.ready, true);
  assert.equal(report.codecs.hevc.ready, false);
  assert.deepEqual(report.codecs.hevc.missing, ['nvh265enc', 'h265parse', 'rtph265pay']);
  assert.doesNotMatch(report.missing.plugins.join(','), /nvh265enc/);
});

test('stage2 report is ready on AMD when AMF H264 encoder exists without NVENC', () => {
  const report = createStage2Report({
    findExecutable: name => {
      if (name === 'gst-launch-1.0' || name === 'gst-inspect-1.0') {
        return `D:/gstreamer/1.0/msvc_x86_64/bin/${name}.exe`;
      }
      if (name === 'dotnet') return 'C:/Program Files/dotnet/dotnet.exe';
      return null;
    },
    inspectPlugin: plugin => plugin !== 'nvh264enc' && plugin !== 'nvh265enc'
  });

  assert.equal(report.ready, true);
  assert.equal(report.gstreamer.ready, true);
  assert.equal(report.plugins.nvh264enc, false);
  assert.equal(report.plugins.amfh264enc, true);
  assert.equal(report.codecs.h264.ready, true);
  assert.equal(report.codecs.h264.encoder, 'amfh264enc');
  assert.deepEqual(report.codecs.h264.missing, []);
  assert.doesNotMatch(report.missing.plugins.join(','), /nvh264enc/);
});

test('stage2 report accepts generic Media Foundation H264 encoder as fallback', () => {
  const report = createStage2Report({
    findExecutable: name => name.startsWith('gst-') ? `D:/gstreamer/bin/${name}.exe` : 'C:/dotnet/dotnet.exe',
    inspectPlugin: plugin => !['nvh264enc', 'amfh264enc', 'nvh265enc'].includes(plugin)
  });

  assert.equal(report.ready, true);
  assert.equal(report.codecs.h264.ready, true);
  assert.equal(report.codecs.h264.encoder, 'mfh264enc');
  assert.equal(report.plugins.mfh264enc, true);
});

test('stage2 report explains when no supported H264 hardware encoder exists', () => {
  const report = createStage2Report({
    findExecutable: name => name.startsWith('gst-') ? `D:/gstreamer/bin/${name}.exe` : 'C:/dotnet/dotnet.exe',
    inspectPlugin: plugin => !['nvh264enc', 'amfh264enc', 'mfh264enc', 'nvh265enc'].includes(plugin)
  });

  assert.equal(report.ready, false);
  assert.equal(report.codecs.h264.ready, false);
  assert.deepEqual(report.codecs.h264.missing, ['nvh264enc|amfh264enc|mfh264enc']);
  assert.ok(report.missing.plugins.includes('H.264 hardware encoder (nvh264enc/amfh264enc/mfh264enc)'));
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

test('stage2 report default inspector uses the resolved gst-inspect path', () => {
  const toolingPath = require.resolve('../src/stage2/tooling');
  const environmentPath = require.resolve('../src/native-streamer/environment');
  const environment = require(environmentPath);
  const originalInspectPlugin = environment.inspectPlugin;
  const seen = [];

  delete require.cache[toolingPath];
  environment.inspectPlugin = (plugin, gstInspectPath) => {
    seen.push([plugin, gstInspectPath]);
    return true;
  };

  try {
    const { createStage2Report: createFreshStage2Report } = require(toolingPath);
    const report = createFreshStage2Report({
      findExecutable: name => {
        if (name === 'gst-inspect-1.0') return 'D:/gstreamer/bin/gst-inspect-1.0.exe';
        if (name === 'gst-launch-1.0') return 'D:/gstreamer/bin/gst-launch-1.0.exe';
        if (name === 'dotnet') return 'C:/dotnet/dotnet.exe';
        return null;
      }
    });

    assert.equal(report.ready, true);
    assert.equal(seen.length, 15);
    assert.deepEqual(seen[0], ['d3d11screencapturesrc', 'D:/gstreamer/bin/gst-inspect-1.0.exe']);
  } finally {
    environment.inspectPlugin = originalInspectPlugin;
    delete require.cache[toolingPath];
    require(toolingPath);
  }
});

test('stage2-check CLI command prints the stage 2 report', () => {
  const cliPath = path.join(__dirname, '..', 'src', 'native-streamer', 'cli.js');
  const result = childProcess.spawnSync(process.execPath, [cliPath, 'stage2-check'], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /阶段 2 发送端环境检测/);
  assert.match(result.stdout, /编码能力/);
  assert.match(result.stdout, /H\.264/);
  assert.match(result.stdout, /HEVC/);
  assert.doesNotMatch(result.stderr, /未知命令/);
});
