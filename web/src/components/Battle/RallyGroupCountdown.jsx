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
  const schedKeyRef = useRef('');

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

    primeRallyAudio(countdown.fireOffsets, lang).then(() => {
      scheduleRallyCountdown({
        startedAtServerMs: countdown.startedAtServerMs,
        fireOffsets: countdown.fireOffsets,
        timeOffset,
        lang,
        volume: ttsVolume,
        muted: ttsMuted,
      });
    });

    return () => { /* next run will cancel via schedule */ };
  }, [countdown, timeOffset, lang, ttsVolume, ttsMuted]);

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
    <div className="rally-countdown">
      <div className="rally-countdown__main">
        <div className="rally-countdown__remain">{remainSec}</div>
        {nextFire && (
          <div className="rally-countdown__next">
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
