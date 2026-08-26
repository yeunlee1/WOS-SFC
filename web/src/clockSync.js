// clockSync.js — 디바이스 간 시계 동기화 핵심 모듈
//
// 목적: WOS SFC 동맹원들의 카운트다운 TTS 음성을 동시에 발화하기 위해 각 클라이언트가
//       서버 시각을 정확히 추정하도록 한다.
//
// 핵심 기능:
// - SNTP 5샘플 + NTP 4-timestamp(t0/t1/t2/t3) 알고리즘 — 서버 처리시간을 RTT에서 분리
// - RTT 최소 샘플 채택(Cristian) + RTT 편차가 크면 추가 샘플 3개를 더 모아 합산
// - 임계값 계층화: <500ms EMA 스무딩(50/50) / >=500ms 즉시 채택(클럭 점프)
//   데드밴드는 두지 않는다 — 첫 샘플의 편향이 영구 고정되는 것을 막기 위함
// - BroadcastChannel 멀티탭 offset 전파 — 다른 탭이 측정한 값을 즉시 반영(각 탭의 주기
//   동기화를 대체하지는 않는다)
// - System clock 점프 감지 — DRIFT_CHECK_MS마다 Date.now()와 performance.now() 비교
// - startup() 첫 동기화 실패 시 백오프 재시도, 그동안 store.timeSyncState로 미동기화 노출
// - getServerNow() 단일 진입점 — Date.now() + timeOffset + personalOffsetMs 자동 합산
//
// 사용처: web/src/timeSync.js는 본 모듈의 thin wrapper (백워드 호환).
//        신규 코드는 본 모듈의 getServerNow() / startup() / shutdown() 직접 사용 권장.

import { api, getSocket } from './api';
import { useStore } from './store';

// LTE/5G의 RTT 지터(50~300ms)에서는 3샘플로 최소 RTT를 뽑기에 부족해 5샘플로 늘렸다.
// 서버 한도 대비 계산: ws time:ping 30회/분, 주기 동기화 30초(=2회/분).
// 최악(추가 샘플까지) 2 × (5+3) = 16회/분 → drift·재접속 트리거분을 더해도 한도 안.
const SAMPLE_COUNT = 5;
const SAMPLE_INTERVAL_MS = 100;
// RTT 표준편차가 이 값 이상이면 지터가 큰 것으로 보고 아래 개수만큼 샘플을 더 모은다.
// 기존 구현은 모은 샘플을 전량 폐기하고 처음부터 다시 모았으나, 버린 쪽에도 최소 RTT
// 후보가 들어 있어 한도만 쓰고 정확도는 나아지지 않았다. 이제 이어 모아 합쳐서 판단한다.
const RTT_STDDEV_RESAMPLE_THRESHOLD_MS = 100;
const EXTRA_SAMPLE_COUNT = 3;
/**
 * TTS 슬롯 리스케줄 임계값(ms).
 * timeOffset 변동이 이 값 이상일 때만 이미 예약된 발화를 다시 잡는다.
 * 잦은 리스케줄은 그 자체로 발화 누락·중복을 만들므로 임계값을 둔다.
 * personalOffsetMs 변경은 별도 effect에서 임계값 무관 즉시 처리.
 *
 * 주의 — 이 값보다 작은 offset 변동은 이미 예약된 발화에 반영되지 않는다.
 * 예약이 실제로 얼마나 정확히 재생되는지는 재생 측(countdownPlayer/rallyGroupPlayer)
 * 구현에 달려 있고, 본 모듈은 그것을 보증하지 않는다.
 */
