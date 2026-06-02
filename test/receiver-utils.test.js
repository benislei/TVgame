'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyDeadzone,
  normalizeGamepad,
  createLatencyState,
  applyLatencyPong
} = require('../public/receiver-utils');

test('applyDeadzone removes small stick noise and rescales larger values', () => {
  assert.equal(applyDeadzone(0.05, 0.12), 0);
  assert.equal(applyDeadzone(-0.11, 0.12), 0);
  assert.equal(Number(applyDeadzone(0.56, 0.12).toFixed(3)), 0.5);
});

test('normalizeGamepad maps standard controller buttons and axes', () => {
  const buttons = Array.from({ length: 17 }, (_, i) => ({ pressed: i === 0 || i === 6 || i === 12, value: i === 6 ? 0.75 : i === 7 ? 0.4 : i === 0 || i === 12 ? 1 : 0 }));
  const state = normalizeGamepad({
    index: 2,
    id: 'standard pad',
    mapping: 'standard',
    axes: [0.5, -0.5, 0.01, -0.2],
    buttons
  });

  assert.equal(state.kind, 'gamepad');
  assert.equal(state.action, 'state');
  assert.equal(state.index, 2);
  assert.equal(state.buttons.a.pressed, true);
  assert.equal(state.buttons.lt.pressed, true);
  assert.equal(state.buttons.rt.value, 0.4);
  assert.equal(state.buttons.dpadUp.pressed, true);
  assert.equal(Number(state.axes.lx.toFixed(3)), 0.432);
  assert.equal(Number(state.axes.ly.toFixed(3)), -0.432);
  assert.equal(state.axes.rx, 0);
  assert.equal(Number(state.axes.ry.toFixed(3)), -0.091);
});

test('applyLatencyPong records data channel rtt', () => {
  const state = createLatencyState();
  const result = applyLatencyPong(state, { id: 7, sentAt: 100 }, 137.25);

  assert.equal(result.rttMs, 37.25);
  assert.equal(state.lastRttMs, 37.25);
  assert.equal(state.samples, 1);
});
