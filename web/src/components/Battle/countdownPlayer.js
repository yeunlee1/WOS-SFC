// countdownPlayer.js — Web Audio API 기반 카운트다운 TTS 재생기 (슬롯 독립 스케줄)
//
// 설계:
//   각 숫자 슬롯을 독립된 setTimeout으로 스케줄한다. 버퍼 로딩은 백그라운드에서
//   병렬로 진행하며 스케줄링을 블로킹하지 않는다. 타임아웃 콜백 시점에 버퍼가
//   준비돼 있으면 즉시 playNow, 아직 로딩 중이면 완료 후 즉시 재생한다.
//
// 왜 이 설계인가 — 과거 "30초 시작했는데 20부터 센다" 버그의 근본 원인:
//   이전 구현은 scheduleCountdown 내부에서 `await Promise.all(keys.map(loadBuffer))`로
//   모든 버퍼 디코딩을 기다린 뒤 스케줄을 실행했다. 캐시가 콜드일 때 await가 수 초
//   걸리면 그 사이 serverNow가 앞서나가 첫 N개 슬롯은 `delayMs < 0`으로 스킵됐다.
//   슬롯별 독립 스케줄로 전환하면 스케줄은 즉시 완료되고, 버퍼가 늦게 도착해도
//   각자의 시각에 맞춰 재생된다.
//
// Web Audio API를 고수하는 이유:
//   HTMLAudioElement의 (1) play() Promise silent reject, (2) 동시 재생 리소스 한계,
//   (3) 실제 출력 검증 불가 문제를 회피. AnalyserNode로 귀 없는 감독관도 RMS
//   측정으로 누락 탐지 가능.
//
// 공개 API:
//   primeCountdownAudio(keys, lang)     — 버퍼 프리로드 + AudioContext 언락
//   scheduleCountdown({...})            — 카운트다운 예약 재생
//   stopCountdownAudio()                — 예약된 모든 재생 정지
//   setCountdownVolume(volume, muted)   — 볼륨/뮤트 실시간 반영

import { ttsUrl } from './tts';
import { perceptualVolume } from '../../utils/volume';

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
  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  masterGain.connect(analyser);
  analyser.connect(ctx.destination);
  if (import.meta.env.DEV) {
    window.__ttsAnalyser = analyser;
    window.__ttsDispatched = dispatchedCount;
    window.__ttsSchedule = scheduleLog;
    window.__ttsDispatchedLog = dispatchedLog;
    window.__ttsCtx = ctx;
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
        console.warn('[CountdownPlayer] loadBuffer fail', lang, key, e.message);
      }
      return null;
    }
  })();
  bufferCache.set(cacheKey, promise);
  return promise;
}

/**
 * AudioContext 언락 + 필요 버퍼 프리로드. 사용자 제스처에서 호출.
 * @param {Array<number|string>} keys
 * @param {string} lang
 */
export async function primeCountdownAudio(keys, lang = 'ko') {
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

  await Promise.all(keys.map((k) => loadBuffer(lang, k)));
}

/**
 * 카운트다운 TTS 예약 — 슬롯별 독립 setTimeout.
 * startedAt(서버 시각, ms) + (totalSeconds - n)*1000 시각에 각 숫자 n을 재생.
 *
 * 버퍼 로딩은 백그라운드에서 진행되며 스케줄 완료를 블로킹하지 않는다.
 * 타임아웃 콜백 시점에 버퍼가 준비되지 않았다면 완료 후 즉시 재생한다
 * (약간 늦을 수 있지만 누락보다는 낫다).
 *
 * @param {{totalSeconds:number, startedAt:number, timeOffset:number, lang?:string, volume:number, muted:boolean}} params
 */
