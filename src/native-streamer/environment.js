'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const GSTREAMER_VERSION = '1.24.13';
const GSTREAMER_BASE_URL = `https://gstreamer.freedesktop.org/pkg/windows/${GSTREAMER_VERSION}/msvc`;

function buildGStreamerDownloadUrls() {
  return {
    runtime: `${GSTREAMER_BASE_URL}/gstreamer-1.0-msvc-x86_64-${GSTREAMER_VERSION}.msi`,
    devel: `${GSTREAMER_BASE_URL}/gstreamer-1.0-devel-msvc-x86_64-${GSTREAMER_VERSION}.msi`
  };
}

function splitPath(value) {
  return String(value || '')
    .split(path.delimiter)
    .map(item => item.trim())
    .filter(Boolean);
}

function executableNames(name) {
  return process.platform === 'win32' && !name.toLowerCase().endsWith('.exe')
    ? [name, `${name}.exe`]
    : [name];
}

function defaultSearchDirs(env = process.env) {
  const dirs = splitPath(env.PATH);
  const roots = [
    env.GSTREAMER_1_0_ROOT_MSVC_X86_64,
    env.GSTREAMER_1_0_ROOT_MINGW_X86_64,
    'C:/gstreamer/1.0/msvc_x86_64',
    'C:/gstreamer/1.0/mingw_x86_64'
  ].filter(Boolean);

  for (const root of roots) {
    dirs.unshift(path.join(root, 'bin'));
  }

  return [...new Set(dirs)];
}

function findExecutable(name, env = process.env) {
  for (const dir of defaultSearchDirs(env)) {
    for (const executable of executableNames(name)) {
      const candidate = path.join(dir, executable);
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function inspectPlugin(plugin, gstInspectPath = findExecutable('gst-inspect-1.0')) {
  if (!gstInspectPath) return false;

  try {
    const result = childProcess.spawnSync(gstInspectPath, [plugin], {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function checkPythonModule(pythonPath, code) {
  if (!pythonPath) return false;

  try {
    const executable = path.basename(pythonPath).toLowerCase();
    const args = executable === 'py.exe' || executable === 'py'
      ? ['-3', '-c', code]
      : ['-c', code];
    const result = childProcess.spawnSync(pythonPath, args, {
      encoding: 'utf8',
      timeout: 8000,
      windowsHide: true
    });
    return result.status === 0;
  } catch {
    return false;
  }
}

function createEnvironmentReport(options = {}) {
  const env = options.env || process.env;
  const find = options.findExecutable || (name => findExecutable(name, env));
  const inspect = options.inspectPlugin || (plugin => inspectPlugin(plugin, find('gst-inspect-1.0')));
  const checkPython = options.checkPythonModule || checkPythonModule;
  const gstLaunch = find('gst-launch-1.0');
  const gstInspect = find('gst-inspect-1.0');
  const python = find('python') || find('python3') || find('py');
  const gstreamerRoot =
    env.GSTREAMER_1_0_ROOT_MSVC_X86_64 ||
    env.GSTREAMER_1_0_ROOT_MINGW_X86_64 ||
    null;

  const plugins = {
    webrtcbin: inspect('webrtcbin'),
    d3d11screencapturesrc: inspect('d3d11screencapturesrc'),
    nvh264enc: inspect('nvh264enc'),
    rtph264pay: inspect('rtph264pay'),
    h264parse: inspect('h264parse'),
    dxgiscreencapsrc: inspect('dxgiscreencapsrc')
  };

  const requiredPlugins = [
    'webrtcbin',
    'nvh264enc',
    'rtph264pay',
    'h264parse'
  ];
  const hasCapture = plugins.d3d11screencapturesrc || plugins.dxgiscreencapsrc;
  const hasRequiredPlugins = requiredPlugins.every(name => plugins[name]) && hasCapture;
  const pythonModules = {
    websockets: checkPython(python, 'import websockets'),
    gstreamerBindings: checkPython(
      python,
      [
        'import gi',
        'gi.require_version("Gst", "1.0")',
        'gi.require_version("GstWebRTC", "1.0")',
        'gi.require_version("GstSdp", "1.0")',
        'from gi.repository import Gst, GstWebRTC, GstSdp'
      ].join('; ')
    )
  };
  const hasPythonSupport = Boolean(python && pythonModules.websockets && pythonModules.gstreamerBindings);

  return {
    ready: Boolean(gstLaunch && gstInspect && hasRequiredPlugins && hasPythonSupport),
    gstreamerRoot,
    downloadUrls: buildGStreamerDownloadUrls(),
    executables: {
      gstLaunch: { found: Boolean(gstLaunch), path: gstLaunch },
      gstInspect: { found: Boolean(gstInspect), path: gstInspect },
      python: { found: Boolean(python), path: python }
    },
    plugins,
    python: pythonModules,
    missing: {
      executables: [
        !gstLaunch && 'gst-launch-1.0',
        !gstInspect && 'gst-inspect-1.0',
        !python && 'python'
      ].filter(Boolean),
      plugins: [
        ...requiredPlugins.filter(name => !plugins[name]),
        !hasCapture && 'd3d11screencapturesrc 或 dxgiscreencapsrc'
      ].filter(Boolean),
      pythonModules: [
        !pythonModules.websockets && 'Python websockets',
        !pythonModules.gstreamerBindings && 'Python GStreamer 绑定（gi / Gst / GstWebRTC）'
      ].filter(Boolean)
    }
  };
}

module.exports = {
  GSTREAMER_VERSION,
  buildGStreamerDownloadUrls,
  checkPythonModule,
  createEnvironmentReport,
  findExecutable,
  inspectPlugin
};
