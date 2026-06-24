'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');

const {
  DISCOVERY_PORT,
  parseDiscoveryMessage,
  createDeviceDiscovery
} = require('../src/desktop/device-discovery');

function receiverPayload(overrides = {}) {
  return Buffer.from(JSON.stringify({
    app: 'TVGameReceiver',
    version: 1,
    deviceName: 'Xiaomi MiTV-AZFU0',
    androidApi: 34,
    decoder: 'c2.amlogic.avc.decoder',
    recommendedProfile: 'hevc1080p60',
    ...overrides
  }));
}

function createFakeSocket() {
  const socket = new EventEmitter();
  socket.bindCalls = [];
  socket.closeCalls = 0;
  socket.bind = port => {
    socket.bindCalls.push(port);
  };
  socket.close = () => {
    socket.closeCalls += 1;
  };
  return socket;
}

test('parseDiscoveryMessage accepts TVGame receiver broadcast payloads', () => {
  const device = parseDiscoveryMessage(receiverPayload(), { address: '192.168.50.140' });

  assert.deepEqual(Object.keys(device).sort(), [
    'androidApi',
    'decoder',
    'id',
    'ip',
    'lastSeenAt',
    'name',
    'recommendedProfile'
  ].sort());
  assert.equal(device.id, '192.168.50.140');
  assert.equal(device.name, 'Xiaomi MiTV-AZFU0');
  assert.equal(device.ip, '192.168.50.140');
  assert.equal(device.androidApi, 34);
  assert.equal(device.decoder, 'c2.amlogic.avc.decoder');
  assert.equal(device.recommendedProfile, 'hevc1080p60');
  assert.equal(typeof device.lastSeenAt, 'number');
});

test('parseDiscoveryMessage rejects invalid JSON and unrelated apps', () => {
  assert.equal(parseDiscoveryMessage(Buffer.from('{'), { address: '192.168.50.140' }), null);
  assert.equal(parseDiscoveryMessage(Buffer.from(JSON.stringify({ app: 'Other' })), { address: '192.168.50.140' }), null);
});

test('parseDiscoveryMessage falls back to payload ip and real Chinese unknown labels', () => {
  const device = parseDiscoveryMessage(receiverPayload({
    ip: '192.168.50.141',
    deviceName: '',
    decoder: ''
  }), {});

  assert.equal(device.id, '192.168.50.141');
  assert.equal(device.ip, '192.168.50.141');
  assert.equal(device.name, '未知电视设备');
  assert.equal(device.decoder, '未知');
});

test('parseDiscoveryMessage normalizes renderer-facing defaults', () => {
  const missing = parseDiscoveryMessage(receiverPayload({
    androidApi: undefined,
    recommendedProfile: undefined
  }), { address: '192.168.50.142' });
  const invalid = parseDiscoveryMessage(receiverPayload({
    androidApi: '34',
    recommendedProfile: '   '
  }), { address: '192.168.50.143' });
  const nonStringProfile = parseDiscoveryMessage(receiverPayload({
    androidApi: Number.NaN,
    recommendedProfile: 123
  }), { address: '192.168.50.144' });

  assert.equal(missing.androidApi, 0);
  assert.equal(missing.recommendedProfile, 'h2641080p30');
  assert.equal(invalid.androidApi, 0);
  assert.equal(invalid.recommendedProfile, 'h2641080p30');
  assert.equal(nonStringProfile.androidApi, 0);
  assert.equal(nonStringProfile.recommendedProfile, 'h2641080p30');
});

