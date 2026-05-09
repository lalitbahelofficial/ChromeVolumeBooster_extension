// In-page media controls that sync with the extension booster.
const DEFAULT_BOOSTER_SETTINGS = {
  enabled: false,
  volume: 100,
  bassBoost: false,
  limiter: true,
  eq: { bass: 0, mid: 0, treble: 0 }
};

const PLAYER_DEFAULTS = {
  speed: 1,
  speedEnabled: false,
  loop: false,
  loopStart: null,
  loopEnd: null
};

const SPEED_STEP = 0.25;
const MIN_SPEED = 0.25;
const MAX_SPEED = 10;
const MIN_VOLUME = 100;
const MAX_VOLUME = 500;
const MIN_MEDIA_SIZE = 120;
const STORAGE_KEY = 'playerControlsSettings';
const GLOBAL_CONTROLS_KEY = 'globalPlayerControlsEnabledV2';
const GLOBAL_BOOSTER_SETTINGS_KEY = 'globalBoosterSettingsV1';
const GLOBAL_PLAYER_SETTINGS_KEY = 'globalPlayerSettingsV1';

let controls = null;
let activeMedia = null;
let boosterSettings = { ...DEFAULT_BOOSTER_SETTINGS };
let playerSettings = { ...PLAYER_DEFAULTS };
let globalControlsEnabled = true;
let saveTimer = null;
let scanTimer = null;
let boosterApplying = false;
let boosterApplyQueued = false;
let panelHideTimer = null;

initPlayerControls();

async function initPlayerControls() {
  if (window.top !== window) return;

  const loaded = await loadSettings();
  playerSettings = loaded.playerSettings;
  globalControlsEnabled = loaded.globalControlsEnabled;
  await syncBoosterState();

  setupMediaObserver();
  setupStorageListener();
  setupRuntimeListener();
  if (globalControlsEnabled) findActiveMedia();

  window.setInterval(findActiveMedia, 1200);
}

function setupMediaObserver() {
  const observer = new MutationObserver(scheduleMediaScan);
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  document.addEventListener('play', (event) => {
    if (isUsableMedia(event.target)) {
      setActiveMedia(event.target);
    }
  }, true);
}

function scheduleMediaScan() {
  if (scanTimer) return;

  scanTimer = window.setTimeout(() => {
    scanTimer = null;
    findActiveMedia();
  }, 500);
}

function setupStorageListener() {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;

    if (changes[GLOBAL_CONTROLS_KEY]) {
      globalControlsEnabled = changes[GLOBAL_CONTROLS_KEY].newValue !== false;
      if (globalControlsEnabled) {
        findActiveMedia();
      } else {
        boosterSettings = { ...DEFAULT_BOOSTER_SETTINGS };
        playerSettings = { ...PLAYER_DEFAULTS };
        applyPlayerSettings(false);
        applyBoosterSettings(false);
        hideControls();
      }
    }

    if (globalControlsEnabled && changes[GLOBAL_BOOSTER_SETTINGS_KEY]?.newValue) {
      boosterSettings = normalizeBoosterSettings(changes[GLOBAL_BOOSTER_SETTINGS_KEY].newValue);
      syncControls();
      if (activeMedia && boosterSettings.enabled) applyBoosterSettings(false);
    }

    if (globalControlsEnabled && changes[GLOBAL_PLAYER_SETTINGS_KEY]?.newValue) {
      playerSettings = normalizePlayerSettings(changes[GLOBAL_PLAYER_SETTINGS_KEY].newValue);
      applyPlayerSettings(false);
    }
  });
}

function setupRuntimeListener() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type !== 'TAB_STATE_CHANGED' || !message.settings) return;
    boosterSettings = normalizeBoosterSettings(message.settings);
    syncControls();
  });
}

async function syncBoosterState() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'GET_TAB_STATE' });
    if (response?.settings) {
      boosterSettings = normalizeBoosterSettings(response.settings);
      return;
    }

    if (globalControlsEnabled) {
      const stored = await chrome.storage.local.get(GLOBAL_BOOSTER_SETTINGS_KEY);
      if (stored[GLOBAL_BOOSTER_SETTINGS_KEY]) {
        boosterSettings = normalizeBoosterSettings(stored[GLOBAL_BOOSTER_SETTINGS_KEY]);
      }
    }
  } catch {
    boosterSettings = { ...DEFAULT_BOOSTER_SETTINGS };
  }
}

