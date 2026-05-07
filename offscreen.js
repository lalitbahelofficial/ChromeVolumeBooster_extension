// #Lalittesting
const DEFAULT_SETTINGS = {
  enabled: false,
  volume: 100,
  bassBoost: false,
  limiter: true,
  eq: { bass: 0, mid: 0, treble: 0 }
};

const audioSessions = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => sendResponse({ ok: false, message: error.message }));
  return true;
});

async function handleMessage(message) {
  if (message.type === 'OFFSCREEN_START_AUDIO') {
    await startAudio(message.tabId, message.streamId, normalizeSettings(message.settings));
    return { ok: true };
  }

  if (message.type === 'OFFSCREEN_UPDATE_AUDIO') {
    return updateAudio(message.tabId, normalizeSettings(message.settings));
  }

  if (message.type === 'OFFSCREEN_STOP_AUDIO') {
    stopAudio(message.tabId);
    return { ok: true };
  }

  return { ok: false };
}

async function startAudio(tabId, streamId, settings) {
  stopAudio(tabId);

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'tab',
        chromeMediaSourceId: streamId
      }
    },
    video: false
  });

  const audioContext = new AudioContext();
  const source = audioContext.createMediaStreamSource(stream);
  const bassFilter = createBiquad(audioContext, 'lowshelf', 120);
  const midFilter = createBiquad(audioContext, 'peaking', 1000, 1);
  const trebleFilter = createBiquad(audioContext, 'highshelf', 6000);
  const compressor = audioContext.createDynamicsCompressor();
  const gain = audioContext.createGain();

  compressor.threshold.value = -9;
  compressor.knee.value = 18;
  compressor.ratio.value = 12;
  compressor.attack.value = 0.003;
  compressor.release.value = 0.25;

  source.connect(bassFilter);
  bassFilter.connect(midFilter);
  midFilter.connect(trebleFilter);
  trebleFilter.connect(compressor);
  compressor.connect(gain);
  gain.connect(audioContext.destination);

  const session = {
    audioContext,
    bassFilter,
    compressor,
    gain,
    midFilter,
    settings,
    source,
    stopping: false,
    stream,
    streamId,
    trebleFilter
  };

  stream.getTracks().forEach((track) => {
    track.addEventListener('ended', () => handleStreamEnded(tabId, session), { once: true });
  });

  audioSessions.set(tabId, session);
  applySettings(session, settings);
}

function updateAudio(tabId, settings) {
  const session = audioSessions.get(tabId);

  if (!session) {
    return { ok: false, message: 'No active audio session for this tab.' };
  }

  applySettings(session, settings);
  return { ok: true };
}

function applySettings(session, settings) {
  session.settings = settings;
  const boostGain = settings.enabled ? settings.volume / 100 : 1;
  const bassBoostGain = settings.bassBoost ? 6 : 0;

  session.gain.gain.setTargetAtTime(boostGain, session.audioContext.currentTime, 0.015);
  session.bassFilter.gain.setTargetAtTime(settings.eq.bass + bassBoostGain, session.audioContext.currentTime, 0.015);
  session.midFilter.gain.setTargetAtTime(settings.eq.mid, session.audioContext.currentTime, 0.015);
  session.trebleFilter.gain.setTargetAtTime(settings.eq.treble, session.audioContext.currentTime, 0.015);

  if (settings.limiter) {
    session.compressor.threshold.setTargetAtTime(-9, session.audioContext.currentTime, 0.015);
    session.compressor.ratio.setTargetAtTime(12, session.audioContext.currentTime, 0.015);
  } else {
    session.compressor.threshold.setTargetAtTime(0, session.audioContext.currentTime, 0.015);
    session.compressor.ratio.setTargetAtTime(1, session.audioContext.currentTime, 0.015);
  }
}

function stopAudio(tabId) {
  const session = audioSessions.get(tabId);
  if (!session) return;

  session.stopping = true;
  session.stream.getTracks().forEach((track) => track.stop());
  session.source.disconnect();
  session.bassFilter.disconnect();
  session.midFilter.disconnect();
  session.trebleFilter.disconnect();
  session.compressor.disconnect();
  session.gain.disconnect();
  session.audioContext.close();
  audioSessions.delete(tabId);
}

function handleStreamEnded(tabId, session) {
  if (session.stopping || audioSessions.get(tabId) !== session) return;

  stopAudio(tabId);
  chrome.runtime.sendMessage({ type: 'OFFSCREEN_AUDIO_ENDED', tabId }).catch(() => undefined);
}

function createBiquad(audioContext, type, frequency, q = null) {
  const filter = audioContext.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  if (q !== null) filter.Q.value = q;
  return filter;
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
