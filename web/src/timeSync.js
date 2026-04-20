import { api } from './api';
import { useStore } from './store';

const SAMPLE_COUNT = 5;
const SAMPLE_INTERVAL_MS = 80;      // 샘플 간 간격
const SMOOTH_THRESHOLD_MS = 50;     // offset 차이 50ms 이상이면 EMA 스무딩
const SMOOTH_OLD_WEIGHT = 0.3;
const SMOOTH_NEW_WEIGHT = 0.7;

// 첫 동기화 여부 추적 — 초기 동기화는 스무딩 스킵 (store 초기값 0이 실측을 희석하지 않도록)
let _hasSynced = false;

/**
 * SNTP 방식 다중 샘플 동기화.
 * - SAMPLE_COUNT 번 /time을 호출, 각각 RTT·offset 측정
 * - 최소 RTT 샘플의 offset을 채택 (Cristian's algorithm)
 * - 기존 offset과 50ms 이상 차이 나면 EMA 스무딩
 *   (카운트다운이 시각적으로 튀지 않도록)
 * @returns {Promise<{offset:number, rtt:number, samples:Array}>}
 */
export async function syncTime() {
  const samples = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    try {
      const t0 = Date.now();
      const res = await api.getTime();
      const t1 = Date.now();
      const rtt = t1 - t0;
      const offset = res.utc - (t0 + t1) / 2;
      samples.push({ rtt, offset });
    } catch (e) {
      // 한 샘플 실패해도 계속 — 최소 한 개만 성공하면 됨
    }
    if (i < SAMPLE_COUNT - 1) {
      await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
    }
  }

  if (samples.length === 0) {
    throw new Error('시간 동기화 실패 — 모든 샘플이 실패했습니다');
  }

  // 최소 RTT 샘플 채택 (Cristian's algorithm)
  samples.sort((a, b) => a.rtt - b.rtt);
  const best = samples[0];

  // 스무딩 적용 — 카운트다운 표시가 갑자기 튀지 않도록
  // 단, 첫 동기화는 스킵 — store 초기값 0이 실측 offset을 희석하지 않도록
  const store = useStore.getState();
  const prevOffset = store.timeOffset;
  let finalOffset = best.offset;
  if (_hasSynced && Math.abs(best.offset - prevOffset) >= SMOOTH_THRESHOLD_MS) {
    finalOffset = prevOffset * SMOOTH_OLD_WEIGHT + best.offset * SMOOTH_NEW_WEIGHT;
  }
  _hasSynced = true;

  store.setTimeOffset(finalOffset);
  store.setTimeSyncRtt(best.rtt);

  console.info(
    '[timeSync] offset=%dms rtt=%dms samples=%d',
    Math.round(finalOffset),
    best.rtt,
    samples.length,
  );

  return { offset: finalOffset, rtt: best.rtt, samples };
}

// 주기적 재동기화 타이머 핸들
let _periodicTimer = null;

export function startPeriodicSync(intervalMs = 30_000) {
  stopPeriodicSync();
  _periodicTimer = setInterval(() => {
    syncTime().catch(() => { /* 일시 실패 무시 — 다음 주기에 재시도 */ });
  }, intervalMs);
}

export function stopPeriodicSync() {
  if (_periodicTimer) {
    clearInterval(_periodicTimer);
    _periodicTimer = null;
  }
}