export const RESCHEDULE_THRESHOLD_MS = 1000;
const JUMP_THRESHOLD_MS = 500; // 이 이상은 클럭 점프 — 즉시 채택
// 데드밴드(변동 무시 구간)를 두지 않는 이유:
// 첫 동기화는 100% 채택이라 그때의 비대칭 편향이 그대로 offset이 된다. 이후 재동기화의
// 차이가 데드밴드보다 작으면 값이 전혀 갱신되지 않아 그 편향이 영구히 남았다.
// 대신 EMA를 절반씩 섞어 noise를 흡수한다 — 정상상태 분산이 측정 분산의 1/3로 줄고
// 반복 동기화는 실측값으로 수렴한다. 리스케줄은 RESCHEDULE_THRESHOLD_MS가 따로 막는다.
const SMOOTH_OLD_WEIGHT = 0.5;
const SMOOTH_NEW_WEIGHT = 0.5;
// 첫 동기화 실패 시 재시도 간격(ms). 끝값에 도달하면 그 값으로 반복한다.
const STARTUP_RETRY_BACKOFF_MS = [1000, 2000, 5000, 10_000, 30_000];
// ws ping은 keep-alive 연결 위에서 동작 — REST(HTTP overhead 5~20ms)보다 가벼움.
// 주의 — BroadcastChannel은 결과를 다른 탭에 전파할 뿐 그 탭의 주기 동기화를 막지 않는다.
// 즉 N탭이면 서버 호출도 N배다. 한도 계산은 탭 하나(=소켓 하나) 기준이다.
const PERIODIC_SYNC_MS = 30_000; // ws time:ping 30회/분 한도 대비 여유 확보
const DRIFT_CHECK_MS = 5000; // 5초 간격 — 검사 빈도 완화
const DRIFT_THRESHOLD_MS = 1000; // 1000ms — main thread blocking 오탐 방지
const WS_PING_TIMEOUT_MS = 1500; // 1.5초로 단축 — ack 미도달 시 빠르게 REST fallback