function findActiveMedia() {
  if (!globalControlsEnabled) {
    hideControls();
    return;
  }

  const mediaElements = getUsableMediaElements();
  const playingMedia = mediaElements.find((media) => !media.paused && !media.ended);
  const nextMedia = playingMedia || mediaElements[0] || null;

  if (nextMedia) {
    setActiveMedia(nextMedia);
  } else {
    hideControls();
    activeMedia = null;
  }
}

function setActiveMedia(media) {
  const mediaChanged = activeMedia !== media;
  activeMedia = media;
  if (mediaChanged) {
    activeMedia.playbackRate = playerSettings.speedEnabled ? playerSettings.speed : 1;
    activeMedia.addEventListener('timeupdate', handleMediaTimeUpdate);
  }
  ensureControls();
  applyLoopSettings();
  syncControls();
  placeControls();
}

function getUsableMediaElements() {
  return [...document.querySelectorAll('video, audio')]
    .filter(isUsableMedia)
    .sort((a, b) => getMediaArea(b) - getMediaArea(a));
}

function isUsableMedia(value) {
  if (!(value instanceof HTMLMediaElement)) return false;
  if (!value.isConnected) return false;
  if (value.tagName === 'AUDIO') return value.controls || !value.paused;

  const rect = value.getBoundingClientRect();
  return rect.width >= MIN_MEDIA_SIZE && rect.height >= MIN_MEDIA_SIZE;
}

function getMediaArea(media) {
  const rect = media.getBoundingClientRect();
  return rect.width * rect.height;
}

