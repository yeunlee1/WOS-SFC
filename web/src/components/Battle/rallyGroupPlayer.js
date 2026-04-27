// rallyGroupPlayer.js — Rally Group Sync 전용 TTS 스케줄러
//
// 설계(Web Audio 클럭 직접 예약):
//   모든 슬롯을 `src.start(ctxTimeAtPlay)` 절대 시각으로 오디오 스레드에 예약한다.
//   setTimeout 기반 디스패치 체인(setTimeout → dispatchSlot → start(0))을 제거해
//   JS 타이머 드리프트, 탭 백그라운드 throttle, dispatch race를 모두 차단.
//
// 왜 setTimeout을 버렸나:
//   이전 구현은 `setTimeout(..., fireAt)` 콜백에서 `src.start(0)`를 호출했다.
//   이 파이프라인은 3개 레이어(JS 타이머 → JS 실행 → 오디오 재생)를 거치며,
//   각 레이어마다 지연이 누적됐다. captain(1.5초)+숫자(1초 간격) 혼합 시나리오에서
//   드리프트가 누적되면 겹침/스킵으로 불안정 체감을 유발.
//   Web Audio API의 `start(when)`은 오디오 하드웨어 스레드가 샘플 단위로 예약을
//   처리하므로 JS 실행 상태와 독립적이다.
//
// 버퍼 로딩 처리:
//   1) 이미 디코드된 경우 즉시 `src.start(ctxTimeAtPlay)` 예약
//   2) Promise 상태인 경우 `.then`에서 시각 재검사 후 예약
//   3) 미로드 상태인 경우 `loadBuffer` 후 동일 처리
//   세 경우 모두 `ctxTimeAtPlay`가 이미 과거면(> 200ms 지남) skip, 약간 지났으면
//   `Math.max(ctxTimeAtPlay, ctx.currentTime)`로 즉시 재생.
//
// ⚠️ 싱글톤 가정: 이 모듈은 한 번에 하나의 집결 그룹만 스케줄링한다.
//   scheduleRallyCountdown 호출 시 이전 스케줄을 즉시 취소한다.
//   다중 그룹 동시 지원이 필요하면 인스턴스 기반으로 리팩토링 필요.
//
// 공개 API:
//   warmupRallyAudio({lang}) — 로그인 직후 모든 그룹의 captain/rally_start/prep/numeric 사전 디코드
//   primeRallyAudio(fireOffsets, lang) — 특정 그룹 시작 직전 prime
//   scheduleRallyCountdown({startedAtServerMs, fireOffsets, timeOffset, lang, volume, muted})
//   stopRallyCountdown()
//   setRallyVolume(volume, muted)

import { ttsUrl } from './tts';
import { perceptualVolume } from '../../utils/volume';

// 서버 DTO @Max(180) (server/src/rally-groups/dto/update-march-override.dto.ts) 와 일치.
// warmupRallyAudio, primeRallyAudio, scheduleRallyCountdown 모두 이 상수를 상한으로 사용.
const MAX_OFFSET_SEC = 180;

// TTS 서버가 지원하는 언어 목록 (server/src/tts/tts.constants.ts LANGS 와 동기화).
// 비지원 언어(ru, other 등) 사용자는 'ko'로 fallback해 서버 400/404 spam 방지.
const SUPPORTED_TTS_LANGS = new Set(['ko', 'en', 'ja', 'zh']);

let ctx = null;
let masterGain = null;
let analyser = null;

// Map<"lang:key", AudioBuffer | Promise<AudioBuffer|null>>
const bufferCache = new Map();

