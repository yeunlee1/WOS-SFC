import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket } from '../../api';

// ── TTS — 서버 캐시된 mp3 직접 재생 ─────────────
// 키 규칙: 숫자는 숫자 그대로(1~180), 문구는 start/stop
// 캐시 범위: 1~180 (tts-generate로 사전 생성된 파일)
const TTS_NUM_MAX = 180;

let currentAudio = null; // 현재 재생 중인 Audio 객체
let lastSpokenKey = null;
let lastSpokenAt  = 0;
const DEDUP_WINDOW_MS = 500; // 같은 key 재요청 방어 창

function ttsUrl(lang, key) {
  return `/tts-audio/${lang}/${encodeURIComponent(key)}`;
}

// D1: 전역 중복 방어 — 동일 key가 500ms 내 두 번 들어오면 무시.
//     StrictMode / HMR / 다중 구독 / 외부 트리거 등 어떤 경로라도 보호.
// I2: 재생은 매번 new Audio() — 같은 HTMLAudioElement 재사용 시 발생하는 play() 충돌 방지.
//     브라우저 HTTP 캐시가 네트워크 요청 중복을 막아줌.
function speak(key, lang = 'ko') {
  // 캐시 범위(1~180) 초과 숫자는 스킵 — API 호출 방지
  if (/^\d+$/.test(key) && parseInt(key, 10) > TTS_NUM_MAX) return;

  const now = performance.now();
  if (lastSpokenKey === key && (now - lastSpokenAt) < DEDUP_WINDOW_MS) {
    if (import.meta.env.DEV) console.warn('[TTS] dedup skip:', key);
    return;
  }
  lastSpokenKey = key;
  lastSpokenAt  = now;

  try {
    // 이전 오디오 정지
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    const audio = new Audio(ttsUrl(lang, key));
    currentAudio = audio;
    // M6: 재생 완료 시 참조 해제 (메모리 GC 대상 처리)
    audio.addEventListener('ended', () => {
      if (currentAudio === audio) currentAudio = null;
    }, { once: true });
    audio.play().catch((e) => {
      // pause()로 인한 play() 중단은 정상 동작 — 무시
      if (e.name === 'AbortError') return;
      if (import.meta.env.DEV) console.warn('[TTS] play 실패:', key, lang, e.message);
    });
  } catch (e) {
    if (import.meta.env.DEV) console.warn('[TTS] speak 오류:', e);
  }
}

// I1: "1" 재생이 끝난 뒤 finish 멘트 — 현재 오디오가 재생 중이면 ended 이벤트 대기
function speakAfterCurrent(key, lang) {
  const ca = currentAudio;
  if (ca && !ca.ended && !ca.paused) {
    const onEnd = () => speak(key, lang);
    ca.addEventListener('ended', onEnd, { once: true });
    // 1.5초 내 ended 안 오면 강제 재생 (네트워크 지연 대비)
    setTimeout(() => {
      ca.removeEventListener('ended', onEnd);
      if (currentAudio === ca || currentAudio === null) speak(key, lang);
    }, 1500);
  } else {
    speak(key, lang);
  }
}

// 프리페치: URL을 미리 브라우저 캐시에 올려 즉시 재생 대비
// M4: lang 변경 시 이전 lang 캐시를 제거해 메모리 누수 방지
const prefetchedLangs = new Set();
const prefetchLinks = new Map(); // lang → Set<key> (관리용)

function prefetchTts(lang) {
  if (prefetchedLangs.has(lang)) return;
  prefetchedLangs.add(lang);

  // 이전 lang의 <link rel="prefetch"> 제거
  for (const [prevLang, links] of prefetchLinks) {
    if (prevLang !== lang) {
      links.forEach(el => el.parentNode?.removeChild(el));
      prefetchLinks.delete(prevLang);
    }
  }

  const langLinks = new Set();
  prefetchLinks.set(lang, langLinks);

  const preload = (key) => {
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.as = 'fetch';
    link.href = ttsUrl(lang, key);
    document.head.appendChild(link);
    langLinks.add(link);
  };

  // 1~10 + 문구: 즉시 (가장 자주 쓰임)
  for (let i = 1; i <= 10; i++) preload(String(i));
  preload('start'); preload('stop');

  // 11~180: 지연 (UI 블로킹 방지, 백그라운드 로드)
  setTimeout(() => {
    for (let i = 11; i <= TTS_NUM_MAX; i++) preload(String(i));
  }, 500);
}

// ── SVG 원형 프로그레스 링 ──────────────────────
const RADIUS = 120;
const STROKE = 10;
const CIRC   = 2 * Math.PI * RADIUS;

