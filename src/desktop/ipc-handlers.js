'use strict';

const { environmentCardsAllOk } = require('./environment-service');

function validateStreamPayload(payload) {
  if (!payload || !payload.device || !payload.device.ip) {
    throw new Error('缺少电视 IP');
  }

  if (!payload.quality || !payload.quality.profile) {
    throw new Error('缺少画质档位');
  }
}

function sendRepairProgress(event, payload) {
  if (event && event.sender && typeof event.sender.send === 'function') {
    event.sender.send('environment:repair-progress', payload);
  }
}

function registerIpcHandlers(ipcMain, services) {
  ipcMain.handle('config:load', () => services.config.load());

  ipcMain.handle('config:save', (_event, payload) => services.config.save(payload));

  ipcMain.handle('environment:check', () => services.environment.check());

  ipcMain.handle('environment:repair', event => services.environment.repair(services.projectRoot, {
    onProgress: progress => sendRepairProgress(event, progress)
  }));

  ipcMain.handle('devices:list', () => services.discovery.list());

  ipcMain.handle('stream:start', async (_event, payload) => {
    validateStreamPayload(payload);

    const environment = await services.environment.check();
    if (!environmentCardsAllOk(environment)) {
      return {
        started: false,
        needsRepair: true,
        message: '环境未全部正常，请先修复环境'
      };
    }

    services.process.startInputBridge({
      projectRoot: services.projectRoot,
      inputBridgeRuntimePath: services.inputBridgeRuntimePath
    });

    try {
      const result = services.process.startStream({
        projectRoot: services.projectRoot,
        nodeRuntimePath: services.nodeRuntimePath,
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
