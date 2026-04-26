// tts.js — 공용 TTS 모듈
// 서버가 Google Cloud TTS로 사전 생성한 mp3를 재생.
// 키 규칙: 숫자 1~180, 문구 start/stop/march
import { useStore } from '../../store';
import { perceptualVolume } from '../../utils/volume';

const TTS_NUM_MAX = 180;

// 동일 key가 짧은 창 안에 중복 호출되는 것 방어 (예: Effect 재실행으로 speak 이중 트리거)
let lastSpokenKey = null;
let lastSpokenAt  = 0;
const DEDUP_WINDOW_MS = 500;

// 현재 재생 중인 Audio 인스턴스 추적 — stopAllTts() 에서 모두 중단할 수 있도록
// WeakSet을 쓰면 반복 순회 불가 → Set으로 직접 관리, ended/error/abort 이벤트로 제거
const liveAudios = new Set();

// ── 핵심 설계 ───────────────────────────────────────
// 과거 버전의 근본 원인:
//   (a) 단일 sharedAudio — 매 호출마다 pause()+load() 하면서 이전 재생을 abort
//   (b) 4-slot 풀 — rotation이 한 바퀴 돌면 여전히 (a)와 동일한 abort 발생
// 새 설계:
//   매 speak 호출마다 "새 HTMLAudioElement" 를 만들어 독립 재생.
//   각 Audio는 ended/error 이벤트로 자동 해제. GC가 메모리 회수.
//   → 이전 재생은 새 재생에 의해 절대 abort되지 않는다. 누락·잘림 불가능.
//   overlap이 발생해도 사용자 입장에서는 "앞·뒤 숫자가 살짝 겹쳐 들림"
//   정도이며 잘려서 못 들리는 것보다 낫다. 서버 speakingRate=1.5로 재생 시간
//   단축해 overlap 자체도 최소화.

export function ttsUrl(lang, key) {
  return `/tts-audio/${lang}/${encodeURIComponent(key)}`;
}

/** 진행 중인 모든 TTS를 즉시 중단 (예: 음소거 토글, 카운트다운 정지 시) */
export function stopAllTts() {
  // 순회 중 Set 돌연변이(이벤트 발화 → cleanup → delete)를 피하기 위해 snapshot
  const snapshot = [...liveAudios];
  liveAudios.clear();
  for (const a of snapshot) {
    try { a.pause(); } catch { /* 무시 */ }
    try { a.src = ''; } catch { /* 무시 */ }
  }
}

/**
 * TTS 재생.
 * @param {string} key - 숫자 문자열('1'~'180') 또는 문구 키('start'|'stop'|'march')
 * @param {string} lang - 'ko'|'en'|'ja'|'zh'
 * @param {{force?: boolean}} [opts] - force=true면 DEDUP 우회 (테스트 버튼 등)
 */
export function speak(key, lang = 'ko', opts) {
  // 화이트리스트: 허용 범위 밖 숫자는 무시
  if (/^\d+$/.test(key) && parseInt(key, 10) > TTS_NUM_MAX) return;

  // 근본 원인 수정 (Bug 2): 볼륨 0 또는 음소거 상태면 오디오 파이프라인 자체를 건드리지 않음
  const state = useStore.getState();
  const vol = state.ttsVolume;
  const muted = !!state.ttsMuted;
  const volNum = typeof vol === 'number' && Number.isFinite(vol) ? vol : 0.3;
  if (muted || volNum <= 0) {
    if (import.meta.env.DEV) {
      console.debug('[TTS] muted or volume=0:', key, { muted, volNum });
    }
    return;
  }

  const now = performance.now();
  if (opts?.force !== true) {
    if (lastSpokenKey === key && (now - lastSpokenAt) < DEDUP_WINDOW_MS) {
      if (import.meta.env.DEV) {
        console.warn('[TTS] dedup skip:', key, 'Δ', (now - lastSpokenAt).toFixed(0) + 'ms');
      }
      return;
    }
  }
  lastSpokenKey = key;
  lastSpokenAt  = now;

  try {
    // 근본 원인 수정 (Bug 1): 매 호출마다 독립 Audio 인스턴스
    //   → 이전 재생은 새 재생에 의해 중단되지 않음.
    const audio = new Audio(ttsUrl(lang, key));
    audio.volume = perceptualVolume(volNum);
    audio.preload = 'auto';

    const cleanup = () => {
      liveAudios.delete(audio);
      audio.removeEventListener('ended', cleanup);
      audio.removeEventListener('error', cleanup);
    };
    audio.addEventListener('ended', cleanup);
    audio.addEventListener('error', cleanup);
    liveAudios.add(audio);

    audio.play().catch((e) => {
      if (e.name === 'AbortError') { cleanup(); return; }
      if (import.meta.env.DEV) console.warn('[TTS] play 실패:', key, lang, e.message);
      cleanup();
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[TTS] speak 오류:', e);
  }
}

// 프리페치: URL을 미리 브라우저 캐시에 올려 즉시 재생 대비
// fetch() 기반으로 전환 — <link rel="prefetch">는 Safari/iOS에서 신뢰성이 낮음
// prefetched 키를 Map<lang, Set<key>>로 추적하여 중복 prefetch 방지

const prefetchedKeys = new Map(); // Map<lang, Set<string>>

/**
 * 지정한 키 배열을 prefetch (fetch()로 브라우저 캐시에 올림).
 * @param {Array<string|number>} keys - prefetch할 키 목록
 * @param {string} lang - 'ko'|'en'|'ja'|'zh'
 */
export function prefetchTts(keys, lang = 'ko') {
  if (!prefetchedKeys.has(lang)) {
    prefetchedKeys.set(lang, new Set());
  }
  const done = prefetchedKeys.get(lang);

  for (const k of keys) {
    const strKey = String(k);
    if (done.has(strKey)) continue;
    done.add(strKey);
    const url = ttsUrl(lang, strKey);
    fetch(url, { credentials: 'same-origin' }).catch(() => { /* 네트워크 오류 무시 */ });
  }
}
