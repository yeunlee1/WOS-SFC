import { useState, useEffect, useRef, useMemo } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api } from '../../api';
import { speak } from './tts';
import PersonalSyncOffset from './PersonalSyncOffset';
import { formatUser } from '../../utils/formatUser';

// PersonalPanel — 개인 현황판
// 유저 본인의 행군 시간(marchSeconds)을 저장하고,
// 카운트다운이 해당 시점에 도달하면 'march' TTS를 로컬에서 재생한다.
export default function PersonalPanel() {
  const countdown          = useStore((s) => s.countdown);
  // timeOffset에 personalOffsetMs 합산 — march TTS 슬롯 시각도 디바이스별 보정 반영.
  const timeOffset         = useStore((s) => s.timeOffset + s.personalOffsetMs);
  const setMyMarchSeconds  = useStore((s) => s.setMyMarchSeconds);
  const { lang }           = useI18n();

  // 내가 가입한 공격 카운트 그룹 목록 — primitive/refs만 구독하고 파생값은 useMemo로 산출.
  // (인라인 selector에서 .filter()를 쓰면 매 호출 새 배열 참조라 zustand가 불필요한 리렌더 트리거)
  const rallyGroups = useStore((s) => s.rallyGroups);
  const userId = useStore((s) => s.user?.id);
  const myGroups = useMemo(() => {
    if (!userId) return [];
    return rallyGroups.filter((g) => g.members?.some((m) => m.userId === userId));
  }, [rallyGroups, userId]);

  // marchSeconds: null(미설정) | 1~180(설정됨)
  const [marchSeconds, setMarchSeconds] = useState(null);
  const [inputVal,     setInputVal]     = useState('');
  const [saving,       setSaving]       = useState(false);
  const [saveError,    setSaveError]    = useState(null);  // 저장 실패 메시지
  const [loading,      setLoading]      = useState(true);  // 초기 로딩 상태
  const saveErrorTimerRef = useRef(null);

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
          setMyMarchSeconds(data.marchSeconds);
        } else {
          // null 응답 처리
          const fallback = parseInt(localStorage.getItem('wos-march-seconds'), 10);
          if (Number.isFinite(fallback) && fallback >= 1 && fallback <= 180) {
            setMarchSeconds(fallback);
            setInputVal(String(fallback));
            setMyMarchSeconds(fallback);
          } else {
            setMyMarchSeconds(null);
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
          setMyMarchSeconds(fallback);
        } else {
          setMyMarchSeconds(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
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
      setMyMarchSeconds(value);
      // localStorage 동기화
      if (value !== null) {
        localStorage.setItem('wos-march-seconds', String(value));
      } else {
        localStorage.removeItem('wos-march-seconds');
      }
    } catch (e) {
      if (import.meta.env.DEV) console.warn('[PersonalPanel] 저장 실패:', e);
      const msg = e?.message || '저장 실패';
      setSaveError(msg);
      // 5초 뒤 자동 clear
      clearTimeout(saveErrorTimerRef.current);
      saveErrorTimerRef.current = setTimeout(() => setSaveError(null), 5000);
    } finally {
      setSaving(false);
    }
  }

  // ── 통합 tick: TTS 트리거 + "내 출발까지 N초" 표시 ───────────
  const intervalRef  = useRef(null);
  const lastFiredRef = useRef(-1);

  const { active, startedAt, totalSeconds } = countdown;

  const [myRemaining, setMyRemaining] = useState(null);

  useEffect(() => {
    clearInterval(intervalRef.current);
    setMyRemaining(null);

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
        setMyRemaining(0);
        return;
      }

      // TTS 트리거
      const sec = Math.ceil(rem);
      if (sec === marchSeconds && lastFiredRef.current !== marchSeconds) {
        lastFiredRef.current = marchSeconds;
        speak('march', lang);
      }

      // 내 출발까지 남은 시간 = rem - marchSeconds
      setMyRemaining(rem - marchSeconds);
    }

    tick();
    intervalRef.current = setInterval(tick, 200);
    return () => clearInterval(intervalRef.current);
  }, [active, startedAt, totalSeconds, marchSeconds, lang]);

  // ── UI 렌더 ─────────────────────────────────────────────────
  const parsedInput  = parseInt(inputVal, 10);
  const inputValid   = Number.isFinite(parsedInput) && parsedInput >= 1 && parsedInput <= 180;

  // marchSeconds > totalSeconds 경고
  const showWarning  = active && marchSeconds !== null
    && marchSeconds > 0 && totalSeconds > 0
    && marchSeconds > totalSeconds;

  // active 중 출발까지 표시
  const showStatus = active && marchSeconds !== null && marchSeconds >= 1 && marchSeconds <= 180;

  // 로딩 중 스피너 — frost 톤 ring spinner + 텍스트
  if (loading) {
    return (
      <section className="personal-panel">
        <h3>개인 현황판</h3>
        <div className="panel-loading" role="status" aria-live="polite">
          <span className="spinner-ring" aria-hidden="true" />
          <span className="panel-loading-text">불러오는 중</span>
        </div>
      </section>
    );
  }

  return (
    <section className="personal-panel">
      <h3>개인 현황판</h3>

      {/* 저장 실패 에러 배너 */}
      {saveError && (
        <div className="march-error" role="alert" id="personal-save-error">
          {saveError}
        </div>
      )}

      {/* 내가 가입한 공격 카운트 그룹 정보 (Phase F) */}
      {myGroups.length > 0 && (
        <div className="my-rally-info">
          {myGroups.map((g) => (
            <div key={g.id} className="my-rally-card">
              <div className="my-rally-name">{g.name}</div>
              <ul className="my-rally-members">
                {[...g.members].sort((a, b) => a.orderIndex - b.orderIndex).map((m) => {
                  const eff = m.marchSecondsOverride ?? m.user?.marchSeconds;
                  const effText = eff != null ? `${eff}초` : '미설정';
                  return (
                    <li key={m.id}>
                      <span className="leader-badge">집결장</span>
                      <span className="my-rally-member-name">{formatUser(m.user)}</span>
                      <span className="my-rally-member-march">— {effText}</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}

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
        <label htmlFor="march-seconds-input" style={{ fontSize: 12, color: 'var(--text-3)' }}>
          행군 시간
        </label>
        <input
          id="march-seconds-input"
          className="input march-input"
          type="number"
          min={0}
          max={180}
          placeholder="0~180"
          value={inputVal}
          disabled={saving}
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
          aria-describedby={saveError ? 'personal-save-error' : undefined}
        >
          {saving ? '저장 중...' : '저장'}
        </button>
      </div>

      {/* 현재 저장값 표시 */}
      {marchSeconds !== null && (
        <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '4px 0 0' }}>
          현재: 수비 카운트 {marchSeconds}초 남을 때 출발 음성
        </p>
      )}

      <PersonalSyncOffset />
    </section>
  );
}
