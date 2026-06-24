'use strict';

function registerIpcHandlers(ipcMain, services) {
  ipcMain.handle('config:load', () => services.config.load());

  ipcMain.handle('config:save', (_event, payload) => services.config.save(payload));

  ipcMain.handle('environment:check', () => services.environment.check());

  ipcMain.handle('environment:repair', () => services.environment.repair(services.projectRoot));

  ipcMain.handle('devices:list', () => services.discovery.list());

  ipcMain.handle('stream:start', (_event, payload) => {
    services.process.startInputBridge({
      projectRoot: services.projectRoot,
      inputBridgeRuntimePath: services.inputBridgeRuntimePath
    });

    return services.process.startStream({
      projectRoot: services.projectRoot,
      device: payload.device,
      quality: payload.quality,
      performanceProtection: payload.performanceProtection
    });
  });

  ipcMain.handle('stream:stop', () => services.process.stopStream());

  ipcMain.handle('stream:status', () => services.process.status());
}

module.exports = {
  registerIpcHandlers
};
