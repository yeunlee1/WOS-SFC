import { useState, useEffect, useRef } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api } from '../../api';
import { speak } from './tts';

// PersonalPanel — 개인 현황판
// 유저 본인의 행군 시간(marchSeconds)을 저장하고,
// 카운트다운이 해당 시점에 도달하면 'march' TTS를 로컬에서 재생한다.
export default function PersonalPanel() {
  const countdown  = useStore((s) => s.countdown);
  const timeOffset = useStore((s) => s.timeOffset);
  const { lang }   = useI18n();

  // marchSeconds: null(미설정) | 1~180(설정됨)
  const [marchSeconds, setMarchSeconds] = useState(null);
  const [inputVal,     setInputVal]     = useState('');
  const [saving,       setSaving]       = useState(false);

  // D2 패턴: timeOffset을 ref로 보관해 effect 재실행 방지
  const timeOffsetRef = useRef(timeOffset);
  useEffect(() => { timeOffsetRef.current = timeOffset; }, [timeOffset]);

  // 마운트 시: 서버에서 marchSeconds 로드, 실패 시 localStorage 폴백
  useEffect(() => {
    let cancelled = false;
    api.getBattleSettings()
      .then((data) => {
        if (cancelled) return;
        if (data && typeof data.marchSeconds === 'number') {
          setMarchSeconds(data.marchSeconds);
          setInputVal(String(data.marchSeconds));
        } else {
          // null 응답 처리
          const fallback = parseInt(localStorage.getItem('wos-march-seconds'), 10);
          if (Number.isFinite(fallback) && fallback >= 1 && fallback <= 180) {
            setMarchSeconds(fallback);
            setInputVal(String(fallback));
          }
        }
      })
      .catch(() => {
        if (cancelled) return;
        // 서버 실패 → localStorage 폴백
        const fallback = parseInt(localStorage.getItem('wos-march-seconds'), 10);
        if (Number.isFinite(fallback) && fallback >= 1 && fallback <= 180) {
          setMarchSeconds(fallback);
          setInputVal(String(fallback));
        }
      });
    return () => { cancelled = true; };
  }, []);

  // 저장 핸들러
  async function handleSave() {
    const parsed = parseInt(inputVal, 10);
    const isValid = Number.isFinite(parsed) && parsed >= 1 && parsed <= 180;
    const value   = isValid ? parsed : null;

    setSaving(true);
    try {
      await api.saveBattleSettings({ marchSeconds: value });
      setMarchSeconds(value);
      // localStorage 동기화
      if (value !== null) {
        localStorage.setItem('wos-march-seconds', String(value));
      } else {
        localStorage.removeItem('wos-march-seconds');
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[PersonalPanel] 저장 실패:', e);
    } finally {
      setSaving(false);
    }
  }

  // ── TTS 트리거: 카운트다운 tick 감시 ──────────────────────────
  const intervalRef  = useRef(null);
  const lastFiredRef = useRef(-1);

  const { active, startedAt, totalSeconds } = countdown;

  useEffect(() => {
    clearInterval(intervalRef.current);

    // active 상태 변경 시 lastFiredRef 리셋 (새 카운트다운 시작)
    lastFiredRef.current = -1;

    // marchSeconds 유효 범위(1~180) + active 상태일 때만 interval 가동
    if (!active || marchSeconds === null || marchSeconds < 1 || marchSeconds > 180) {
      return;
    }

    function tick() {
      const rem = totalSeconds - (Date.now() + timeOffsetRef.current - startedAt) / 1000;
      if (rem <= 0) {
        clearInterval(intervalRef.current);
        return;
      }
      const sec = Math.ceil(rem);
      if (sec === marchSeconds && lastFiredRef.current !== marchSeconds) {
        lastFiredRef.current = marchSeconds;
        speak('march', lang);
      }
    }

    intervalRef.current = setInterval(tick, 200);
    return () => clearInterval(intervalRef.current);
  }, [active, startedAt, totalSeconds, marchSeconds, lang]);

  // ── 표시용 계산 ─────────────────────────────────────────────
  // "내 출발까지 N초" 실시간 표시용 별도 tick state
  const [myRemaining, setMyRemaining] = useState(null);
  const myIntervalRef = useRef(null);

  useEffect(() => {
    clearInterval(myIntervalRef.current);
    setMyRemaining(null);

    if (!active || marchSeconds === null || marchSeconds < 1 || marchSeconds > 180) return;

    function updateRemaining() {
      const rem = totalSeconds - (Date.now() + timeOffsetRef.current - startedAt) / 1000;
      if (rem <= 0) {
        clearInterval(myIntervalRef.current);
        setMyRemaining(0);
        return;
      }
      // 내 출발까지 남은 시간 = rem - marchSeconds
      const untilMarch = rem - marchSeconds;
      setMyRemaining(untilMarch);
    }

    updateRemaining();
    myIntervalRef.current = setInterval(updateRemaining, 200);
    return () => clearInterval(myIntervalRef.current);
  }, [active, startedAt, totalSeconds, marchSeconds]);

  // ── UI 렌더 ─────────────────────────────────────────────────
  const parsedInput  = parseInt(inputVal, 10);
  const inputValid   = Number.isFinite(parsedInput) && parsedInput >= 1 && parsedInput <= 180;

  // marchSeconds > totalSeconds 경고
  const showWarning  = active && marchSeconds !== null
    && marchSeconds > 0 && totalSeconds > 0
    && marchSeconds > totalSeconds;

  // active 중 출발까지 표시
  const showStatus = active && marchSeconds !== null && marchSeconds >= 1 && marchSeconds <= 180;

  return (
    <section className="personal-panel">
      <h3>개인 현황판</h3>

      {/* 미설정 안내 */}
      {marchSeconds === null && (
        <p className="march-status">
          출발 시점 저장 안됨 — 음성 울리지 않음
        </p>
      )}

      {/* 경고: marchSeconds > totalSeconds */}
      {showWarning && (
        <div className="march-status march-warning">
          이번 판에서는 울리지 않습니다 (설정값 {marchSeconds}s &gt; 총 {totalSeconds}s)
        </div>
      )}

      {/* 활성 중: 내 출발까지 N초 */}
      {showStatus && !showWarning && myRemaining !== null && (
        <p className="march-status">
          {myRemaining > 0
            ? `내 출발까지 ${Math.ceil(myRemaining)}초`
            : '출발! (march TTS 발송됨)'}
        </p>
      )}

      {/* 입력 행 */}
      <div className="march-input-row">
        <input
          className="input march-input"
          type="number"
          min={0}
          max={180}
          placeholder="0~180"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !saving) handleSave();
          }}
        />
        <span style={{ fontSize: 12, color: 'var(--text-3)' }}>초 전 출발</span>
        <button
          className="btn btn-primary"
          style={{ padding: '5px 12px', fontSize: 13 }}
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {/* 현재 저장값 표시 */}
      {marchSeconds !== null && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>
          현재: 카운트다운 {marchSeconds}초 남을 때 출발 음성
        </p>
      )}
    </section>
  );
}