function ensureControls() {
  if (controls) {
    controls.host.hidden = false;
    return;
  }

  const host = document.createElement('div');
  host.id = 'cvb-player-controls-host';
  host.style.zIndex = '2147483647';

  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `
    <style>
      :host {
        all: initial;
        color-scheme: dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }

      .wrap {
        align-items: center;
        display: inline-flex;
        gap: 2px;
        height: 36px;
        min-width: max-content;
        position: relative;
      }

      :host(.ytp-inline-controls) {
        display: inline-flex !important;
        flex: 0 0 auto !important;
        height: 36px !important;
        min-width: 168px !important;
        overflow: visible !important;
        width: auto !important;
      }

      .trigger {
        align-items: center;
        background: rgba(0, 0, 0, 0);
        border: 0;
        color: #ffffff;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: 13px;
        font-weight: 900;
        height: 36px;
        justify-content: center;
        min-width: 38px;
        white-space: nowrap;
        padding: 0 8px;
        text-shadow: 0 0 2px rgba(0, 0, 0, 0.85);
      }

      .loop-button[aria-pressed="true"] {
        color: #4ade80;
      }

      .speed-button[aria-pressed="true"] {
        color: #4ade80;
      }

      .trigger:hover,
      .trigger[aria-expanded="true"] {
        color: #4ade80;
      }

      .panel {
        background: rgba(13, 17, 23, 0.76);
        backdrop-filter: blur(14px);
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 8px;
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.35);
        color: #f8fafc;
        display: grid;
        gap: 10px;
        min-width: 292px;
        padding: 12px;
        position: fixed;
        z-index: 2147483647;
      }

      .panel[hidden] {
        display: none;
      }

      .row {
        align-items: center;
        display: grid;
        gap: 8px;
        grid-template-columns: 46px 1fr 48px;
      }

      .speed-row {
        grid-template-columns: 46px 32px 1fr 32px;
      }

      .presets {
        display: grid;
        gap: 6px;
        grid-template-columns: repeat(6, 1fr);
      }

      .loop-row {
        display: grid;
        gap: 6px;
        grid-template-columns: repeat(3, 1fr);
      }

      .label,
      .value {
        font-size: 12px;
        font-weight: 800;
        line-height: 1;
        white-space: nowrap;
      }

      .label {
        color: #cbd5e1;
      }

      .value {
        color: #ffffff;
        text-align: right;
      }

      input[type="range"] {
        accent-color: #4ade80;
        cursor: pointer;
        width: 100%;
      }

      .mini-button {
        align-items: center;
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 7px;
        color: #ffffff;
        cursor: pointer;
        display: inline-flex;
        font: inherit;
        font-size: 13px;
        font-weight: 900;
        height: 28px;
        justify-content: center;
        padding: 0 8px;
      }

      .mini-button:hover {
        background: rgba(255, 255, 255, 0.18);
      }

      .reset {
        justify-self: end;
      }
    </style>
    <div class="wrap">
      <button id="trigger" class="trigger" type="button" aria-label="Volume booster controls" aria-expanded="false">VB</button>
      <button id="speedToggle" class="trigger speed-button" type="button" aria-label="Toggle speed control" aria-pressed="false">Speed Off</button>
      <button id="loopToggle" class="trigger loop-button" type="button" aria-label="Loop current video" aria-pressed="false">Loop</button>
      <div id="panel" class="panel" role="group" aria-label="Volume booster controls" hidden>
        <div class="row">
          <span class="label">Boost</span>
          <input id="volume" aria-label="Boost volume" type="range" min="100" max="500" step="5">
          <span id="volumeValue" class="value">100%</span>
        </div>
        <div class="row speed-row">
          <span class="label">Speed</span>
          <button id="speedDown" class="mini-button" type="button" aria-label="Decrease playback speed">-</button>
          <span id="speedValue" class="value">1x</span>
          <button id="speedUp" class="mini-button" type="button" aria-label="Increase playback speed">+</button>
        </div>
        <div class="presets" aria-label="Speed presets">
          <button class="mini-button" type="button" data-speed="0.5">0.5x</button>
          <button class="mini-button" type="button" data-speed="0.75">0.75x</button>
          <button class="mini-button" type="button" data-speed="1">1x</button>
          <button class="mini-button" type="button" data-speed="1.25">1.25x</button>
          <button class="mini-button" type="button" data-speed="1.5">1.5x</button>
          <button class="mini-button" type="button" data-speed="2">2x</button>
          <button class="mini-button" type="button" data-speed="3">3x</button>
          <button class="mini-button" type="button" data-speed="4">4x</button>
          <button class="mini-button" type="button" data-speed="5">5x</button>
          <button class="mini-button" type="button" data-speed="7.5">7.5x</button>
          <button class="mini-button" type="button" data-speed="10">10x</button>
        </div>
        <div class="loop-row" aria-label="Section loop controls">
          <button id="loopStart" class="mini-button" type="button">Set A</button>
          <button id="loopEnd" class="mini-button" type="button">Set B</button>
          <button id="loopClear" class="mini-button" type="button">Clear AB</button>
        </div>
        <button id="reset" class="mini-button reset" type="button" aria-label="Reset controls">Reset</button>
      </div>
    </div>
  `;

  document.documentElement.append(host);

  controls = {
    host,
    trigger: shadow.querySelector('#trigger'),
    speedToggle: shadow.querySelector('#speedToggle'),
    loopToggle: shadow.querySelector('#loopToggle'),
    panel: shadow.querySelector('#panel'),
    volume: shadow.querySelector('#volume'),
    volumeValue: shadow.querySelector('#volumeValue'),
    speedDown: shadow.querySelector('#speedDown'),
    speedValue: shadow.querySelector('#speedValue'),
    speedUp: shadow.querySelector('#speedUp'),
    speedPresets: shadow.querySelectorAll('[data-speed]'),
    loopStart: shadow.querySelector('#loopStart'),
    loopEnd: shadow.querySelector('#loopEnd'),
    loopClear: shadow.querySelector('#loopClear'),
    reset: shadow.querySelector('#reset')
  };

  controls.trigger.addEventListener('click', () => {
    const expanded = controls.panel.hidden;
    controls.panel.hidden = !expanded;
    controls.trigger.setAttribute('aria-expanded', String(expanded));
    if (expanded) {
      positionPanel();
      schedulePanelHide();
    } else {
      clearPanelHide();
    }
  });

  controls.loopToggle.addEventListener('click', () => {
    playerSettings.loop = !playerSettings.loop;
    applyPlayerSettings(true);
  });

  controls.speedToggle.addEventListener('click', () => {
    playerSettings.speedEnabled = !playerSettings.speedEnabled;
    if (!playerSettings.speedEnabled) playerSettings.speed = 1;
    applyPlayerSettings(true);
  });

  controls.panel.addEventListener('pointerenter', clearPanelHide);
  controls.panel.addEventListener('pointerleave', schedulePanelHide);
  controls.panel.addEventListener('pointermove', schedulePanelHide);
  controls.panel.addEventListener('input', schedulePanelHide);
  controls.panel.addEventListener('click', schedulePanelHide);

  controls.volume.addEventListener('input', () => {
    boosterSettings.volume = Number(controls.volume.value);
    boosterSettings.enabled = boosterSettings.volume > 100;
    syncControls();
    applyBoosterSettings(true);
  });

  controls.volume.addEventListener('change', () => {
    applyBoosterSettings(true);
  });

  controls.speedDown.addEventListener('click', () => {
    playerSettings.speed = clampSpeed(playerSettings.speed - SPEED_STEP);
    playerSettings.speedEnabled = playerSettings.speed !== 1;
    applyPlayerSettings(true);
  });

  controls.speedUp.addEventListener('click', () => {
    playerSettings.speed = clampSpeed(playerSettings.speed + SPEED_STEP);
    playerSettings.speedEnabled = playerSettings.speed !== 1;
    applyPlayerSettings(true);
  });

  controls.speedPresets.forEach((button) => {
    button.addEventListener('click', () => {
      playerSettings.speed = clampSpeed(Number(button.dataset.speed));
      playerSettings.speedEnabled = playerSettings.speed !== 1;
      applyPlayerSettings(true);
    });
  });

  controls.loopStart.addEventListener('click', () => {
    if (!activeMedia) return;
    playerSettings.loopStart = Number(activeMedia.currentTime.toFixed(2));
    playerSettings.loop = true;
    applyPlayerSettings(true);
  });

  controls.loopEnd.addEventListener('click', () => {
    if (!activeMedia) return;
    playerSettings.loopEnd = Number(activeMedia.currentTime.toFixed(2));
    playerSettings.loop = true;
    applyPlayerSettings(true);
  });

  controls.loopClear.addEventListener('click', () => {
    playerSettings.loopStart = null;
    playerSettings.loopEnd = null;
    applyPlayerSettings(true);
  });

  controls.reset.addEventListener('click', () => {
    boosterSettings = { ...boosterSettings, enabled: false, volume: 100 };
    playerSettings = { ...PLAYER_DEFAULTS };
    applyPlayerSettings(true);
    applyBoosterSettings(true);
  });
}

