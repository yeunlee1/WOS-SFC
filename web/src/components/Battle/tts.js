// tts.js — 공용 TTS 모듈
// 서버가 Google Cloud TTS로 사전 생성한 mp3를 재생.
// 키 규칙: 숫자 1~180, 문구 start/stop/march
import { useStore } from '../../store';

const TTS_NUM_MAX = 180;

// 동일 key가 짧은 창 안에 중복 호출되는 것 방어 (예: Effect 재실행으로 speak 이중 트리거)
let lastSpokenKey = null;
let lastSpokenAt  = 0;
const DEDUP_WINDOW_MS = 500;

// ── 오디오 풀 ────────────────────────────────────────
// 근본 원인 수정: 과거에는 sharedAudio 1개로 pause()+load()+play() 하면서
//   이전 재생을 강제 중단 → 한국어 3음절 숫자(백팔십 등)가 다음 tick(1s)에 잘리거나,
//   load() 직전 fetch가 abort되어 특정 숫자가 아예 재생되지 않음.
// 해결: 고정 크기 풀(POOL_SIZE)을 round-robin으로 사용 →
//   새 재생이 이전 재생을 건드리지 않음. 자연 감쇠(재생 완료) 대기.
const POOL_SIZE = 4;
let audioPool = null;
let poolIdx = 0;

function getPool() {
  if (!audioPool) {
    audioPool = [];
    for (let i = 0; i < POOL_SIZE; i++) {
      const a = new Audio();
      a.preload = 'auto';
      audioPool.push(a);
    }
  }
  return audioPool;
}

// 외부에서 예: 카운트다운 정지 시 강제 침묵을 걸어야 하면 사용
export function stopAllTts() {
  if (!audioPool) return;
  for (const a of audioPool) {
    try { a.pause(); } catch { /* 무시 */ }
  }
}

export function ttsUrl(lang, key) {
  return `/tts-audio/${lang}/${encodeURIComponent(key)}`;
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

  // 근본 원인 수정 (Bug 2): 볼륨 0이면 오디오 파이프라인 자체를 건드리지 않음.
  //   audio.volume=0 의존 대신 재생 경로 전체를 차단 → 브라우저/OS 단의 예외 케이스 제거.
  const vol = useStore.getState().ttsVolume;
  const volNum = typeof vol === 'number' && Number.isFinite(vol) ? vol : 0.3;
  if (volNum <= 0) {
    if (import.meta.env.DEV) {
      console.debug('[TTS] muted (volume=0):', key);
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
    const pool = getPool();
    const audio = pool[poolIdx % POOL_SIZE];
    poolIdx = (poolIdx + 1) % POOL_SIZE;

    // 볼륨은 매번 재설정 (유저가 슬라이더 움직였을 수 있음)
    audio.volume = Math.max(0, Math.min(1, volNum));
    audio.muted  = false; // 혹시 이전에 muted였다면 해제

    // 이 풀 슬롯이 이전에 재생 중이었다면 중단하고 새 src로 재사용.
    // (POOL_SIZE개를 순회한 후 되돌아올 때만 발생 → 이전 재생은 사실상 완료된 상태)
    audio.pause();
    audio.src = ttsUrl(lang, key);
    audio.currentTime = 0;
    audio.load();
    audio.play().catch((e) => {
      if (e.name === 'AbortError') return;
      if (import.meta.env.DEV) console.warn('[TTS] play 실패:', key, lang, e.message);
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[TTS] speak 오류:', e);
  }
}

// 프리페치: URL을 미리 브라우저 캐시에 올려 즉시 재생 대비
// M4: lang 변경 시 이전 lang 캐시를 제거해 메모리 누수 방지
// orphan setTimeout 방지: prefetchState에 timer를 함께 관리
//   Map<lang, { links: Set<HTMLLinkElement>; timer: number | null }>
const prefetchState = new Map();

export function prefetchTts(lang) {
  if (prefetchState.has(lang)) return;

  // 이전 lang 정리: setTimeout 취소 + DOM <link> 제거
  for (const [prevLang, state] of prefetchState) {
    if (prevLang !== lang) {
      if (state.timer !== null) clearTimeout(state.timer);
      state.links.forEach(el => el.parentNode?.removeChild(el));
      prefetchState.delete(prevLang);
    }
  }

  const entry = { links: new Set(), timer: null };
  prefetchState.set(lang, entry);

  const preload = (key) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'fetch';
    link.href = ttsUrl(lang, key);
    document.head.appendChild(link);
    entry.links.add(link);
  };

  // 1~10 + 문구: 즉시 (가장 자주 쓰임)
  for (let i = 1; i <= 10; i++) preload(String(i));
  preload('start'); preload('stop'); preload('march');

  // 11~180: 지연 (UI 블로킹 방지, 백그라운드 로드)
  entry.timer = setTimeout(() => {
    // lang이 여전히 활성 상태이고 timer가 유효한지 확인
    const current = prefetchState.get(lang);
    if (!current || current.timer === null) return;
    current.timer = null;
    for (let i = 11; i <= TTS_NUM_MAX; i++) preload(String(i));
  }, 500);
}

// 하위 호환: 외부에서 getSharedAudio를 import 하는 코드가 있을 경우 대비 (현재 없음).
// 풀의 첫 번째 엘리먼트를 돌려줌. 새 코드에서는 쓰지 말 것.
export function getSharedAudio() {
  return getPool()[0];
}
