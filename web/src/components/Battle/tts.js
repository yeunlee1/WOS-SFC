// tts.js — 공용 TTS 모듈 (Countdown.jsx 에서 분리)
// 서버가 Google Cloud TTS로 사전 생성한 mp3를 재생.
// 키 규칙: 숫자 1~180, 문구 start/stop/march
import { useStore } from '../../store';

const TTS_NUM_MAX = 180;

let lastSpokenKey = null;
let lastSpokenAt  = 0;
const DEDUP_WINDOW_MS = 500; // 같은 key 재요청 방어 창

// 단일 공유 오디오 엘리먼트 — 같은 탭 안에서 동시에 두 개 재생되는 물리적 가능성 제거
let sharedAudio = null;
export function getSharedAudio() {
  if (!sharedAudio) {
    sharedAudio = new Audio();
    sharedAudio.preload = 'auto';
  }
  return sharedAudio;
}

export function ttsUrl(lang, key) {
  return `/tts-audio/${lang}/${encodeURIComponent(key)}`;
}

// D1: 전역 중복 방어 — 동일 key가 500ms 내 두 번 들어오면 무시 (force=true 시 우회)
// D2: 단일 Audio 엘리먼트의 src를 교체해서 재생 — 이전 재생 자동 중단, 두 소리 겹침 불가능
export function speak(key, lang = 'ko', opts) {
  if (/^\d+$/.test(key) && parseInt(key, 10) > TTS_NUM_MAX) return;

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
    const audio = getSharedAudio();
    // 볼륨 적용 — store에서 직접 읽기 (훅 외부이므로 getState() 사용)
    const vol = useStore.getState().ttsVolume;
    audio.volume = typeof vol === 'number' ? Math.max(0, Math.min(1, vol)) : 0.3;
    audio.pause();
    audio.src = ttsUrl(lang, key);
    audio.load(); // 대기 중이던 이전 fetch 취소
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