// 재생 예약/중인 SourceNode 추적 (stop 시 일괄 중단 — 미래 시각 예약도 src.stop()으로 취소 가능)
const activeSources = new Set();

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
    window.__rallyAnalyser = analyser;
    window.__rallyDispatchedCount = dispatchedCount;
    window.__rallyDispatchedLog = dispatchedLog;
    window.__rallyScheduleLog = scheduleLog;
    window.__rallyCtx = ctx;
    Object.defineProperty(window, '__rallyBufferCacheSize', {
      configurable: true,
      get: () => bufferCache.size,
    });
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
 * 로그인 직후 호출되는 광범위 사전 워밍업.
 * 모든 그룹(1~6)의 captain/rally_start, 프리카운트("3","2","1"), 숫자 1~60을 fetch+decode.
 * fire-and-forget 패턴 — 호출자는 await 하지 않아도 background 진행.
 *
 * 첫 카운트다운 시작 시 일부 음성이 누락/지연되는 문제(첫 시작 RMS 낮음, 200ms past-due 가드 hit)
 * 의 근본 원인: bufferCache가 schedulePlay 호출 후에만 채워져 첫 시작에서 fetch+decode 시간이
 * 7s prep 안에 못 들어오는 케이스 발생. 사전에 모든 가능 키를 디코드해 두면 schedulePlay는
 * 즉시 startSource 가능.
 *
 * 워밍업 대상 (총 ~192개, 6KB×192 ≈ 1.15MB — MAX_OFFSET_SEC=180 기준):
 *   - captain_1~6 (6)
 *   - rally_start_1~6 (6)
 *   - prep "3","2","1" (3)
 *   - numeric "4"~"180" (177, prep과 중복 제거)
 *
 * @param {{lang?:string, onProgress?:(p:{loaded:number,total:number})=>void}} [opts]
 */
export async function warmupRallyAudio(opts = {}) {
  const { lang = 'ko', onProgress } = opts;
  const safeLang = SUPPORTED_TTS_LANGS.has(lang) ? lang : 'ko';
  const c = ensureContext();
  if (!c) return;
  if (c.state === 'suspended') {
    try { await c.resume(); } catch { /* noop */ }
  }

  const keys = [];
  for (let i = 1; i <= 6; i++) keys.push(`rally_start_${i}`);
  for (let i = 1; i <= 6; i++) keys.push(`captain_${i}`);
  keys.push('3', '2', '1');
  for (let t = 4; t <= MAX_OFFSET_SEC; t++) keys.push(String(t));

  let loaded = 0;
  const total = keys.length;
  await Promise.all(keys.map(async (k) => {
    await loadBuffer(safeLang, k);
    loaded += 1;
    if (typeof onProgress === 'function') {
      try { onProgress({ loaded, total }); } catch { /* noop */ }
    }
  }));

  if (import.meta.env.DEV) {
    console.info('[RallyGroupPlayer] warmup complete', { lang, safeLang, loaded, cacheSize: bufferCache.size });
  }
}

/**
 * AudioContext 언락 + 필요 버퍼 프리로드. 사용자 제스처에서 호출.
 * @param {Array<{orderIndex:number, offsetMs:number}>} fireOffsets
 * @param {string} lang
 * @param {number} [displayOrder] 그룹 번호 — rally_start_N 안내 음성 프리로드용 (있으면 critical 추가)
 */
export async function primeRallyAudio(fireOffsets, lang = 'ko', displayOrder) {
  const safeLang = SUPPORTED_TTS_LANGS.has(lang) ? lang : 'ko';
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

  const offsets = fireOffsets ?? [];
  const rawMax = offsets.length > 0
    ? Math.max(...offsets.map((f) => Math.round(f.offsetMs / 1000)))
    : 0;
  const maxOffsetSec = Math.min(rawMax, MAX_OFFSET_SEC);

  const numberKeys = [];
  if (maxOffsetSec > 0) {
    const captainSeconds = new Set(offsets.map((f) => Math.round(f.offsetMs / 1000)));
    for (let t = 1; t <= maxOffsetSec; t++) {
      if (!captainSeconds.has(t)) {
        numberKeys.push(String(t));
      }
    }
  }

  // 안내 음성(rally_start_N)은 프리카운트("3")보다 먼저 재생되므로 critical에 포함.
  const criticalKeys = [
    ...(displayOrder ? [`rally_start_${displayOrder}`] : []),
    '3', '2', '1',
    ...offsets.map((f) => `captain_${f.orderIndex}`),
  ];
  await Promise.all(criticalKeys.map((k) => loadBuffer(safeLang, k)));
  for (const k of numberKeys) loadBuffer(safeLang, k);
}

