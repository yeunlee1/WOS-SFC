import { useMemo } from 'react';
import { useStore } from '../../store';
import { useElapsedSeconds } from './useElapsedSeconds';

// RallyDots — 공격 카운트 타임라인 점 시각화
// running 중인 그룹 1개만 시각화. zustand에서 직접 구독. props 없음.
// CSS 클래스(.dots-row, .dot, .dot--red, .dot-cell, .dot-label, .dots-empty)는
// Phase E2에서 정의됨 — 이 시점에는 스타일 미적용이 정상.
export default function RallyDots() {
  const rallyGroups     = useStore((s) => s.rallyGroups);
  const rallyCountdowns = useStore((s) => s.rallyCountdowns);
  const timeOffset      = useStore((s) => s.timeOffset + s.personalOffsetMs);

  // running 그룹 1개와 그 카운트다운 페어
  const runningGroup = useMemo(
    () => rallyGroups.find((g) => g.state === 'running'),
    [rallyGroups]
  );
  const countdown = runningGroup ? rallyCountdowns[runningGroup.id] : null;

  // startedAtServerMs는 서버 시각 — useElapsedSeconds는 (Date.now() + timeOffset) 기준이므로 동일
  const startedAt   = countdown?.startedAtServerMs ?? 0;
  const fireOffsets = countdown?.fireOffsets ?? [];

  // 총 시각화 길이 = max(offsetMs)/1000 초 (반올림 올림)
  const totalSec = useMemo(() => {
    if (fireOffsets.length === 0) return 0;
    const maxMs = Math.max(...fireOffsets.map((f) => f.offsetMs));
    return Math.ceil(maxMs / 1000);
  }, [fireOffsets]);

  const elapsedFloor = useElapsedSeconds(!!countdown, startedAt, timeOffset);

  // 인덱스별 라벨: { [secIndex]: 'nick1, nick2' }
  const labelsByIndex = useMemo(() => {
    if (!runningGroup || !countdown) return {};
    const memberByOrder = new Map(
      (runningGroup.members ?? []).map((m) => [m.orderIndex, m])
    );
    const map = {};
    for (const f of fireOffsets) {
      const idx = Math.round(f.offsetMs / 1000);
      const m   = memberByOrder.get(f.orderIndex);
      if (!m?.user) continue;
      const name = m.user.nickname; // 점 라벨은 짧게 nickname만
      if (map[idx]) map[idx] = `${map[idx]}, ${name}`;
      else map[idx] = name;
    }
    return map;
  }, [runningGroup, countdown, fireOffsets]);

  const dots = useMemo(() => {
    if (!runningGroup || !countdown || totalSec < 1) return [];
    return Array.from({ length: totalSec + 1 }, (_, i) => i); // 0..totalSec 포함
  }, [runningGroup, countdown, totalSec]);

  if (!runningGroup || !countdown) {
    return <p className="dots-empty">공격 카운트가 시작되면 집결장 출발 시점이 표시됩니다</p>;
  }

  return (
    <div className="dots-row" role="presentation">
      {dots.map((i) => (
        <div key={i} className="dot-cell">
          <span className={`dot${i < elapsedFloor ? ' dot--red' : ''}`} aria-hidden="true" />
          {labelsByIndex[i] && <span className="dot-label">{labelsByIndex[i]}</span>}
        </div>
      ))}
    </div>
  );
}
