import { useEffect, useState } from 'react';

// 매 250ms tick으로 elapsed 초를 계산하되,
// floor 값이 바뀔 때만 setState → 1초당 1회 리렌더로 최소화.
export function useElapsedSeconds(active, startedAt, timeOffset) {
  const [elapsedFloor, setElapsedFloor] = useState(0);

  useEffect(() => {
    if (!active) {
      setElapsedFloor(0);
      return;
    }
    function tick() {
      const elapsed = (Date.now() + timeOffset - startedAt) / 1000;
      setElapsedFloor((prev) => {
        const next = Math.floor(elapsed);
        return next === prev ? prev : Math.max(0, next);
      });
    }
    tick();
    const id = setInterval(tick, 250);
    return () => clearInterval(id);
  }, [active, startedAt, timeOffset]);

  return elapsedFloor;
}
