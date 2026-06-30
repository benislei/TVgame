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
  deviceMode: 'manual',
  streamStartedAt: null,
  repairProgress: {
    active: false,
    summary: '暂无修复任务',
    items: [],
    percent: 0,
    startedAt: null,
    lastActivityAt: null,
    lastMessage: '',
    activeActionId: ''
  },
  busy: false
};

const PAGE_TITLES = {
  home: '日常主屏',
  setup: '首次配置',
  devices: '电视设备',
  quality: '画质档位',
  diagnostics: '环境诊断',
  logs: '日志'
};

const elements = {};

function ensurePreviewStub() {
  if (window.tvgame) {
    return;
  }

  const previewLogs = ['开发预览模式：未检测到 Electron preload，已启用本地示例数据。'];
  const previewRepairListeners = new Set();
  let previewRunning = false;
  let previewStartedAt = null;

  function emitPreviewRepairProgress(event) {
    for (const listener of previewRepairListeners) {
      listener(event);
    }
  }

  window.tvgame = {
    loadConfig() {
      return {
        selectedQuality: 'hevc1080p30',
        performanceProtection: true,
        selectedDevice: '',
        manualIp: '192.168.50.80',
        deviceMode: 'manual'
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
      emitPreviewRepairProgress({ type: 'check', message: '正在检查发送端环境' });
      emitPreviewRepairProgress({
        type: 'plan',
        actions: [{ id: 'preview-repair', title: '开发预览修复项' }],
        message: '已生成可自动处理的修复计划'
      });
      emitPreviewRepairProgress({
        type: 'action-start',
        actionId: 'preview-repair',
        title: '开发预览修复项',
        message: '正在处理：开发预览修复项'
      });
      emitPreviewRepairProgress({
        type: 'action-complete',
        actionId: 'preview-repair',
        title: '开发预览修复项',
        message: '开发预览修复项 已完成'
      });
      emitPreviewRepairProgress({ type: 'complete', message: '环境已全部正常' });
      return {
        gstreamer: { ok: true, message: '运行时可用', detail: '必要插件可用' },
        encoder: { ok: true, message: '硬件编码可用', detail: 'H.264 与 HEVC 可用' },
        inputBridge: { ok: true, message: '输入桥可启动', detail: '键鼠与手柄回传可用' },
        gamepadDriver: { ok: true, message: '驱动已准备', detail: '可注入 Xbox 手柄' }
      };
    },
    onRepairProgress(callback) {
      if (typeof callback !== 'function') {
        return () => {};
      }
      previewRepairListeners.add(callback);
      return () => previewRepairListeners.delete(callback);
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
    topbarCopy: getElement('topbarCopy'),
    sidebarStatusText: getElement('sidebarStatusText'),
    topbarQualityPill: getElement('topbarQualityPill'),
    streamRuntimeStatus: getElement('streamRuntimeStatus'),
    streamRuntimeText: getElement('streamRuntimeText'),
    targetMetricText: getElement('targetMetricText'),
    gamepadMetricText: getElement('gamepadMetricText'),
    receiverSummaryText: getElement('receiverSummaryText'),
    homeHealthGrid: getElement('homeHealthGrid'),
    recentStatusText: getElement('recentStatusText'),
    deviceSelect: getElement('deviceSelect'),
    manualIpInput: getElement('manualIpInput'),
    qualityDropdown: getElement('qualityDropdown'),
    qualityDropdownButton: getElement('qualityDropdownButton'),
    qualityMenu: getElement('qualityMenu'),
    qualitySelect: getElement('qualitySelect'),
    qualityDisplayLabel: getElement('qualityDisplayLabel'),
    qualityDisplayNote: getElement('qualityDisplayNote'),
    selectedQualityDetails: getElement('selectedQualityDetails'),
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
    qualityPresetMirror: getElement('qualityPresetMirror'),
    checkEnvironmentButton: getElement('checkEnvironmentButton'),
    repairEnvironmentButton: getElement('repairEnvironmentButton'),
    homeRepairProgressPanel: getElement('homeRepairProgressPanel'),
    homeRepairProgressSummary: getElement('homeRepairProgressSummary'),
    homeRepairProgressPercent: getElement('homeRepairProgressPercent'),
    homeRepairProgressBar: getElement('homeRepairProgressBar'),
    homeRepairCurrentStep: getElement('homeRepairCurrentStep'),
    diagnosticGrid: getElement('diagnosticGrid'),
    repairProgressPanel: getElement('repairProgressPanel'),
    repairProgressList: getElement('repairProgressList'),
    repairProgressSummary: getElement('repairProgressSummary'),
    repairProgressIntro: getElement('repairProgressIntro'),
    repairElapsedText: getElement('repairElapsedText'),
    repairCurrentTitle: getElement('repairCurrentTitle'),
    repairProgressPercent: getElement('repairProgressPercent'),
    repairProgressBar: getElement('repairProgressBar'),
    repairCurrentStep: getElement('repairCurrentStep'),
    repairDownloadSpeed: getElement('repairDownloadSpeed'),
    repairEta: getElement('repairEta'),
    repairFileSize: getElement('repairFileSize'),
    repairDownloader: getElement('repairDownloader'),
    repairStageFeedback: getElement('repairStageFeedback'),
    diagnosticRecentStatusText: getElement('diagnosticRecentStatusText'),
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

  return '准备就绪';
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

  for (const button of [elements.checkEnvironmentButton, elements.repairEnvironmentButton]) {
    if (button) {
      button.disabled = Boolean(isBusy);
      button.setAttribute('aria-busy', isBusy ? 'true' : 'false');
    }
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
  const runtime = running && state.streamStartedAt ? formatDuration(Date.now() - state.streamStartedAt) : '00:00:00';

  setText(elements.streamRuntimeStatus, running ? '正在串流' : '准备就绪');
  setText(elements.streamRuntimeText, runtime);

  const panel = elements.streamRuntimeStatus && elements.streamRuntimeStatus.closest('.status-card');
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
  closeQualityDropdown();
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

function renderSelectedQualityDetails() {
  const preset = getSelectedQuality();
  const recommended = preset.id === 'hevc1080p30';
  const badge = recommended ? '推荐' : preset.codec;
  const badgeClass = recommended ? 'ok' : preset.codec === 'HEVC' ? 'warn' : '';

  setHtml(elements.selectedQualityDetails, `
    <div>
      <span class="item-meta">当前选择</span>
      <strong>${escapeHtml(preset.label)}</strong>
    </div>
    <span class="badge ${badgeClass}">${escapeHtml(badge)}</span>
    <p>${escapeHtml(preset.note)}</p>
  `);
}

function renderQualityMenu() {
  if (!elements.qualityMenu) {
    return;
  }

  const selected = getSelectedQuality();
  elements.qualityMenu.innerHTML = QUALITY_PRESETS.map(preset => {
    const isSelected = preset.id === selected.id;
    const tag = preset.id === 'hevc1080p30' ? '推荐' : preset.id === selected.id ? '当前' : preset.tag;
    return `
      <button class="quality-option${isSelected ? ' is-selected' : ''}" type="button" role="option" aria-selected="${isSelected ? 'true' : 'false'}" data-quality-id="${escapeHtml(preset.id)}">
        <span class="quality-option-main">
          <span class="quality-option-label">${escapeHtml(preset.label)}</span>
          <span class="quality-option-note">${escapeHtml(preset.note)}</span>
        </span>
        <span class="quality-option-tag">${escapeHtml(tag)}</span>
      </button>
    `;
  }).join('');
}

function isQualityDropdownOpen() {
  return Boolean(elements.qualityDropdown && elements.qualityDropdown.classList.contains('is-open'));
}

function setQualityDropdownOpen(isOpen) {
  if (!elements.qualityDropdown || !elements.qualityDropdownButton || !elements.qualityMenu) {
    return;
  }

  elements.qualityDropdown.classList.toggle('is-open', Boolean(isOpen));
  elements.qualityDropdownButton.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  elements.qualityMenu.hidden = !isOpen;

  if (isOpen) {
    elements.qualityMenu.scrollTop = 0;
  }
}

function openQualityDropdown() {
  setQualityDropdownOpen(true);
}

function closeQualityDropdown() {
  setQualityDropdownOpen(false);
}

function toggleQualityDropdown() {
  setQualityDropdownOpen(!isQualityDropdownOpen());
}

function renderQualityControls() {
  const selectedPreset = getSelectedQuality();

  if (elements.qualitySelect) {
    elements.qualitySelect.innerHTML = QUALITY_PRESETS.map(preset => (
      `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.label)}</option>`
    )).join('');
    elements.qualitySelect.value = state.selectedQuality;
  }

  setText(elements.topbarQualityPill, selectedPreset.label);
  setText(elements.qualityDisplayLabel, selectedPreset.label);
  setText(elements.qualityDisplayNote, selectedPreset.note);
  renderQualityMenu();

  const mirrorCards = QUALITY_PRESETS.map(preset => renderQualityCard(preset, true)).join('');
  setHtml(elements.qualityPresetMirror, mirrorCards);
  renderSelectedQualityDetails();
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
    elements.deviceList.textContent = '自动搜索暂未发现设备，可以继续使用手动 IP。';
    renderTargetSummary();
    return;
  }

  const placeholder = state.deviceMode === 'auto'
    ? '<option value="">请选择自动发现的电视或盒子</option>'
    : '<option value="">手动 IP 优先，自动发现仅作为辅助</option>';
  const deviceOptions = state.devices.map(device => {
    const key = escapeHtml(deviceKey(device));
    const name = escapeHtml(device.name || device.model || '电视或盒子');
    const ip = device.ip ? `（${escapeHtml(device.ip)}）` : '';
    return `<option value="${key}">${name}${ip}</option>`;
  }).join('');

  elements.deviceSelect.innerHTML = `${placeholder}${deviceOptions}`;

  if (
    state.deviceMode === 'auto'
    && (!state.selectedDevice || !state.devices.some(device => deviceKey(device) === state.selectedDevice))
  ) {
    state.selectedDevice = deviceKey(state.devices[0]);
  }

  elements.deviceSelect.value = state.deviceMode === 'auto' ? state.selectedDevice : '';
  elements.deviceList.innerHTML = state.devices.map(device => {
    const key = escapeHtml(deviceKey(device));
    const selected = state.deviceMode === 'auto' && deviceKey(device) === state.selectedDevice;
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
  const quality = getSelectedQuality();
  const target = getStreamTarget();
  const hasTarget = Boolean(target && target.ip);
  const targetName = hasTarget ? (target.name || '手动输入 IP') : '未选择';
  const targetText = hasTarget ? `${targetName} · ${target.ip}` : '未选择';

  setText(elements.topbarQualityPill, quality.label);
  setText(elements.targetMetricText, targetText);
  setText(
    elements.receiverSummaryText,
    hasTarget
      ? `${targetName} 已准备接收 ${quality.label}，画面会按原比例显示。`
      : '电视端在线后，画面会按原比例显示。'
  );
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

function diagnosticBadgeClass(diagnostic) {
  if (diagnostic.ok) {
    return 'ok';
  }

  return diagnostic.state === 'error' ? 'fail' : 'warn';
}

function diagnosticBadgeText(diagnostic) {
  if (diagnostic.ok) {
    return '正常';
  }

  return diagnostic.state === 'warning' ? '警告' : '待处理';
}

function renderEnvironment() {
  const cards = DIAGNOSTIC_ITEMS.map(item => {
    const diagnostic = resolveDiagnostic(item);
    const badgeClass = diagnosticBadgeClass(diagnostic);
    const badgeText = diagnosticBadgeText(diagnostic);
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

  const homeRows = DIAGNOSTIC_ITEMS.map(item => {
    const diagnostic = resolveDiagnostic(item);
    const badgeClass = diagnosticBadgeClass(diagnostic);
    const badgeText = diagnosticBadgeText(diagnostic);
    return `
      <div class="health-row">
        <span>
          <span class="status-name">${escapeHtml(item.label)}</span>
          <span class="item-meta">${escapeHtml(diagnostic.message)}</span>
        </span>
        <span class="badge ${badgeClass}">${badgeText}</span>
      </div>
    `;
  }).join('');
  setHtml(elements.homeHealthGrid, homeRows);

  const gamepadDiagnostic = resolveDiagnostic({ key: 'gamepadDriver', label: '手柄驱动' });
  setText(
    elements.gamepadMetricText,
    gamepadDiagnostic.ok ? '可用' : gamepadDiagnostic.state === 'error' ? '不可用' : '建议安装'
  );
}

function isEnvironmentFullyReady() {
  if (!state.environment || Object.keys(state.environment).length === 0) {
    return false;
  }

  return DIAGNOSTIC_ITEMS.every(item => resolveDiagnostic(item).state === 'ok');
}

function resetRepairProgress(summary) {
  const now = Date.now();
  state.repairProgress = {
    active: true,
    summary,
    items: [],
    percent: 8,
    startedAt: now,
    lastActivityAt: now,
    lastMessage: summary || '',
    activeActionId: ''
  };
  renderRepairProgress();
}

function updateRepairProgressItem(actionId, title, status, message) {
  const id = actionId || title || `repair-${state.repairProgress.items.length}`;
  const existing = state.repairProgress.items.find(item => item.id === id);
  const next = {
    id,
    title: title || existing?.title || '环境修复项',
    status: status || existing?.status || 'pending',
    message: message || existing?.message || ''
  };

  if (existing) {
    Object.assign(existing, next);
  } else {
    state.repairProgress.items.push(next);
  }
}

function normalizeRepairMessage(message) {
  return String(message || '')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .pop() || '';
}

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(number)));
}

function calculateRepairPercent(progress) {
  const items = asArray(progress.items);
  if (items.length === 0) {
    return progress.active ? clampPercent(progress.percent || 8) : clampPercent(progress.percent || 0);
  }

  const completeCount = items.filter(item => item.status === 'complete').length;
  const runningCount = items.filter(item => item.status === 'running').length;
  const errorCount = items.filter(item => item.status === 'error').length;
  const perItem = 74 / items.length;
  let percent = 18 + completeCount * perItem + runningCount * perItem * 0.55 + errorCount * perItem;

  if (!progress.active && errorCount === 0) {
    percent = 100;
  }

  return clampPercent(percent);
}

function currentRepairStep(progress) {
  const running = progress.items.find(item => item.status === 'running');
  if (running) {
    return running.message || running.title || '正在处理修复项';
  }

  const error = progress.items.find(item => item.status === 'error');
  if (error) {
    return error.message || `${error.title} 处理失败`;
  }

  const pending = progress.items.find(item => item.status === 'pending');
  if (pending && progress.active) {
    return pending.message || `${pending.title} 等待处理`;
  }

  if (progress.items.length > 0 && !progress.active) {
    return '修复流程已完成，请重新检查环境状态';
  }

  return progress.summary || '等待修复任务';
}

function currentRepairItem(progress) {
  return progress.items.find(item => item.id === progress.activeActionId)
    || progress.items.find(item => item.status === 'running')
    || progress.items.find(item => item.status === 'error')
    || progress.items.find(item => item.status === 'pending')
    || progress.items[progress.items.length - 1]
    || null;
}

function currentRepairTitle(progress) {
  const item = currentRepairItem(progress);
  if (item && item.status === 'running') {
    return item.title || '正在处理修复项';
  }
  if (item && item.status === 'error') {
    return `${item.title || '环境修复'} 失败`;
  }
  if (item && item.status === 'complete' && !progress.active) {
    return progress.summary || '修复流程已完成';
  }
  if (item && progress.active) {
    return item.title || progress.summary || '正在处理修复项';
  }
  return progress.active ? (progress.summary || '正在检查并修复环境') : '等待环境检查';
}

function repairElapsed(progress) {
  return progress.startedAt ? formatDuration(Date.now() - progress.startedAt) : '00:00:00';
}

function extractRepairMetric(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      return match.slice(1).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

function inferRepairMetadata(progress) {
  const item = currentRepairItem(progress);
  const text = [
    progress.summary,
    progress.lastMessage,
    item?.title,
    item?.message
  ].filter(Boolean).join(' ');

  let downloader = '自动选择';
  if (/aria2/i.test(text)) {
    downloader = 'aria2 多线程';
  } else if (/curl/i.test(text)) {
    downloader = 'curl 断点续传';
  } else if (/winget/i.test(text)) {
    downloader = 'winget';
  } else if (/GStreamer|gstreamer/i.test(text)) {
    downloader = 'aria2 / curl 自动选择';
  }

  let fileSize = extractRepairMetric(text, [
    /(\d+(?:\.\d+)?)\s*(KB|MB|GB|KiB|MiB|GiB)\s*\/\s*(\d+(?:\.\d+)?)\s*(KB|MB|GB|KiB|MiB|GiB)/i
  ]);
  if (fileSize) {
    const parts = fileSize.split(' ');
    fileSize = `${parts[0]} ${parts[1]} / ${parts[2]} ${parts[3]}`;
  } else if (/devel/i.test(text) && /GStreamer|gstreamer/i.test(text)) {
    fileSize = 'gstreamer-devel.msi';
  } else if (/runtime/i.test(text) && /GStreamer|gstreamer/i.test(text)) {
    fileSize = 'gstreamer-runtime.msi';
  } else if (/ViGEmBus/i.test(text)) {
    fileSize = 'ViGEmBus 安装包';
  } else {
    fileSize = '等待文件信息';
  }

  const downloadSpeed = extractRepairMetric(text, [
    /(\d+(?:\.\d+)?)\s*(KB|MB|GB|KiB|MiB|GiB)\/s/i,
    /速度[:：]\s*([^\s，,]+)/i
  ]) || '等待下载信息';

  const eta = extractRepairMetric(text, [
    /ETA[:=\s]+([0-9:]+)/i,
    /剩余[:：]\s*([^，,]+)/i
  ]) || '等待下载信息';

  return { downloader, fileSize, downloadSpeed, eta };
}

function setRepairProgressPanel(panel, summaryElement, percentElement, barElement, stepElement, visible, progress, compact) {
  if (!panel) {
    return;
  }

  panel.hidden = !visible;
  panel.classList.toggle('is-active', visible);

  if (!visible) {
    return;
  }

  const percent = calculateRepairPercent(progress);
  const step = currentRepairStep(progress);
  setText(summaryElement, progress.summary || '暂无修复任务');
  setText(percentElement, `${percent}%`);
  setText(stepElement, compact && step.length > 48 ? `${step.slice(0, 48)}...` : step);

  if (barElement) {
    barElement.style.width = `${percent}%`;
  }
}

function renderDiagnosticRepairProgress(progress) {
  if (!elements.repairProgressPanel) {
    return;
  }

  const visible = Boolean(progress.active || progress.items.length > 0);
  const percent = visible ? calculateRepairPercent(progress) : 0;
  const title = currentRepairTitle(progress);
  const step = visible ? currentRepairStep(progress) : '等待检查结果';
  const metadata = inferRepairMetadata(progress);

  elements.repairProgressPanel.hidden = false;
  elements.repairProgressPanel.classList.toggle('is-active', visible);
  if (elements.repairStageFeedback) {
    elements.repairStageFeedback.classList.toggle('is-active', visible);
  }

  setText(elements.repairProgressSummary, title);
  setText(
    elements.repairProgressIntro,
    visible ? '下载、校验、安装分阶段显示；长时间任务会持续刷新最近活动。' : '开始修复后会显示下载、校验和安装阶段的实时进展。'
  );
  setText(elements.repairElapsedText, repairElapsed(progress));
  setText(elements.repairCurrentTitle, title);
  setText(elements.repairProgressPercent, `${percent}%`);
  setText(elements.repairCurrentStep, `最近活动：${visible ? step : '等待检查结果'}`);
  setText(elements.repairDownloadSpeed, metadata.downloadSpeed);
  setText(elements.repairEta, metadata.eta);
  setText(elements.repairFileSize, metadata.fileSize);
  setText(elements.repairDownloader, metadata.downloader);
  setText(elements.diagnosticRecentStatusText, visible ? (progress.lastMessage || step) : '等待串流准备');

  if (elements.repairProgressBar) {
    elements.repairProgressBar.style.width = `${percent}%`;
  }
}

function handleRepairProgress(event = {}) {
  if (!state.repairProgress.active) {
    resetRepairProgress('正在准备修复环境');
  }

  const now = Date.now();
  const message = normalizeRepairMessage(event.message);
  state.repairProgress.lastActivityAt = now;
  if (message) {
    state.repairProgress.lastMessage = message;
  }

  if (event.type === 'check') {
    state.repairProgress.summary = event.message || '正在检查发送端环境';
    state.repairProgress.percent = Math.max(state.repairProgress.percent || 0, 12);
  } else if (event.type === 'start') {
    state.repairProgress.summary = event.message || '开始修复环境';
    state.repairProgress.percent = Math.max(state.repairProgress.percent || 0, 18);
  } else if (event.type === 'plan') {
    state.repairProgress.summary = event.message || '已生成修复计划';
    state.repairProgress.percent = Math.max(state.repairProgress.percent || 0, event.actions && event.actions.length > 0 ? 22 : 84);
    for (const action of asArray(event.actions)) {
      updateRepairProgressItem(action.id, action.title, 'pending', '待处理');
    }
  } else if (event.type === 'action-start') {
    state.repairProgress.activeActionId = event.actionId || event.title || '';
    state.repairProgress.summary = event.message || '正在处理修复项';
    updateRepairProgressItem(event.actionId, event.title, 'running', event.message);
  } else if (event.type === 'log') {
    updateRepairProgressItem(event.actionId, event.title, 'running', event.message);
  } else if (event.type === 'action-complete') {
    updateRepairProgressItem(event.actionId, event.title, 'complete', event.message || '已完成');
    if (state.repairProgress.activeActionId === event.actionId) {
      state.repairProgress.activeActionId = '';
    }
  } else if (event.type === 'action-error') {
    updateRepairProgressItem(event.actionId, event.title, 'error', event.message || '处理失败');
    state.repairProgress.summary = event.message || '修复失败';
  } else if (event.type === 'complete') {
    state.repairProgress.active = false;
    state.repairProgress.summary = event.message || '修复流程已完成';
    state.repairProgress.percent = 100;
    state.repairProgress.activeActionId = '';
  }

  renderRepairProgress();
}

function repairStatusLabel(status) {
  if (status === 'running') return '处理中';
  if (status === 'complete') return '完成';
  if (status === 'error') return '失败';
  return '待处理';
}

function renderRepairProgress() {
  const progress = state.repairProgress;
  const visible = Boolean(progress.active || progress.items.length > 0);
  setRepairProgressPanel(
    elements.homeRepairProgressPanel,
    elements.homeRepairProgressSummary,
    elements.homeRepairProgressPercent,
    elements.homeRepairProgressBar,
    elements.homeRepairCurrentStep,
    visible,
    progress,
    true
  );
  renderDiagnosticRepairProgress(progress);

  if (!elements.repairProgressList) {
    return;
  }

  if (progress.items.length === 0) {
    elements.repairProgressList.innerHTML = '<li class="repair-progress-empty">暂无修复任务</li>';
    return;
  }

  elements.repairProgressList.innerHTML = progress.items.map(item => {
    const badgeClass = item.status === 'complete' ? 'ok' : item.status === 'error' ? 'fail' : item.status === 'running' ? 'warn' : '';
    return `
      <li class="repair-progress-item ${escapeHtml(item.status)}">
        <span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.message || repairStatusLabel(item.status))}</small>
        </span>
        <span class="badge ${badgeClass}">${escapeHtml(repairStatusLabel(item.status))}</span>
      </li>
    `;
  }).join('');
}

function renderStatus() {
  syncStreamingClock();

  const label = statusLabel();
  const running = isStreamRunning();

  setText(elements.sidebarStatusText, running ? '正在向电视发送画面' : '等待串流准备');
  if (elements.sidebarStatusText && elements.sidebarStatusText.parentElement) {
    elements.sidebarStatusText.parentElement.classList.toggle('is-running', running);
  }

  if (elements.actionStatus && !state.busy && !elements.actionStatus.classList.contains('is-error')) {
    setActionStatus(label, running ? 'is-ok' : '');
  }

  renderStreamRuntime();

  const logs = asArray(state.status && state.status.logs);
  const recentStatus = logs.length > 0
    ? logs[logs.length - 1]
    : running ? '正在向电视发送画面' : '等待串流准备';
  setText(elements.recentStatusText, recentStatus);
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
  renderRepairProgress();
  renderStatus();
  renderTargetSummary();
}

function switchPage(pageName) {
  const nextPage = PAGE_TITLES[pageName] ? pageName : 'home';

  document.querySelectorAll('.nav-item').forEach(button => {
    const active = button.dataset.page === nextPage;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-current', active ? 'page' : 'false');
  });
  document.querySelectorAll('.page').forEach(page => {
    page.classList.toggle('is-active', page.dataset.pagePanel === nextPage);
  });
  setText(elements.pageTitle, PAGE_TITLES[nextPage]);
  if (elements.topbarCopy) {
    elements.topbarCopy.hidden = nextPage === 'diagnostics';
  }
}

async function loadConfig() {
  const config = await Promise.resolve(window.tvgame.loadConfig());
  state.config = config || {};
  state.selectedQuality = state.config.selectedQuality || state.selectedQuality;
  state.performanceProtection = state.config.performanceProtection !== false;
  state.selectedDevice = state.config.selectedDevice || '';
  state.manualIp = state.config.manualIp || state.config.manualIpAddress || '';
  state.deviceMode = state.config.deviceMode === 'auto' ? 'auto' : 'manual';
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

async function checkEnvironment(options = {}) {
  if (options.showBusy) {
    setBusyState(true, options.busyMessage || '正在检查运行环境...');
  }

  try {
    const result = await Promise.resolve(window.tvgame.checkEnvironment());
    state.environment = normalizeEnvironment(result);
    renderEnvironment();
    const ready = isEnvironmentFullyReady();
    if (options.showResult) {
      setActionStatus(ready ? '环境检查完成' : '环境仍有项目需要处理', ready ? 'is-ok' : 'is-error');
    }
    return ready;
  } catch (error) {
    setActionStatus(`检查环境失败：${error.message}`, 'is-error');
    return false;
  } finally {
    if (options.showBusy) {
      setBusyState(false);
    }
  }
}

async function repairEnvironment(options = {}) {
  resetRepairProgress(options.summary || '正在检查并修复环境');
  setBusyState(true, '正在检查并修复环境...');

  try {
    const result = await Promise.resolve(window.tvgame.repairEnvironment());
    state.environment = normalizeEnvironment(result);
    renderEnvironment();
    const fullyReady = isEnvironmentFullyReady();
    setActionStatus(fullyReady ? '环境检查与修复已完成' : '修复已完成，仍有项目需要处理', fullyReady ? 'is-ok' : 'is-error');
    return fullyReady;
  } catch (error) {
    handleRepairProgress({
      type: 'action-error',
      actionId: 'repair-error',
      title: '环境修复',
      message: error.message
    });
    setActionStatus(`检查并修复环境失败：${error.message}`, 'is-error');
    return false;
  } finally {
    setBusyState(false);
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

async function ensureEnvironmentReadyForStart() {
  const ready = isEnvironmentFullyReady() || await checkEnvironment({
    showBusy: true,
    busyMessage: '正在检查运行环境...'
  });
  if (ready) {
    return true;
  }

  switchPage('diagnostics');
  setActionStatus('环境未全部正常，正在自动修复...', 'is-busy');
  await repairEnvironment({
    summary: '开始串流前需要先修复环境'
  });
  setActionStatus('环境修复已执行，请确认全部正常后再次点击开始串流', isEnvironmentFullyReady() ? 'is-ok' : 'is-error');
  return false;
}

async function startStream() {
  const device = getStreamTarget();

  if (!device || !device.ip) {
    setActionStatus('请输入电视或盒子的 IP，自动搜索可作为辅助。', 'is-error');
    return;
  }

  if (!await ensureEnvironmentReadyForStart()) {
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
      if (result.needsRepair) {
        switchPage('diagnostics');
        setActionStatus(result.message || '环境未全部正常，正在自动修复...', 'is-busy');
        await repairEnvironment({
          summary: '开始串流前需要先修复环境'
        });
        await refreshStatus();
        return;
      }
      setActionStatus('启动失败', 'is-error');
      await refreshStatus();
      return;
    }

    await Promise.resolve(window.tvgame.saveConfig({
      selectedDevice: state.deviceMode === 'auto' ? state.selectedDevice : '',
      deviceMode: state.deviceMode,
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
  if (typeof window.tvgame.onRepairProgress === 'function') {
    window.tvgame.onRepairProgress(handleRepairProgress);
  }

  document.querySelectorAll('.nav-item').forEach(button => {
    button.addEventListener('click', () => switchPage(button.dataset.page));
  });

  elements.deviceSelect.addEventListener('change', event => {
    state.selectedDevice = event.target.value;
    if (state.selectedDevice) {
      state.deviceMode = 'auto';
      renderConnectionMode();
    }
    renderTargetSummary();
    renderDevices();
  });

  elements.manualIpInput.addEventListener('input', event => {
    state.manualIp = event.target.value;
    if (state.manualIp.trim()) {
      state.deviceMode = 'manual';
      renderConnectionMode();
    } else {
      state.deviceMode = 'manual';
      renderConnectionMode();
    }
    renderTargetSummary();
  });

  elements.qualitySelect.addEventListener('change', event => {
    selectQuality(event.target.value);
  });

  if (elements.qualityDropdownButton) {
    elements.qualityDropdownButton.addEventListener('click', toggleQualityDropdown);
    elements.qualityDropdownButton.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openQualityDropdown();
      }
    });
  }

  if (elements.qualityMenu) {
    elements.qualityMenu.addEventListener('click', event => {
      const option = event.target.closest('[data-quality-id]');
      if (option) {
        selectQuality(option.dataset.qualityId);
        elements.qualityDropdownButton?.focus();
      }
    });
    elements.qualityMenu.addEventListener('keydown', event => {
      const options = Array.from(elements.qualityMenu.querySelectorAll('.quality-option'));
      const currentIndex = options.indexOf(document.activeElement);
      if (event.key === 'Escape') {
        event.preventDefault();
        closeQualityDropdown();
        elements.qualityDropdownButton?.focus();
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        const nextIndex = currentIndex < 0
          ? 0
          : (currentIndex + direction + options.length) % options.length;
        options[nextIndex]?.focus();
      } else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        const option = document.activeElement?.closest?.('[data-quality-id]');
        if (option) {
          selectQuality(option.dataset.qualityId);
          elements.qualityDropdownButton?.focus();
        }
      }
    });
  }

  document.addEventListener('click', event => {
    if (elements.qualityDropdown && !elements.qualityDropdown.contains(event.target)) {
      closeQualityDropdown();
    }
  });

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

  if (elements.modeAuto) {
    elements.modeAuto.addEventListener('change', () => {
      state.deviceMode = 'auto';
      renderConnectionMode();
      renderTargetSummary();
      refreshDevices();
    });
  }

  if (elements.modeManual) {
    elements.modeManual.addEventListener('change', () => {
      state.deviceMode = 'manual';
      renderConnectionMode();
      renderTargetSummary();
    });
  }

  elements.startButton.addEventListener('click', startStream);
  elements.stopButton.addEventListener('click', stopStream);
  elements.refreshDevicesButton.addEventListener('click', refreshDevices);
  elements.checkEnvironmentButton.addEventListener('click', () => checkEnvironment({
    showBusy: true,
    showResult: true
  }));
  elements.repairEnvironmentButton.addEventListener('click', repairEnvironment);
}

async function init() {
  ensurePreviewStub();
  cacheElements();
  bindEvents();
  renderControls();

  await loadConfig();
  renderControls();
  refreshStatus();
  if (state.deviceMode === 'auto') {
    refreshDevices();
  }
  renderControls();

  window.setInterval(refreshStatus, 5000);
  window.setInterval(() => {
    renderStreamRuntime();
    if (state.repairProgress.active) {
      renderDiagnosticRepairProgress(state.repairProgress);
    }
  }, 1000);
  window.setInterval(() => {
    if (state.deviceMode === 'auto') {
      refreshDevices();
    }
  }, 15000);
}

document.addEventListener('DOMContentLoaded', init);
