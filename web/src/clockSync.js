// clockSync.js — 디바이스 간 시계 동기화 핵심 모듈
//
// 목적: WOS SFC 동맹원들의 카운트다운 TTS 음성을 동시에 발화하기 위해 각 클라이언트가
//       서버 시각을 정확히 추정하도록 한다.
//
// 핵심 기능:
// - SNTP 5샘플 + NTP 4-timestamp(t0/t1/t2/t3) 알고리즘 — 서버 처리시간을 RTT에서 분리
// - 임계값 계층화: <50ms 무시 / 50~500ms EMA 스무딩 / >=500ms 즉시 채택(클럭 점프)
// - BroadcastChannel 멀티탭 offset 공유 — 동일 사용자 N탭이 1번만 fetch
// - System clock 점프 감지 — 1초마다 Date.now()와 performance.now() 비교, 200ms+ drift 시 즉시 재동기화
// - getServerNow() 단일 진입점 — Date.now() + timeOffset + personalOffsetMs 자동 합산
//
// 사용처: web/src/timeSync.js는 본 모듈의 thin wrapper (백워드 호환).
//        신규 코드는 본 모듈의 getServerNow() / startup() / shutdown() 직접 사용 권장.

import { api, getSocket } from './api';
import { useStore } from './store';

const SAMPLE_COUNT = 3; // 3샘플로 충분 — 한도 절약
const SAMPLE_INTERVAL_MS = 100;
// RTT 표준편차가 이 값 이상이면 네트워크가 불안정한 것으로 간주 — 1회 추가 재샘플 실행
const RTT_STDDEV_RESAMPLE_THRESHOLD_MS = 100;
/**
 * TTS 슬롯 리스케줄 임계값(ms).
 * Web Audio API 스케줄은 AudioContext.currentTime(모노토닉) 기반이라
 * 한 번 예약된 발화는 Date.now() drift와 무관하게 정확히 재생됨.
 * 따라서 일반적인 RTT 변동(수백 ms 이내)으로 인한 재스케줄은 불필요.
 * 시스템 클록이 실제로 1초 이상 점프한 경우에만 재스케줄.
 * personalOffsetMs 변경은 별도 effect에서 임계값 무관 즉시 처리.
 */
export const RESCHEDULE_THRESHOLD_MS = 1000;
const SMOOTH_THRESHOLD_MS = 50;     // 이 미만 변동은 noise로 무시
const JUMP_THRESHOLD_MS = 500;       // 이 이상은 클럭 점프 — 즉시 채택
const SMOOTH_OLD_WEIGHT = 0.3;
const SMOOTH_NEW_WEIGHT = 0.7;
// ws ping은 keep-alive 연결 위에서 동작 — REST(HTTP overhead 5~20ms)보다 가벼움.
// BroadcastChannel 멀티탭 흡수 덕에 단일 사용자 N탭은 1번만 보내므로 5초 주기도 서버 부담 미미.
const PERIODIC_SYNC_MS = 30_000; // 30초로 늘림 — backend throttle 30/분 한도 대비 여유 확보
const DRIFT_CHECK_MS = 5000; // 5초 간격 — 검사 빈도 완화
const DRIFT_THRESHOLD_MS = 1000; // 1000ms — main thread blocking 오탐 방지
const WS_PING_TIMEOUT_MS = 1500; // 1.5초로 단축 — ack 미도달 시 빠르게 REST fallback

let _hasSynced = false;
let _periodicTimer = null;
let _driftTimer = null;
let _lastWallMs = Date.now();
let _lastPerfMs = (typeof performance !== 'undefined') ? performance.now() : 0;
let _broadcastChannel = null;

/**
 * 디바이스 시각 → 서버 기준 시각으로 변환.
 * - timeOffset: 서버와의 시계 오차 (clockSync가 추정)
 * - personalOffsetMs: 사용자가 디바이스별로 미세 보정한 값 (단계 4 UI)
 * 모든 카운트다운/TTS 슬롯 시각 계산에 사용.
 */
export function getServerNow() {
  const store = useStore.getState();
  return Date.now() + (store.timeOffset || 0) + (store.personalOffsetMs || 0);
}

