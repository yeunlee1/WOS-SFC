import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../store';
import { useI18n } from '../../i18n';
import { api } from '../../api';
import { formatUser } from '../../utils/formatUser';
import {
  scheduleRallyCountdown,
  stopRallyCountdown,
  setRallyVolume,
  primeRallyAudio,
} from './rallyGroupPlayer';
import { RESCHEDULE_THRESHOLD_MS } from '../../clockSync';

export default function RallyGroupCountdown({ group, countdown }) {
  const user = useStore((s) => s.user);
  // timeOffset과 personalOffsetMs를 별도 구독 —
  // personalOffsetMs 변경 시 즉시 리스케줄 effect가 임계값 무관 트리거되도록.
  const clockOffset      = useStore((s) => s.timeOffset);
  const personalOffsetMs = useStore((s) => s.personalOffsetMs);
  // 실제 시각 계산에는 두 값의 합산 사용
  const timeOffset       = clockOffset + personalOffsetMs;
  const ttsVolume = useStore((s) => s.ttsVolume);
  const ttsMuted = useStore((s) => s.ttsMuted);
  const { lang } = useI18n();

  const [now, setNow] = useState(Date.now());
  const [editingOverride, setEditingOverride] = useState(null);
  const [saving, setSaving] = useState(false);
  const lastOffsetRef = useRef(timeOffset);

  // 스케줄 effect 의 deps 로 쓸 원시값 키.
  // countdown 객체를 그대로 deps 에 두면 값이 같아도 참조가 바뀔 때마다 effect 가 재실행된다.
  // 재접속 스냅샷은 같은 페이로드를 "새 객체"로 다시 보내므로, 그때마다
  // scheduleRallyCountdown → stopRallyCountdown 이 울리던 단어를 자르고
  // 재예약 때 past-due 가드가 그 슬롯을 버려 본인 순번 안내를 통째로 놓쳤다.
  // 절대예약은 소켓 상태와 무관하게 정확히 재생되므로 값이 같으면 아무 것도 하지 않는다.
  const countdownKey = useMemo(() => {
    if (!countdown) return null;
    const offsets = (countdown.fireOffsets ?? [])
      .map((f) => `${f.orderIndex}:${f.offsetMs}`)
      .join(',');
    return `${countdown.startedAtServerMs}|${offsets}`;
  }, [countdown]);

  // effect 안에서 최신 countdown 객체를 읽기 위한 ref — effect 자체는 countdownKey 로만 돈다.
  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;

  // 언마운트(정지 버튼 등으로 컴포넌트 제거) 시 오디오 즉시 정리
  useEffect(() => () => stopRallyCountdown(), []);

  // countdown 페이로드 또는 언어 변경 시 전체 리스케줄.
  // ttsVolume/ttsMuted는 별도 effect로 분리 — schedule effect deps에 두면 볼륨 슬라이더 조작 시
  // 재생 중 오디오가 끊기며 재스케줄된다. schedKeyRef 기반 dedup은 StrictMode 이중 invocation에서
  // 첫 setup이 set한 key가 cleanup 이후 re-setup의 early-return을 유발해 stop→restart 시
  // 완전 미동작하는 버그를 일으켜 제거. scheduleRallyCountdown 내부에서 기존 스케줄을
  // stopRallyCountdown()으로 취소하므로 재호출은 idempotent.
  useEffect(() => {
    const cd = countdownRef.current;
    if (!cd) {
      stopRallyCountdown();
      return;
    }
    const { ttsVolume: vol, ttsMuted: mut } = useStore.getState();
    primeRallyAudio(cd.fireOffsets, lang, group.displayOrder).catch(() => {});
    scheduleRallyCountdown({
      startedAtServerMs: cd.startedAtServerMs,
      fireOffsets: cd.fireOffsets,
      timeOffset,
      lang,
      volume: vol,
      muted: mut,
      displayOrder: group.displayOrder,
    });
    lastOffsetRef.current = timeOffset;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdownKey, lang, group.displayOrder]);

  // clockOffset 급변(RESCHEDULE_THRESHOLD_MS 이상) 시 리스케줄 — RESCHEDULE_THRESHOLD_MS 상수 사용 (Q1-a)
  useEffect(() => {
    if (!countdown) return;
    const effectiveOffset = clockOffset + personalOffsetMs;
    const deltaMs = Math.abs(effectiveOffset - lastOffsetRef.current);
    if (deltaMs <= RESCHEDULE_THRESHOLD_MS) return;
    const { ttsVolume: vol, ttsMuted: mut } = useStore.getState();
    primeRallyAudio(countdown.fireOffsets, lang, group.displayOrder).catch(() => {});
    scheduleRallyCountdown({
      startedAtServerMs: countdown.startedAtServerMs,
      fireOffsets: countdown.fireOffsets,
      timeOffset: effectiveOffset,
      lang,
      volume: vol,
      muted: mut,
      displayOrder: group.displayOrder,
    });
    lastOffsetRef.current = effectiveOffset;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockOffset, countdown]);

  // personalOffsetMs 변경 시 즉시 리스케줄 — 슬라이더 조작에 즉각 반응 (Q1-b)
  // Q-mount-1: effectiveOffset이 main effect에서 이미 설정한 lastOffsetRef와 동일하면 skip —
  //   mount 시점에 main effect가 먼저 실행되므로 첫 렌더에서 중복 scheduleRallyCountdown 호출 방지.
  useEffect(() => {
    if (!countdown) return;
    const effectiveOffset = clockOffset + personalOffsetMs;
    if (lastOffsetRef.current === effectiveOffset) return; // 첫 렌더 또는 변경 없음 — skip
    const { ttsVolume: vol, ttsMuted: mut } = useStore.getState();
    primeRallyAudio(countdown.fireOffsets, lang, group.displayOrder).catch(() => {});
    scheduleRallyCountdown({
      startedAtServerMs: countdown.startedAtServerMs,
      fireOffsets: countdown.fireOffsets,
      timeOffset: effectiveOffset,
      lang,
      volume: vol,
      muted: mut,
      displayOrder: group.displayOrder,
    });
    lastOffsetRef.current = effectiveOffset;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [personalOffsetMs, countdown]);

  useEffect(() => { setRallyVolume(ttsVolume, ttsMuted); }, [ttsVolume, ttsMuted]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);

  const sortedMembers = useMemo(
    () => [...(group.members ?? [])].sort((a, b) => a.orderIndex - b.orderIndex),
    [group]
  );

  const fireByOrder = useMemo(() => {
    const map = new Map();
    for (const f of (countdown?.fireOffsets ?? [])) map.set(f.orderIndex, f);
    return map;
  }, [countdown]);

  const serverNow = now + timeOffset;
  const maxOffsetMs = Math.max(0, ...(countdown?.fireOffsets ?? []).map((f) => f.offsetMs));
  const endServerMs = (countdown?.startedAtServerMs ?? 0) + maxOffsetMs;
  const remainMs = Math.max(0, endServerMs - serverNow);
  const remainSec = Math.ceil(remainMs / 1000);

  const nextFire = useMemo(() => {
    if (!countdown) return null;
    const upcoming = countdown.fireOffsets
      .map((f) => ({ ...f, absMs: countdown.startedAtServerMs + f.offsetMs }))
      .filter((f) => f.absMs >= serverNow - 200)
      .sort((a, b) => a.absMs - b.absMs);
    return upcoming[0] ?? null;
  }, [countdown, serverNow]);

  async function saveOverride(memberId) {
    const parsed = parseInt(editingOverride?.value ?? '', 10);
    const value = Number.isFinite(parsed) && parsed >= 1 && parsed <= 600 ? parsed : null;
    setSaving(true);
    try {
      await api.updateRallyMarchOverride(group.id, memberId, value);
      setEditingOverride(null);
    } catch (e) {
      alert(e?.message || '저장 실패');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rally-group-countdown">
      <div className="rally-group-countdown__main">
        <div className="rally-group-countdown__remain">{remainSec}</div>
        {nextFire && (
          <div className="rally-group-countdown__next">
            다음 열기: {nextFire.orderIndex}번 집결장
            {sortedMembers.find((m) => m.orderIndex === nextFire.orderIndex)?.user
              ? ` (${formatUser(sortedMembers.find((m) => m.orderIndex === nextFire.orderIndex).user)})`
              : ''}
          </div>
        )}
      </div>

      <ul className="rally-timeline">
        {sortedMembers.map((m) => {
          const f = fireByOrder.get(m.orderIndex);
          const absMs = f ? countdown.startedAtServerMs + f.offsetMs : null;
          const fired = absMs != null && serverNow >= absMs;
          const isMe = user && m.userId === user.id;
          const effective = m.marchSecondsOverride ?? m.user?.marchSeconds ?? null;

          return (
            <li key={m.id} className={`rally-timeline__row ${fired ? 'fired' : ''}`}>
              <span className="rally-member-order">{m.orderIndex}번</span>
              <span className="rally-member-name">{formatUser(m.user)}</span>
              {isMe && editingOverride?.memberId === m.id ? (
                <>
                  <input
                    type="number"
                    className="rally-march-input"
                    value={editingOverride.value}
                    onChange={(e) => setEditingOverride({ memberId: m.id, value: e.target.value })}
                    min={1}
                    max={600}
                    autoFocus
                  />
                  <button type="button" className="rally-btn rally-btn--primary" disabled={saving} onClick={() => saveOverride(m.id)}>저장</button>
                  <button type="button" className="rally-btn" onClick={() => setEditingOverride(null)}>취소</button>
                </>
              ) : (
                <>
                  <span className="rally-member-march">
                    {effective != null ? `${effective}초` : '미설정'}
                  </span>
                  {/* 진행 중에는 비활성 — 저장하면 전원의 발사 시각과 호명 번호가 밀린다.
                      서버도 409로 거절한다(rally-groups.service.updateMarchOverride). */}
                  {isMe && (
                    <button
                      type="button"
                      className="rally-btn"
                      disabled={group.state === 'running'}
                      title={group.state === 'running' ? '카운트다운 진행 중에는 바꿀 수 없습니다' : undefined}
                      onClick={() => setEditingOverride({ memberId: m.id, value: String(effective ?? '') })}
                    >
                      수정
                    </button>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
