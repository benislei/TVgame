'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvgame', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: payload => ipcRenderer.invoke('config:save', payload),
  checkEnvironment: () => ipcRenderer.invoke('environment:check'),
  repairEnvironment: () => ipcRenderer.invoke('environment:repair'),
  listDevices: () => ipcRenderer.invoke('devices:list'),
  startStream: payload => ipcRenderer.invoke('stream:start', payload),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  getStatus: () => ipcRenderer.invoke('stream:status')
});
