// 접속 목록 브로드캐스트 코얼레싱과 KST 시각 표시를 검증한다.
import { ONLINE_COALESCE_MS, RealtimeGateway, formatCreatedAt } from './realtime.gateway';

/** 생성자 주입 9개를 피하고 broadcastOnline 만 떼어 검증한다. */
function makeGateway() {
  const gateway = Object.create(RealtimeGateway.prototype) as RealtimeGateway;
  (gateway as unknown as { onlineMap: Map<string, unknown> }).onlineMap = new Map([
    ['s1', { id: 1, nickname: 'alice' }],
  ]);
  const emit = jest.fn();
  gateway.server = { emit } as never;
  return { gateway, emit };
}

describe('online:updated 코얼레싱', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('120ms 안의 연속 호출은 한 번만 방출한다', () => {
    const { gateway, emit } = makeGateway();
    gateway.broadcastOnline();
    gateway.broadcastOnline();
    gateway.broadcastOnline();
    expect(emit).not.toHaveBeenCalled();
    jest.advanceTimersByTime(ONLINE_COALESCE_MS);
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith('online:updated', [{ id: 1, nickname: 'alice' }]);
  });

  it('창이 닫힌 뒤의 호출은 다시 방출한다', () => {
    const { gateway, emit } = makeGateway();
    gateway.broadcastOnline();
    jest.advanceTimersByTime(ONLINE_COALESCE_MS);
    gateway.broadcastOnline();
    jest.advanceTimersByTime(ONLINE_COALESCE_MS);
    expect(emit).toHaveBeenCalledTimes(2);
  });
});

describe('formatCreatedAt', () => {
  it('컨테이너 시간대와 무관하게 KST 로 표시한다', () => {
    const at = new Date('2026-09-02T00:30:00Z');
    const text = formatCreatedAt(at);
    // 오전/오후 표기는 ICU 데이터에 따라 AM/PM 으로 나올 수 있어 시각만 본다(UTC 00:30 → KST 09:30).
    expect(text).toMatch(/9:30/);
    expect(text).toBe(
      new Intl.DateTimeFormat('ko-KR', {
        dateStyle: 'short',
        timeStyle: 'short',
        timeZone: 'Asia/Seoul',
      }).format(at),
    );
  });
});