function placeControls() {
  if (!controls || !activeMedia) return;

  const youtubeVolumeArea = document.querySelector('.html5-video-player .ytp-volume-area');
  const youtubeControls = youtubeVolumeArea?.parentElement
    || document.querySelector('.html5-video-player .ytp-left-controls')
    || document.querySelector('.html5-video-player .ytp-right-controls');

  if (youtubeControls) {
    if (controls.host.parentElement === youtubeControls && controls.host.style.position === 'relative') {
      controls.host.hidden = false;
      if (!controls.panel.hidden) positionPanel();
      return;
    }

    controls.host.style.position = 'relative';
    controls.host.style.left = '';
    controls.host.style.bottom = '';
    controls.host.style.transform = '';
    controls.host.style.display = 'inline-flex';
    controls.host.className = 'ytp-inline-controls';
    controls.host.style.cssFloat = 'left';
    controls.host.style.float = 'left';
    controls.host.style.flex = '0 0 auto';
    controls.host.style.height = '36px';
    controls.host.style.minWidth = '168px';
    controls.host.style.width = 'auto';
    controls.host.style.overflow = 'visible';
    if (youtubeVolumeArea) {
      youtubeVolumeArea.insertAdjacentElement('afterend', controls.host);
    } else {
      youtubeControls.append(controls.host);
    }
    if (!controls.panel.hidden) positionPanel();
    return;
  }

  const rect = activeMedia.getBoundingClientRect();
  controls.host.className = '';
  controls.host.style.position = 'fixed';
  controls.host.style.display = 'block';
  controls.host.style.left = `${clamp(rect.right - 58, 12, window.innerWidth - 64)}px`;
  controls.host.style.bottom = `${Math.max(18, window.innerHeight - rect.bottom + 14)}px`;
  controls.host.style.transform = '';
  if (!controls.panel.hidden) positionPanel();
}

