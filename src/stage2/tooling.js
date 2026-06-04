'use strict';

const { findExecutable, inspectPlugin } = require('../native-streamer/environment');

const REQUIRED_PLUGINS = [
  'd3d11screencapturesrc',
  'd3d11download',
  'nvh264enc',
  'rtph264pay',
  'h264parse',
  'wasapi2src',
  'audioconvert',
  'audioresample',
  'rtpL16pay',
  'udpsink'
];

const OPTIONAL_HEVC_PLUGINS = [
  'nvh265enc',
  'h265parse',
  'rtph265pay'
];

function createStage2Report(options = {}) {
  const find = options.findExecutable || findExecutable;
  const gstLaunch = find('gst-launch-1.0');
  const gstInspect = find('gst-inspect-1.0');
  const inspect = options.inspectPlugin || (plugin => inspectPlugin(plugin, gstInspect));
  const dotnet = find('dotnet');
  const plugins = Object.fromEntries(REQUIRED_PLUGINS.map(name => [name, inspect(name)]));
  const optionalPlugins = Object.fromEntries(OPTIONAL_HEVC_PLUGINS.map(name => [name, inspect(name)]));
  const missingPlugins = REQUIRED_PLUGINS.filter(name => !plugins[name]);
  const missingHevcPlugins = OPTIONAL_HEVC_PLUGINS.filter(name => !optionalPlugins[name]);

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
        ready: Boolean(plugins.nvh264enc && plugins.h264parse && plugins.rtph264pay),
        missing: ['nvh264enc', 'h264parse', 'rtph264pay'].filter(name => !plugins[name])
      },
      hevc: {
        ready: missingHevcPlugins.length === 0,
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

module.exports = { REQUIRED_PLUGINS, OPTIONAL_HEVC_PLUGINS, createStage2Report };
