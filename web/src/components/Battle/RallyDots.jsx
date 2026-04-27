import { useMemo } from 'react';
import { useStore } from '../../store';
import { useElapsedSeconds } from './useElapsedSeconds';

// RallyDots — 공격 카운트 타임라인 (가로 막대 + 집결장 출발 마커)
// running 중인 그룹 1개만 시각화. 각 집결장의 출발 시점에 닉네임 마커가 꽂힘.
// 본인이 속한 집결장이면 마커 강조. 마커 위치 = (offsetMs / maxOffsetMs) * 100%.
export default function RallyDots() {
  const rallyGroups     = useStore((s) => s.rallyGroups);
  const rallyCountdowns = useStore((s) => s.rallyCountdowns);
  const userId          = useStore((s) => s.user?.id);
  const timeOffset      = useStore((s) => s.timeOffset + s.personalOffsetMs);

  // running 그룹 1개 + 그 카운트다운 페어
  const runningGroup = useMemo(
    () => rallyGroups.find((g) => g.state === 'running'),
    [rallyGroups]
  );
  const countdown = runningGroup ? rallyCountdowns[runningGroup.id] : null;

  const startedAt   = countdown?.startedAtServerMs ?? 0;
  const fireOffsets = countdown?.fireOffsets ?? [];

  // 총 시각화 길이 = max(offsetMs) (밀리초)
  const totalMs = useMemo(() => {
    if (fireOffsets.length === 0) return 0;
    return Math.max(...fireOffsets.map((f) => f.offsetMs));
  }, [fireOffsets]);
  const totalSec = Math.ceil(totalMs / 1000);

  const elapsedFloor = useElapsedSeconds(!!countdown, startedAt, timeOffset);

  // 마커 데이터: 같은 offset(±0.5s) 멤버는 닉네임 ", "로 결합
  const markers = useMemo(() => {
    if (!runningGroup || !countdown || totalMs <= 0) return [];
    const memberByOrder = new Map(
      (runningGroup.members ?? []).map((m) => [m.orderIndex, m])
    );
    // 1초 bin으로 그룹핑
    const bins = new Map(); // sec -> { sec, names[], isMe }
    for (const f of fireOffsets) {
      const sec = Math.round(f.offsetMs / 1000);
      const m   = memberByOrder.get(f.orderIndex);
      if (!m?.user) continue;
      const isMe = userId != null && m.userId === userId;
      const cur = bins.get(sec) || { sec, names: [], isMe: false };
      cur.names.push(m.user.nickname);
      cur.isMe = cur.isMe || isMe;
      bins.set(sec, cur);
    }
    return Array.from(bins.values()).sort((a, b) => a.sec - b.sec);
  }, [runningGroup, countdown, fireOffsets, totalMs, userId]);

  if (!runningGroup || !countdown) {
    return <p className="timeline-empty">공격 카운트가 시작되면 집결장 출발 시점이 표시됩니다</p>;
  }
  if (totalSec === 0) {
    // running 중이지만 fireOffsets 비어있는 race 케이스
    return <p className="timeline-empty">집결장 데이터를 불러오는 중...</p>;
  }

  const progressPct = Math.min(100, (elapsedFloor / totalSec) * 100);
  const remainSec = Math.max(0, totalSec - elapsedFloor);

  return (
    <div className="timeline" role="presentation">
      {/* 마커 영역 */}
      <div className="timeline-markers">
        {markers.map((mk) => {
          const pct = totalSec > 0 ? (mk.sec / totalSec) * 100 : 0;
          const passed = elapsedFloor >= mk.sec;
          const remain = Math.max(0, mk.sec - elapsedFloor);
          const cls = [
            'timeline-marker',
            mk.isMe ? 'timeline-marker--me' : '',
            passed ? 'is-passed' : '',
          ].filter(Boolean).join(' ');
          return (
            <div key={mk.sec} className={cls} style={{ left: `${pct}%` }}>
              <div className="timeline-marker__pin">
                <span className="timeline-marker__name" title={mk.names.join(', ')}>
                  {mk.names.join(', ')}
                </span>
                {!passed && <span className="timeline-marker__time">{remain}s</span>}
              </div>
              <div className="timeline-marker__arrow" />
            </div>
          );
        })}
      </div>

      {/* 진행 막대 + 막대 위 마커 점 */}
      <div className="timeline-bar">
        <div className="timeline-bar__fill" style={{ width: `${progressPct}%` }} />
        {markers.map((mk) => {
          const pct = totalSec > 0 ? (mk.sec / totalSec) * 100 : 0;
          const passed = elapsedFloor >= mk.sec;
          const cls = [
            'timeline-bar__marker-dot',
            mk.isMe ? 'timeline-bar__marker-dot--me' : '',
            passed ? 'is-passed' : '',
          ].filter(Boolean).join(' ');
          return <div key={`d-${mk.sec}`} className={cls} style={{ left: `${pct}%` }} />;
        })}
      </div>

      {/* 시간축 */}
      <div className="timeline-axis">
        <span>0s</span>
        <span className="timeline-axis__now">남은 {remainSec}s</span>
        <span>{totalSec}s</span>
      </div>
    </div>
  );
}
