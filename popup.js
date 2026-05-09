// #Lalittesting
const DEFAULT_SETTINGS = {
  enabled: false,
  volume: 100,
  bassBoost: false,
  limiter: true,
  eq: {
    bass: 0,
    mid: 0,
    treble: 0
  },
  saveForSite: false
};
const GLOBAL_CONTROLS_KEY = 'globalPlayerControlsEnabledV2';
const GLOBAL_BOOSTER_SETTINGS_KEY = 'globalBoosterSettingsV1';
const GLOBAL_PLAYER_SETTINGS_KEY = 'globalPlayerSettingsV1';

const elements = {
  themeToggle: document.querySelector('#themeToggle'),
  globalControlsToggle: document.querySelector('#globalControlsToggle'),
  globalModeToggle: document.querySelector('#globalModeToggle'),
  enabledToggle: document.querySelector('#enabledToggle'),
  statusText: document.querySelector('#statusText'),
  siteLabel: document.querySelector('#siteLabel'),
  volumeSlider: document.querySelector('#volumeSlider'),
  volumeValue: document.querySelector('#volumeValue'),
  speedEnabledToggle: document.querySelector('#speedEnabledToggle'),
  speedSlider: document.querySelector('#speedSlider'),
  speedValue: document.querySelector('#speedValue'),
  bassBoostToggle: document.querySelector('#bassBoostToggle'),
  limiterToggle: document.querySelector('#limiterToggle'),
  saveSiteToggle: document.querySelector('#saveSiteToggle'),
  bassSlider: document.querySelector('#bassSlider'),
  midSlider: document.querySelector('#midSlider'),
  trebleSlider: document.querySelector('#trebleSlider'),
  bassValue: document.querySelector('#bassValue'),
  midValue: document.querySelector('#midValue'),
  trebleValue: document.querySelector('#trebleValue'),
  resetButton: document.querySelector('#resetButton'),
  eqResetButton: document.querySelector('#eqResetButton')
};

let activeTab = null;
let activeHost = '';
let settings = structuredClone(DEFAULT_SETTINGS);
let playerSettings = { speed: 1, speedEnabled: false, loop: false, loopStart: null, loopEnd: null };
let globalControlsEnabled = true;
let isApplyingSettings = false;
let updateTimer = null;

init();
chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== 'TAB_STATE_CHANGED' || message.tabId !== activeTab?.id) return;
  settings = { ...settings, ...message.settings };
  applySettingsToUi();
});

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  activeHost = getHost(tab?.url);
  elements.siteLabel.textContent = activeHost || 'This tab';

  const {
    theme = 'dark',
    siteSettings = {},
    [GLOBAL_BOOSTER_SETTINGS_KEY]: globalBoosterSettings,
    [GLOBAL_PLAYER_SETTINGS_KEY]: globalPlayerSettings,
    [GLOBAL_CONTROLS_KEY]: storedGlobalControlsEnabled
  } = await chrome.storage.local.get([
    'theme',
    'siteSettings',
    GLOBAL_CONTROLS_KEY,
    GLOBAL_BOOSTER_SETTINGS_KEY,
    GLOBAL_PLAYER_SETTINGS_KEY
  ]);

  globalControlsEnabled = storedGlobalControlsEnabled !== false;
  setTheme(theme);
  applyGlobalControlsState();

  if (activeHost && siteSettings[activeHost]) {
    settings = { ...DEFAULT_SETTINGS, ...siteSettings[activeHost], saveForSite: true };
  }

  if (globalControlsEnabled && globalBoosterSettings) {
    settings = { ...settings, ...globalBoosterSettings };
  }

  if (globalControlsEnabled && globalPlayerSettings) {
    playerSettings = normalizePlayerSettings(globalPlayerSettings);
  }

  try {
    const response = await sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab?.id });
    if (response?.ok === false) {
      throw new Error(response.message);
    }

    if (response?.settings) {
      settings = { ...settings, ...response.settings };
    }
  } catch (error) {
    setStatus('Audio engine is not ready yet.');
  }

  applySettingsToUi();
  bindEvents();
}

