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

export default function RallyGroupCountdown({ group, countdown }) {
  const user = useStore((s) => s.user);
  const timeOffset = useStore((s) => s.timeOffset);
  const ttsVolume = useStore((s) => s.ttsVolume);
  const ttsMuted = useStore((s) => s.ttsMuted);
  const { lang } = useI18n();

  const [now, setNow] = useState(Date.now());
  const [editingOverride, setEditingOverride] = useState(null);
  const [saving, setSaving] = useState(false);
  const [localMuted, setLocalMuted] = useState(false);
  const schedKeyRef = useRef('');
  const lastOffsetRef = useRef(timeOffset);

  // countdown payload가 새로 시작되면 로컬 음소거 자동 해제
  useEffect(() => {
    setLocalMuted(false);
  }, [countdown?.startedAtServerMs]);

  // Schedule audio when countdown payload arrives or member march times change
  useEffect(() => {
    if (!countdown) {
      stopRallyCountdown();
      schedKeyRef.current = '';
      return;
    }
    const key = `${countdown.startedAtServerMs}:${countdown.fireOffsets.map((f) => `${f.orderIndex}-${f.offsetMs}`).join(',')}`;
    if (schedKeyRef.current === key) return;
    schedKeyRef.current = key;

    // 1번(countdownPlayer) 패턴과 동일: prime은 fire-and-forget, schedule은 즉시 호출.
    // prime을 await하면 Promise.all(criticalKeys)가 수 초 blocking → 초반 슬롯 skip 버그 재현.
    // scheduleRallyCountdown 내부의 500ms Promise.race 워밍업이 타이밍을 보호한다.
    primeRallyAudio(countdown.fireOffsets, lang).catch(() => {});
    scheduleRallyCountdown({
      startedAtServerMs: countdown.startedAtServerMs,
      fireOffsets: countdown.fireOffsets,
      timeOffset,
      lang,
      volume: ttsVolume,
      muted: ttsMuted,
    });
    lastOffsetRef.current = timeOffset;

    return () => { /* next run will cancel via schedule */ };
  // timeOffset은 별도 effect에서 1초 이상 급변 시에만 리스케줄 (잦은 RTT 변동으로 인한 불필요한 재스케줄 방지)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown, lang, ttsVolume, ttsMuted]);

  // timeOffset 급변(1초 이상) 시 리스케줄 — 1번(Countdown.jsx) 패턴과 동일
  useEffect(() => {
    if (!countdown) return;
    const deltaMs = Math.abs(timeOffset - lastOffsetRef.current);
    if (deltaMs <= 1000) return;
    primeRallyAudio(countdown.fireOffsets, lang).catch(() => {});
    scheduleRallyCountdown({
      startedAtServerMs: countdown.startedAtServerMs,
      fireOffsets: countdown.fireOffsets,
      timeOffset,
      lang,
      volume: ttsVolume,
      muted: ttsMuted,
    });
    lastOffsetRef.current = timeOffset;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeOffset, countdown]);

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

  function handleLocalMuteToggle() {
    if (!localMuted) {
      // 로컬 음성만 즉시 중지 — 서버 state 및 다른 사용자에게 영향 없음
      stopRallyCountdown();
      setLocalMuted(true);
    } else {
      // 재개: 현재 countdown 기준으로 남은 슬롯 재스케줄
      if (countdown) {
        primeRallyAudio(countdown.fireOffsets, lang).catch(() => {});
        scheduleRallyCountdown({
          startedAtServerMs: countdown.startedAtServerMs,
          fireOffsets: countdown.fireOffsets,
          timeOffset,
          lang,
          volume: ttsVolume,
          muted: ttsMuted,
        });
      }
      setLocalMuted(false);
    }
  }

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
        <button
          type="button"
          className={`rally-local-mute-btn${localMuted ? ' rally-local-mute-btn--muted' : ''}`}
          onClick={handleLocalMuteToggle}
        >
          {localMuted ? '🔊 음성 재개' : '🔇 음성 중지'}
        </button>
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
                  {isMe && (
                    <button
                      type="button"
                      className="rally-btn"
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
