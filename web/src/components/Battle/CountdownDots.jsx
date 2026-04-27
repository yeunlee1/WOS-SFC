import { useMemo } from 'react';
import { useStore } from '../../store';
import { useElapsedSeconds } from './useElapsedSeconds';

// CountdownDots — 수비 카운트 타임라인 (가로 막대 + 출발 마커)
// 막대가 진행에 따라 채워지고, 사용자 marchSeconds 시점에 "출발" 마커가 꽂힘.
export default function CountdownDots() {
  const countdown      = useStore((s) => s.countdown);
  const timeOffset     = useStore((s) => s.timeOffset + s.personalOffsetMs);
  const myMarchSeconds = useStore((s) => s.myMarchSeconds);

  const { active, startedAt, totalSeconds } = countdown;
  const elapsedFloor = useElapsedSeconds(active, startedAt, timeOffset);

  // 출발 시점(시작 후 N초) = totalSeconds - marchSeconds
  // 카운트다운이 marchSeconds 남았을 때 출발 → 시작 후 (totalSeconds-marchSeconds)초.
  const departSec = useMemo(() => {
    if (myMarchSeconds == null || myMarchSeconds < 1) return -1;
    if (myMarchSeconds > totalSeconds) return -1; // 이번 판에서는 안 울림
    return totalSeconds - myMarchSeconds;
  }, [myMarchSeconds, totalSeconds]);

  if (!active) {
    return <p className="timeline-empty">수비 카운트가 시작되면 타임라인이 표시됩니다</p>;
  }

  const progressPct = totalSeconds > 0 ? Math.min(100, (elapsedFloor / totalSeconds) * 100) : 0;
  const remainSec = Math.max(0, totalSeconds - elapsedFloor);
  const departPct = departSec > 0 ? (departSec / totalSeconds) * 100 : -1;
  const departPassed = departSec >= 0 && elapsedFloor >= departSec;
  const departRemain = Math.max(0, departSec - elapsedFloor);

  return (
    <div className="timeline" role="presentation">
      {/* 마커 영역 (막대 위) */}
      <div className="timeline-markers">
        {departPct >= 0 && (
          <div
            className={`timeline-marker timeline-marker--me${departPassed ? ' is-passed' : ''}`}
            style={{ left: `${departPct}%` }}
          >
            <div className="timeline-marker__pin">
              <span className="timeline-marker__name">출발</span>
              {!departPassed && <span className="timeline-marker__time">{departRemain}s</span>}
            </div>
            <div className="timeline-marker__arrow" />
          </div>
        )}
      </div>

      {/* 진행 막대 */}
      <div className="timeline-bar">
        <div className="timeline-bar__fill" style={{ width: `${progressPct}%` }} />
        {departPct >= 0 && (
          <div
            className={`timeline-bar__marker-dot timeline-bar__marker-dot--me${departPassed ? ' is-passed' : ''}`}
            style={{ left: `${departPct}%` }}
          />
        )}
      </div>

      {/* 시간축 */}
      <div className="timeline-axis">
        <span>0s</span>
        <span className="timeline-axis__now">남은 {remainSec}s</span>
        <span>{totalSeconds}s</span>
      </div>
    </div>
  );
}