function RingProgress({ progress, secs, total }) {
  const offset = CIRC * (1 - progress);

  const size   = RADIUS * 2 + STROKE * 2 + 8;
  const center = size / 2;

  const numClass = secs === null  ? 'countdown-number'
                 : secs <= 10   ? 'countdown-number countdown-danger'
                 : secs <= 30   ? 'countdown-number countdown-warning'
                 :                'countdown-number';

  const ringStroke = secs === null   ? '#e9d5ff'
                   : secs <= 10     ? 'url(#cd-grad-danger)'
                   : secs <= 30     ? 'url(#cd-grad-warning)'
                   :                  'url(#cd-grad-normal)';

  const display = secs === null ? '--' : String(secs);

  return (
    <div className="cd-ring-wrap" style={{ position: 'relative', width: size, height: size }}>
      <svg width={size} height={size} style={{ display: 'block' }}>
        <defs>
          <linearGradient id="cd-grad-normal" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ec4899" />
            <stop offset="100%" stopColor="#a855f7" />
          </linearGradient>
          <linearGradient id="cd-grad-warning" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#fbbf24" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
          <linearGradient id="cd-grad-danger" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f87171" />
            <stop offset="100%" stopColor="#dc2626" />
          </linearGradient>
        </defs>
        <circle cx={center} cy={center} r={RADIUS}
          fill="none" stroke="#f3e8ff" strokeWidth={STROKE} />
        <circle cx={center} cy={center} r={RADIUS}
          fill="none"
          stroke={ringStroke}
          strokeWidth={STROKE}
          strokeLinecap="round"
          strokeDasharray={CIRC}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${center} ${center})`}
          style={{ transition: 'stroke-dashoffset .25s linear, stroke .3s ease' }}
        />
      </svg>
      <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 2,
      }}>
        <span className={numClass}>{display}</span>
        {secs !== null && total > 0 && (
          <span className="cd-total">/ {total}s</span>
        )}
      </div>
    </div>
  );
}

// ── 프리셋 시간 목록 ────────────────────────────
const PRESETS = [
  { label: '30초', value: 30 },
  { label: '1분',  value: 60 },
  { label: '3분',  value: 180 },
];

// ── 메인 컴포넌트 ───────────────────────────────
export default function Countdown() {
  const { countdown, timeOffset, user } = useStore();
  const { t, lang } = useI18n();

  const [remaining, setRemaining]   = useState(null);
  const [inputSec,  setInputSec]    = useState('');
  const intervalRef    = useRef(null);
  const lastSpokenRef  = useRef(-1);
  const prevActiveRef  = useRef(countdown.active);
  const initializedRef = useRef(false);

  // 마운트 / 언어 변경 시 TTS 프리페치
  useEffect(() => { prefetchTts(lang); }, [lang]);

  // countdown 상태 변경 → interval 재설정
  // 의존성을 객체 전체 대신 개별 값으로 분리 — 참조만 바뀌는 경우의 불필요한 재실행 방지
  const { active, startedAt, totalSeconds } = countdown;
  useEffect(() => {
    clearInterval(intervalRef.current);

    if (!active) {
      setRemaining(null);
      lastSpokenRef.current = -1;
      return;
    }

    // 시작 직후 초기 숫자(totalSeconds)는 speak 하지 않음 — Effect 2의 'start' 멘트와 중복 방지
    // 1초 경과 후 다음 숫자(totalSeconds - 1)부터 순차 재생
    lastSpokenRef.current = totalSeconds;

    function tick() {
      const now     = Date.now() + timeOffset;
      const elapsed = (now - startedAt) / 1000;
      const rem     = totalSeconds - elapsed;

      if (rem <= 0) {
        setRemaining(0);
        clearInterval(intervalRef.current);
        return;
      }
      setRemaining(rem);

      const currentSec = Math.ceil(rem);
      if (currentSec !== lastSpokenRef.current) {
        lastSpokenRef.current = currentSec;
        speak(String(currentSec), lang);
      }
    }

    tick();
    intervalRef.current = setInterval(tick, 200);
    return () => clearInterval(intervalRef.current);
  }, [active, startedAt, totalSeconds, timeOffset, lang]);

  // start/stop 멘트
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevActiveRef.current  = active;
      return;
    }
    if (active && !prevActiveRef.current) {
      speak('start', lang);
    } else if (!active && prevActiveRef.current) {
      speak('stop', lang);
    }
    prevActiveRef.current = active;
  }, [active, lang]);

  const canControl = user?.role && user.role !== 'member';

  const secs     = remaining !== null ? Math.max(0, Math.ceil(remaining)) : null;
  const total    = totalSeconds || 0;
  const progress = (secs !== null && total > 0) ? secs / total : 1;
  const isActive = active;

  function handleStart(seconds) {
    const s = seconds ?? parseInt(inputSec, 10);
    if (!s || s < 1 || s > 180) return;
    getSocket()?.emit('countdown:start', s);
  }

  function handleStop() {
    getSocket()?.emit('countdown:stop');
  }

  const statusLabel = isActive
    ? (secs === 0 ? '🎯 전투 시작!' : '📡 공유 중')
    : '⏸ 대기 중';

  return (
    <section className="cd-section">
      <div className={`cd-status-badge ${isActive ? (secs === 0 ? 'finished' : 'active') : ''}`}>
        {statusLabel}
      </div>

      <RingProgress progress={progress} secs={secs} total={total} />

      {canControl && (
        <div className="cd-controls">
          <div className="cd-presets">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                className={`cd-preset-btn ${!isActive && parseInt(inputSec) === p.value ? 'selected' : ''}`}
                onClick={() => {
                  setInputSec(String(p.value));
                  if (!isActive) handleStart(p.value);
                }}
                disabled={isActive}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="cd-input-row">
            <input
              className="input cd-input"
              type="number"
              min="1"
              max="180"
              placeholder="직접 입력 (1~180초)"
              value={inputSec}
              onChange={(e) => setInputSec(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isActive && handleStart()}
              disabled={isActive}
            />
            {!isActive ? (
              <button
                className="btn btn-primary cd-btn-start"
                onClick={() => handleStart()}
                disabled={!inputSec || parseInt(inputSec) < 1 || parseInt(inputSec) > 180}
              >
                ▶ 시작
              </button>
            ) : (
              <button className="btn btn-danger cd-btn-stop" onClick={handleStop}>
                ■ 중지
              </button>
            )}
          </div>
        </div>
      )}

      {!canControl && !isActive && (
        <p className="cd-viewer-msg">SFC가 카운트다운을 시작하면 여기에 표시됩니다</p>
      )}
    </section>
  );
}
