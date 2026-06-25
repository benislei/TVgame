'use strict';

const QUALITY_PRESETS = [
  {
    id: 'h264720p30',
    profile: 'h264720p30',
    label: '720P30',
    codec: 'H.264',
    note: '稳定保底，适合电视盒子和弱解码设备',
    tag: '稳'
  },
  {
    id: 'h264720p60',
    profile: 'h264720p60',
    label: '720P60',
    codec: 'H.264',
    note: '流畅优先，适合动作游戏和普通电视',
    tag: '快'
  },
  {
    id: 'h2641080p30',
    profile: 'h2641080p30',
    label: '1080P30',
    codec: 'H.264',
    note: '清晰稳定，适合多数 Android 11+ 设备',
    tag: '清'
  },
  {
    id: 'h2641080p60',
    profile: 'h2641080p60',
    label: '1080P60',
    codec: 'H.264',
    note: '高刷新体验，适合性能较好的电视或盒子',
    tag: '60'
  },
  {
    id: 'hevc1080p30',
    profile: 'hevc1080p30',
    label: 'HEVC 1080P30',
    codec: 'HEVC',
    note: '推荐，画面与负载更平衡',
    tag: '推荐'
  },
  {
    id: 'hevc1080p60',
    profile: 'hevc1080p60',
    label: 'HEVC 1080P60',
    codec: 'HEVC',
    note: '高画质高刷新，适合解码能力较强的 Android 11+ 设备',
    tag: '强'
  }
];

const DIAGNOSTIC_ITEMS = [
  { key: 'gstreamer', label: 'GStreamer' },
  { key: 'encoder', label: '编码器' },
  { key: 'inputBridge', label: '输入桥' },
  { key: 'gamepadDriver', label: '手柄驱动' }
];

const state = {
  config: {},
  devices: [],
  environment: {},
  status: { streamRunning: false, logs: [] },
  selectedDevice: '',
  selectedQuality: 'hevc1080p30',
  performanceProtection: true,
  manualIp: '',
  deviceMode: 'auto',
  streamStartedAt: null,
  busy: false
};

const elements = {};

function ensurePreviewStub() {
  if (window.tvgame) {
    return;
  }

  const previewLogs = ['开发预览模式：未检测到 Electron preload，已启用本地示例数据。'];
  let previewRunning = false;
  let previewStartedAt = null;

  window.tvgame = {
    loadConfig() {
      return {
        selectedQuality: 'hevc1080p30',
        performanceProtection: true,
        selectedDevice: 'preview-living-room',
        manualIp: ''
      };
    },
    saveConfig(payload) {
      previewLogs.push(`已保存配置：${payload.selectedQuality}`);
      return payload;
    },
    checkEnvironment() {
      return {
        gstreamer: { ok: true, message: '运行时可用', detail: '必要插件可用' },
        encoder: { ok: true, message: '硬件编码可用', detail: 'H.264 与 HEVC 可用' },
        inputBridge: { ok: true, message: '输入桥可启动', detail: '键鼠与手柄回传可用' },
        gamepadDriver: { ok: false, message: '建议安装驱动', detail: '安装 ViGEmBus 后可注入 Xbox 手柄' }
      };
    },
    repairEnvironment() {
      previewLogs.push('已执行开发预览修复流程。');
      return {
        gstreamer: { ok: true, message: '运行时可用', detail: '必要插件可用' },
        encoder: { ok: true, message: '硬件编码可用', detail: 'H.264 与 HEVC 可用' },
        inputBridge: { ok: true, message: '输入桥可启动', detail: '键鼠与手柄回传可用' },
        gamepadDriver: { ok: true, message: '驱动已准备', detail: '可注入 Xbox 手柄' }
      };
    },
    listDevices() {
      return [
        { id: 'preview-living-room', name: '客厅电视', ip: '192.168.1.23', model: 'Android TV' },
        { id: 'preview-box', name: '书房盒子', ip: '192.168.1.42', model: 'TV Box' }
      ];
    },
    startStream(payload) {
      previewRunning = true;
      previewStartedAt = Date.now();
      previewLogs.push(`开始串流到 ${payload.device.ip}，档位 ${payload.quality.label}`);
      return { started: true };
    },
    stopStream() {
      previewRunning = false;
      previewStartedAt = null;
      previewLogs.push('停止串流。');
      return { stopped: true };
    },
    getStatus() {
      return {
        streamRunning: previewRunning,
        inputBridgeRunning: previewRunning,
        streamStartedAt: previewStartedAt,
        logs: previewLogs.slice(-80)
      };
    }
  };
}

