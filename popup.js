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

const elements = {
  themeToggle: document.querySelector('#themeToggle'),
  enabledToggle: document.querySelector('#enabledToggle'),
  statusText: document.querySelector('#statusText'),
  siteLabel: document.querySelector('#siteLabel'),
  volumeSlider: document.querySelector('#volumeSlider'),
  volumeValue: document.querySelector('#volumeValue'),
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
let isApplyingSettings = false;
let updateTimer = null;

init();

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  activeHost = getHost(tab?.url);
  elements.siteLabel.textContent = activeHost || 'This tab';

  const { theme = 'dark', siteSettings = {} } = await chrome.storage.local.get(['theme', 'siteSettings']);
  setTheme(theme);

  if (activeHost && siteSettings[activeHost]) {
    settings = { ...DEFAULT_SETTINGS, ...siteSettings[activeHost], saveForSite: true };
  }

  try {
    const response = await sendMessage({ type: 'GET_TAB_STATE', tabId: activeTab?.id });
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

  elements.enabledToggle.addEventListener('change', () => {
    settings.enabled = elements.enabledToggle.checked;
    persistAndSendSettings(true);
  });

  elements.volumeSlider.addEventListener('input', () => {
    settings.volume = Number(elements.volumeSlider.value);
    applySettingsToUi();
    persistAndSendSettings();
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
}

function applySettingsToUi() {
  isApplyingSettings = true;
  elements.enabledToggle.checked = settings.enabled;
  elements.volumeSlider.value = settings.volume;
  elements.volumeValue.textContent = `${settings.volume}%`;
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

function persistAndSendSettings(immediate = false) {
  if (isApplyingSettings) return;
  window.clearTimeout(updateTimer);
  updateTimer = window.setTimeout(async () => {
    await persistSiteSettings();
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

async function updateTabAudio() {
  if (!activeTab?.id) {
    setStatus('Open a regular website tab to boost audio.');
    return;
  }

  try {
    const response = await sendMessage({
      type: settings.enabled ? 'START_OR_UPDATE_AUDIO' : 'STOP_AUDIO',
      tabId: activeTab.id,
      settings: withoutRuntimeFields(settings)
    });
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