function positionPanel() {
  if (!controls) return;

  const triggerRect = controls.trigger.getBoundingClientRect();
  const panelWidth = 292;
  const panelHeight = 238;
  const left = clamp(triggerRect.left + triggerRect.width / 2 - panelWidth / 2, 8, window.innerWidth - panelWidth - 8);
  const top = clamp(triggerRect.top - panelHeight - 34, 8, window.innerHeight - panelHeight - 8);

  controls.panel.style.left = `${left}px`;
  controls.panel.style.top = `${top}px`;
}

function schedulePanelHide() {
  clearPanelHide();
  panelHideTimer = window.setTimeout(hidePanel, 3200);
}

function clearPanelHide() {
  window.clearTimeout(panelHideTimer);
  panelHideTimer = null;
}

function hidePanel() {
  if (!controls) return;
  controls.panel.hidden = true;
  controls.trigger.setAttribute('aria-expanded', 'false');
  clearPanelHide();
}

function applyPlayerSettings(shouldPersist = true) {
  if (activeMedia) activeMedia.playbackRate = playerSettings.speedEnabled ? playerSettings.speed : 1;
  applyLoopSettings();
  syncControls();
  if (shouldPersist) queueSaveSettings();
}

function applyLoopSettings() {
  if (!activeMedia) return;
  activeMedia.loop = Boolean(playerSettings.loop && !hasSectionLoop());
}

function handleMediaTimeUpdate(event) {
  if (event.target !== activeMedia || !playerSettings.loop || !hasSectionLoop()) return;

  const start = Number(playerSettings.loopStart) || 0;
  const end = Number(playerSettings.loopEnd);
  if (Number.isFinite(end) && activeMedia.currentTime >= end) {
    activeMedia.currentTime = Math.min(start, Math.max(0, activeMedia.duration || start));
    activeMedia.play().catch(() => undefined);
  }
}

function hasSectionLoop() {
  return Number.isFinite(Number(playerSettings.loopStart))
    && Number.isFinite(Number(playerSettings.loopEnd))
    && Number(playerSettings.loopEnd) > Number(playerSettings.loopStart);
}

async function applyBoosterSettings(shouldPersist = true) {
  if (boosterApplying) {
    boosterApplyQueued = true;
    return;
  }

  boosterApplying = true;
  syncControls();
  if (shouldPersist) await persistGlobalBoosterSettings();

  try {
    const response = await chrome.runtime.sendMessage({
      type: boosterSettings.enabled ? 'START_OR_UPDATE_AUDIO' : 'STOP_AUDIO',
      settings: withoutRuntimeFields(boosterSettings)
    });

    if (response?.ok === false) throw new Error(response.message);
  } catch {
    // Chrome may reject tab capture if the page is not eligible or the user gesture is not accepted.
  } finally {
    boosterApplying = false;
    if (boosterApplyQueued) {
      boosterApplyQueued = false;
      applyBoosterSettings(shouldPersist);
    }
  }
}