function bindEvents() {
  elements.themeToggle.addEventListener('click', async () => {
    const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    setTheme(nextTheme);
    await chrome.storage.local.set({ theme: nextTheme });
  });

  elements.globalControlsToggle.addEventListener('click', async () => {
    await setGlobalControlsEnabled(!globalControlsEnabled);
  });

  elements.globalModeToggle.addEventListener('change', async () => {
    await setGlobalControlsEnabled(elements.globalModeToggle.checked);
  });

  elements.enabledToggle.addEventListener('change', () => {
    settings.enabled = elements.enabledToggle.checked;
    persistAndSendSettings(true);
  });

  elements.volumeSlider.addEventListener('input', () => {
    settings.volume = Number(elements.volumeSlider.value);
    applySettingsToUi();
    persistAndSendSettings();
  });

  elements.speedSlider.addEventListener('input', () => {
    playerSettings.speed = normalizeSpeed(elements.speedSlider.value);
    playerSettings.speedEnabled = playerSettings.speed !== 1;
    applySettingsToUi();
    persistPlayerSettings();
  });

  elements.speedEnabledToggle.addEventListener('change', () => {
    playerSettings.speedEnabled = elements.speedEnabledToggle.checked;
    if (!playerSettings.speedEnabled) playerSettings.speed = 1;
    applySettingsToUi();
    persistPlayerSettings();
  });

  document.querySelectorAll('[data-speed]').forEach((button) => {
    button.addEventListener('click', () => {
      playerSettings.speed = normalizeSpeed(button.dataset.speed);
      playerSettings.speedEnabled = playerSettings.speed !== 1;
      applySettingsToUi();
      persistPlayerSettings();
    });
  });

  document.querySelectorAll('[data-volume]').forEach((button) => {
    button.addEventListener('click', () => {
      settings.volume = Number(button.dataset.volume);
      settings.enabled = settings.volume !== 100;
      applySettingsToUi();
      persistAndSendSettings(true);
    });
  });

  elements.resetButton.addEventListener('click', () => {
    settings = { ...structuredClone(DEFAULT_SETTINGS), saveForSite: settings.saveForSite };
    applySettingsToUi();
    persistAndSendSettings(true);
  });

  elements.bassBoostToggle.addEventListener('change', () => {
    settings.bassBoost = elements.bassBoostToggle.checked;
    persistAndSendSettings();
  });

  elements.limiterToggle.addEventListener('change', () => {
    settings.limiter = elements.limiterToggle.checked;
    persistAndSendSettings();
  });

  elements.saveSiteToggle.addEventListener('change', () => {
    settings.saveForSite = elements.saveSiteToggle.checked;
    persistAndSendSettings();
  });

  [elements.bassSlider, elements.midSlider, elements.trebleSlider].forEach((slider) => {
    slider.addEventListener('input', () => {
      settings.eq = {
        bass: Number(elements.bassSlider.value),
        mid: Number(elements.midSlider.value),
        treble: Number(elements.trebleSlider.value)
      };
      applySettingsToUi();
      persistAndSendSettings();
    });
  });

  elements.eqResetButton.addEventListener('click', () => {
    settings.eq = { bass: 0, mid: 0, treble: 0 };
    applySettingsToUi();
    persistAndSendSettings();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes[GLOBAL_BOOSTER_SETTINGS_KEY] && globalControlsEnabled) {
      settings = { ...settings, ...changes[GLOBAL_BOOSTER_SETTINGS_KEY].newValue };
      applySettingsToUi();
    }

    if (changes[GLOBAL_CONTROLS_KEY]) {
      globalControlsEnabled = changes[GLOBAL_CONTROLS_KEY].newValue !== false;
      applyGlobalControlsState();
    }

    if (changes[GLOBAL_PLAYER_SETTINGS_KEY] && globalControlsEnabled) {
      playerSettings = normalizePlayerSettings(changes[GLOBAL_PLAYER_SETTINGS_KEY].newValue);
      applySettingsToUi();
    }
  });
}

function applySettingsToUi() {
  isApplyingSettings = true;
  elements.enabledToggle.checked = settings.enabled;
  elements.volumeSlider.value = settings.volume;
  elements.volumeValue.textContent = `${settings.volume}%`;
  elements.speedEnabledToggle.checked = playerSettings.speedEnabled;
  elements.speedSlider.value = playerSettings.speed;
  elements.speedValue.textContent = playerSettings.speedEnabled ? `${formatSpeed(playerSettings.speed)}x` : 'Off';
  elements.bassBoostToggle.checked = settings.bassBoost;
  elements.limiterToggle.checked = settings.limiter;
  elements.saveSiteToggle.checked = settings.saveForSite;
  elements.bassSlider.value = settings.eq.bass;
  elements.midSlider.value = settings.eq.mid;
  elements.trebleSlider.value = settings.eq.treble;
  elements.bassValue.textContent = `${settings.eq.bass} dB`;
  elements.midValue.textContent = `${settings.eq.mid} dB`;
  elements.trebleValue.textContent = `${settings.eq.treble} dB`;
  setStatus(settings.enabled ? `Boosting this tab at ${settings.volume}%.` : 'Ready to boost this tab.');
  isApplyingSettings = false;
}

