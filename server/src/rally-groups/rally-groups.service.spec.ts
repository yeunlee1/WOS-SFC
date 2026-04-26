import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  computeFireSchedule,
  sortMembersByMarchDesc,
  RallyGroupsService,
} from './rally-groups.service';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { User } from '../users/users.entity';
import { RallyGroupsGateway } from './rally-groups.gateway';
import { BusyLockService } from '../realtime/busy-lock.service';

describe('computeFireSchedule', () => {
  it('멤버 3명, 서로 다른 marchSeconds → maxMarch와 offset 계산', () => {
    const members = [
      { userId: 1, orderIndex: 1 },
      { userId: 2, orderIndex: 2 },
      { userId: 3, orderIndex: 3 },
    ];
    const effectiveMap = new Map<number, number>([
      [1, 30],
      [2, 24],
      [3, 20],
    ]);

    const { maxMarch, fireOffsets } = computeFireSchedule(
      members,
      effectiveMap,
    );

    expect(maxMarch).toBe(30);
    expect(fireOffsets).toHaveLength(3);

    const a = fireOffsets.find((o) => o.userId === 1)!;
    const b = fireOffsets.find((o) => o.userId === 2)!;
    const c = fireOffsets.find((o) => o.userId === 3)!;

    expect(a.offsetMs).toBe(0);
    expect(b.offsetMs).toBe(6000);
    expect(c.offsetMs).toBe(10000);
  });

  it('단일 멤버 → maxMarch=15, offset=0', () => {
    const members = [{ userId: 1, orderIndex: 1 }];
    const effectiveMap = new Map<number, number>([[1, 15]]);

    const { maxMarch, fireOffsets } = computeFireSchedule(
      members,
      effectiveMap,
    );

    expect(maxMarch).toBe(15);
    expect(fireOffsets).toHaveLength(1);
    expect(fireOffsets[0].offsetMs).toBe(0);
  });

  it('빈 배열 → maxMarch=0, fireOffsets=[]', () => {
    const { maxMarch, fireOffsets } = computeFireSchedule([], new Map());

    expect(maxMarch).toBe(0);
    expect(fireOffsets).toHaveLength(0);
  });

  it('모두 동일값 (A=20, B=20) → offset 모두 0', () => {
    const members = [
      { userId: 1, orderIndex: 1 },
      { userId: 2, orderIndex: 2 },
    ];
    const effectiveMap = new Map<number, number>([
      [1, 20],
      [2, 20],
    ]);

    const { maxMarch, fireOffsets } = computeFireSchedule(
      members,
      effectiveMap,
    );

    expect(maxMarch).toBe(20);
    expect(fireOffsets[0].offsetMs).toBe(0);
    expect(fireOffsets[1].offsetMs).toBe(0);
  });

  it('marchSeconds가 Map에 없는 유저 → 0 취급', () => {
    const members = [
      { userId: 1, orderIndex: 1 },
      { userId: 2, orderIndex: 2 },
    ];
    const effectiveMap = new Map<number, number>([[1, 20]]);

    const { maxMarch, fireOffsets } = computeFireSchedule(
      members,
      effectiveMap,
    );

    expect(maxMarch).toBe(20);
    const missing = fireOffsets.find((o) => o.userId === 2)!;
    expect(missing.offsetMs).toBe(20000);
  });
});

