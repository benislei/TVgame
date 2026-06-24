'use strict';

function validateStreamPayload(payload) {
  if (!payload || !payload.device || !payload.device.ip) {
    throw new Error('缺少电视 IP');
  }

  if (!payload.quality || !payload.quality.profile) {
    throw new Error('缺少画质档位');
  }
}

function registerIpcHandlers(ipcMain, services) {
  ipcMain.handle('config:load', () => services.config.load());

  ipcMain.handle('config:save', (_event, payload) => services.config.save(payload));

  ipcMain.handle('environment:check', () => services.environment.check());

  ipcMain.handle('environment:repair', () => services.environment.repair(services.projectRoot));

  ipcMain.handle('devices:list', () => services.discovery.list());

  ipcMain.handle('stream:start', (_event, payload) => {
    validateStreamPayload(payload);

    services.process.startInputBridge({
      projectRoot: services.projectRoot,
      inputBridgeRuntimePath: services.inputBridgeRuntimePath
    });

    try {
      const result = services.process.startStream({
        projectRoot: services.projectRoot,
        device: payload.device,
        quality: payload.quality,
        performanceProtection: payload.performanceProtection
      });

      if (result && result.started === false) {
        services.process.stopInputBridge();
      }

      return result;
    } catch (error) {
      services.process.stopInputBridge();
      throw error;
    }
  });

  ipcMain.handle('stream:stop', () => ({
    stream: services.process.stopStream(),
    inputBridge: services.process.stopInputBridge()
  }));

  ipcMain.handle('stream:status', () => services.process.status());
}

module.exports = {
  registerIpcHandlers
};