// 단일 sample 측정 — ws ping 우선, 미연결/실패 시 REST `/time` fallback.
// 두 경로 모두 NTP 4-timestamp(t0/t1/t2/t3)로 서버 처리시간을 RTT에서 분리.
async function fetchOneSample() {
  const t0 = Date.now();
  const sock = getSocket();

  // ws 경로 — keep-alive 연결 위라서 HTTP overhead 없음
  if (sock && sock.connected) {
    const wsResult = await new Promise((resolve) => {
      let settled = false;
      const timeout = setTimeout(() => {
        if (!settled) { settled = true; resolve(null); }
      }, WS_PING_TIMEOUT_MS);
      try {
        sock.emit('time:ping', null, (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const t3 = Date.now();
          if (res && typeof res.t1 === 'number' && typeof res.t2 === 'number') {
            const rtt = (t3 - t0) - (res.t2 - res.t1);
            const offset = ((res.t1 - t0) + (res.t2 - t3)) / 2;
            if (Number.isFinite(rtt) && Number.isFinite(offset)) {
              resolve({ rtt, offset });
              return;
            }
          }
          resolve(null);
        });
      } catch {
        if (!settled) { settled = true; clearTimeout(timeout); resolve(null); }
      }
    });
    if (wsResult) return wsResult;
  }

  // REST fallback — ws 미연결 또는 ws 호출 실패 시
  try {
    const res = await api.getTime();
    const t3 = Date.now();
    let rtt, offset;
    if (typeof res.t1 === 'number' && typeof res.t2 === 'number') {
      rtt = (t3 - t0) - (res.t2 - res.t1);
      offset = ((res.t1 - t0) + (res.t2 - t3)) / 2;
    } else {
      // 백워드 호환: 단계 1 머지 전 응답 형식
      rtt = t3 - t0;
      offset = res.utc - (t0 + t3) / 2;
    }
    if (Number.isFinite(rtt) && Number.isFinite(offset)) {
      return { rtt, offset };
    }
  } catch {
    // 모든 경로 실패 — 호출자가 처리
  }
  return null;
}

/**
 * RTT 배열의 표준편차(ms) 계산.
 * @param {Array<{rtt:number}>} samples
 * @returns {number}
 */
function calcRttStddev(samples) {
  if (samples.length < 2) return 0;
  const rtts = samples.map((s) => s.rtt);
  const mean = rtts.reduce((a, b) => a + b, 0) / rtts.length;
  const variance = rtts.reduce((a, b) => a + (b - mean) ** 2, 0) / rtts.length;
  return Math.sqrt(variance);
}

/**
 * SNTP 다중 샘플 동기화.
 * - SAMPLE_COUNT 번 ws ping(또는 REST fallback)으로 RTT·offset 측정
 * - NTP 4-timestamp(서버 처리시간 분리) — fetchOneSample 참고
 * - 최소 RTT 샘플 채택 후 임계값 계층화
 * - RTT 표준편차 100ms+ 시 1회 추가 재샘플 (단계 2 명세)
 * @param {boolean} [_isResample=false] — 재귀 방지용 내부 플래그
 * @returns {Promise<{offset:number, rtt:number, samples:Array}>}
 */
