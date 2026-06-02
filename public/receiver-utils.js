(function (root, factory) {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    root.ReceiverUtils = factory();
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ReceiverUtils = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const BUTTON_NAMES = [
    'a', 'b', 'x', 'y',
    'lb', 'rb', 'lt', 'rt',
    'back', 'start', 'ls', 'rs',
    'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight',
    'home'
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function applyDeadzone(value, deadzone = 0.12) {
    const n = Number(value) || 0;
    const abs = Math.abs(n);
    if (abs < deadzone) return 0;
    return clamp(Math.sign(n) * ((abs - deadzone) / (1 - deadzone)), -1, 1);
  }

  function normalizeButton(button) {
    if (!button) return { pressed: false, value: 0 };
    const value = clamp(Number(button.value) || 0, 0, 1);
    return {
      pressed: Boolean(button.pressed) || value >= 0.5,
      value
    };
  }

  function normalizeGamepad(gamepad, options = {}) {
    const deadzone = options.deadzone ?? 0.12;
    const buttons = {};
    const rawButtons = Array.from(gamepad.buttons || []).map(normalizeButton);

    for (let i = 0; i < BUTTON_NAMES.length; i++) {
      buttons[BUTTON_NAMES[i]] = rawButtons[i] || { pressed: false, value: 0 };
    }

    const axes = Array.from(gamepad.axes || []);
    return {
      type: 'input',
      kind: 'gamepad',
      action: 'state',
      index: gamepad.index,
      id: gamepad.id,
      mapping: gamepad.mapping || '',
      axes: {
        lx: applyDeadzone(axes[0] || 0, deadzone),
        ly: applyDeadzone(axes[1] || 0, deadzone),
        rx: applyDeadzone(axes[2] || 0, deadzone),
        ry: applyDeadzone(axes[3] || 0, deadzone)
      },
      buttons,
      raw: {
        axes,
        buttons: rawButtons
      }
    };
  }

  function stableGamepadSignature(state) {
    return JSON.stringify({
      index: state.index,
      axes: state.axes,
      buttons: Object.fromEntries(Object.entries(state.buttons).map(([name, button]) => [
        name,
        [button.pressed, Number(button.value.toFixed(3))]
      ]))
    });
  }

  function createLatencyState() {
    return {
      nextPingId: 1,
      pending: new Map(),
      lastRttMs: null,
      minRttMs: null,
      maxRttMs: null,
      avgRttMs: null,
      samples: 0
    };
  }

  function makeLatencyPing(state, nowMs) {
    const id = state.nextPingId++;
    state.pending.set(id, nowMs);
    return {
      type: 'latency-ping',
      kind: 'latency',
      id,
      sentAt: nowMs
    };
  }

  function applyLatencyPong(state, pong, nowMs) {
    const sentAt = Number(pong.sentAt ?? state.pending.get(pong.id));
    if (!Number.isFinite(sentAt)) return null;

    state.pending.delete(pong.id);
    const rttMs = Math.max(0, nowMs - sentAt);
    state.lastRttMs = rttMs;
    state.minRttMs = state.minRttMs == null ? rttMs : Math.min(state.minRttMs, rttMs);
    state.maxRttMs = state.maxRttMs == null ? rttMs : Math.max(state.maxRttMs, rttMs);
    state.samples += 1;
    state.avgRttMs = state.avgRttMs == null
      ? rttMs
      : state.avgRttMs + (rttMs - state.avgRttMs) / Math.min(state.samples, 20);
    return { rttMs };
  }

  function formatMs(value) {
    return value == null || !Number.isFinite(value) ? '--' : `${Math.round(value)} ms`;
  }

  function formatNumber(value, digits = 0) {
    return value == null || !Number.isFinite(value) ? '--' : Number(value).toFixed(digits);
  }

  return {
    applyDeadzone,
    normalizeGamepad,
    stableGamepadSignature,
    createLatencyState,
    makeLatencyPing,
    applyLatencyPong,
    formatMs,
    formatNumber
  };
});
