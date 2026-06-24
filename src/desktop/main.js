'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain } = require('electron');
const { createConfigStore } = require('./config-store');
const { createEnvironmentService } = require('./environment-service');
const { createProcessService } = require('./process-service');
const { createDeviceDiscovery } = require('./device-discovery');
const { registerIpcHandlers } = require('./ipc-handlers');

const projectRoot = path.resolve(__dirname, '..', '..');

function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    title: 'TVGame 发送端',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  return window;
}

function createServices(electronApp = app) {
  return {
    projectRoot,
    inputBridgeRuntimePath: path.join(projectRoot, 'InputBridgeRuntime', 'InputBridge.exe'),
    config: createConfigStore({ appDataDir: electronApp.getPath('userData') }),
    environment: createEnvironmentService(),
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
    createWindow();
  });

  app.on('before-quit', () => {
    cleanupActiveServices();
  });

  app.on('window-all-closed', () => {
    cleanupActiveServices();
    app.quit();
  });
}

if (require.main === module) {
  registerApp();
}

module.exports = {
  createWindow,
  createServices,
  cleanupServices,
  registerApp,
  projectRoot
};