/**
 * 집결 그룹 카운트다운 재생.
 * @param {{startedAtServerMs:number, fireOffsets:Array<{orderIndex:number,offsetMs:number,userId:number}>,
 *          timeOffset:number, lang?:string, volume:number, muted:boolean,
 *          displayOrder?:number}} params
 *   displayOrder — 그룹 1~6. 지정 시 프리카운트 이전(ctxAnchor - 6s)에 "N번 집결그룹
 *   집결 시작합니다" 안내 음성을 예약. 서버측 COUNTDOWN_LEAD_MS(7s)가 이 타이밍을 전제로 설정됨.
 */
export async function scheduleRallyCountdown({ startedAtServerMs, fireOffsets, timeOffset = 0, lang = 'ko', volume, muted, displayOrder }) {
  const safeLang = SUPPORTED_TTS_LANGS.has(lang) ? lang : 'ko';
  const c = ensureContext();
  if (!c) return;
  if (!startedAtServerMs || !Array.isArray(fireOffsets)) return;

  stopRallyCountdown();  // 기존 스케줄 정리 (latestScheduleId는 stop 내에서 증가)
  const myId = ++latestScheduleId;

  if (c.state === 'suspended') {
    try { await c.resume(); } catch { /* noop */ }
  }
  setRallyVolume(volume, muted);

  dispatchedCount.value = 0;
  scheduleLog.items = [];
  dispatchedLog.length = 0;

  if (import.meta.env.DEV) {
    window.__rallyDispatchedCount = dispatchedCount;
    window.__rallyDispatchedLog = dispatchedLog;
    window.__rallyScheduleLog = scheduleLog;
  }

  const rawMax = fireOffsets.length > 0
    ? Math.max(...fireOffsets.map((f) => Math.round(f.offsetMs / 1000)))
    : 0;
  if (rawMax > MAX_OFFSET_SEC && import.meta.env.DEV) {
    console.warn('[RallyGroupPlayer] maxOffsetSec', rawMax, '> MAX_OFFSET_SEC, capping at', MAX_OFFSET_SEC);
  }
  const maxOffsetSec = Math.min(rawMax, MAX_OFFSET_SEC);

  const captainSeconds = new Set(fireOffsets.map((f) => Math.round(f.offsetMs / 1000)));

  // 첫 슬롯 워밍업 — 가장 일찍 발화할 안내 음성(있으면) 또는 "3" 프리카운트를 최대 500ms 기다림.
  // ctx 클럭 기반 예약이라도 버퍼가 제시각 지나 도착하면 slot 유실되므로 유지.
  if (displayOrder) loadBuffer(safeLang, `rally_start_${displayOrder}`);
  for (const k of ['3', '2', '1']) loadBuffer(safeLang, k);
  for (const f of fireOffsets) loadBuffer(safeLang, `captain_${f.orderIndex}`);
  if (maxOffsetSec > 0) {
    for (let t = 1; t <= maxOffsetSec; t++) {
      if (!captainSeconds.has(t)) loadBuffer(safeLang, String(t));
    }
  }
  // 안내 음성이 있으면 그것이 가장 일찍 발화되므로 그 버퍼를 워밍업 대상으로.
  const firstKey = displayOrder ? `rally_start_${displayOrder}` : '3';
  await Promise.race([
    loadBuffer(safeLang, firstKey),
    new Promise((r) => setTimeout(r, 500)),
  ]);
  if (myId !== latestScheduleId) return;

  if (c.state === 'suspended') {
    try { await c.resume(); } catch { /* noop */ }
  }
  if (myId !== latestScheduleId) return;

  // 앵커: startedAtServerMs 순간의 ctx.currentTime
  // 이후 모든 슬롯은 ctxAnchor + offsetSec로 절대 시각 계산
  const serverNow = Date.now() + timeOffset;
  const ctxAnchor = c.currentTime + (startedAtServerMs - serverNow) / 1000;

  // 시작 안내: T-6 ("N번 집결그룹 집결 시작합니다" — 한국어 약 3초, T-3 프리카운트 시작 전 여유)
  // 서버 COUNTDOWN_LEAD_MS=7000ms가 이 타이밍을 전제로 설정됨.
  if (displayOrder) {
    schedulePlay(safeLang, `rally_start_${displayOrder}`, ctxAnchor - 6, myId);
  }

  // 프리카운트: T-3, T-2, T-1
  for (const n of [3, 2, 1]) {
    schedulePlay(safeLang, String(n), ctxAnchor - n, myId);
  }

  // 집결장 순번 발화
  for (const f of fireOffsets) {
    schedulePlay(safeLang, `captain_${f.orderIndex}`, ctxAnchor + f.offsetMs / 1000, myId);
  }

  // 초당 카운팅.
  // t<=3 은 프리카운트(T-3,T-2,T-1)에서 같은 음성 "3","2","1"을 이미 예약했으므로
  // 중복 재생을 방지하기 위해 skip. (T-1에 "1" 재생 직후 T+1에 또 "1"이 들려
  // "프리카운트가 중복된다"는 사용자 보고의 근본 원인.)
  if (maxOffsetSec > 0) {
    for (let t = 1; t <= maxOffsetSec; t++) {
      if (t <= 3) continue;
      if (captainSeconds.has(t)) continue;
      schedulePlay(safeLang, String(t), ctxAnchor + t, myId);
    }
  }

  if (import.meta.env.DEV) {
    console.info('[RallyGroupPlayer] scheduled', {
      maxOffsetSec,
      captainCount: fireOffsets.length,
      scheduledSlots: scheduleLog.items.length,
      ctxAnchor,
    });
  }
}

