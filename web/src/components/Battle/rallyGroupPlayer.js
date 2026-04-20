// rallyGroupPlayer.js — Rally Group Sync 전용 TTS 스케줄러
// 3-2-1 프리카운트 + 각 집결장 순번("captain_N") 음성을 절대시각 기반으로 재생.
// countdownPlayer.js와 동일 설계(슬롯 독립 setTimeout + AudioBuffer 캐시)를 재사용.

import { ttsUrl } from './tts';

let ctx = null;
let masterGain = null;

const bufferCache = new Map();
const activeSources = new Set();
const activeTimeouts = new Set();
let latestScheduleId = 0;

function ensureContext() {
  if (ctx) return ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  try {
    ctx = new Ctx();
  } catch {
    return null;
  }
  masterGain = ctx.createGain();
  masterGain.gain.value = 0.3;
  masterGain.connect(ctx.destination);
  return ctx;
}

function loadBuffer(lang, key) {
  const cacheKey = `${lang}:${key}`;
  const cached = bufferCache.get(cacheKey);
  if (cached) return cached;
  const c = ensureContext();
  if (!c) return Promise.resolve(null);

  const promise = (async () => {
    try {
      const resp = await fetch(ttsUrl(lang, key), { cache: 'no-cache', credentials: 'same-origin' });
      if (!resp.ok) throw new Error('fetch status ' + resp.status);
      const arrBuf = await resp.arrayBuffer();
      const audioBuf = await c.decodeAudioData(arrBuf);
      bufferCache.set(cacheKey, audioBuf);
      return audioBuf;
    } catch (e) {
      bufferCache.delete(cacheKey);
      if (import.meta.env.DEV) {
        console.warn('[RallyGroupPlayer] loadBuffer fail', lang, key, e.message);
      }
      return null;
    }
  })();
  bufferCache.set(cacheKey, promise);
  return promise;
}

export async function primeRallyAudio(fireOffsets, lang = 'ko') {
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch { /* noop */ }
  }
  try {
    const silent = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = silent;
    src.connect(c.destination);
    src.start(0);
  } catch { /* noop */ }

  const keys = ['3', '2', '1', ...(fireOffsets ?? []).map((f) => `captain_${f.orderIndex}`)];
  await Promise.all(keys.map((k) => loadBuffer(lang, k)));
}

/**
 * 집결 그룹 카운트다운 재생.
 * @param {{startedAtServerMs:number, fireOffsets:Array<{orderIndex:number,offsetMs:number,userId:number}>,
 *          timeOffset:number, lang?:string, volume:number, muted:boolean}} params
 */
export function scheduleRallyCountdown({ startedAtServerMs, fireOffsets, timeOffset = 0, lang = 'ko', volume, muted }) {
  const c = ensureContext();
  if (!c) return;
  if (!startedAtServerMs || !Array.isArray(fireOffsets)) return;

  stopRallyCountdown();
  const myId = ++latestScheduleId;
  setRallyVolume(volume, muted);

  if (c.state === 'suspended') c.resume().catch(() => { /* noop */ });

  // 프리로드 — 백그라운드
  const preKeys = ['3', '2', '1'];
  for (const k of preKeys) loadBuffer(lang, k);
  for (const f of fireOffsets) loadBuffer(lang, `captain_${f.orderIndex}`);

  const serverNow = Date.now() + timeOffset;

  // 프리카운트: T-3, T-2, T-1
  for (const n of [3, 2, 1]) {
    const playAt = startedAtServerMs - n * 1000;
    scheduleSlot(playAt - serverNow, String(n), lang, myId);
  }
  // 집결장 순번 발화
  for (const f of fireOffsets) {
    const playAt = startedAtServerMs + f.offsetMs;
    scheduleSlot(playAt - serverNow, `captain_${f.orderIndex}`, lang, myId);
  }
}

function scheduleSlot(delayMs, key, lang, myId) {
  if (delayMs < -200) return;
  const fireAt = Math.max(0, delayMs);
  const timeoutId = window.setTimeout(() => {
    activeTimeouts.delete(timeoutId);
    if (myId !== latestScheduleId) return;
    dispatchSlot(lang, key, myId);
  }, fireAt);
  activeTimeouts.add(timeoutId);
}

function dispatchSlot(lang, key, myId) {
  const entry = bufferCache.get(`${lang}:${key}`);
  if (entry && typeof entry === 'object' && 'numberOfChannels' in entry) {
    playNow(entry);
    return;
  }
  if (entry && typeof entry.then === 'function') {
    entry.then((buf) => {
      if (myId !== latestScheduleId) return;
      if (buf) playNow(buf);
    });
    return;
  }
  loadBuffer(lang, key).then((buf) => {
    if (myId !== latestScheduleId) return;
    if (buf) playNow(buf);
  });
}

function playNow(buffer) {
  if (!ctx || !masterGain) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(masterGain);
  src.onended = () => { activeSources.delete(src); };
  try {
    src.start(0);
    activeSources.add(src);
  } catch { /* noop */ }
}

export function stopRallyCountdown() {
  latestScheduleId++;
  for (const id of activeTimeouts) {
    try { clearTimeout(id); } catch { /* noop */ }
  }
  activeTimeouts.clear();
  for (const src of activeSources) {
    try { src.stop(); } catch { /* already stopped */ }
    try { src.disconnect(); } catch { /* noop */ }
  }
  activeSources.clear();
}

export function setRallyVolume(volume, muted) {
  if (!masterGain || !ctx) return;
  const v = (typeof volume === 'number' && Number.isFinite(volume))
    ? Math.max(0, Math.min(1, volume))
    : 0.3;
  const target = muted ? 0 : v;
  try {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
  } catch {
    masterGain.gain.value = target;
  }
}
