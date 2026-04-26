import { Test, TestingModule } from '@nestjs/testing';
import { BusyLockService, LockHolder } from './busy-lock.service';

describe('BusyLockService', () => {
  let service: BusyLockService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BusyLockService],
    }).compile();
    service = module.get<BusyLockService>(BusyLockService);
  });

  it('초기 state — getHolder()가 null', () => {
    expect(service.getHolder()).toBeNull();
  });

  it('tryAcquire({type:countdown}) — true 반환 + getHolder가 {type:countdown} 반환', () => {
    const holder: LockHolder = { type: 'countdown' };
    const result = service.tryAcquire(holder);
    expect(result).toBe(true);
    expect(service.getHolder()).toEqual({ type: 'countdown' });
  });

  it('이미 점유 중 — 두 번째 tryAcquire 호출 시 false 반환, holder 유지', () => {
    const first: LockHolder = { type: 'countdown' };
    const second: LockHolder = { type: 'rally', groupId: 'x' };
    service.tryAcquire(first);
    const result = service.tryAcquire(second);
    expect(result).toBe(false);
    expect(service.getHolder()).toEqual({ type: 'countdown' });
  });

  it('release 정상 — 같은 holder로 해제 시 getHolder가 null', () => {
    const holder: LockHolder = { type: 'countdown' };
    service.tryAcquire(holder);
    service.release(holder);
    expect(service.getHolder()).toBeNull();
  });

  it('release 다른 type — {type:countdown} 점유 중 release({type:rally, groupId:x}) 호출 → 해제 안 됨, holder 유지', () => {
    const acquired: LockHolder = { type: 'countdown' };
    const wrong: LockHolder = { type: 'rally', groupId: 'x' };
    service.tryAcquire(acquired);
    service.release(wrong);
    expect(service.getHolder()).toEqual({ type: 'countdown' });
  });

  it('release 다른 groupId — {type:rally, groupId:A} 점유 중 release({type:rally, groupId:B}) → 해제 안 됨', () => {
    const acquired: LockHolder = { type: 'rally', groupId: 'A' };
    const wrong: LockHolder = { type: 'rally', groupId: 'B' };
    service.tryAcquire(acquired);
    service.release(wrong);
    expect(service.getHolder()).toEqual({ type: 'rally', groupId: 'A' });
  });

  describe('자동 해제', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('autoReleaseMs 경과 후 holder가 null, callback 호출됨', () => {
      jest.useFakeTimers();
      const holder: LockHolder = { type: 'countdown' };
      const cb = jest.fn();
      service.tryAcquire(holder, 1000, cb);
      expect(service.getHolder()).toEqual({ type: 'countdown' });

      jest.advanceTimersByTime(1000);
      expect(service.getHolder()).toBeNull();
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('release 명시적 호출 시 timer cancel — advanceTimersByTime 후에도 cb 호출 안 됨', () => {
      jest.useFakeTimers();
      const holder: LockHolder = { type: 'countdown' };
      const cb = jest.fn();
      service.tryAcquire(holder, 1000, cb);
      service.release(holder);

      jest.advanceTimersByTime(2000);
      expect(cb).not.toHaveBeenCalled();
      expect(service.getHolder()).toBeNull();
    });
  });
});