export async function scheduleCountdown({ totalSeconds, startedAt, timeOffset, lang = 'ko', volume, muted }) {
  const c = ensureContext();
  if (!c) return;
  if (!startedAt || !totalSeconds) return;
  // totalSeconds < 2 이면 재생할 슬롯이 없음 (firstSlot = totalSeconds - 1 = 0)
  // 가드 없으면 loadBuffer(lang, 0) → /tts-audio/ko/0 404 발생
  if (totalSeconds < 2) return;

  stopCountdownAudio();  // 기존 스케줄 정리 (latestScheduleId는 stop 내에서 증가)
  const myId = ++latestScheduleId;
  setCountdownVolume(volume, muted);

  if (c.state === 'suspended') {
    c.resume().catch(() => { /* noop */ });
  }

  dispatchedCount.value = 0;
  scheduleLog.items = [];
  dispatchedLog.length = 0;

  // 첫 슬롯 버퍼 워밍업 — 최대 500ms.
  // 첫 슬롯은 fireAt ≈ 0ms(= "totalSeconds" 숫자) 에 발화되므로, 이 구간 안에 버퍼가
  // 도착하지 않으면 setTimeout 콜백에서 .then 대기 동안 발화가 밀린다.
  // Promise.race 로 워밍업하되 500ms 초과 시 즉시 스케줄링으로 진행해 "20부터 센다"
  // 류의 전체 블로킹 버그 재발을 방지한다. 동시에 남은 모든 키의 로드도
  // 백그라운드로 시작해 후속 슬롯 준비를 앞당긴다.
  //
  // 루프 시작값 = totalSeconds (첫 숫자) : 30초 카운트다운이면 "30"부터 읽어야
  // 사용자 기대와 일치. 과거 구현(n = totalSeconds - 1)은 "30"을 누락하고
  // "29"부터 시작해, 동시 호출되는 speak('start')의 "준비해주세요"(1.3초)와
  // 1초 후의 "29"가 겹쳐 "이십N부터 센다"로 들리는 원인.
  const firstSlot = totalSeconds;
  for (let n = totalSeconds; n >= 1; n--) loadBuffer(lang, n);
  await Promise.race([
    loadBuffer(lang, firstSlot),
    new Promise((r) => setTimeout(r, 500)),
  ]);
  if (myId !== latestScheduleId) return;

  // 버퍼 워밍업 후 시점으로 serverNow 재계산 → whenCtx 정확도 확보
  const serverNow = Date.now() + timeOffset;
  let scheduled = 0;
  let skippedPastDue = 0;

  for (let n = totalSeconds; n >= 1; n--) {
    const playServerTime = startedAt + (totalSeconds - n) * 1000;
    const delayMs = playServerTime - serverNow;

    // 200ms 이상 과거 — 진짜로 놓쳤으므로 스킵. 그보다 작은 음수는 즉시 재생 시도.
    if (delayMs < -200) {
      skippedPastDue++;
      continue;
    }

    const fireAt = Math.max(0, delayMs);
    scheduleLog.items.push({ n, playServerTime, delayMs: Math.round(delayMs), fireAt });

    const timeoutId = window.setTimeout(() => {
      activeTimeouts.delete(timeoutId);
      if (myId !== latestScheduleId) return;
      dispatchSlot(lang, n, myId);
    }, fireAt);
    activeTimeouts.add(timeoutId);
    scheduled++;
  }

  if (import.meta.env.DEV) {
    console.info('[CountdownPlayer] scheduled', { totalSeconds, scheduled, skippedPastDue });
  }
}

function dispatchSlot(lang, n, myId) {
  const entry = bufferCache.get(`${lang}:${n}`);
  if (entry && typeof entry === 'object' && 'numberOfChannels' in entry) {
    // 이미 디코드된 AudioBuffer
    playNow(entry, n);
    return;
  }
  if (entry && typeof entry.then === 'function') {
    // 아직 로딩 중 — 완료되면 즉시 재생
    entry.then((buf) => {
      if (myId !== latestScheduleId) return;
      if (buf) playNow(buf, n);
      else if (import.meta.env.DEV) console.warn('[CountdownPlayer] slot buf null', n);
    });
    return;
  }
  // 캐시에 없음 — 지금이라도 로드 시도
  loadBuffer(lang, n).then((buf) => {
    if (myId !== latestScheduleId) return;
    if (buf) playNow(buf, n);
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
    if (import.meta.env.DEV) console.warn('[CountdownPlayer] playNow fail', label, e.message);
  }
}

export function stopCountdownAudio() {
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

export function setCountdownVolume(volume, muted) {
  if (!masterGain || !ctx) return;
  const linear = (typeof volume === 'number' && Number.isFinite(volume)) ? volume : 0.3;
  const target = muted ? 0 : perceptualVolume(linear);
  try {
    masterGain.gain.cancelScheduledValues(ctx.currentTime);
    masterGain.gain.setTargetAtTime(target, ctx.currentTime, 0.01);
  } catch {
    masterGain.gain.value = target;
  }
}

// 앱 전반의 사용자 제스처로도 언락
if (typeof document !== 'undefined') {
  const unlock = () => {
    const c = ensureContext();
    if (c && c.state === 'suspended') c.resume().catch(() => { /* noop */ });
  };
  document.addEventListener('click', unlock, { passive: true });
  document.addEventListener('keydown', unlock, { passive: true });
  document.addEventListener('touchstart', unlock, { passive: true });
}
