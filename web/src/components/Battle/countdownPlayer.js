// countdownPlayer.js — Web Audio API 기반 카운트다운 TTS 재생기 (Web Audio 클럭 절대 예약)
//
// 설계:
//   startedAt(서버 시각) 순간에 대응하는 ctx.currentTime 을 앵커로 잡고, 각 숫자 슬롯을
//   `src.start(ctxAnchor + 경과초)` 절대 시각으로 오디오 스레드에 직접 예약한다.
//   버퍼 로딩은 백그라운드로 진행하며 스케줄링을 블로킹하지 않는다. 버퍼가 늦게
//   도착하면 그 시점에 예정 시각을 재검사해, 아직 미래면 예약하고 이미 지났으면 버린다.
//
// 왜 setTimeout 을 버렸나:
//   이전 구현은 `window.setTimeout(..., fireAt)` 콜백에서 `src.start(0)` 을 호출했다.
//   JS 타이머는 지터가 있고 백그라운드 탭에서는 최대 1초까지 스로틀되며 iOS 는 아예
//   멈춘다. 100명이 같은 순간에 들어야 하는 요구사항에서 이 경로는 그대로 오차가 된다.
//   Web Audio 의 `start(when)` 은 오디오 하드웨어 스레드가 샘플 단위로 처리하므로
//   JS 실행 상태와 독립적이다. rallyGroupPlayer.js 가 이미 쓰던 방식을 이식했다.
//
// 왜 과거 슬롯을 버리나:
//   콜드캐시 LTE 에서 "30" 버퍼가 몇 초 늦게 도착하면, 시각 검사 없이 재생할 경우
//   "27" 뒤에 "30" 이 끼어들어 순서가 역전된다. 예정 시각이 200ms 이상 지난 슬롯은
//   재생하지 않는다.
//
// 출력 지연 보정:
//   `start(when)` 은 샘플이 출력 파이프라인에 들어가는 시각이고, 실제로 스피커에서
//   소리가 나는 시각은 그보다 뒤다. 그 차이가 기기마다 달라(유선 수십 ms, 블루투스는
//   수백 ms까지) 보정 없이는 기기 종류만으로 사용자 간 편차가 생긴다.
//   앵커에서 ctx.outputLatency(미지원 시 baseLatency)를 한 번 빼 보정한다.
//   ※ 보증하지 못하는 것 — 브라우저가 보고하는 값이 실제 지연과 얼마나 일치하는지는
//     플랫폼·오디오 백엔드에 달렸다. 블루투스 코덱 지연을 OS가 알려주지 않으면
//     과소 보고되어 잔차가 남는다. 그 잔차는 개인 수동 보정(personalOffsetMs)의 몫이다.
//     personalOffsetMs 는 호출자가 timeOffset 에 합산해 넘기므로 이중 적용되지 않는다.
//   ※ 값은 스케줄 시점에 한 번만 읽는다. 카운트다운 도중 출력 기기를 바꾸면
//     그 회차에는 반영되지 않는다.
//
// 과거 "30초 시작했는데 20부터 센다" 버그 재발 방지 메모:
//   당시 구현은 scheduleCountdown 내부에서 `await Promise.all(keys.map(loadBuffer))`로
//   모든 버퍼 디코딩을 기다린 뒤 스케줄을 실행했다. 캐시가 콜드일 때 await가 수 초
//   걸리면 그 사이 serverNow가 앞서나가 첫 N개 슬롯이 past-due로 사라졌다.
//   슬롯별 독립 예약으로 전환해 스케줄 자체는 즉시 완료된다.
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

// 재생 예약/중인 SourceNode 추적 (stop 시 일괄 중단 — 미래 시각 예약도 src.stop()으로 취소 가능)
const activeSources = new Set();

// 출력 지연 보정 상한. 블루투스 최악값(약 300ms)보다는 크고, 브라우저가 비정상적으로 큰
// 값을 보고했을 때 앵커가 통째로 과거로 밀려 전 슬롯이 past-due로 사라지는 것은 막는 선.
const MAX_OUTPUT_LATENCY_SEC = 0.5;

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

/**
 * 스피커에서 실제로 소리가 나기까지의 출력 지연(초).
 * outputLatency 우선, 미지원(Safari 등)이면 baseLatency, 둘 다 없으면 0.
 * 음수·NaN 같은 비정상 값은 0으로, 과대값은 MAX_OUTPUT_LATENCY_SEC 으로 잘라낸다.
 */
function outputLatencySec(c) {
  if (!c) return 0;
  const pick = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  const raw = pick(c.outputLatency) || pick(c.baseLatency);
  if (raw <= 0) return 0;
  return Math.min(raw, MAX_OUTPUT_LATENCY_SEC);
}

