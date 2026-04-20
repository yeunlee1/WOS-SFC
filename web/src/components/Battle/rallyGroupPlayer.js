// rallyGroupPlayer.js — Rally Group Sync 전용 TTS 스케줄러
//
// 설계(countdownPlayer.js와 동일한 파이프라인):
//   각 발화 슬롯을 독립된 setTimeout으로 스케줄한다. 버퍼 로딩은 백그라운드에서
//   병렬로 진행하며 스케줄링을 블로킹하지 않는다. 타임아웃 콜백 시점에 버퍼가
//   준비돼 있으면 즉시 playNow, 아직 로딩 중이면 완료 후 즉시 재생한다.
//
// countdownPlayer와의 차이:
//   숫자 연속 카운팅(1 ~ maxOffsetSec) + captain_N 혼합 스케줄.
//   captainSeconds에 해당하는 초는 숫자 대신 captain_N 발화로 대체.
//   첫 슬롯 워밍업 대상은 가장 일찍 발화할 슬롯("3" 프리카운트).
//
// 공개 API:
//   primeRallyAudio(fireOffsets, lang)
//   scheduleRallyCountdown({startedAtServerMs, fireOffsets, timeOffset, lang, volume, muted})
//   stopRallyCountdown()
//   setRallyVolume(volume, muted)

import { ttsUrl } from './tts';

let ctx = null;
let masterGain = null;
let analyser = null;

// Map<"lang:key", AudioBuffer | Promise<AudioBuffer|null>>
const bufferCache = new Map();

// 재생 중인 SourceNode 추적 (stop 시 일괄 중단)
const activeSources = new Set();

// 예약된 setTimeout id 추적 (stop 시 일괄 취소)
const activeTimeouts = new Set();

// 스케줄 호출 식별자 — 늦게 도착한 버퍼 완료 콜백이 이전 스케줄의 결과를 재생하는 것 방지
let latestScheduleId = 0;

// DEV 감독관용 텔레메트리
const dispatchedCount = { value: 0 };
const scheduleLog = { items: [] };
const dispatchedLog = [];

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
  // countdownPlayer와 동일한 AnalyserNode 체인: masterGain → analyser → destination
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);
  if (import.meta.env.DEV) {
    window.__rallyAnalyser = analyser;
    window.__rallyDispatchedCount = dispatchedCount;
    window.__rallyDispatchedLog = dispatchedLog;
    window.__rallyScheduleLog = scheduleLog;
    window.__rallyCtx = ctx;
  }
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

/**
 * AudioContext 언락 + 필요 버퍼 프리로드. 사용자 제스처에서 호출.
 * @param {Array<{orderIndex:number, offsetMs:number}>} fireOffsets
 * @param {string} lang
 */
export async function primeRallyAudio(fireOffsets, lang = 'ko') {
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch { /* noop */ }
  }
  // iOS Safari 언락: 무음 버퍼 1회 재생
  try {
    const silent = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = silent;
    src.connect(c.destination);
    src.start(0);
  } catch { /* noop */ }

  // 초당 카운팅에 필요한 숫자 키 계산
  const offsets = fireOffsets ?? [];
  const rawMax = offsets.length > 0
    ? Math.max(...offsets.map((f) => Math.round(f.offsetMs / 1000)))
    : 0;
  const maxOffsetSec = Math.min(rawMax, 180);

  const numberKeys = [];
  if (maxOffsetSec > 0) {
    const captainSeconds = new Set(offsets.map((f) => Math.round(f.offsetMs / 1000)));
    for (let t = 1; t <= maxOffsetSec; t++) {
      if (!captainSeconds.has(t)) {
        numberKeys.push(String(t));
      }
    }
  }

  // 핵심 키(프리카운트 + captain)는 await, 숫자는 백그라운드
  const criticalKeys = ['3', '2', '1', ...offsets.map((f) => `captain_${f.orderIndex}`)];
  await Promise.all(criticalKeys.map((k) => loadBuffer(lang, k)));
  for (const k of numberKeys) loadBuffer(lang, k);
}

/**
 * 집결 그룹 카운트다운 재생.
 * @param {{startedAtServerMs:number, fireOffsets:Array<{orderIndex:number,offsetMs:number,userId:number}>,
 *          timeOffset:number, lang?:string, volume:number, muted:boolean}} params
 */
