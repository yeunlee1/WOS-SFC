import { useMemo } from 'react';
import { useStore } from '../../store';
import { useElapsedSeconds } from './useElapsedSeconds';

// CountdownDots — 수비 카운트 타임라인 점 시각화
// zustand에서 직접 구독. props 없음.
// CSS 클래스(.dots-row, .dot, .dot--red, .dot-cell, .dot-label, .dots-empty)는
// Phase E2에서 정의됨 — 이 시점에는 스타일 미적용이 정상.
export default function CountdownDots() {
  const countdown      = useStore((s) => s.countdown);
  const timeOffset     = useStore((s) => s.timeOffset + s.personalOffsetMs);
  const myMarchSeconds = useStore((s) => s.myMarchSeconds);

  const { active, startedAt, totalSeconds } = countdown;
  const elapsedFloor = useElapsedSeconds(active, startedAt, timeOffset);

  // 출발 라벨 인덱스 = totalSeconds - marchSeconds
  // (카운트다운이 marchSeconds 남았을 때 출발 → 시작 후 totalSeconds-marchSeconds초 시점)
  const departIndex = useMemo(() => {
    if (myMarchSeconds == null || myMarchSeconds < 1) return -1;
    if (myMarchSeconds > totalSeconds) return -1; // 이번 판에서는 안 울림
    return totalSeconds - myMarchSeconds;
  }, [myMarchSeconds, totalSeconds]);

  const dots = useMemo(() => {
    if (!active || totalSeconds < 1) return [];
    return Array.from({ length: totalSeconds }, (_, i) => i);
  }, [active, totalSeconds]);

  if (!active) {
    return <p className="dots-empty">수비 카운트가 시작되면 점이 표시됩니다</p>;
  }

  return (
    <div className="dots-row" role="presentation">
      {dots.map((i) => (
        <div key={i} className="dot-cell">
          <span className={`dot${i < elapsedFloor ? ' dot--red' : ''}`} aria-hidden="true" />
          {i === departIndex && <span className="dot-label">출발</span>}
        </div>
      ))}
    </div>
  );
}
