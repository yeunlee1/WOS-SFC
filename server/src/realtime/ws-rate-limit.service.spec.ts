import { Test, TestingModule } from '@nestjs/testing';
import { WsRateLimitService } from './ws-rate-limit.service';

describe('WsRateLimitService', () => {
  let service: WsRateLimitService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WsRateLimitService],
    }).compile();
    service = module.get<WsRateLimitService>(WsRateLimitService);
  });

  describe('check — 기본 sliding window 동작', () => {
    it('limit 미만 호출은 모두 허용', () => {
      for (let i = 0; i < 5; i++) {
        expect(service.check('s1', 'time:ping', 5, 60_000)).toBe(true);
      }
    });

    it('limit 초과 즉시 거부', () => {
      for (let i = 0; i < 3; i++) service.check('s1', 'time:ping', 3, 60_000);
      expect(service.check('s1', 'time:ping', 3, 60_000)).toBe(false);
    });

    it('윈도우 밖 timestamp는 자동 만료 — 추가 호출 가능', async () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-04-26T00:00:00Z'));

      for (let i = 0; i < 3; i++) service.check('s1', 'time:ping', 3, 1000);
      expect(service.check('s1', 'time:ping', 3, 1000)).toBe(false);

      // 윈도우(1초) 지난 후 다시 허용
      jest.advanceTimersByTime(1100);
      expect(service.check('s1', 'time:ping', 3, 1000)).toBe(true);

      jest.useRealTimers();
    });
  });

  describe('socket / event 격리', () => {
    it('서로 다른 socket은 독립적으로 추적', () => {
      for (let i = 0; i < 3; i++) service.check('s1', 'time:ping', 3, 60_000);
      // s1은 limit 초과
      expect(service.check('s1', 'time:ping', 3, 60_000)).toBe(false);
      // s2는 영향 없음
      expect(service.check('s2', 'time:ping', 3, 60_000)).toBe(true);
    });

    it('서로 다른 event는 독립적으로 추적', () => {
      for (let i = 0; i < 3; i++) service.check('s1', 'time:ping', 3, 60_000);
      // time:ping은 limit 초과
      expect(service.check('s1', 'time:ping', 3, 60_000)).toBe(false);
      // countdown:start는 영향 없음
      expect(service.check('s1', 'countdown:start', 3, 60_000)).toBe(true);
    });
  });

  describe('cleanup', () => {
    it('socket 정리 후 새 호출은 fresh 버킷', () => {
      for (let i = 0; i < 3; i++) service.check('s1', 'time:ping', 3, 60_000);
      expect(service.check('s1', 'time:ping', 3, 60_000)).toBe(false);

      service.cleanup('s1');
      // 정리 후 다시 허용
      expect(service.check('s1', 'time:ping', 3, 60_000)).toBe(true);
    });

    it('존재하지 않는 socket cleanup도 안전 (no-op)', () => {
      expect(() => service.cleanup('nonexistent')).not.toThrow();
    });
  });

  describe('실용 시나리오', () => {
    it('time:ping 분당 30회 제한 — 정상 5초 주기 sync 충분', () => {
      // 1분 동안 12회(5초마다) — 모두 허용 (실제 클라이언트 sync 패턴)
      for (let i = 0; i < 12; i++) {
        expect(service.check('s1', 'time:ping', 30, 60_000)).toBe(true);
      }
    });

    it('countdown:start 분당 5회 제한 — SFC 정상 사용 충분, 무한 호출 차단', () => {
      // 5회 정상 시작
      for (let i = 0; i < 5; i++) {
        expect(service.check('admin1', 'countdown:start', 5, 60_000)).toBe(true);
      }
      // 6번째는 차단
      expect(service.check('admin1', 'countdown:start', 5, 60_000)).toBe(false);
    });
  });
});
