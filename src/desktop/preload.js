'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tvgame', {
  loadConfig: () => ipcRenderer.invoke('config:load'),
  saveConfig: payload => ipcRenderer.invoke('config:save', payload),
  checkEnvironment: () => ipcRenderer.invoke('environment:check'),
  repairEnvironment: () => ipcRenderer.invoke('environment:repair'),
  onRepairProgress: callback => {
    if (typeof callback !== 'function') {
      return () => {};
    }

    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('environment:repair-progress', listener);
    return () => ipcRenderer.removeListener('environment:repair-progress', listener);
  },
  listDevices: () => ipcRenderer.invoke('devices:list'),
  startStream: payload => ipcRenderer.invoke('stream:start', payload),
  stopStream: () => ipcRenderer.invoke('stream:stop'),
  getStatus: () => ipcRenderer.invoke('stream:status')
});