test('device discovery binds UDP port, listens for messages and reports newest-first list updates', () => {
  const sockets = [];
  const updates = [];
  const discovery = createDeviceDiscovery({
    socketFactory: () => {
      const socket = createFakeSocket();
      sockets.push(socket);
      return socket;
    }
  });

  discovery.start(list => updates.push(list));

  assert.equal(sockets.length, 1);
  assert.deepEqual(sockets[0].bindCalls, [DISCOVERY_PORT]);

  sockets[0].emit('message', receiverPayload({
    deviceName: 'Living Room TV'
  }), { address: '192.168.50.140' });
  const firstSeenAt = updates[0][0].lastSeenAt;

  sockets[0].emit('message', receiverPayload({
    deviceName: 'Bedroom TV',
    decoder: 'c2.qti.avc.decoder'
  }), { address: '192.168.50.141' });

  assert.equal(updates.length, 2);
  assert.deepEqual(updates[1].map(device => device.ip), ['192.168.50.141', '192.168.50.140']);
  assert.equal(updates[1][0].name, 'Bedroom TV');
  assert.equal(updates[1][1].name, 'Living Room TV');
  assert.equal(discovery.list()[1].lastSeenAt, firstSeenAt);
});

test('device discovery start is idempotent while running', () => {
  const sockets = [];
  const discovery = createDeviceDiscovery({
    socketFactory: () => {
      const socket = createFakeSocket();
      sockets.push(socket);
      return socket;
    }
  });

  discovery.start();
  discovery.start();

  assert.equal(sockets.length, 1);
  assert.deepEqual(sockets[0].bindCalls, [DISCOVERY_PORT]);
});

test('device discovery stop closes the socket and is safe while idle', () => {
  const socket = createFakeSocket();
  const discovery = createDeviceDiscovery({ socketFactory: () => socket });

  discovery.stop();
  discovery.start();
  discovery.stop();
  discovery.stop();

  assert.equal(socket.closeCalls, 1);
});

test('device discovery contains socket errors and exposes them through onError', () => {
  const socket = createFakeSocket();
  const errors = [];
  const discovery = createDeviceDiscovery({
    socketFactory: () => socket,
    onError: error => errors.push(error)
  });
  const error = new Error('bind failed');

  discovery.start();
  assert.doesNotThrow(() => socket.emit('error', error));
  assert.deepEqual(errors, [error]);
});

test('device discovery clears async socket errors and can start again', () => {
  const sockets = [];
  const errors = [];
  const discovery = createDeviceDiscovery({
    socketFactory: () => {
      const socket = createFakeSocket();
      sockets.push(socket);
      return socket;
    },
    onError: error => errors.push(error)
  });
  const error = new Error('async bind failed');

  discovery.start();
  sockets[0].emit('error', error);
  discovery.start();

  assert.deepEqual(errors, [error]);
  assert.equal(sockets.length, 2);
  assert.equal(sockets[0].closeCalls, 1);
  assert.deepEqual(sockets[1].bindCalls, [DISCOVERY_PORT]);
});

test('device discovery repeated updates for the same IP replace one list entry', () => {
  const socket = createFakeSocket();
  const updates = [];
  const discovery = createDeviceDiscovery({ socketFactory: () => socket });

  discovery.start(list => updates.push(list));
  socket.emit('message', receiverPayload({
    deviceName: 'Old Living Room TV',
    decoder: 'old.decoder'
  }), { address: '192.168.50.145' });
  socket.emit('message', receiverPayload({
    deviceName: 'New Living Room TV',
    decoder: 'new.decoder'
  }), { address: '192.168.50.145' });

  assert.equal(updates.length, 2);
  assert.equal(updates[1].length, 1);
  assert.equal(updates[1][0].ip, '192.168.50.145');
  assert.equal(updates[1][0].name, 'New Living Room TV');
  assert.equal(updates[1][0].decoder, 'new.decoder');
});

test('desktop device discovery production text does not contain mojibake fragments', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'desktop', 'device-discovery.js'), 'utf8');

  for (const fragment of ['缂?', '閸?', '鏉?', '濡?', '濮?', '閹?', '娑?', '閻?', '闁?', '缁?', '鏈煡']) {
    assert.equal(source.includes(fragment), false);
  }

  assert.match(source, /未知电视设备/);
  assert.match(source, /未知/);
});
