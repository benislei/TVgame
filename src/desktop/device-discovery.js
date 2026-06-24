'use strict';

const dgram = require('node:dgram');

const DISCOVERY_PORT = 8790;
const RECEIVER_APP = 'TVGameReceiver';
const UNKNOWN_DEVICE_NAME = '未知电视设备';
const UNKNOWN_DECODER = '未知';
const DEFAULT_RECOMMENDED_PROFILE = 'h2641080p30';

function textOrFallback(value, fallback) {
  if (typeof value !== 'string') {
    return fallback;
  }

  const text = value.trim();
  return text || fallback;
}

function normalizeAndroidApi(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function parseDiscoveryMessage(message, remote = {}) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(message) ? message.toString('utf8') : String(message));
  } catch (_) {
    return null;
  }

  if (!parsed || parsed.app !== RECEIVER_APP) {
    return null;
  }

  const ip = textOrFallback(remote.address, textOrFallback(parsed.ip, ''));
  if (!ip) {
    return null;
  }

  return {
    id: ip,
    name: textOrFallback(parsed.deviceName, UNKNOWN_DEVICE_NAME),
    ip,
    androidApi: normalizeAndroidApi(parsed.androidApi),
    decoder: textOrFallback(parsed.decoder, UNKNOWN_DECODER),
    recommendedProfile: textOrFallback(parsed.recommendedProfile, DEFAULT_RECOMMENDED_PROFILE),
    lastSeenAt: Date.now()
  };
}

function createDeviceDiscovery(options = {}) {
  const socketFactory = options.socketFactory || (() => dgram.createSocket('udp4'));
  const devices = new Map();
  let socket = null;
  let newestSeenAt = 0;

  function reportError(error) {
    if (typeof options.onError === 'function') {
      options.onError(error);
    }
  }

  function clearSocket(failedSocket) {
    if (socket === failedSocket) {
      socket = null;
    }

    if (failedSocket && typeof failedSocket.close === 'function') {
      try {
        failedSocket.close();
      } catch (error) {
        reportError(error);
      }
    }
  }

  function list() {
    return Array.from(devices.values()).sort((left, right) => right.lastSeenAt - left.lastSeenAt);
  }

  function start(onUpdate) {
    if (socket) {
      return;
    }

    const nextSocket = socketFactory();
    socket = nextSocket;

    nextSocket.on('message', (message, remote) => {
      const device = parseDiscoveryMessage(message, remote);
      if (!device) {
        return;
      }

      if (device.lastSeenAt <= newestSeenAt) {
        device.lastSeenAt = newestSeenAt + 1;
      }
      newestSeenAt = device.lastSeenAt;
      devices.set(device.ip, device);

      if (typeof onUpdate === 'function') {
        onUpdate(list());
      }
    });

    nextSocket.on('error', error => {
      reportError(error);
      clearSocket(nextSocket);
    });

    try {
      nextSocket.bind(DISCOVERY_PORT);
    } catch (error) {
      reportError(error);
      clearSocket(nextSocket);
    }
  }

  function stop() {
    if (!socket) {
      return;
    }

    const currentSocket = socket;
    socket = null;

    try {
      currentSocket.close();
    } catch (error) {
      reportError(error);
    }
  }

  return {
    start,
    stop,
    list
  };
}

module.exports = {
  DISCOVERY_PORT,
  parseDiscoveryMessage,
  createDeviceDiscovery
};
