import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket } from '../../api';
import { speak, stopAllTts, prefetchTts } from './tts';

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
  // S1: zustand selector로 구독 범위 최소화 — onlineUsers 등 무관한 state 변경으로 인한 재렌더 차단
  const countdown   = useStore((s) => s.countdown);
  const timeOffset  = useStore((s) => s.timeOffset);
  const user        = useStore((s) => s.user);
  const { t, lang } = useI18n();

  const [remaining, setRemaining]   = useState(null);
  const [inputSec,  setInputSec]    = useState('');
  // 화면 업데이트용 interval
  const intervalRef    = useRef(null);
  // TTS 스케줄 타이머 배열 — 카운트다운 종료/정리 시 전부 clearTimeout
  const timersRef      = useRef([]);
  const prevActiveRef  = useRef(countdown.active);
  const initializedRef = useRef(false);
  // 마지막으로 적용된 timeOffset — 리스케줄 필요 여부 판단
  const lastOffsetRef  = useRef(timeOffset);

  // 마운트 / 언어 변경 시 TTS 프리페치 (기존 prefetchTts는 1~180 전체 prefetch)
  useEffect(() => { prefetchTts(lang); }, [lang]);

  // ── TTS 타이머 정리 헬퍼 ──────────────────────
  function clearAllTimers() {
    for (const id of timersRef.current) clearTimeout(id);
    timersRef.current = [];
  }

  // ── TTS 스케줄 예약 (스케줄 기반 재설계) ─────
  // totalSeconds-1 부터 1 까지 각 정수 N에 대해
  // "서버 시각 기준 startedAt + (totalSeconds - N) * 1000" 에 speak(N) 실행 예약.
  // drift가 발생해도 브라우저가 예약 시각에 보정하여 콜백 실행 → 누락 차단.
  function scheduleTts(startedAt, totalSeconds, lang, offset) {
    clearAllTimers();

    const timers = [];
    let skipped = 0;

    for (let n = totalSeconds - 1; n >= 1; n--) {
      // 해당 숫자가 발음될 서버 시각 (ms)
      const playServerTime = startedAt + (totalSeconds - n) * 1000;
      // 로컬 기준 지연
      const delay = playServerTime - (Date.now() + offset);

      if (delay < 0) {
        // 이미 지난 과거 (중간 진입) — 스킵
        skipped++;
        continue;
      }

      const capturedN = n;
      const id = setTimeout(() => {
        if (import.meta.env.DEV) {
          console.debug('[Countdown] speak', capturedN, 'at', Date.now());
        }
        speak(String(capturedN), lang);
      }, delay);
      timers.push(id);
    }

    timersRef.current = timers;

    const scheduledCount = timers.length;
    const now = Date.now();
    // N=totalSeconds-1 → 1초 후 첫 발음, N=1 → totalSeconds-1초 후 마지막 발음
    const firstPlayAt = startedAt + 1 * 1000;               // N=totalSeconds-1 발음 시각
    const lastPlayAt  = startedAt + (totalSeconds - 1) * 1000; // N=1 발음 시각

    console.info('[Countdown] scheduled', {
      totalSeconds,
      firstPlayAt: Math.round(firstPlayAt),
      lastPlayAt:  Math.round(lastPlayAt),
      timerCount:  scheduledCount,
      skipped,
    });
  }

  // countdown 상태 변경 → interval(화면) 재설정 + TTS 스케줄 예약
  const { active, startedAt, totalSeconds } = countdown;
  useEffect(() => {
    clearInterval(intervalRef.current);
    clearAllTimers();

    if (!active) {
      setRemaining(null);
      stopAllTts();
      return;
    }

    // 시작 시 TTS 스케줄 예약
    scheduleTts(startedAt, totalSeconds, lang, timeOffset);
    lastOffsetRef.current = timeOffset;

    // ── 화면 렌더링용 tick (speak 호출 없음) ────
    function tick() {
      const now     = Date.now() + lastOffsetRef.current;
      const elapsed = (now - startedAt) / 1000;
      const rem     = totalSeconds - elapsed;

      if (rem <= 0) {
        setRemaining(0);
        clearInterval(intervalRef.current);
        return;
      }
      setRemaining(rem);
    }

    tick();
    intervalRef.current = setInterval(tick, 200);
    return () => {
      clearInterval(intervalRef.current);
      clearAllTimers();
      stopAllTts();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startedAt, totalSeconds, lang]);

  // timeOffset 변경 시 리스케줄 (>50ms 차이일 때만)
  useEffect(() => {
    const deltaMs = Math.abs(timeOffset - lastOffsetRef.current);
    lastOffsetRef.current = timeOffset;

    if (!active || !startedAt || !totalSeconds) return;
    if (deltaMs <= 50) return;

    console.info('[Countdown] reschedule due to offset change', deltaMs);
    scheduleTts(startedAt, totalSeconds, lang, timeOffset);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeOffset]);

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
