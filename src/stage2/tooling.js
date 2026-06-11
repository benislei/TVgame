'use strict';

const { findExecutable, inspectPlugin } = require('../native-streamer/environment');

const REQUIRED_PLUGINS = [
  'd3d11screencapturesrc',
  'd3d11download',
  'rtph264pay',
  'h264parse',
  'wasapi2src',
  'audioconvert',
  'audioresample',
  'rtpL16pay',
  'udpsink'
];

const H264_ENCODER_PLUGINS = [
  'nvh264enc',
  'amfh264enc',
  'mfh264enc'
];

const HEVC_ENCODER_PLUGINS = [
  'nvh265enc',
  'amfh265enc',
  'mfh265enc'
];

const OPTIONAL_HEVC_PLUGINS = [
  ...HEVC_ENCODER_PLUGINS,
  'h265parse',
  'rtph265pay'
];

function createStage2Report(options = {}) {
  const find = options.findExecutable || findExecutable;
  const gstLaunch = find('gst-launch-1.0');
  const gstInspect = find('gst-inspect-1.0');
  const inspect = options.inspectPlugin || (plugin => inspectPlugin(plugin, gstInspect));
  const dotnet = find('dotnet');
  const plugins = Object.fromEntries(REQUIRED_PLUGINS.concat(H264_ENCODER_PLUGINS).map(name => [name, inspect(name)]));
  const optionalPlugins = Object.fromEntries(OPTIONAL_HEVC_PLUGINS.map(name => [name, inspect(name)]));
  const availableH264Encoders = H264_ENCODER_PLUGINS.filter(name => plugins[name]);
  const availableHevcEncoders = HEVC_ENCODER_PLUGINS.filter(name => optionalPlugins[name]);
  const missingPlugins = REQUIRED_PLUGINS
    .filter(name => !plugins[name])
    .concat(availableH264Encoders.length === 0 ? ['H.264 hardware encoder (nvh264enc/amfh264enc/mfh264enc)'] : []);
  const missingHevcPlugins = [
    availableHevcEncoders.length === 0 && 'nvh265enc|amfh265enc|mfh265enc',
    !optionalPlugins.h265parse && 'h265parse',
    !optionalPlugins.rtph265pay && 'rtph265pay'
  ].filter(Boolean);

  return {
    ready: Boolean(gstLaunch && gstInspect && dotnet && missingPlugins.length === 0),
    gstreamer: {
      ready: Boolean(gstLaunch && gstInspect && missingPlugins.length === 0),
      gstLaunch,
      gstInspect
    },
    dotnet: { ready: Boolean(dotnet), path: dotnet },
    plugins,
    optionalPlugins,
    codecs: {
      h264: {
        ready: Boolean(availableH264Encoders.length > 0 && plugins.h264parse && plugins.rtph264pay),
        encoder: availableH264Encoders[0] || null,
        availableEncoders: availableH264Encoders,
        missing: [
          availableH264Encoders.length === 0 && 'nvh264enc|amfh264enc|mfh264enc',
          !plugins.h264parse && 'h264parse',
          !plugins.rtph264pay && 'rtph264pay'
        ].filter(Boolean)
      },
      hevc: {
        ready: Boolean(availableHevcEncoders.length > 0 && optionalPlugins.h265parse && optionalPlugins.rtph265pay),
        encoder: availableHevcEncoders[0] || null,
        availableEncoders: availableHevcEncoders,
        missing: missingHevcPlugins
      }
    },
    missing: {
      executables: [
        !gstLaunch && 'gst-launch-1.0',
        !gstInspect && 'gst-inspect-1.0',
        !dotnet && 'dotnet'
      ].filter(Boolean),
      plugins: missingPlugins,
      pythonModules: []
    }
  };
}

module.exports = {
  REQUIRED_PLUGINS,
  H264_ENCODER_PLUGINS,
  HEVC_ENCODER_PLUGINS,
  OPTIONAL_HEVC_PLUGINS,
  createStage2Report
};