/**
 * 단일 슬롯 재생 예약 — Web Audio 클럭 `src.start(ctxTimeAtPlay)` 직접 호출.
 * 버퍼가 로딩 중이면 도착 후 시각을 재검사해 예약, 과거면 skip.
 */
function schedulePlay(lang, key, ctxTimeAtPlay, myId) {
  if (!ctx) return;
  scheduleLog.items.push({ key, ctxTimeAtPlay });

  const startSource = (buffer) => {
    if (myId !== latestScheduleId) return;
    if (!ctx || !masterGain) return;
    if (!buffer) { if (import.meta.env.DEV) console.warn('[RallyGroupPlayer] slot buf null', key); return; }
    // 버퍼 도착 시점에서 예정 시각 재검사
    const now = ctx.currentTime;
    if (ctxTimeAtPlay < now - 0.2) {
      if (import.meta.env.DEV) console.warn('[RallyGroupPlayer] slot past due', key, { ctxTimeAtPlay, now });
      return;
    }
    const when = Math.max(ctxTimeAtPlay, now);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(masterGain);
    src.onended = () => { activeSources.delete(src); };
    try {
      src.start(when);
      activeSources.add(src);
      dispatchedCount.value += 1;
      if (import.meta.env.DEV) dispatchedLog.push({ label: key, at: performance.now(), when });
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[RallyGroupPlayer] start fail', key, e.message);
    }
  };

  const entry = bufferCache.get(`${lang}:${key}`);
  if (entry && typeof entry === 'object' && 'numberOfChannels' in entry) {
    startSource(entry);
    return;
  }
  if (entry && typeof entry.then === 'function') {
    entry.then(startSource);
    return;
  }
  loadBuffer(lang, key).then(startSource);
}

export function stopRallyCountdown() {
  latestScheduleId++;
  // src.stop()은 이미 시작된 것은 중단, 미래 시각으로 예약된 것은 취소
  for (const src of activeSources) {
    try { src.stop(); } catch { /* already stopped or not started */ }
    try { src.disconnect(); } catch { /* noop */ }
  }
  activeSources.clear();
}

export function setRallyVolume(volume, muted) {
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
