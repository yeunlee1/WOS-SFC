import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { getSocket } from '../../api';
import { speak, stopAllTts, prefetchTts } from './tts';
import {
  primeCountdownAudio,
  scheduleCountdown,
  stopCountdownAudio,
  setCountdownVolume,
} from './countdownPlayer';
import { RESCHEDULE_THRESHOLD_MS } from '../../clockSync';
import CountdownDots from './CountdownDots';

// ── SVG 아크 백드롭 상수 ────────────────────────
const ARC_SIZE = 600;
const ARC_R    = 240;
const ARC_C    = 2 * Math.PI * ARC_R;

// ── 21-틱 다이얼 컴포넌트 ───────────────────────
function CdDial({ value, total }) {
  const ticks = [];
  const span  = 10;
  for (let i = -span; i <= span; i++) {
    const at = value - i; // upcoming seconds
    if (at < 0 || at > total) {
      ticks.push({ key: i, cls: 'cd-tick passed' });
      continue;
    }
    let cls = 'cd-tick';
    if (i === 0) {
      cls += value <= 5 ? ' now danger' : value <= 10 ? ' now warn' : ' now';
    } else if (at % 5 === 0) {
      cls += ' major';
    }
    if (i < 0) cls += ' passed';
    ticks.push({ key: i, cls });
  }
  return (
    <div className="cd-dial">
      {ticks.map((t) => <div key={t.key} className={t.cls} />)}
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
  const countdown        = useStore((s) => s.countdown);
  // timeOffset과 personalOffsetMs를 별도 구독 —
  // personalOffsetMs 변경 시 즉시 리스케줄 effect(아래)가 임계값 무관 트리거되도록.
  const clockOffset      = useStore((s) => s.timeOffset);
  const personalOffsetMs = useStore((s) => s.personalOffsetMs);
  // 실제 시각 계산에는 두 값의 합산 사용
  const timeOffset       = clockOffset + personalOffsetMs;
  const user             = useStore((s) => s.user);
  const busyHolder       = useStore((s) => s.busyHolder);
  const { t, lang } = useI18n();

  const [remaining, setRemaining]   = useState(null);
  const [inputSec,  setInputSec]    = useState('');
  const [errorMsg,  setErrorMsg]    = useState(null);
  // 화면 업데이트용 interval
  const intervalRef    = useRef(null);
  const prevActiveRef  = useRef(countdown.active);
  const initializedRef = useRef(false);
  // 마지막으로 적용된 timeOffset — 리스케줄 필요 여부 판단
  const lastOffsetRef  = useRef(timeOffset);

  // 마운트 / 언어 변경 시 비카운트다운 문구만 prefetch (카운트다운 숫자는 countdownPlayer가 decode 캐시)
  useEffect(() => {
    prefetchTts(['start', 'stop', 'march'], lang);
    // 백그라운드에서 1~180 버퍼를 미리 decode해 둠 (AudioContext)
    const keys = [];
    for (let n = 1; n <= 180; n++) keys.push(n);
    // primeCountdownAudio는 AudioContext 언락도 시도하지만 사용자 제스처 전에는 suspended 유지
    // decodeAudioData는 제스처 없이도 가능 → 버퍼만 우선 준비해 둠
    primeCountdownAudio(keys, lang).catch(() => { /* 네트워크/디코드 실패 무시 */ });
  }, [lang]);

  // ttsVolume/ttsMuted 변경 → countdownPlayer 마스터 게인 실시간 반영
  useEffect(() => {
    const apply = () => {
      const s = useStore.getState();
      setCountdownVolume(s.ttsVolume, s.ttsMuted);
    };
    apply();
    const unsub = useStore.subscribe((s, prev) => {
      if (s.ttsVolume !== prev.ttsVolume || s.ttsMuted !== prev.ttsMuted) apply();
    });
    return unsub;
  }, []);

  // countdown 상태 변경 → interval(화면) 재설정 + TTS 스케줄 예약
  const { active, startedAt, totalSeconds } = countdown;
  useEffect(() => {
    clearInterval(intervalRef.current);
    stopCountdownAudio();

    if (!active) {
      setRemaining(null);
      stopAllTts();
      return;
    }

    // 사용자 제스처에서 AudioContext 언락 (카운트다운 시작 버튼 클릭 등)
    // 필요한 키만 즉시 prime (이미 decode되었다면 no-op).
    // 언락은 비동기이지만 scheduleCountdown 내부에서 이미 decode된 버퍼는 즉시 예약,
    // 미완료 버퍼는 로드 완료 시 예약되므로 prime을 기다릴 필요 없다.
    const neededKeys = [];
    for (let n = 1; n < totalSeconds; n++) neededKeys.push(n);
    primeCountdownAudio(neededKeys, lang).catch(() => { /* 무시 */ });

    const { ttsVolume, ttsMuted } = useStore.getState();
    scheduleCountdown({
      totalSeconds,
      startedAt,
      timeOffset,
      lang,
      volume: ttsVolume,
      muted: ttsMuted,
    });
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
      stopCountdownAudio();
      stopAllTts();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, startedAt, totalSeconds, lang]);

  // clockOffset 급변(1초 이상) 시 리스케줄 — RESCHEDULE_THRESHOLD_MS 상수 사용 (Q1-a)
  //
  // Web Audio API 스케줄은 AudioContext.currentTime(모노토닉) 기반이라
  // 한 번 예약된 발화는 Date.now() drift와 무관하게 정확히 재생된다.
  // 따라서 일반적인 RTT 변동으로 인한 작은 offset 변화(수백 ms 이내)는
  // 무시해야 한다 — 재스케줄 사이사이 await로 인해 오히려 슬롯이 누락될 수 있다.
  // 시스템 클록이 실제로 점프한 경우(예: 수동 시간 변경)에만 재스케줄.
  useEffect(() => {
    if (!active || !startedAt || !totalSeconds) return;
    const effectiveOffset = clockOffset + personalOffsetMs;
    const deltaMs = Math.abs(effectiveOffset - lastOffsetRef.current);
    if (deltaMs <= RESCHEDULE_THRESHOLD_MS) return; // 1초 이내의 변동은 무시 (AudioContext가 이미 정확히 스케줄함)

    if (import.meta.env.DEV) console.info('[Countdown] reschedule due to large offset jump', deltaMs, 'ms');
    const { ttsVolume, ttsMuted } = useStore.getState();
    scheduleCountdown({
      totalSeconds,
      startedAt,
      timeOffset: effectiveOffset,
      lang,
      volume: ttsVolume,
      muted: ttsMuted,
    });
    lastOffsetRef.current = effectiveOffset;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockOffset, active, startedAt]);

  // personalOffsetMs 변경 시 즉시 리스케줄 — 슬라이더 조작에 즉각 반응 (Q1-b)
  // 임계값(RESCHEDULE_THRESHOLD_MS) 무관하게 항상 리스케줄 — ±100ms 미세 보정 즉시 반영.
  // Q-mount-1: effectiveOffset이 main effect에서 이미 설정한 lastOffsetRef와 동일하면 skip —
  //   mount 시점에 main effect가 먼저 실행되므로 첫 렌더에서 중복 scheduleCountdown 호출 방지.
  useEffect(() => {
    if (!active || !startedAt || !totalSeconds) return;
    const effectiveOffset = clockOffset + personalOffsetMs;
    if (lastOffsetRef.current === effectiveOffset) return; // 첫 렌더 또는 변경 없음 — skip
    if (import.meta.env.DEV) console.info('[Countdown] reschedule due to personalOffset change', personalOffsetMs, 'ms');
    const { ttsVolume, ttsMuted } = useStore.getState();
    scheduleCountdown({
      totalSeconds,
      startedAt,
      timeOffset: effectiveOffset,
      lang,
      volume: ttsVolume,
      muted: ttsMuted,
    });
    lastOffsetRef.current = effectiveOffset;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalOffsetMs, active, startedAt]);

  // start/stop 멘트
  // stop 멘트만 재생. start 멘트("준비해주세요")는 제거 —
  // countdownPlayer가 이제 "totalSeconds"(예: "30")부터 스케줄하므로
  // 카운트다운 시작 시점에 첫 숫자 발화가 그 역할을 대체한다.
  // start 멘트(1.3초) + 1초 후 첫 숫자(0.96초)가 겹쳐 "이십N부터 센다"로
  // 들리는 원인 제거.
  useEffect(() => {
    if (!initializedRef.current) {
      initializedRef.current = true;
      prevActiveRef.current  = active;
      return;
    }
    if (!active && prevActiveRef.current) {
      speak('stop', lang);
    }
    prevActiveRef.current = active;
  }, [active, lang]);

  const canControl = user?.role && user.role !== 'member';

  // 다른 타입(rally 등)이 lock을 잡고 있으면 시작 버튼 disable
  const blockedByOther = busyHolder && busyHolder.type !== 'countdown';

  const secs     = remaining !== null ? Math.max(0, Math.ceil(remaining)) : null;
  const total    = totalSeconds || 0;
  const progress = (secs !== null && total > 0) ? secs / total : 1;
  const isActive = active;

  function handleStart(seconds) {
    const s = seconds ?? parseInt(inputSec, 10);
    if (!s || s < 1 || s > 180) return;
    getSocket()?.emit('countdown:start', s, (ack) => {
      if (ack && !ack.ok) {
        let msg;
        if (ack.reason === 'busy') {
          const holder = busyHolder;
          if (holder?.type === 'rally') {
            msg = '공격 카운트가 진행 중입니다';
          } else if (holder?.type === 'countdown') {
            msg = '수비 카운트가 진행 중입니다';
          } else {
            msg = '다른 카운트가 진행 중입니다';
          }
        } else if (ack.reason === 'rate_limit') {
          msg = '요청이 너무 빠릅니다. 잠시 후 다시 시도하세요';
        } else if (ack.reason === 'invalid') {
          msg = '수비 카운트 시간이 유효하지 않습니다';
        } else {
          msg = '수비 카운트 시작에 실패했습니다';
        }
        setErrorMsg(msg);
        setTimeout(() => setErrorMsg(null), 1500);
      }
    });
  }

  function handleStop() {
    getSocket()?.emit('countdown:stop');
  }

  // ── SVG 아크 계산 ──────────────────────────────
  const arcPct    = total > 0 ? Math.max(0, Math.min(1, (secs ?? total) / total)) : (secs === null ? 1 : 0);
  const arcOffset = ARC_C * (1 - arcPct);
  const arcStroke = secs !== null && secs <= 5
    ? '#f87171'
    : secs !== null && secs <= 10
      ? '#fbbf24'
      : 'url(#arcGrad)';

  // ── mega number 클래스 ─────────────────────────
  let megaCls = 'cd-mega';
  if (secs !== null && isActive && secs <= 5)  megaCls += ' danger';
  else if (secs !== null && isActive && secs <= 10) megaCls += ' warn';

  // ── 상태 태그 ─────────────────────────────────
  const statusActive = isActive && secs !== 0;
  const statusDanger = isActive && secs !== null && secs <= 5 && secs !== 0;
  let statusText;
  if (!isActive)        statusText = '대기';
  else if (secs === 0)  statusText = '종료';
  else                  statusText = '진행중';

  const heroTagCls = 'cd-hero-tag'
    + (statusActive ? ' active' : '')
    + (statusDanger ? ' danger' : '');

  // ── 표시 숫자 ─────────────────────────────────
  const displayNum = secs !== null ? secs : '--';

  return (
    <section className="cd-section">
      <div className="cd-hero">
        {/* 상단 헤더: 상태 태그 + 총 시간 */}
        <div className="cd-hero-head">
          <span className={heroTagCls}>
            {statusText.toUpperCase()}
          </span>
          <span>T · {total}초</span>
        </div>

        {/* SVG 아크 백드롭 */}
        <div className="cd-arc-bg">
          <svg viewBox={`0 0 ${ARC_SIZE} ${ARC_SIZE}`}>
            <defs>
              <linearGradient id="arcGrad" x1="0" x2="1" y1="0" y2="1">
                <stop offset="0%" stopColor="#a8e6ff" stopOpacity="0.4"/>
                <stop offset="100%" stopColor="#3a78ff" stopOpacity="0.05"/>
              </linearGradient>
            </defs>
            <circle
              cx={ARC_SIZE / 2} cy={ARC_SIZE / 2} r={ARC_R}
              fill="none"
              stroke="rgba(124,220,255,0.06)"
              strokeWidth="2"
            />
            <circle
              cx={ARC_SIZE / 2} cy={ARC_SIZE / 2} r={ARC_R}
              fill="none"
              stroke={arcStroke}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={ARC_C}
              strokeDashoffset={arcOffset}
              transform={`rotate(-90 ${ARC_SIZE / 2} ${ARC_SIZE / 2})`}
              style={{
                transition: 'stroke-dashoffset 0.3s linear',
                filter: 'drop-shadow(0 0 12px currentColor)',
              }}
            />
          </svg>
        </div>

        {/* 메가 숫자 */}
        <div className={megaCls}>{displayNum}</div>

        {/* 21-틱 다이얼 */}
        <CdDial value={secs ?? 0} total={total} />

        {/* 컨트롤: 프리셋 + 입력 + 시작/중지 */}
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
                  disabled={isActive || blockedByOther}
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
                onKeyDown={(e) => e.key === 'Enter' && !isActive && !blockedByOther && handleStart()}
                disabled={isActive || blockedByOther}
              />
              {!isActive ? (
                <button
                  className="btn btn-primary cd-btn-start"
                  onClick={() => handleStart()}
                  disabled={!inputSec || parseInt(inputSec) < 1 || parseInt(inputSec) > 180 || blockedByOther}
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

        {errorMsg && (
          <p className="cd-error-msg" style={{ color: '#ef4444', fontSize: '0.875rem', marginTop: '0.5rem', textAlign: 'center' }}>
            {errorMsg}
          </p>
        )}

        {!canControl && !isActive && (
          <p className="cd-viewer-msg">SFC가 수비 카운트를 시작하면 여기에 표시됩니다</p>
        )}

        {/* 키보드 힌트 */}
        {canControl && (
          <div className="cd-key-hint">
            <span><kbd>SPACE</kbd> 시작/정지</span>
            <span><kbd>R</kbd> 초기화</span>
          </div>
        )}
      </div>

      <div className="battle-viz-mobile">
        <CountdownDots />
      </div>
    </section>
  );
}