describe('sortMembersByMarchDesc', () => {
  it('멤버 3명 — 느린 순(내림차순)으로 orderIndex 1,2,3 재할당', () => {
    // userId 1: 22초(빠름), userId 2: 38초(느림), userId 3: 37초(중간)
    const members = [
      {
        userId: 1,
        orderIndex: 1,
        marchSecondsOverride: null,
        user: { marchSeconds: 22 },
      },
      {
        userId: 2,
        orderIndex: 2,
        marchSecondsOverride: null,
        user: { marchSeconds: 38 },
      },
      {
        userId: 3,
        orderIndex: 3,
        marchSecondsOverride: null,
        user: { marchSeconds: 37 },
      },
    ] as any[];

    const sorted = sortMembersByMarchDesc(members);

    // 느린 순: userId 2(38s)=1번, userId 3(37s)=2번, userId 1(22s)=3번
    expect(sorted[0].userId).toBe(2);
    expect(sorted[0].orderIndex).toBe(1);
    expect(sorted[1].userId).toBe(3);
    expect(sorted[1].orderIndex).toBe(2);
    expect(sorted[2].userId).toBe(1);
    expect(sorted[2].orderIndex).toBe(3);
  });

  it('marchSecondsOverride가 user.marchSeconds보다 우선', () => {
    // userId 1: user.marchSeconds=10, override=50 → effective=50(느림) → 1번
    // userId 2: user.marchSeconds=40, override=null → effective=40 → 2번
    const members = [
      {
        userId: 1,
        orderIndex: 1,
        marchSecondsOverride: 50,
        user: { marchSeconds: 10 },
      },
      {
        userId: 2,
        orderIndex: 2,
        marchSecondsOverride: null,
        user: { marchSeconds: 40 },
      },
    ] as any[];

    const sorted = sortMembersByMarchDesc(members);

    expect(sorted[0].userId).toBe(1); // override=50 우선
    expect(sorted[0].orderIndex).toBe(1);
    expect(sorted[1].userId).toBe(2);
    expect(sorted[1].orderIndex).toBe(2);
  });

  it('동률은 기존 orderIndex 오름차순(안정 정렬)으로 tie-break', () => {
    const members = [
      {
        userId: 1,
        orderIndex: 3,
        marchSecondsOverride: null,
        user: { marchSeconds: 30 },
      },
      {
        userId: 2,
        orderIndex: 1,
        marchSecondsOverride: null,
        user: { marchSeconds: 30 },
      },
      {
        userId: 3,
        orderIndex: 2,
        marchSecondsOverride: null,
        user: { marchSeconds: 30 },
      },
    ] as any[];

    const sorted = sortMembersByMarchDesc(members);

    // 동률 → 기존 orderIndex 오름차순 유지
    expect(sorted[0].userId).toBe(2); // prevOrder 1
    expect(sorted[1].userId).toBe(3); // prevOrder 2
    expect(sorted[2].userId).toBe(1); // prevOrder 3
  });
});