export async function syncTime(_isResample = false) {
  const samples = [];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const sample = await fetchOneSample();
    if (sample) samples.push(sample);
    if (i < SAMPLE_COUNT - 1) {
      await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
    }
  }

  if (samples.length === 0) {
    throw new Error('시간 동기화 실패 — 모든 샘플이 실패했습니다');
  }

  // RTT 표준편차 100ms+ → 네트워크 불안정 → 1회 추가 재샘플 (무한 재귀 방지: _isResample 플래그)
  if (!_isResample && calcRttStddev(samples) >= RTT_STDDEV_RESAMPLE_THRESHOLD_MS) {
    console.warn(
      '[clockSync] RTT 표준편차 과다 (%dms), 재샘플 실행',
      Math.round(calcRttStddev(samples)),
    );
    return syncTime(true);
  }

  // 최소 RTT 샘플 채택 (Cristian's algorithm — 네트워크 지연 적은 샘플이 가장 정확)
  samples.sort((a, b) => a.rtt - b.rtt);
  const best = samples[0];

  // 임계값 계층화
  const store = useStore.getState();
  const prevOffset = store.timeOffset;
  const delta = best.offset - prevOffset;
  let finalOffset;
  if (!_hasSynced || Math.abs(delta) >= JUMP_THRESHOLD_MS) {
    // 첫 동기화 또는 클럭 점프 → 즉시 100% 채택
    finalOffset = best.offset;
  } else if (Math.abs(delta) < SMOOTH_THRESHOLD_MS) {
    // 작은 변동은 noise로 간주, 기존 offset 유지 (시각적 튐 방지)
    finalOffset = prevOffset;
  } else {
    // 50~500ms 범위는 EMA 스무딩 — 카운트다운이 시각적으로 튀지 않도록
    finalOffset = prevOffset * SMOOTH_OLD_WEIGHT + best.offset * SMOOTH_NEW_WEIGHT;
  }
  _hasSynced = true;

  store.setTimeOffset(finalOffset);
  store.setTimeSyncRtt(best.rtt);

  // 멀티탭 공유 — 다른 탭들이 자기 fetch 안 하고 이 결과 사용
  if (_broadcastChannel) {
    try {
      _broadcastChannel.postMessage({ type: 'offset', offset: finalOffset, rtt: best.rtt });
    } catch {
      // 채널 닫혔거나 직렬화 실패 — 무시
    }
  }

  console.info(
    '[clockSync] offset=%dms rtt=%dms samples=%d delta=%dms',
    Math.round(finalOffset), best.rtt, samples.length, Math.round(delta),
  );

  return { offset: finalOffset, rtt: best.rtt, samples };
}

/**
 * System clock 점프 감지.
 * Date.now() (wall clock)는 사용자가 시계를 수동 변경하거나 NTP 보정 시 점프하지만,
 * performance.now() (monotonic clock)는 점프하지 않음. 두 값의 delta 차이로 점프 감지.
 */
function startDriftCheck() {
  stopDriftCheck();
  if (typeof performance === 'undefined') return;
  _lastWallMs = Date.now();
  _lastPerfMs = performance.now();
  _driftTimer = setInterval(() => {
    const wall = Date.now();
    const perf = performance.now();
    const drift = (wall - _lastWallMs) - (perf - _lastPerfMs);
    _lastWallMs = wall;
    _lastPerfMs = perf;
    if (Math.abs(drift) > DRIFT_THRESHOLD_MS) {
      console.warn(`[clockSync] system clock 점프 감지 (drift=${Math.round(drift)}ms), 재동기화`);
      syncTime().catch(() => {});
    }
  }, DRIFT_CHECK_MS);
}

function stopDriftCheck() {
  if (_driftTimer) {
    clearInterval(_driftTimer);
    _driftTimer = null;
  }
}

/**
 * 주기적 재동기화 timer 시작 — 30초마다.
 */
export function startPeriodicSync(intervalMs = PERIODIC_SYNC_MS) {
  stopPeriodicSync();
  _periodicTimer = setInterval(() => {
    syncTime().catch(() => {});
  }, intervalMs);
}

export function stopPeriodicSync() {
  if (_periodicTimer) {
    clearInterval(_periodicTimer);
    _periodicTimer = null;
  }
}

/**
 * 부팅 시 1회 호출 — 멀티탭 채널 시작 + 첫 동기화 + 주기적 timer + drift 감지 모두 활성.
 */
export async function startup() {
  if (typeof BroadcastChannel !== 'undefined' && !_broadcastChannel) {
    try {
      _broadcastChannel = new BroadcastChannel('wos-clock');
      _broadcastChannel.addEventListener('message', (e) => {
        if (e.data?.type === 'offset' && Number.isFinite(e.data.offset)) {
          const store = useStore.getState();
          store.setTimeOffset(e.data.offset);
          if (Number.isFinite(e.data.rtt)) store.setTimeSyncRtt(e.data.rtt);
          _hasSynced = true;
        }
      });
    } catch {
      // BroadcastChannel 미지원 (Safari 구버전 등) — 무시, 단일 탭 모드
    }
  }
  await syncTime();
  startPeriodicSync();
  startDriftCheck();
}

/**
 * 언마운트 시 호출 — 모든 timer 및 채널 정리.
 */
export function shutdown() {
  stopPeriodicSync();
  stopDriftCheck();
  if (_broadcastChannel) {
    try { _broadcastChannel.close(); } catch {
      // 이미 닫힘 — 무시
    }
    _broadcastChannel = null;
  }
}
