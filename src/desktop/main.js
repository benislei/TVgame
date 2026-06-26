'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createConfigStore } = require('./config-store');
const {
  createDesktopRuntimeDetector,
  createEnvironmentService
} = require('./environment-service');
const { createProcessService } = require('./process-service');
const { createDeviceDiscovery } = require('./device-discovery');
const { registerIpcHandlers } = require('./ipc-handlers');

function replacePathSegment(source, segment, replacement) {
  const normalized = path.normalize(source);
  const parts = normalized.split(/[\\/]+/);
  const index = parts.lastIndexOf(segment);
  if (index === -1) return null;

  parts[index] = replacement;
  return path.normalize(parts.slice(0, index + 1).join(path.sep));
}

function resolveProjectRoot(desktopDir = __dirname) {
  const asarRoot = replacePathSegment(desktopDir, 'app.asar', 'app');
  if (asarRoot) return asarRoot;

  return path.resolve(desktopDir, '..', '..');
}

const projectRoot = resolveProjectRoot();
let mainWindow = null;

function createWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1040,
    minHeight: 680,
    title: 'TVGame 发送端',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.setMenuBarVisibility(false);
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return window;
}

function createServices(electronApp = app, options = {}) {
  const serviceProjectRoot = resolveProjectRoot(options.desktopDir || __dirname);
  const inputBridgeRuntimePath = path.join(serviceProjectRoot, 'InputBridgeRuntime', 'InputBridge.exe');

  return {
    projectRoot: serviceProjectRoot,
    inputBridgeRuntimePath,
    nodeRuntimePath: process.execPath,
    config: createConfigStore({ appDataDir: electronApp.getPath('userData') }),
    environment: createEnvironmentService({
      getRuntime: createDesktopRuntimeDetector({
        projectRoot: serviceProjectRoot,
        inputBridgeRuntimePath
      })
    }),
    process: createProcessService(),
    discovery: createDeviceDiscovery()
  };
}

function cleanupServices(services) {
  if (!services) {
    return {
      stream: { stopped: false },
      inputBridge: { stopped: false },
      discovery: { stopped: false }
    };
  }

  const stream = services.process.stopStream();
  const inputBridge = services.process.stopInputBridge();
  services.discovery.stop();

  return {
    stream,
    inputBridge,
    discovery: { stopped: true }
  };
}

function registerApp() {
  let services = null;

  function cleanupActiveServices() {
    cleanupServices(services);
  }

  app.whenReady().then(() => {
    services = createServices(app);
    registerIpcHandlers(ipcMain, services);
    services.discovery.start();
    mainWindow = createWindow();
  });

  app.on('before-quit', () => {
    cleanupActiveServices();
  });

  app.on('window-all-closed', () => {
    cleanupActiveServices();
    app.quit();
  });
}

if ((process.versions && process.versions.electron && process.type === 'browser') || require.main === module) {
  registerApp();
}

module.exports = {
  createWindow,
  createServices,
  cleanupServices,
  registerApp,
  resolveProjectRoot,
  projectRoot
};