function getElement(id) {
  return document.getElementById(id);
}

function cacheElements() {
  Object.assign(elements, {
    pageTitle: getElement('pageTitle'),
    streamStatusText: getElement('streamStatusText'),
    sidebarStatusText: getElement('sidebarStatusText'),
    currentQualityText: getElement('currentQualityText'),
    streamRuntimeStatus: getElement('streamRuntimeStatus'),
    streamRuntimeText: getElement('streamRuntimeText'),
    streamTargetText: getElement('streamTargetText'),
    streamQualityText: getElement('streamQualityText'),
    deviceSelect: getElement('deviceSelect'),
    manualIpInput: getElement('manualIpInput'),
    qualitySelect: getElement('qualitySelect'),
    performanceProtectionInput: getElement('performanceProtectionInput'),
    modeAuto: getElement('modeAuto'),
    modeManual: getElement('modeManual'),
    modeAutoOption: getElement('modeAutoOption'),
    modeManualOption: getElement('modeManualOption'),
    startButton: getElement('startButton'),
    stopButton: getElement('stopButton'),
    actionStatus: getElement('actionStatus'),
    refreshDevicesButton: getElement('refreshDevicesButton'),
    deviceList: getElement('deviceList'),
    presetList: getElement('presetList'),
    qualityPresetMirror: getElement('qualityPresetMirror'),
    checkEnvironmentButton: getElement('checkEnvironmentButton'),
    repairEnvironmentButton: getElement('repairEnvironmentButton'),
    diagnosticGrid: getElement('diagnosticGrid'),
    logView: getElement('logView')
  });
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function setText(element, text) {
  if (element) {
    element.textContent = text;
  }
}

function setHtml(element, html) {
  if (element) {
    element.innerHTML = html;
  }
}

function deviceKey(device) {
  return String(device.id || device.ip || device.name || '');
}

function normalizeDevices(result) {
  if (Array.isArray(result)) {
    return result;
  }

  return asArray(result && result.devices);
}

function normalizeEnvironment(result) {
  if (!result) {
    return {};
  }

  if (result.items && typeof result.items === 'object') {
    return result.items;
  }

  if (result.cards && typeof result.cards === 'object') {
    return result.cards;
  }

  return result;
}

function statusLabel() {
  if (state.status && state.status.streamRunning) {
    return '正在串流';
  }

  return '未启动';
}

function setActionStatus(text, tone) {
  if (!elements.actionStatus) {
    return;
  }

  elements.actionStatus.textContent = text;
  elements.actionStatus.className = `workflow-summary ${tone || ''}`.trim();
}

function setBusyState(isBusy, message) {
  state.busy = Boolean(isBusy);

  if (elements.startButton) {
    elements.startButton.disabled = Boolean(isBusy);
    elements.startButton.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    elements.startButton.classList.toggle('is-loading', Boolean(isBusy));
  }

  if (isBusy && message) {
    setActionStatus(message, 'is-busy');
  }
}

function getSelectedQuality() {
  return QUALITY_PRESETS.find(preset => preset.id === state.selectedQuality) || QUALITY_PRESETS[4];
}

function getSelectedDevice() {
  return state.devices.find(device => deviceKey(device) === state.selectedDevice) || null;
}

function getManualDevice() {
  const ip = state.manualIp.trim();
  return ip ? { id: `manual-${ip}`, name: '手动输入 IP', ip } : null;
}

function getStreamTarget() {
  if (state.deviceMode === 'manual') {
    return getManualDevice();
  }

  return getSelectedDevice() || getManualDevice();
}

function isStreamRunning() {
  return Boolean(state.status && state.status.streamRunning);
}

function formatDuration(milliseconds) {
  const totalSeconds = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

function getStatusStartedAt() {
  const value = Number(state.status && (state.status.streamStartedAt || state.status.startedAt));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function syncStreamingClock() {
  if (isStreamRunning()) {
    if (!state.streamStartedAt) {
      state.streamStartedAt = getStatusStartedAt() || Date.now();
    }
    return;
  }

  state.streamStartedAt = null;
}

function renderStreamRuntime() {
  const running = isStreamRunning();
  const device = getStreamTarget();
  const quality = getSelectedQuality();
  const runtime = running && state.streamStartedAt ? formatDuration(Date.now() - state.streamStartedAt) : '00:00:00';

  setText(elements.streamRuntimeStatus, running ? '正在串流' : '未启动');
  setText(elements.streamRuntimeText, runtime);
  setText(elements.streamTargetText, device && device.ip ? `${device.name || '电视或盒子'} · ${device.ip}` : '等待选择');
  setText(elements.streamQualityText, quality.label);

  const panel = elements.streamRuntimeStatus && elements.streamRuntimeStatus.closest('.stream-runtime-panel');
  if (panel) {
    panel.classList.toggle('is-running', running);
  }
}

function selectQuality(qualityId) {
  if (!QUALITY_PRESETS.some(preset => preset.id === qualityId)) {
    return;
  }

  state.selectedQuality = qualityId;

  if (elements.qualitySelect) {
    elements.qualitySelect.value = qualityId;
  }

  renderQualityControls();
  renderTargetSummary();
}

function renderQualityCard(preset, mirror) {
  const selected = preset.id === state.selectedQuality;
  const recommended = preset.id === 'hevc1080p30';
  const badge = selected ? '当前' : recommended ? '推荐' : preset.tag;
  const badgeClass = selected || recommended ? 'ok' : preset.codec === 'HEVC' ? 'warn' : '';
  return `
    <button class="quality-card${selected ? ' is-selected' : ''}" type="button" data-quality-id="${escapeHtml(preset.id)}" aria-pressed="${selected ? 'true' : 'false'}"${mirror ? ' data-quality-mirror="true"' : ''}>
      <span class="quality-card-head">
        <span class="quality-label">${escapeHtml(preset.label)}</span>
        <span class="badge ${badgeClass}">${escapeHtml(badge)}</span>
      </span>
      <span class="quality-code">${escapeHtml(preset.codec)}</span>
      <span class="item-meta">${escapeHtml(preset.note)}</span>
    </button>
  `;
}

function renderQualityControls() {
  if (elements.qualitySelect) {
    elements.qualitySelect.innerHTML = QUALITY_PRESETS.map(preset => (
      `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.label)}</option>`
    )).join('');
    elements.qualitySelect.value = state.selectedQuality;
  }

  const cards = QUALITY_PRESETS.map(preset => renderQualityCard(preset, false)).join('');
  const mirrorCards = QUALITY_PRESETS.map(preset => renderQualityCard(preset, true)).join('');
  setHtml(elements.presetList, cards);
  setHtml(elements.qualityPresetMirror, mirrorCards);
  setText(elements.currentQualityText, getSelectedQuality().label);
}

function selectDevice(deviceId) {
  state.selectedDevice = deviceId;
  state.deviceMode = 'auto';
  renderDevices();
  renderConnectionMode();
  renderTargetSummary();
}

function renderDevices() {
  if (!elements.deviceSelect || !elements.deviceList) {
    return;
  }

  if (state.devices.length === 0) {
    elements.deviceSelect.innerHTML = '<option value="">还没有发现电视或盒子</option>';
    elements.deviceList.textContent = '还没有发现电视或盒子';
    renderTargetSummary();
    return;
  }

  elements.deviceSelect.innerHTML = state.devices.map(device => {
    const key = escapeHtml(deviceKey(device));
    const name = escapeHtml(device.name || device.model || '电视或盒子');
    const ip = device.ip ? `（${escapeHtml(device.ip)}）` : '';
    return `<option value="${key}">${name}${ip}</option>`;
  }).join('');

  if (!state.selectedDevice || !state.devices.some(device => deviceKey(device) === state.selectedDevice)) {
    state.selectedDevice = deviceKey(state.devices[0]);
  }

  elements.deviceSelect.value = state.selectedDevice;
  elements.deviceList.innerHTML = state.devices.map(device => {
    const key = escapeHtml(deviceKey(device));
    const selected = deviceKey(device) === state.selectedDevice;
    const name = escapeHtml(device.name || '电视或盒子');
    const model = escapeHtml(device.model || '接收端');
    const ip = escapeHtml(device.ip || '未知 IP');
    return `
      <button class="device-item${selected ? ' is-selected' : ''}" type="button" data-device-id="${key}" aria-pressed="${selected ? 'true' : 'false'}">
        <span>
          <span class="item-title">${name}</span>
          <span class="item-meta">${model} · ${ip}</span>
        </span>
        <span class="badge ok">${selected ? '已选择' : '已发现'}</span>
      </button>
    `;
  }).join('');

  renderTargetSummary();
}

function renderConnectionMode() {
  if (elements.modeAuto) {
    elements.modeAuto.checked = state.deviceMode === 'auto';
  }
  if (elements.modeManual) {
    elements.modeManual.checked = state.deviceMode === 'manual';
  }
  if (elements.modeAutoOption) {
    elements.modeAutoOption.classList.toggle('is-selected', state.deviceMode === 'auto');
  }
  if (elements.modeManualOption) {
    elements.modeManualOption.classList.toggle('is-selected', state.deviceMode === 'manual');
  }
}

function renderTargetSummary() {
  renderStreamRuntime();
}

function resolveDiagnostic(item) {
  const value = state.environment[item.key] || state.environment[item.label] || {};

  if (typeof value === 'boolean') {
    return {
      ok: value,
      message: value ? '正常' : '需要处理',
      detail: '',
      state: value ? 'ok' : 'warning'
    };
  }

  const cardState = value.state || (value.ok || value.available || value.installed ? 'ok' : 'warning');
  const ok = cardState === 'ok';

  return {
    ok,
    message: value.message || value.detail || value.path || (ok ? '正常' : '待检查'),
    detail: value.detail || '',
    state: cardState
  };
}

function renderEnvironment() {
  const cards = DIAGNOSTIC_ITEMS.map(item => {
    const diagnostic = resolveDiagnostic(item);
    const badgeClass = diagnostic.ok ? 'ok' : diagnostic.state === 'error' ? 'fail' : 'warn';
    const badgeText = diagnostic.ok ? '正常' : diagnostic.state === 'warning' ? '警告' : '待处理';
    const detail = diagnostic.detail ? ` · ${diagnostic.detail}` : '';
    return `
      <div class="diagnostic-card">
        <div>
          <div class="status-name">${escapeHtml(item.label)}</div>
          <div class="item-meta">${escapeHtml(`${diagnostic.message}${detail}`)}</div>
        </div>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join('');

  setHtml(elements.diagnosticGrid, cards);
}

function renderStatus() {
  syncStreamingClock();

  const label = statusLabel();
  const running = isStreamRunning();

  setText(elements.streamStatusText, label);
  if (elements.streamStatusText) {
    elements.streamStatusText.classList.toggle('is-running', running);
  }

  setText(elements.sidebarStatusText, running ? '正在向电视发送画面' : '等待串流准备');
  if (elements.sidebarStatusText && elements.sidebarStatusText.parentElement) {
    elements.sidebarStatusText.parentElement.classList.toggle('is-running', running);
  }

  if (elements.actionStatus && !state.busy && !elements.actionStatus.classList.contains('is-error')) {
    setActionStatus(label, running ? 'is-ok' : '');
  }

  setText(elements.currentQualityText, getSelectedQuality().label);
  renderStreamRuntime();

  const logs = asArray(state.status && state.status.logs);
  setText(elements.logView, logs.length > 0 ? logs.join('\n') : '暂无日志');
}

function renderControls() {
  renderConnectionMode();

  if (elements.manualIpInput) {
    elements.manualIpInput.value = state.manualIp;
  }
  if (elements.performanceProtectionInput) {
    elements.performanceProtectionInput.checked = Boolean(state.performanceProtection);
  }

  renderQualityControls();
  renderDevices();
  renderEnvironment();
  renderStatus();
  renderTargetSummary();
}

function switchPage(pageName) {
  document.querySelectorAll('.nav-item').forEach(button => {
    button.classList.toggle('is-active', button.dataset.page === pageName);
  });
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('is-active', page.id === `page-${pageName}`);
  });

  const active = document.querySelector(`.nav-item[data-page="${pageName}"] span:last-child`);
  setText(elements.pageTitle, active ? active.textContent : '日常主屏');
}

async function loadConfig() {
  const config = await Promise.resolve(window.tvgame.loadConfig());
  state.config = config || {};
  state.selectedQuality = state.config.selectedQuality || state.selectedQuality;
  state.performanceProtection = state.config.performanceProtection !== false;
  state.selectedDevice = state.config.selectedDevice || '';
  state.manualIp = state.config.manualIp || state.config.manualIpAddress || '';
  state.deviceMode = state.manualIp && !state.selectedDevice ? 'manual' : 'auto';
}

async function refreshDevices() {
  try {
    const result = await Promise.resolve(window.tvgame.listDevices());
    state.devices = normalizeDevices(result);
    renderDevices();
  } catch (error) {
    setActionStatus(`自动搜索电视失败：${error.message}`, 'is-error');
  }
}

async function checkEnvironment() {
  try {
    const result = await Promise.resolve(window.tvgame.checkEnvironment());
    state.environment = normalizeEnvironment(result);
    renderEnvironment();
  } catch (error) {
    setActionStatus(`检查环境失败：${error.message}`, 'is-error');
  }
}

async function repairEnvironment() {
  setActionStatus('正在检查并修复环境...', 'is-busy');
  try {
    const result = await Promise.resolve(window.tvgame.repairEnvironment());
    state.environment = normalizeEnvironment(result);
    renderEnvironment();
    setActionStatus('环境检查与修复已完成', 'is-ok');
  } catch (error) {
    setActionStatus(`检查并修复环境失败：${error.message}`, 'is-error');
  }
}

async function refreshStatus() {
  try {
    const status = await Promise.resolve(window.tvgame.getStatus());
    state.status = status || state.status;
    renderStatus();
  } catch (error) {
    setActionStatus(`刷新状态失败：${error.message}`, 'is-error');
  }
}

async function startStream() {
  const device = getStreamTarget();

  if (!device || !device.ip) {
    setActionStatus('请选择自动发现的电视/盒子，或手动输入 IP。', 'is-error');
    return;
  }

  const quality = getSelectedQuality();
  const payload = {
    device,
    quality: {
      id: quality.id,
      profile: quality.profile,
      label: quality.label
    },
    performanceProtection: Boolean(state.performanceProtection)
  };

  setBusyState(true, '正在启动串流...');

  try {
    const result = await Promise.resolve(window.tvgame.startStream(payload));

    if (result && result.started === false) {
      setActionStatus('启动失败', 'is-error');
      await refreshStatus();
      return;
    }

    await Promise.resolve(window.tvgame.saveConfig({
      selectedDevice: state.deviceMode === 'auto' ? state.selectedDevice : '',
      selectedQuality: state.selectedQuality,
      performanceProtection: Boolean(state.performanceProtection),
      manualIp: state.manualIp,
      firstRunComplete: true
    }));

    state.streamStartedAt = Date.now();
    state.status = { ...state.status, streamRunning: true };
    setActionStatus('正在串流', 'is-ok');
    renderStatus();
    await refreshStatus();
  } catch (error) {
    setActionStatus(`启动失败：${error.message}`, 'is-error');
    await refreshStatus();
  } finally {
    setBusyState(false);
  }
}

async function stopStream() {
  setActionStatus('正在停止串流...', 'is-busy');
  try {
    await Promise.resolve(window.tvgame.stopStream());
    state.streamStartedAt = null;
    state.status = { ...state.status, streamRunning: false };
    setActionStatus('未启动');
    renderStatus();
    await refreshStatus();
  } catch (error) {
    setActionStatus(`停止串流失败：${error.message}`, 'is-error');
  }
}

function bindQualityList(element) {
  if (!element) {
    return;
  }

  element.addEventListener('click', event => {
    const button = event.target.closest('[data-quality-id]');
    if (button) {
      selectQuality(button.dataset.qualityId);
    }
  });
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => switchPage(button.dataset.page));
  });

  elements.deviceSelect.addEventListener('change', event => {
    state.selectedDevice = event.target.value;
    renderTargetSummary();
    renderDevices();
  });

  elements.manualIpInput.addEventListener('input', event => {
    state.manualIp = event.target.value;
    renderTargetSummary();
  });

  elements.qualitySelect.addEventListener('change', event => {
    selectQuality(event.target.value);
  });

  bindQualityList(elements.presetList);
  bindQualityList(elements.qualityPresetMirror);

  elements.deviceList.addEventListener('click', event => {
    const button = event.target.closest('[data-device-id]');
    if (button) {
      selectDevice(button.dataset.deviceId);
    }
  });

  elements.performanceProtectionInput.addEventListener('change', event => {
    state.performanceProtection = event.target.checked;
  });

  elements.modeAuto.addEventListener('change', () => {
    state.deviceMode = 'auto';
    renderConnectionMode();
    renderTargetSummary();
  });

  elements.modeManual.addEventListener('change', () => {
    state.deviceMode = 'manual';
    renderConnectionMode();
    renderTargetSummary();
  });

  elements.startButton.addEventListener('click', startStream);
  elements.stopButton.addEventListener('click', stopStream);
  elements.refreshDevicesButton.addEventListener('click', refreshDevices);
  elements.checkEnvironmentButton.addEventListener('click', checkEnvironment);
  elements.repairEnvironmentButton.addEventListener('click', repairEnvironment);
}

async function init() {
  ensurePreviewStub();
  cacheElements();
  bindEvents();
  renderControls();

  await loadConfig();
  renderControls();
  await Promise.allSettled([
    refreshDevices(),
    checkEnvironment(),
    refreshStatus()
  ]);
  renderControls();

  window.setInterval(refreshStatus, 5000);
  window.setInterval(renderStreamRuntime, 1000);
  window.setInterval(refreshDevices, 15000);
}

document.addEventListener('DOMContentLoaded', init);
