const OFFSCREEN_DOCUMENT_PATH = 'offscreen.html';
const DEFAULT_SETTINGS = {
  enabled: false,
  volume: 100,
  bassBoost: false,
  limiter: true,
  eq: { bass: 0, mid: 0, treble: 0 }
};

const tabSettings = new Map();
codex/create-chrome-volume-booster-extension-jcxbpt
const capturedTabs = new Set();

main
let creatingOffscreenDocument = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, message: error.message }));
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  tabSettings.delete(tabId);
codex/create-chrome-volume-booster-extension-jcxbpt
  capturedTabs.delete(tabId);

main
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_AUDIO', tabId }).catch(() => undefined);
});

async function handleMessage(message) {
  if (message.type === 'GET_TAB_STATE') {
    return {
      ok: true,
      settings: tabSettings.get(message.tabId) || null
    };
  }

  if (message.type === 'START_OR_UPDATE_AUDIO') {
    const tabId = Number(message.tabId);
    const settings = normalizeSettings(message.settings);
    tabSettings.set(tabId, settings);
    await ensureOffscreenDocument();

 codex/create-chrome-volume-booster-extension-jcxbpt
    if (capturedTabs.has(tabId)) {
      const updateResponse = await chrome.runtime.sendMessage({
        type: 'OFFSCREEN_UPDATE_AUDIO',
        tabId,
        settings
      });

      if (updateResponse?.ok) {
        return { ok: true, message: `Boosting this tab at ${settings.volume}%.` };
      }

      capturedTabs.delete(tabId);
    }

    const streamId = await getStreamId(tabId);
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START_AUDIO',

    const streamId = await getStreamId(tabId);
    await chrome.runtime.sendMessage({
      type: 'OFFSCREEN_START_OR_UPDATE_AUDIO',
 main
      tabId,
      streamId,
      settings
    });
codex/create-chrome-volume-booster-extension-jcxbpt
    capturedTabs.add(tabId);

 main

    return { ok: true, message: `Boosting this tab at ${settings.volume}%.` };
  }

  if (message.type === 'STOP_AUDIO') {
    const tabId = Number(message.tabId);
    tabSettings.set(tabId, normalizeSettings({ ...message.settings, enabled: false }));
codex/create-chrome-volume-booster-extension-jcxbpt
    capturedTabs.delete(tabId);
main
    await chrome.runtime.sendMessage({ type: 'OFFSCREEN_STOP_AUDIO', tabId }).catch(() => undefined);
    return { ok: true, message: 'Volume booster is off.' };
  }

  return { ok: false, message: 'Unknown extension message.' };
}

async function ensureOffscreenDocument() {
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_DOCUMENT_PATH);
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [offscreenUrl]
  });

  if (contexts.length > 0) return;

  if (!creatingOffscreenDocument) {
    creatingOffscreenDocument = chrome.offscreen.createDocument({
      url: OFFSCREEN_DOCUMENT_PATH,
      reasons: ['USER_MEDIA'],
      justification: 'Process and play captured tab audio for the current-tab volume booster.'
    });
  }

  await creatingOffscreenDocument;
  creatingOffscreenDocument = null;
}

function getStreamId(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabCapture.getMediaStreamId({ targetTabId: tabId }, (streamId) => {
      if (chrome.runtime.lastError || !streamId) {
        reject(new Error(chrome.runtime.lastError?.message || 'Could not capture this tab audio.'));
        return;
      }
      resolve(streamId);
    });
  });
}

function normalizeSettings(settings = {}) {
  const eq = settings.eq || {};
  return {
    enabled: Boolean(settings.enabled),
    volume: clamp(Number(settings.volume) || DEFAULT_SETTINGS.volume, 100, 500),
    bassBoost: Boolean(settings.bassBoost),
    limiter: settings.limiter !== false,
    eq: {
      bass: clamp(Number(eq.bass) || 0, -12, 12),
      mid: clamp(Number(eq.mid) || 0, -12, 12),
      treble: clamp(Number(eq.treble) || 0, -12, 12)
    }
  };
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