let _hasSynced = false;
let _periodicTimer = null;
let _driftTimer = null;
let _lastWallMs = Date.now();
let _lastPerfMs = typeof performance !== 'undefined' ? performance.now() : 0;
let _broadcastChannel = null;
let _startupPromise = null;
let _started = false;
let _lifecycleToken = 0;

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
        if (!settled) {
          settled = true;
          resolve(null);
        }
      }, WS_PING_TIMEOUT_MS);
      try {
        sock.emit('time:ping', null, (res) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          const t3 = Date.now();
          if (res && typeof res.t1 === 'number' && typeof res.t2 === 'number') {
            const rtt = t3 - t0 - (res.t2 - res.t1);
            const offset = (res.t1 - t0 + (res.t2 - t3)) / 2;
            if (Number.isFinite(rtt) && Number.isFinite(offset)) {
              resolve({ rtt, offset });
              return;
            }
          }
          resolve(null);
        });
      } catch {
        if (!settled) {
          settled = true;
          clearTimeout(timeout);
          resolve(null);
        }
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
      rtt = t3 - t0 - (res.t2 - res.t1);
      offset = (res.t1 - t0 + (res.t2 - t3)) / 2;
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

/** 샘플을 count개 수집해 samples 배열에 밀어 넣는다. 각 샘플 사이에 SAMPLE_INTERVAL_MS 대기. */
async function collectSamples(samples, count, waitBeforeFirst) {
  for (let i = 0; i < count; i++) {
    if (i > 0 || waitBeforeFirst) {
      await new Promise((r) => setTimeout(r, SAMPLE_INTERVAL_MS));
    }
    const sample = await fetchOneSample();
    if (sample) samples.push(sample);
  }
}

/**
 * SNTP 다중 샘플 동기화.
 * - SAMPLE_COUNT 번 ws ping(또는 REST fallback)으로 RTT·offset 측정
 * - NTP 4-timestamp(서버 처리시간 분리) — fetchOneSample 참고
 * - RTT 편차가 크면 EXTRA_SAMPLE_COUNT개를 더 모아 같은 풀에 합침
 * - 최소 RTT 샘플 채택 후 EMA 스무딩(클럭 점프는 즉시 채택)
 * @returns {Promise<{offset:number, rtt:number, samples:Array}>}
 */
export async function syncTime() {
  const samples = [];
  await collectSamples(samples, SAMPLE_COUNT, false);

  if (samples.length === 0) {
    throw new Error('시간 동기화 실패 — 모든 샘플이 실패했습니다');
  }

  // RTT 편차가 크면(지터 큰 모바일 회선) 추가 샘플로 최소 RTT 후보를 늘린다.
  // 모은 샘플을 버리지 않으므로 서버 호출은 최대 SAMPLE_COUNT + EXTRA_SAMPLE_COUNT 번.
  if (calcRttStddev(samples) >= RTT_STDDEV_RESAMPLE_THRESHOLD_MS) {
    console.warn(
      '[clockSync] RTT 표준편차 과다 (%dms), 샘플 %d개 추가 수집',
      Math.round(calcRttStddev(samples)),
      EXTRA_SAMPLE_COUNT,
    );
    await collectSamples(samples, EXTRA_SAMPLE_COUNT, true);
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
  } else {
    // 그 밖의 모든 변동은 EMA 스무딩 — 무시 구간을 두지 않아 편향이 남지 않는다
    finalOffset =
      prevOffset * SMOOTH_OLD_WEIGHT + best.offset * SMOOTH_NEW_WEIGHT;
  }
  _hasSynced = true;

  store.setTimeOffset(finalOffset);
  store.setTimeSyncRtt(best.rtt);
  store.setTimeSyncState('synced');

  // 멀티탭 전파 — 다른 탭이 자기 주기 동기화를 기다리지 않고 최신 값을 바로 반영
  if (_broadcastChannel) {
    try {
      _broadcastChannel.postMessage({
        type: 'offset',
        offset: finalOffset,
        rtt: best.rtt,
      });
    } catch {
      // 채널 닫혔거나 직렬화 실패 — 무시
    }
  }

  console.info(
    '[clockSync] offset=%dms rtt=%dms samples=%d delta=%dms',
    Math.round(finalOffset),
    best.rtt,
    samples.length,
    Math.round(delta),
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
    const drift = wall - _lastWallMs - (perf - _lastPerfMs);
    _lastWallMs = wall;
    _lastPerfMs = perf;
    if (Math.abs(drift) > DRIFT_THRESHOLD_MS) {
      console.warn(
        `[clockSync] system clock 점프 감지 (drift=${Math.round(drift)}ms), 재동기화`,
      );
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
export function startup() {
  if (_started) return Promise.resolve();
  if (_startupPromise) return _startupPromise;

  const lifecycleToken = ++_lifecycleToken;
  if (typeof BroadcastChannel !== 'undefined' && !_broadcastChannel) {
    try {
      _broadcastChannel = new BroadcastChannel('wos-clock');
      _broadcastChannel.addEventListener('message', (e) => {
        if (e.data?.type === 'offset' && Number.isFinite(e.data.offset)) {
          const store = useStore.getState();
          store.setTimeOffset(e.data.offset);
          if (Number.isFinite(e.data.rtt)) store.setTimeSyncRtt(e.data.rtt);
          store.setTimeSyncState('synced');
          _hasSynced = true;
        }
      });
    } catch {
      // BroadcastChannel 미지원 (Safari 구버전 등) — 무시, 단일 탭 모드
    }
  }
  const pending = (async () => {
    // 첫 동기화가 실패하면 예전에는 그대로 끝나 영구 미동기화 상태가 됐다(주기 타이머도
    // 시작되지 않음). 성공하거나 shutdown()이 불릴 때까지 백오프로 재시도한다.
    for (let attempt = 0; ; attempt++) {
      if (lifecycleToken !== _lifecycleToken) return;
      useStore.getState().setTimeSyncState('syncing');
      try {
        await syncTime();
        break;
      } catch {
        if (lifecycleToken !== _lifecycleToken) return;
        useStore.getState().setTimeSyncState('failed');
        const waitMs =
          STARTUP_RETRY_BACKOFF_MS[
            Math.min(attempt, STARTUP_RETRY_BACKOFF_MS.length - 1)
          ];
        console.warn(
          '[clockSync] 첫 동기화 실패 (%d회차) — %dms 뒤 재시도',
          attempt + 1,
          waitMs,
        );
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    if (lifecycleToken !== _lifecycleToken) return;
    startPeriodicSync();
    startDriftCheck();
    _started = true;
  })();

  const tracked = pending.finally(() => {
    if (_startupPromise === tracked) _startupPromise = null;
  });
  _startupPromise = tracked;
  return tracked;
}

/**
 * 언마운트 시 호출 — 모든 timer 및 채널 정리.
 * _hasSynced도 되돌려 재로그인 시 첫 동기화가 다시 100% 채택되도록 한다
 * (남겨 두면 이전 세션의 offset에 EMA로 끌려가 첫 추정이 느려진다).
 * timeOffset 값 자체는 유지한다 — 같은 기기·같은 서버라 직전 추정이 0보다 낫다.
 * 다만 최신 여부를 보증할 수 없으므로 상태는 'unsynced'로 되돌린다.
 */
export function shutdown() {
  _lifecycleToken += 1;
  _started = false;
  _startupPromise = null;
  _hasSynced = false;
  useStore.getState().setTimeSyncState('unsynced');
  stopPeriodicSync();
  stopDriftCheck();
  if (_broadcastChannel) {
    try {
      _broadcastChannel.close();
    } catch {
      // 이미 닫힘 — 무시
    }
    _broadcastChannel = null;
  }
}
