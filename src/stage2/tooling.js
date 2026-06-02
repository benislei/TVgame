'use strict';

const { findExecutable, inspectPlugin } = require('../native-streamer/environment');

const REQUIRED_PLUGINS = [
  'd3d11screencapturesrc',
  'nvh264enc',
  'rtph264pay',
  'h264parse',
  'wasapi2src',
  'audioconvert',
  'audioresample',
  'rtpL16pay',
  'udpsink'
];

function createStage2Report(options = {}) {
  const find = options.findExecutable || findExecutable;
  const inspect = options.inspectPlugin || inspectPlugin;
  const gstLaunch = find('gst-launch-1.0');
  const gstInspect = find('gst-inspect-1.0');
  const dotnet = find('dotnet');
  const plugins = Object.fromEntries(REQUIRED_PLUGINS.map(name => [name, inspect(name)]));
  const missingPlugins = REQUIRED_PLUGINS.filter(name => !plugins[name]);

  return {
    ready: Boolean(gstLaunch && gstInspect && dotnet && missingPlugins.length === 0),
    gstreamer: {
      ready: Boolean(gstLaunch && gstInspect && missingPlugins.length === 0),
      gstLaunch,
      gstInspect
    },
    dotnet: { ready: Boolean(dotnet), path: dotnet },
    plugins,
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

module.exports = { REQUIRED_PLUGINS, createStage2Report };
