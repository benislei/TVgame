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

function registerApp() {
  app.whenReady().then(() => {
    const services = createServices(app);
    registerIpcHandlers(ipcMain, services);
    services.discovery.start();
    createWindow();
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}

if (require.main === module) {
  registerApp();
}

module.exports = {
  createWindow,
  createServices,
  registerApp,
  projectRoot
};