export async function scheduleRallyCountdown({ startedAtServerMs, fireOffsets, timeOffset = 0, lang = 'ko', volume, muted }) {
  const c = ensureContext();
  if (!c) return;
  if (!startedAtServerMs || !Array.isArray(fireOffsets)) return;

  stopRallyCountdown();  // 기존 스케줄 정리 (latestScheduleId는 stop 내에서 증가)
  const myId = ++latestScheduleId;
  setRallyVolume(volume, muted);

  if (c.state === 'suspended') c.resume().catch(() => { /* noop */ });

  dispatchedCount.value = 0;
  scheduleLog.items = [];
  dispatchedLog.length = 0;

  if (import.meta.env.DEV) {
    window.__rallyDispatchedCount = dispatchedCount;
    window.__rallyDispatchedLog = dispatchedLog;
    window.__rallyScheduleLog = scheduleLog;
  }

  // maxOffsetSec 계산 (TTS 상한 180초로 제한)
  const rawMax = fireOffsets.length > 0
    ? Math.max(...fireOffsets.map((f) => Math.round(f.offsetMs / 1000)))
    : 0;
  if (rawMax > 180 && import.meta.env.DEV) {
    console.warn('[RallyGroupPlayer] maxOffsetSec', rawMax, '> 180, capping at 180');
  }
  const maxOffsetSec = Math.min(rawMax, 180);

  // 집결장 발화 시각 집합 (초 단위, 중복 방지)
  const captainSeconds = new Set(fireOffsets.map((f) => Math.round(f.offsetMs / 1000)));

  // 첫 슬롯 워밍업 — 가장 일찍 발화할 슬롯("3" 프리카운트)을 최대 500ms 기다림.
  // 동시에 나머지 키들도 백그라운드 로드 시작.
  for (const k of ['3', '2', '1']) loadBuffer(lang, k);
  for (const f of fireOffsets) loadBuffer(lang, `captain_${f.orderIndex}`);
  if (maxOffsetSec > 0) {
    for (let t = 1; t <= maxOffsetSec; t++) {
      if (!captainSeconds.has(t)) loadBuffer(lang, String(t));
    }
  }
  await Promise.race([
    loadBuffer(lang, '3'),
    new Promise((r) => setTimeout(r, 500)),
  ]);
  if (myId !== latestScheduleId) return;

  // 워밍업 후 serverNow 재계산 → whenCtx 정확도 확보
  const serverNow = Date.now() + timeOffset;

  // 프리카운트: T-3, T-2, T-1
  for (const n of [3, 2, 1]) {
    const playAt = startedAtServerMs - n * 1000;
    scheduleSlot(playAt - serverNow, String(n), lang, myId);
  }

  // 집결장 순번 발화 (captainSeconds와 겹치는 초를 대체)
  for (const f of fireOffsets) {
    const playAt = startedAtServerMs + f.offsetMs;
    scheduleSlot(playAt - serverNow, `captain_${f.orderIndex}`, lang, myId);
  }

  // 초당 카운팅: t=1 ~ maxOffsetSec, 집결장 발화 초는 skip
  if (maxOffsetSec > 0) {
    for (let t = 1; t <= maxOffsetSec; t++) {
      if (captainSeconds.has(t)) continue; // captain 발화가 해당 초를 대체
      const playAt = startedAtServerMs + t * 1000;
      scheduleSlot(playAt - serverNow, String(t), lang, myId);
    }
  }

  if (import.meta.env.DEV) {
    console.info('[RallyGroupPlayer] scheduled', {
      maxOffsetSec,
      captainCount: fireOffsets.length,
      scheduledSlots: scheduleLog.items.length,
    });
  }
}

function scheduleSlot(delayMs, key, lang, myId) {
  // -200ms 이상 과거 → 진짜로 놓쳤으므로 스킵. 그보다 작은 음수는 즉시 재생 시도.
  if (delayMs < -200) return;
  const fireAt = Math.max(0, delayMs);
  scheduleLog.items.push({ key, delayMs: Math.round(delayMs), fireAt });
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
    // 이미 디코드된 AudioBuffer
    playNow(entry, key);
    return;
  }
  if (entry && typeof entry.then === 'function') {
    // 아직 로딩 중 — 완료되면 즉시 재생
    entry.then((buf) => {
      if (myId !== latestScheduleId) return;
      if (buf) playNow(buf, key);
      else if (import.meta.env.DEV) console.warn('[RallyGroupPlayer] slot buf null', key);
    });
    return;
  }
  // 캐시에 없음 — 지금이라도 로드 시도
  loadBuffer(lang, key).then((buf) => {
    if (myId !== latestScheduleId) return;
    if (buf) playNow(buf, key);
  });
}

function playNow(buffer, label) {
  if (!ctx || !masterGain) return;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(masterGain);
  src.onended = () => { activeSources.delete(src); };
  try {
    src.start(0);
    activeSources.add(src);
    dispatchedCount.value += 1;
    if (import.meta.env.DEV) dispatchedLog.push({ label, at: performance.now() });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[RallyGroupPlayer] playNow fail', label, e.message);
  }
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

// 앱 전반의 사용자 제스처로도 AudioContext 언락
if (typeof document !== 'undefined') {
  const unlock = () => {
    const c = ensureContext();
    if (c && c.state === 'suspended') c.resume().catch(() => { /* noop */ });
  };
  document.addEventListener('click', unlock, { passive: true });
  document.addEventListener('keydown', unlock, { passive: true });
  document.addEventListener('touchstart', unlock, { passive: true });
}
