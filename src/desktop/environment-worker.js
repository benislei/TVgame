'use strict';

const path = require('node:path');
const { parentPort, workerData } = require('node:worker_threads');
const {
  createDesktopRuntimeDetector,
  createEnvironmentService
} = require('./environment-service');

function post(type, payload = {}) {
  parentPort.postMessage({ type, ...payload });
}

async function main() {
  const projectRoot = workerData.projectRoot || process.cwd();
  const inputBridgeRuntimePath = workerData.inputBridgeRuntimePath
    || path.join(projectRoot, 'InputBridgeRuntime', 'InputBridge.exe');
  const service = createEnvironmentService({
    getRuntime: createDesktopRuntimeDetector({
      projectRoot,
      inputBridgeRuntimePath
    })
  });

  if (workerData.action === 'check') {
    post('result', { result: service.check() });
    return;
  }

  if (workerData.action === 'repair') {
    const result = await service.repair(projectRoot, {
      onProgress: progress => post('progress', { progress })
    });
    post('result', { result });
    return;
  }

  throw new Error(`未知环境后台任务：${workerData.action}`);
}

main().catch(error => {
  post('error', {
    error: {
      message: error.message,
      stack: error.stack
    }
  });
});
