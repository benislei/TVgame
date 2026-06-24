'use strict';

const QUALITY_PRESETS = [
  { id: 'h264720p30', profile: 'h264720p30', label: '720P30', note: '兼容性优先' },
  { id: 'h264720p60', profile: 'h264720p60', label: '720P60', note: '低延迟动作游戏' },
  { id: 'h2641080p30', profile: 'h2641080p30', label: '1080P30', note: '清晰稳定' },
  { id: 'h2641080p60', profile: 'h2641080p60', label: '1080P60', note: '高刷新体验' },
  { id: 'hevc1080p30', profile: 'hevc1080p30', label: 'HEVC 1080P30', note: '推荐，画面与负载平衡' },
  { id: 'hevc1080p60', profile: 'hevc1080p60', label: 'HEVC 1080P60', note: '高画质高刷新' }
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
  deviceMode: 'auto'
};

const elements = {};

function ensurePreviewStub() {
  if (window.tvgame) {
    return;
  }

  const previewLogs = ['开发预览模式：未检测到 Electron preload，已启用本地示例数据。'];
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
        gstreamer: { ok: true, message: '已安装' },
        encoder: { ok: true, message: '可用' },
        inputBridge: { ok: true, message: '可启动' },
        gamepadDriver: { ok: false, message: '建议安装驱动' }
      };
    },
    repairEnvironment() {
      previewLogs.push('已执行开发预览修复流程。');
      return {
        gstreamer: { ok: true, message: '已安装' },
        encoder: { ok: true, message: '可用' },
        inputBridge: { ok: true, message: '可启动' },
        gamepadDriver: { ok: true, message: '已准备' }
      };
    },
    listDevices() {
      return [
        { id: 'preview-living-room', name: '客厅电视', ip: '192.168.1.23', model: 'Android TV' },
        { id: 'preview-box', name: '书房盒子', ip: '192.168.1.42', model: 'TV Box' }
      ];
    },
    startStream(payload) {
      previewLogs.push(`开始串流到 ${payload.device.ip}，档位 ${payload.quality.label}`);
      return { started: true };
    },
    stopStream() {
      previewLogs.push('停止串流。');
      return { stopped: true };
    },
    getStatus() {
      return { streamRunning: false, inputBridgeRunning: false, logs: previewLogs.slice(-80) };
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
    environmentSummary: getElement('environmentSummary'),
    deviceSelect: getElement('deviceSelect'),
    manualIpInput: getElement('manualIpInput'),
    qualitySelect: getElement('qualitySelect'),
    performanceProtectionInput: getElement('performanceProtectionInput'),
    modeAuto: getElement('modeAuto'),
    modeManual: getElement('modeManual'),
    startButton: getElement('startButton'),
    stopButton: getElement('stopButton'),
    actionStatus: getElement('actionStatus'),
    refreshDevicesButton: getElement('refreshDevicesButton'),
    deviceList: getElement('deviceList'),
    presetList: getElement('presetList'),
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
  elements.actionStatus.textContent = text;
  elements.actionStatus.className = `inline-status ${tone || ''}`.trim();
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

function renderQualityControls() {
  elements.qualitySelect.innerHTML = QUALITY_PRESETS.map(preset => (
    `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.label)}</option>`
  )).join('');
  elements.qualitySelect.value = state.selectedQuality;

  elements.presetList.innerHTML = QUALITY_PRESETS.map(preset => {
    const recommended = preset.id === 'hevc1080p30';
    return `
      <div class="preset-item">
        <div>
          <div class="item-title">${escapeHtml(preset.label)}</div>
          <div class="item-meta">${escapeHtml(preset.note)}</div>
        </div>
        ${recommended ? '<span class="badge ok">推荐</span>' : '<span class="badge">预设</span>'}
      </div>
    `;
  }).join('');
}

function renderDevices() {
  if (state.devices.length === 0) {
    elements.deviceSelect.innerHTML = '<option value="">还没有发现电视或盒子</option>';
    elements.deviceList.textContent = '还没有发现电视或盒子';
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
    const name = escapeHtml(device.name || '电视或盒子');
    const model = escapeHtml(device.model || '接收端');
    const ip = escapeHtml(device.ip || '未知 IP');
    return `
      <div class="device-item">
        <div>
          <div class="item-title">${name}</div>
          <div class="item-meta">${model} · ${ip}</div>
        </div>
        <span class="badge ok">已发现</span>
      </div>
    `;
  }).join('');
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

  elements.environmentSummary.innerHTML = cards;
  elements.diagnosticGrid.innerHTML = cards;
}

function renderStatus() {
  const label = statusLabel();
  elements.streamStatusText.textContent = label;
  elements.streamStatusText.classList.toggle('is-running', label === '正在串流');

  if (!elements.actionStatus.textContent || elements.actionStatus.textContent === '未启动' || elements.actionStatus.textContent === '正在串流') {
    setActionStatus(label);
  }

  const logs = asArray(state.status && state.status.logs);
  elements.logView.textContent = logs.length > 0 ? logs.join('\n') : '暂无日志';
}

function renderControls() {
  elements.modeAuto.checked = state.deviceMode === 'auto';
  elements.modeManual.checked = state.deviceMode === 'manual';
  elements.manualIpInput.value = state.manualIp;
  elements.performanceProtectionInput.checked = Boolean(state.performanceProtection);
  renderQualityControls();
  renderDevices();
  renderEnvironment();
  renderStatus();
}

function switchPage(pageName) {
  document.querySelectorAll('.nav-item').forEach(button => {
    button.classList.toggle('is-active', button.dataset.page === pageName);
  });
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('is-active', page.id === `page-${pageName}`);
  });

  const active = document.querySelector(`.nav-item[data-page="${pageName}"]`);
  elements.pageTitle.textContent = active ? active.textContent : '日常主屏';
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
  setActionStatus('正在检查并修复环境...');
  try {
    const result = await Promise.resolve(window.tvgame.repairEnvironment());
    state.environment = normalizeEnvironment(result);
    renderEnvironment();
    setActionStatus('环境检查与修复已完成');
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

  setActionStatus('正在启动串流...');

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

    setActionStatus('正在串流');
    await refreshStatus();
  } catch (error) {
    setActionStatus(`启动失败：${error.message}`, 'is-error');
    await refreshStatus();
  }
}

async function stopStream() {
  setActionStatus('正在停止串流...');
  try {
    await Promise.resolve(window.tvgame.stopStream());
    setActionStatus('未启动');
    await refreshStatus();
  } catch (error) {
    setActionStatus(`停止串流失败：${error.message}`, 'is-error');
  }
}

function bindEvents() {
  document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => switchPage(button.dataset.page));
  });

  elements.deviceSelect.addEventListener('change', event => {
    state.selectedDevice = event.target.value;
  });

  elements.manualIpInput.addEventListener('input', event => {
    state.manualIp = event.target.value;
  });

  elements.qualitySelect.addEventListener('change', event => {
    state.selectedQuality = event.target.value;
    renderQualityControls();
  });

  elements.performanceProtectionInput.addEventListener('change', event => {
    state.performanceProtection = event.target.checked;
  });

  elements.modeAuto.addEventListener('change', () => {
    state.deviceMode = 'auto';
  });

  elements.modeManual.addEventListener('change', () => {
    state.deviceMode = 'manual';
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
  window.setInterval(refreshDevices, 15000);
}

document.addEventListener('DOMContentLoaded', init);
