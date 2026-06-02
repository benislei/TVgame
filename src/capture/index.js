'use strict';

const path = require('path');

function loadNative() {
  const candidates = [
    path.join(__dirname, '..', '..', 'native', 'dxgi-capture', 'dxgi_capture.win32-x64-msvc.node'),
    path.join(__dirname, '..', '..', 'native', 'dxgi-capture', 'index.node')
  ];

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next native build output.
    }
  }

  throw new Error(
    'DXGI native module is not built. Build native/dxgi-capture with napi-rs on Windows, ' +
    'or inject a compatible capture object into createBgraFrameSource().'
  );
}

class DesktopDuplicator {
  static async listDisplays() {
    return loadNative().listDisplays();
  }

  constructor(options = {}) {
    const native = loadNative();
    this.inner = new native.NativeDuplicator({
      displayId: options.displayId ?? 0,
      fps: options.fps ?? 60,
      includeCursor: options.includeCursor ?? true,
      maxQueueSize: options.maxQueueSize ?? 2
    });
  }

  start() {
    return this.inner.start();
  }

  stop() {
    return this.inner.stop();
  }

  nextFrame(timeoutMs = 16) {
    return this.inner.nextFrame(timeoutMs);
  }

  getDisplayInfo() {
    return this.inner.getDisplayInfo();
  }
}

module.exports = { DesktopDuplicator };