function applyGlobalControlsState() {
  elements.globalControlsToggle.setAttribute('aria-pressed', String(globalControlsEnabled));
  elements.globalModeToggle.checked = globalControlsEnabled;
  elements.globalControlsToggle.title = globalControlsEnabled
    ? 'In-page controls are on for all websites'
    : 'In-page controls are off';
}

async function setGlobalControlsEnabled(enabled) {
  globalControlsEnabled = enabled;

  if (!globalControlsEnabled) {
    settings = structuredClone(DEFAULT_SETTINGS);
    playerSettings = { speed: 1, speedEnabled: false, loop: false, loopStart: null, loopEnd: null };
    applyGlobalControlsState();
    applySettingsToUi();
    await chrome.storage.local.set({
      [GLOBAL_CONTROLS_KEY]: false,
      [GLOBAL_BOOSTER_SETTINGS_KEY]: withoutRuntimeFields(settings),
      [GLOBAL_PLAYER_SETTINGS_KEY]: playerSettings
    });
    await updateTabAudio();
    setStatus('Global controls are off. Volume, speed, and loop reset.');
    return;
  }

  applyGlobalControlsState();
  await chrome.storage.local.set({
    [GLOBAL_CONTROLS_KEY]: true,
    [GLOBAL_BOOSTER_SETTINGS_KEY]: withoutRuntimeFields(settings),
    [GLOBAL_PLAYER_SETTINGS_KEY]: playerSettings
  });
  setStatus('Global controls are on for all websites.');
}

function persistAndSendSettings(immediate = false) {
  if (isApplyingSettings) return;
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(async () => {
    await persistSiteSettings();
    await persistGlobalSettings();
    await updateTabAudio();
  }, immediate ? 0 : 80);
}

async function persistSiteSettings() {
  if (!activeHost) return;
  const { siteSettings = {} } = await chrome.storage.local.get('siteSettings');
  if (settings.saveForSite) {
    siteSettings[activeHost] = withoutRuntimeFields(settings);
  } else {
    delete siteSettings[activeHost];
  }
  await chrome.storage.local.set({ siteSettings });
}

async function persistGlobalSettings() {
  if (!globalControlsEnabled) return;
  await chrome.storage.local.set({ [GLOBAL_BOOSTER_SETTINGS_KEY]: withoutRuntimeFields(settings) });
}

async function persistPlayerSettings() {
  if (!globalControlsEnabled) return;
  await chrome.storage.local.set({ [GLOBAL_PLAYER_SETTINGS_KEY]: playerSettings });
}

async function updateTabAudio() {
  if (typeof activeTab?.id !== 'number') {
    setStatus('Open a regular website tab to boost audio.');
    return;
  }

  try {
    const response = await sendMessage({
      type: settings.enabled ? 'START_OR_UPDATE_AUDIO' : 'STOP_AUDIO',
      tabId: activeTab.id,
      settings: withoutRuntimeFields(settings)
    });

    if (response?.ok === false) {
      throw new Error(response.message);
    }

    setStatus(response?.message || (settings.enabled ? `Boosting this tab at ${settings.volume}%.` : 'Volume booster is off.'));
  } catch (error) {
    setStatus(error.message || 'Could not update tab audio. Try reopening the popup.');
  }
}

function withoutRuntimeFields(value) {
  return {
    enabled: Boolean(value.enabled),
    volume: Number(value.volume),
    bassBoost: Boolean(value.bassBoost),
    limiter: Boolean(value.limiter),
    eq: {
      bass: Number(value.eq?.bass || 0),
      mid: Number(value.eq?.mid || 0),
      treble: Number(value.eq?.treble || 0)
    }
  };
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  elements.themeToggle.textContent = theme === 'light' ? '☀' : '☾';
}

function setStatus(message) {
  elements.statusText.textContent = message;
}

function getHost(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol.startsWith('http') ? parsed.hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
}

function sendMessage(message) {
  return chrome.runtime.sendMessage(message);
}

function normalizePlayerSettings(value = {}) {
  return {
    speed: normalizeSpeed(value.speed),
    speedEnabled: Boolean(value.speedEnabled),
    loop: Boolean(value.loop),
    loopStart: Number.isFinite(Number(value.loopStart)) ? Number(value.loopStart) : null,
    loopEnd: Number.isFinite(Number(value.loopEnd)) ? Number(value.loopEnd) : null
  };
}

function normalizeSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed)) return 1;
  return Math.min(Math.max(Number(speed.toFixed(2)), 0.25), 10);
}

function formatSpeed(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}