function loadBuffer(lang, key) {
  const cacheKey = `${lang}:${key}`;
  const cached = bufferCache.get(cacheKey);
  if (cached) return cached;
  const c = ensureContext();
  if (!c) return Promise.resolve(null);

  const promise = (async () => {
    try {
      // 캐시 옵션은 기본값(default)을 쓴다. 서버가 Cache-Control: public, max-age=3600 +
      // ETag 를 주므로(server/src/tts/tts.controller.ts) 브라우저가 신선한 응답을
      // 재검증 없이 재사용한다. 과거의 `cache: 'no-cache'` 는 이 헤더를 무력화해
      // 접속마다 수백 건의 조건부 GET 을 서버로 보냈다.
      const resp = await fetch(ttsUrl(lang, key), { credentials: 'same-origin' });
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
 * 카운트다운 TTS 예약 — Web Audio 클럭 절대 예약.
 * startedAt(서버 시각, ms) + (totalSeconds - n)*1000 시각에 각 숫자 n을 재생.
 *
 * 버퍼 로딩은 백그라운드에서 진행되며 스케줄 완료를 블로킹하지 않는다.
 * 버퍼가 늦게 도착하면 그 시점에 예정 시각을 재검사한다 — 아직 미래면 예약,
 * 이미 200ms 넘게 지났으면 버린다(순서 역전 방지).
 *
 * @param {{totalSeconds:number, startedAt:number, timeOffset:number, lang?:string, volume:number, muted:boolean}} params
 */
export async function scheduleCountdown({ totalSeconds, startedAt, timeOffset, lang = 'ko', volume, muted }) {
  const c = ensureContext();
  if (!c) return;
  if (!startedAt || !totalSeconds) return;
  // 1초 카운트다운은 음성 없이 진행한다 (기존 동작 유지).
  // 과거 구현은 첫 슬롯을 totalSeconds - 1 로 잡아 여기서 loadBuffer(lang, 0) →
  // /tts-audio/ko/0 404 가 났고 그 방어로 들어온 가드다. 지금은 첫 슬롯이
  // totalSeconds 라 0 키를 부를 일은 없지만, 가드를 풀면 동작이 바뀌므로 그대로 둔다.
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
  // 첫 슬롯(= "totalSeconds" 숫자)은 앵커 시각 그 자체에 발화되므로, 이 구간 안에
  // 버퍼가 도착하지 않으면 past-due 가드에 걸려 통째로 유실될 수 있다.
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

  // 앵커는 ctx 클럭 기준이라 suspended 상태에서 잡으면 안 된다 — suspended 동안
  // currentTime 은 멈춰 있으므로, 재개 이후 전 슬롯이 멈춰 있던 시간만큼 통째로 밀린다.
  // 다만 자동재생이 차단된 환경에서는 resume() 프라미스가 사용자 제스처 전까지
  // pending 으로 남을 수 있어 무기한 await 는 위험하다. 200ms 상한을 둔다.
  if (c.state === 'suspended') {
    await Promise.race([
      c.resume().catch(() => { /* noop */ }),
      new Promise((r) => setTimeout(r, 200)),
    ]);
    if (myId !== latestScheduleId) return;
  }

  // 워밍업·언락 후 시점으로 serverNow 재계산 → 앵커 정확도 확보.
  // 앵커: startedAt(서버 시각) 순간의 ctx.currentTime.
  // 출력 지연만큼 앞당겨야 스피커에서 소리가 나는 시각이 서버 시각과 맞는다.
  const serverNow = Date.now() + timeOffset;
  const latencySec = outputLatencySec(c);
  const ctxAnchor = c.currentTime + (startedAt - serverNow) / 1000 - latencySec;

  for (let n = totalSeconds; n >= 1; n--) {
    // 슬롯 n 의 서버 절대시각 = startedAt + (totalSeconds - n) * 1000
    schedulePlay(lang, n, ctxAnchor + (totalSeconds - n), myId);
  }

  if (import.meta.env.DEV) {
    console.info('[CountdownPlayer] scheduled', {
      totalSeconds,
      scheduledSlots: scheduleLog.items.length,
      ctxAnchor,
      latencySec,
    });
  }
}

/**
 * 단일 슬롯 재생 예약 — Web Audio 클럭 `src.start(ctxTimeAtPlay)` 직접 호출.
 * 버퍼가 로딩 중이면 도착 후 시각을 재검사해 예약, 과거면 skip.
 */
function schedulePlay(lang, n, ctxTimeAtPlay, myId) {
  if (!ctx) return;
  scheduleLog.items.push({ n, ctxTimeAtPlay });

  const startSource = (buffer) => {
    if (myId !== latestScheduleId) return;
    if (!ctx || !masterGain) return;
    if (!buffer) { if (import.meta.env.DEV) console.warn('[CountdownPlayer] slot buf null', n); return; }
    // 버퍼 도착 시점에서 예정 시각 재검사 — 200ms 넘게 지난 슬롯은 버린다.
    // (늦게 온 "30"이 "27" 뒤에 끼어드는 순서 역전 방지)
    const now = ctx.currentTime;
    if (ctxTimeAtPlay < now - 0.2) {
      if (import.meta.env.DEV) console.warn('[CountdownPlayer] slot past due', n, { ctxTimeAtPlay, now });
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
      if (import.meta.env.DEV) dispatchedLog.push({ label: n, at: performance.now(), when });
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[CountdownPlayer] start fail', n, e.message);
    }
  };

  const entry = bufferCache.get(`${lang}:${n}`);
  if (entry && typeof entry === 'object' && 'numberOfChannels' in entry) {
    startSource(entry);
    return;
  }
  if (entry && typeof entry.then === 'function') {
    entry.then(startSource);
    return;
  }
  loadBuffer(lang, n).then(startSource);
}

export function stopCountdownAudio() {
  latestScheduleId++;
  // src.stop()은 이미 시작된 것은 중단, 미래 시각으로 예약된 것은 취소
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