function syncControls() {
  if (!controls) return;

  controls.volume.value = String(boosterSettings.volume);
  controls.volumeValue.textContent = `${boosterSettings.volume}%`;
  controls.speedValue.textContent = playerSettings.speedEnabled ? `${formatSpeed(playerSettings.speed)}x` : 'Off';
  controls.speedToggle.setAttribute('aria-pressed', String(Boolean(playerSettings.speedEnabled)));
  controls.speedToggle.textContent = playerSettings.speedEnabled ? `Speed ${formatSpeed(playerSettings.speed)}x` : 'Speed Off';
  controls.loopToggle.setAttribute('aria-pressed', String(Boolean(playerSettings.loop)));
  controls.loopToggle.textContent = playerSettings.loop ? 'Loop On' : 'Loop';
  controls.loopStart.textContent = playerSettings.loopStart === null ? 'Set A' : `A ${formatTime(playerSettings.loopStart)}`;
  controls.loopEnd.textContent = playerSettings.loopEnd === null ? 'Set B' : `B ${formatTime(playerSettings.loopEnd)}`;
  controls.trigger.textContent = boosterSettings.enabled
    ? `${boosterSettings.volume}%`
    : `VB ${formatSpeed(playerSettings.speed)}x`;
  if (!controls.panel.hidden) positionPanel();
}

async function loadSettings() {
  const host = location.hostname;
  if (!host) {
    return {
      playerSettings: { ...PLAYER_DEFAULTS },
      globalControlsEnabled: true
    };
  }

  try {
    const stored = await chrome.storage.local.get([STORAGE_KEY, GLOBAL_CONTROLS_KEY, GLOBAL_PLAYER_SETTINGS_KEY]);
    const globalControls = stored[GLOBAL_CONTROLS_KEY] !== false;
    return {
      playerSettings: normalizePlayerSettings(globalControls ? stored[GLOBAL_PLAYER_SETTINGS_KEY] : stored[STORAGE_KEY]?.[host]),
      globalControlsEnabled: globalControls
    };
  } catch {
    return {
      playerSettings: { ...PLAYER_DEFAULTS },
      globalControlsEnabled: true
    };
  }
}

function queueSaveSettings() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveSettings, 200);
}

async function saveSettings() {
  const host = location.hostname;
  if (!host) return;

  if (globalControlsEnabled) {
    await chrome.storage.local.set({ [GLOBAL_PLAYER_SETTINGS_KEY]: playerSettings });
    return;
  }

  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const allSettings = stored[STORAGE_KEY] || {};
  allSettings[host] = playerSettings;
  await chrome.storage.local.set({ [STORAGE_KEY]: allSettings });
}

async function persistGlobalBoosterSettings() {
  if (!globalControlsEnabled) return;
  await chrome.storage.local.set({ [GLOBAL_BOOSTER_SETTINGS_KEY]: withoutRuntimeFields(boosterSettings) });
}

function hideControls() {
  if (!controls) return;
  hidePanel();
  controls.host.hidden = true;
}

function normalizePlayerSettings(value = {}) {
  const speed = Number(value.speed);
  const loopStart = Number(value.loopStart);
  const loopEnd = Number(value.loopEnd);
  return {
    speed: Number.isFinite(speed) ? clampSpeed(speed) : PLAYER_DEFAULTS.speed,
    speedEnabled: Boolean(value.speedEnabled),
    loop: Boolean(value.loop),
    loopStart: Number.isFinite(loopStart) ? Math.max(0, loopStart) : null,
    loopEnd: Number.isFinite(loopEnd) ? Math.max(0, loopEnd) : null
  };
}

function normalizeBoosterSettings(value = {}) {
  const eq = value.eq || {};
  return {
    enabled: Boolean(value.enabled),
    volume: clamp(Number(value.volume) || DEFAULT_BOOSTER_SETTINGS.volume, MIN_VOLUME, MAX_VOLUME),
    bassBoost: Boolean(value.bassBoost),
    limiter: value.limiter !== false,
    eq: {
      bass: clamp(Number(eq.bass) || 0, -12, 12),
      mid: clamp(Number(eq.mid) || 0, -12, 12),
      treble: clamp(Number(eq.treble) || 0, -12, 12)
    }
  };
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

function clampSpeed(value) {
  return clamp(Number(value.toFixed(2)), MIN_SPEED, MAX_SPEED);
}

function formatSpeed(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
}

function formatTime(value) {
  const seconds = Math.floor(Number(value) || 0);
  const minutes = Math.floor(seconds / 60);
  const remainder = String(seconds % 60).padStart(2, '0');
  return `${minutes}:${remainder}`;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

window.addEventListener('scroll', placeControls, { passive: true });
window.addEventListener('resize', placeControls);