describe('RallyGroupsService — BusyLock 통합', () => {
  let service: RallyGroupsService;
  let busyLock: BusyLockService;
  let groupRepo: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let memberRepo: { find: jest.Mock; findOne: jest.Mock; update: jest.Mock };
  let gateway: {
    emitGroupUpdated: jest.Mock;
    emitCountdownStart: jest.Mock;
    emitCountdownStop: jest.Mock;
    emitGroupRemoved: jest.Mock;
    emitBusyState: jest.Mock;
  };

  // 단일 멤버, marchSeconds=10인 가짜 그룹.
  // startCountdown 경로에서 reorderByMarchSeconds → getFullGroup → computeFireSchedule을 거침.
  const fakeGroup = (state: 'idle' | 'running' = 'idle'): any => ({
    id: 'g1',
    name: '1번 집결그룹',
    displayOrder: 1,
    state,
    startedAtServerMs: state === 'running' ? Date.now() : null,
    maxMarchSeconds: state === 'running' ? 10 : null,
    members: [
      {
        id: 'm1',
        userId: 1,
        orderIndex: 1,
        marchSecondsOverride: null,
        user: { id: 1, marchSeconds: 10, nickname: 'a' },
      },
    ],
    createdBy: null,
    createdById: 1,
    broadcastAll: false,
  });

  beforeEach(async () => {
    groupRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(fakeGroup('idle')),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    memberRepo = {
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    gateway = {
      emitGroupUpdated: jest.fn(),
      emitCountdownStart: jest.fn(),
      emitCountdownStop: jest.fn(),
      emitGroupRemoved: jest.fn(),
      emitBusyState: jest.fn(),
    };

    // dataSource.transaction을 그냥 callback 호출로 단순화 — reorderByMarchSeconds_inner는
    // memberRepo.find/update만 사용하므로 mgr를 같은 형태로 stub.
    type TxCallback<T> = (mgr: unknown) => Promise<T>;
    const dataSource: Partial<DataSource> = {
      transaction: jest
        .fn()
        .mockImplementation(<T>(cb: TxCallback<T>): Promise<T> => {
          const mgrStub = {
            getRepository: (entity: unknown) => {
              if (entity === RallyGroupMember) return memberRepo;
              if (entity === RallyGroup) return groupRepo;
              return memberRepo;
            },
          };
          return cb(mgrStub);
        }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [
        RallyGroupsService,
        BusyLockService,
        { provide: getRepositoryToken(RallyGroup), useValue: groupRepo },
        { provide: getRepositoryToken(RallyGroupMember), useValue: memberRepo },
        { provide: getRepositoryToken(User), useValue: {} },
        { provide: RallyGroupsGateway, useValue: gateway },
        { provide: DataSource, useValue: dataSource },
      ],
    }).compile();

    service = moduleRef.get(RallyGroupsService);
    busyLock = moduleRef.get(BusyLockService);
  });

  afterEach(() => {
    // BusyLock의 autoRelease setTimeout이 활성 상태로 남아 있으면
    // 테스트 종료 후 worker process가 graceful하게 못 닫히는 경고가 뜬다.
    // 모든 가능한 holder를 release해서 timer cancel.
    busyLock.release({ type: 'countdown' });
    busyLock.release({ type: 'rally', groupId: 'g1' });
  });

  describe('startCountdown', () => {
    it('정상 — lock 획득 + state running으로 update + busy:state broadcast', async () => {
      groupRepo.findOne.mockResolvedValue(fakeGroup('idle'));

      const result = await service.startCountdown('g1');

      // lock holder가 rally/g1로 설정됨
      expect(busyLock.getHolder()).toEqual({ type: 'rally', groupId: 'g1' });

      // state update를 running으로 호출
      expect(groupRepo.update).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ state: 'running' }),
      );

      // gateway broadcast 호출 검증
      expect(gateway.emitCountdownStart).toHaveBeenCalled();
      expect(gateway.emitGroupUpdated).toHaveBeenCalled();
      expect(gateway.emitBusyState).toHaveBeenCalledWith({
        type: 'rally',
        groupId: 'g1',
      });

      expect(result.payload.groupId).toBe('g1');
    });

    it('lock 점유 중 (다른 holder) → ConflictException(409)', async () => {
      // 미리 다른 holder로 lock 점유.
      busyLock.tryAcquire({ type: 'countdown' });

      await expect(service.startCountdown('g1')).rejects.toBeInstanceOf(
        ConflictException,
      );

      // lock은 여전히 countdown holder.
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });
      // DB update는 running 상태로 호출되지 않음.
      expect(groupRepo.update).not.toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({ state: 'running' }),
      );
    });

    it('DB update 실패 시 lock leak 방지 — release + busy:state(null) broadcast', async () => {
      // groupRepo.update의 첫 호출(state:running)에서 실패.
      groupRepo.update.mockRejectedValueOnce(new Error('DB down'));
      groupRepo.findOne.mockResolvedValue(fakeGroup('idle'));

      await expect(service.startCountdown('g1')).rejects.toThrow('DB down');

      // lock 자동 해제 확인.
      expect(busyLock.getHolder()).toBeNull();
      // emitBusyState(null)이 마지막에 호출됨.
      expect(gateway.emitBusyState).toHaveBeenLastCalledWith(null);
    });
  });

  describe('stopCountdown', () => {
    it('정상 — release + state idle + emitBusyState(null)', async () => {
      // 사전 조건: 그룹이 존재 + lock 점유.
      groupRepo.findOne.mockResolvedValue(fakeGroup('running'));
      busyLock.tryAcquire({ type: 'rally', groupId: 'g1' });

      await service.stopCountdown('g1');

      expect(busyLock.getHolder()).toBeNull();
      expect(groupRepo.update).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({
          state: 'idle',
          startedAtServerMs: null,
          maxMarchSeconds: null,
        }),
      );
      expect(gateway.emitCountdownStop).toHaveBeenCalledWith('g1');
      expect(gateway.emitBusyState).toHaveBeenCalledWith(null);
    });

    // ──────────────────────────────────────────────────────────────
    // Quality reviewer 지적 수정: stopCountdown holder mismatch 가드 추가.
    // RealtimeGateway.handleCountdownStop과 대칭화 — 다른 holder가 잡고 있고
    // 자기 그룹이 idle이면 silent no-op (부수효과 모두 차단).
    // 자기 그룹이 stale running 상태면 DB만 idle로 reset, lock은 건드리지 않음.
    // ──────────────────────────────────────────────────────────────
    it('countdown holder가 lock 잡고 있고 자기 그룹이 idle이면 stopCountdown(rally) — silent no-op (부수효과 차단)', async () => {
      groupRepo.findOne.mockResolvedValue(fakeGroup('idle'));
      // 다른 holder(countdown)가 lock 점유.
      busyLock.tryAcquire({ type: 'countdown' });

      await service.stopCountdown('g1');

      // countdown lock 유지 — 가드로 release 시도조차 안 함.
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      // 가드로 인해 DB update / broadcast 모두 차단됨.
      expect(groupRepo.update).not.toHaveBeenCalled();
      expect(gateway.emitCountdownStop).not.toHaveBeenCalled();
      expect(gateway.emitGroupUpdated).not.toHaveBeenCalled();
      expect(gateway.emitBusyState).not.toHaveBeenCalled();
    });

    it('다른 그룹 rally가 lock 잡고 있고 자기 그룹이 idle이면 stopCountdown(g1) — silent no-op', async () => {
      // 사전: 다른 그룹(g2)의 rally가 lock 점유, g1은 idle.
      groupRepo.findOne.mockResolvedValue(fakeGroup('idle'));
      busyLock.tryAcquire({ type: 'rally', groupId: 'g2' });

      await service.stopCountdown('g1');

      // g2 lock 유지.
      expect(busyLock.getHolder()).toEqual({ type: 'rally', groupId: 'g2' });

      // g1에 대한 DB update + broadcast 모두 차단 — 유령 broadcast 방지.
      expect(groupRepo.update).not.toHaveBeenCalled();
      expect(gateway.emitCountdownStop).not.toHaveBeenCalled();
      expect(gateway.emitGroupUpdated).not.toHaveBeenCalled();
      expect(gateway.emitBusyState).not.toHaveBeenCalled();
    });

    it('다른 holder가 lock 잡고 있고 자기 그룹은 stale running이면 — DB는 idle로 reset, lock은 건드리지 않음', async () => {
      // 사전 조건 — g1이 running인데 다른 holder(countdown)가 lock 점유 중인 비정상 상태.
      // (예: 서버 재시작 후 부분 복구가 어긋난 상황 등)
      // 자기 그룹 state를 idle로 재정렬해야 클라이언트가 일관된 상태를 보지만,
      // 다른 holder의 lock은 절대 풀지 않음.
      groupRepo.findOne.mockResolvedValue(fakeGroup('running'));
      busyLock.tryAcquire({ type: 'countdown' });

      await service.stopCountdown('g1');

      // countdown lock 유지.
      expect(busyLock.getHolder()).toEqual({ type: 'countdown' });

      // g1 DB는 idle로 reset (stale state 정정).
      expect(groupRepo.update).toHaveBeenCalledWith(
        'g1',
        expect.objectContaining({
          state: 'idle',
          startedAtServerMs: null,
          maxMarchSeconds: null,
        }),
      );
      expect(gateway.emitCountdownStop).toHaveBeenCalledWith('g1');
      // emitBusyState는 현재 holder(countdown)를 그대로 broadcast — null 아님.
      expect(gateway.emitBusyState).toHaveBeenCalledWith({ type: 'countdown' });
    });
  });

  describe('handleAutoIdle (BusyLock setTimeout 만료 시뮬레이션)', () => {
    it('autoRelease 만료 → state idle로 자동 reset + broadcast', async () => {
      jest.useFakeTimers();
      try {
        // computeFireSchedule이 maxMarch=10 반환 → autoReleaseMs = 7000 + 10000 + 5000 = 22000ms.
        groupRepo.findOne.mockResolvedValue(fakeGroup('idle'));

        await service.startCountdown('g1');
        // 시작 직후 lock 점유.
        expect(busyLock.getHolder()).toEqual({
          type: 'rally',
          groupId: 'g1',
        });

        // autoRelease 타이머 만료까지 시간 진행.
        jest.advanceTimersByTime(22_001);

        // autoRelease 콜백 내부에서 시작된 Promise가 microtask 큐에 있어 비움.
        await Promise.resolve();
        await Promise.resolve();

        expect(busyLock.getHolder()).toBeNull();
        // groupRepo.update가 idle reset으로 호출됨.
        type IdleResetPatch = {
          state?: string;
          startedAtServerMs?: number | null;
        };
        const idleResetCall = (
          groupRepo.update.mock.calls as [string, IdleResetPatch][]
        ).find(
          ([id, patch]) =>
            id === 'g1' &&
            patch &&
            patch.state === 'idle' &&
            patch.startedAtServerMs === null,
        );
        expect(idleResetCall).toBeDefined();
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('onModuleInit (서버 재시작 복구)', () => {
    it('running 상태인 그룹이 있으면 일괄 idle로 reset', async () => {
      groupRepo.find.mockResolvedValue([
        fakeGroup('running'),
        { ...fakeGroup('running'), id: 'g2' },
      ]);

      await service.onModuleInit();

      expect(groupRepo.find).toHaveBeenCalledWith({
        where: { state: 'running' },
      });
      expect(groupRepo.update).toHaveBeenCalledWith(
        { state: 'running' },
        {
          state: 'idle',
          startedAtServerMs: null,
          maxMarchSeconds: null,
        },
      );
    });

    it('running 상태인 그룹이 없으면 update 호출 없음', async () => {
      groupRepo.find.mockResolvedValue([]);

      await service.onModuleInit();

      expect(groupRepo.find).toHaveBeenCalled();
      expect(groupRepo.update).not.toHaveBeenCalled();
    });
  });
});
