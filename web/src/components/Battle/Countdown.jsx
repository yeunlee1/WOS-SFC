import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket } from '../../api';

// ── TTS — 서버 캐시된 mp3 직접 재생 ─────────────
// 키 규칙: 숫자는 숫자 그대로, 문구는 start/stop/finish
let currentAudio = null;
const audioCache = new Map(); // key → HTMLAudioElement (preloaded)

function ttsUrl(lang, key) {
  return `/tts-audio/${lang}/${encodeURIComponent(key)}`;
}

// 즉시 재생 (캐시된 Audio 객체 우선)
function speak(key, lang = 'ko') {
  try {
    if (currentAudio) { currentAudio.pause(); currentAudio.currentTime = 0; currentAudio = null; }
    const ck = `${lang}:${key}`;
    const audio = audioCache.get(ck) || new Audio(ttsUrl(lang, key));
    audio.currentTime = 0;
    currentAudio = audio;
    audio.play().catch(() => {});
  } catch { /* 무시 */ }
}

// 프리페치: Audio 객체 미리 생성해 브라우저 캐시에 올림
const prefetchedLangs = new Set();
function prefetchTts(lang) {
  if (prefetchedLangs.has(lang)) return;
  prefetchedLangs.add(lang);

  const preload = (key) => {
    const ck = `${lang}:${key}`;
    if (audioCache.has(ck)) return;
    const a = new Audio(ttsUrl(lang, key));
    a.preload = 'auto';
    audioCache.set(ck, a);
  };

  // 1~10 즉시
  for (let i = 1; i <= 10; i++) preload(String(i));
  preload('start'); preload('stop'); preload('finish');

  // 11~180 지연 (UI 블로킹 방지)
  setTimeout(() => {
    for (let i = 11; i <= 180; i++) preload(String(i));
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

  // 항상 초 단위 표시 (분 단위 금지)
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
        {/* 배경 트랙 */}
        <circle cx={center} cy={center} r={RADIUS}
          fill="none" stroke="#f3e8ff" strokeWidth={STROKE} />
        {/* 진행 링 */}
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

      {/* 숫자 — 절대 위치로 SVG 위에 겹치기 */}
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
  { label: '5분',  value: 300 },
  { label: '10분', value: 600 },
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
  useEffect(() => {
    clearInterval(intervalRef.current);
    lastSpokenRef.current = -1;

    const { active, startedAt, totalSeconds } = countdown;

    if (!active) {
      setRemaining(null);
      return;
    }

    function tick() {
      const now     = Date.now() + timeOffset;
      const elapsed = (now - startedAt) / 1000;
      const rem     = totalSeconds - elapsed;

      if (rem <= 0) {
        setRemaining(0);
        clearInterval(intervalRef.current);
        speak('finish', lang);
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
  }, [countdown, timeOffset, lang]);

  // start/stop 멘트
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevActiveRef.current  = countdown.active;
      return;
    }
    if (countdown.active && !prevActiveRef.current) {
      speak('start', lang);
    } else if (!countdown.active && prevActiveRef.current) {
      speak('stop', lang);
    }
    prevActiveRef.current = countdown.active;
  }, [countdown.active, lang]);

  // 제어 권한: admin, developer, SFC만 (member는 시청 전용)
  const canControl = user?.role && user.role !== 'member';

  const secs     = remaining !== null ? Math.max(0, Math.ceil(remaining)) : null;
  const total    = countdown.totalSeconds || 0;
  const progress = (secs !== null && total > 0) ? secs / total : 1;
  const isActive = countdown.active;

  function handleStart(seconds) {
    const s = seconds ?? parseInt(inputSec, 10);
    if (!s || s < 1) return;
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
      {/* 상태 뱃지 */}
      <div className={`cd-status-badge ${isActive ? (secs === 0 ? 'finished' : 'active') : ''}`}>
        {statusLabel}
      </div>

      {/* 원형 링 + 숫자 */}
      <RingProgress progress={progress} secs={secs} total={total} />

      {/* 컨트롤 영역 (권한 있는 경우만) */}
      {canControl && (
        <div className="cd-controls">
          {/* 프리셋 버튼 */}
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

          {/* 커스텀 입력 + 시작/정지 */}
          <div className="cd-input-row">
            <input
              className="input cd-input"
              type="number"
              min="1"
              placeholder="직접 입력 (초)"
              value={inputSec}
              onChange={(e) => setInputSec(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !isActive && handleStart()}
              disabled={isActive}
            />
            {!isActive ? (
              <button
                className="btn btn-primary cd-btn-start"
                onClick={() => handleStart()}
                disabled={!inputSec || parseInt(inputSec) < 1}
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

      {/* 권한 없는 경우 — 시청자 메시지 */}
      {!canControl && !isActive && (
        <p className="cd-viewer-msg">SFC가 카운트다운을 시작하면 여기에 표시됩니다</p>
      )}
    </section>
  );
}
