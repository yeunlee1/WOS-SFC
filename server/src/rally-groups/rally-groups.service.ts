import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
  OnModuleInit,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, MoreThan, Repository } from 'typeorm';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { User } from '../users/users.entity';
import { CreateRallyGroupDto } from './dto/create-rally-group.dto';
import { RallyGroupsGateway } from './rally-groups.gateway';
import { BusyLockService } from '../realtime/busy-lock.service';

const MAX_GROUP_MEMBERS = 10;
const MAX_GROUPS = 6;
// 시작 안내 음성("N번 집결그룹 집결 시작합니다") + 프리카운트(3,2,1) 재생 시간 확보.
// 기존 4000ms는 프리카운트만 고려한 값으로, 안내 음성(~3초)이 추가되어 7초로 증가.
const COUNTDOWN_LEAD_MS = 7000;
// BusyLock 자동 해제까지의 추가 여유 — maxMarchSeconds 만료 후 약간의 grace로
// 안전하게 lock 해제. 너무 짧으면 race로 미해제, 너무 길면 다음 동작 차단 시간 증가.
const RALLY_AUTO_IDLE_GRACE_SECONDS = 5;

/** 자동 생성 이름 포맷 — 음성 안내와 쌍으로 유지 */
function formatGroupName(displayOrder: number): string {
  return `${displayOrder}번 집결그룹`;
}

function sanitizeUser(u: any) {
  if (!u) return u;
  return {
    id: u.id,
    nickname: u.nickname,
    allianceName: u.allianceName,
    role: u.role,
    language: u.language,
    marchSeconds: u.marchSeconds,
  };
}

function sanitizeGroup(group: RallyGroup): RallyGroup {
  return {
    ...group,
    createdBy: group.createdBy
      ? sanitizeUser(group.createdBy)
      : group.createdBy,
    members: (group.members ?? []).map((m) => ({
      ...m,
      user: m.user ? sanitizeUser(m.user) : m.user,
    })) as any,
  };
}

/**
 * 멤버 배열을 marchSeconds 내림차순(느린 순)으로 정렬하고
 * orderIndex를 1부터 재할당한 새 배열을 반환.
 * 동률은 기존 orderIndex 오름차순으로 tie-break (안정 정렬).
 * 순수 함수 — DB 접근 없음. reorderByMarchSeconds의 정렬 핵심 로직.
 */
export function sortMembersByMarchDesc<
  T extends {
    orderIndex: number;
    marchSecondsOverride: number | null;
    user?: { marchSeconds?: number | null } | null;
  },
>(members: T[]): T[] {
  const withEffective = members.map((m) => ({
    m,
    effective: m.marchSecondsOverride ?? m.user?.marchSeconds ?? 0,
    prevOrder: m.orderIndex,
  }));
  withEffective.sort((a, b) => {
    if (b.effective !== a.effective) return b.effective - a.effective;
    return a.prevOrder - b.prevOrder;
  });
  return withEffective.map((x, i) => {
    x.m.orderIndex = i + 1;
    return x.m;
  });
}

export function computeFireSchedule(
  members: Array<{ userId: number; orderIndex: number }>,
  effectiveMarchByUserId: Map<number, number>,
): {
  maxMarch: number;
  fireOffsets: Array<{ orderIndex: number; offsetMs: number; userId: number }>;
} {
  const marches = members.map((m) => effectiveMarchByUserId.get(m.userId) ?? 0);
  const maxMarch = Math.max(0, ...marches);
  const fireOffsets = members.map((m) => ({
    orderIndex: m.orderIndex,
    userId: m.userId,
    offsetMs: (maxMarch - (effectiveMarchByUserId.get(m.userId) ?? 0)) * 1000,
  }));
  return { maxMarch, fireOffsets };
}

@Injectable()
export class RallyGroupsService implements OnModuleInit {
  constructor(
    @InjectRepository(RallyGroup) private groupRepo: Repository<RallyGroup>,
    @InjectRepository(RallyGroupMember)
    private memberRepo: Repository<RallyGroupMember>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private gateway: RallyGroupsGateway,
    private dataSource: DataSource,
    @Inject(forwardRef(() => BusyLockService))
    private busyLock: BusyLockService,
  ) {}

  /**
   * 서버 재시작 시 stale 'running' 상태 복구.
   * 메모리 lock은 재시작과 함께 휘발됐지만 DB에 'running' row가 남아 있을 수 있음.
   * 클라이언트도 disconnect되어 카운트다운이 의미 없으므로 일괄 idle로 reset.
   * 복구 시점에는 socket.io server가 아직 초기화 안 됐을 수 있어 broadcast는 생략 —
   * 클라이언트가 재연결할 때 listAll로 idle 상태를 받게 됨.
   */
  async onModuleInit(): Promise<void> {
    const running = await this.groupRepo.find({ where: { state: 'running' } });
    if (running.length === 0) return;
    await this.groupRepo.update(
      { state: 'running' },
      { state: 'idle', startedAtServerMs: null, maxMarchSeconds: null },
    );
  }

  async listAssignableUsers() {
    return this.userRepo.find({
      select: ['id', 'nickname', 'allianceName', 'role', 'language'],
      order: { allianceName: 'ASC', nickname: 'ASC' },
    });
  }

  async listAll(): Promise<RallyGroup[]> {
    // displayOrder ASC — 재번호화 후 1번~N번 순서대로 UI 노출.
    // createdAt 기준으로 하면 삭제→재번호화 후 "4번이 3번보다 먼저 나오는" 어긋남 발생.
    const groups = await this.groupRepo.find({
      relations: ['members', 'members.user', 'createdBy'],
      order: { displayOrder: 'ASC' },
    });
    return groups.map(sanitizeGroup);
  }

  async getFullGroup(id: string): Promise<RallyGroup> {
    const group = await this.groupRepo.findOne({
      where: { id },
      relations: ['members', 'members.user', 'createdBy'],
    });
    if (!group) throw new NotFoundException('RallyGroup not found');
    return sanitizeGroup(group);
  }

  async create(userId: number, dto: CreateRallyGroupDto): Promise<RallyGroup> {
    // 최대 6개 제한 + displayOrder 자동 할당을 단일 트랜잭션으로 묶어
    // 동시 생성 시 중복 번호 할당 방지.
    const saved = await this.dataSource.transaction(async (mgr) => {
      const groupRepo = mgr.getRepository(RallyGroup);
      const count = await groupRepo.count();
      if (count >= MAX_GROUPS) {
        throw new BadRequestException(
          `집결 그룹은 최대 ${MAX_GROUPS}개까지만 생성 가능합니다.`,
        );
      }
      // count+1 = 다음 슬롯 (remove에서 재번호화로 1..N 연속 보장).
      const displayOrder = count + 1;
      const group = groupRepo.create({
        name: formatGroupName(displayOrder),
        displayOrder,
        broadcastAll: dto.broadcastAll ?? false,
        createdById: userId,
        state: 'idle',
      });
      return groupRepo.save(group);
    });
    const full = await this.getFullGroup(saved.id);
    this.gateway.emitGroupUpdated(full);
    return full;
  }

  async remove(id: string): Promise<void> {
    // 삭제 + 남은 그룹 재번호화를 단일 트랜잭션으로.
    // 예: [1,2,3,4] 중 2 삭제 → [1,3,4] → [1,2,3]으로 재할당.
    // name 필드도 displayOrder와 동기화.
    const affectedIds = await this.dataSource.transaction(async (mgr) => {
      const groupRepo = mgr.getRepository(RallyGroup);
      const group = await groupRepo.findOne({ where: { id } });
      if (!group) throw new NotFoundException('RallyGroup not found');
      const removedOrder = group.displayOrder;
      await groupRepo.remove(group);

      // 삭제된 것보다 뒤에 있던 그룹들을 1씩 당김.
      // displayOrder가 unique 제약이 있다면 임시 음수 → 최종값 2단계 필요하지만
      // 현재 제약이 없고 renumber 순서를 오름차순으로 하면 (N+1 → N)
      // 중간 상태 충돌 없음.
      const tail = await groupRepo.find({
        where: { displayOrder: MoreThan(removedOrder) },
        order: { displayOrder: 'ASC' },
      });
      for (const g of tail) {
        const newOrder = g.displayOrder - 1;
        g.displayOrder = newOrder;
        g.name = formatGroupName(newOrder);
        await groupRepo.save(g);
      }
      return tail.map((g) => g.id);
    });

    this.gateway.emitGroupRemoved(id);
    // 재번호화된 그룹들을 클라이언트에 브로드캐스트.
    for (const gid of affectedIds) {
      const full = await this.getFullGroup(gid);
      this.gateway.emitGroupUpdated(full);
    }
  }

  async addMember(groupId: string, userId: number): Promise<RallyGroup> {
    await this.dataSource.transaction(async (mgr) => {
      const count = await mgr.count(RallyGroupMember, { where: { groupId } });
      if (count >= MAX_GROUP_MEMBERS)
        throw new BadRequestException(
          `Group is full (max ${MAX_GROUP_MEMBERS})`,
        );
      const duplicate = await mgr.findOne(RallyGroupMember, {
        where: { groupId, userId },
      });
      if (duplicate) throw new BadRequestException('User already in group');
      // 임시 orderIndex(count+1)로 삽입 후 reorderByMarchSeconds에서 재할당
      const member = mgr.create(RallyGroupMember, {
        groupId,
        userId,
        orderIndex: count + 1,
        marchSecondsOverride: null,
      });
      await mgr.save(member);
      // removeMember와 대칭: 트랜잭션 안에서 재정렬
      await this.reorderByMarchSeconds(groupId, mgr);
    });

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
    return full;
  }

  async removeMember(groupId: string, memberId: string): Promise<void> {
    await this.dataSource.transaction(async (mgr) => {
      const member = await mgr.findOne(RallyGroupMember, {
        where: { id: memberId, groupId },
      });
      if (!member) throw new NotFoundException('Member not found');
      await mgr.remove(member);

      // 기존 연속 번호 재할당 대신 marchSeconds 기준 재정렬
      await this.reorderByMarchSeconds(groupId, mgr);
    });

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
  }

  async updateMarchOverride(
    memberId: string,
    seconds: number | null,
  ): Promise<RallyGroup> {
    const member = await this.memberRepo.findOne({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Member not found');
    await this.memberRepo.update(memberId, { marchSecondsOverride: seconds });

    // override 변경 후 marchSeconds 기준 재정렬
    await this.reorderByMarchSeconds(member.groupId);

    const full = await this.getFullGroup(member.groupId);
    this.gateway.emitGroupUpdated(full);

    if (full.state === 'running') await this.recomputeIfRunning(member.groupId);

    return full;
  }

  async startCountdown(groupId: string): Promise<{
    group: RallyGroup;
    payload: {
      groupId: string;
      startedAtServerMs: number;
      fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[];
    };
  }> {
    // 1단계: 정렬 + 그룹 + maxMarch 계산.
    // reorder는 idempotent하므로 lock 획득 전에 수행 — DB 쓰기는 있으나 결과 동일.
    // maxMarch를 미리 알아야 lock 자동해제 시간을 정확히 설정할 수 있음.
    await this.reorderByMarchSeconds(groupId);

    const group = await this.getFullGroup(groupId);

    const effectiveMap = new Map<number, number>(
      group.members.map((m) => [
        m.userId,
        m.marchSecondsOverride ?? m.user?.marchSeconds ?? 0,
      ]),
    );

    const { maxMarch, fireOffsets } = computeFireSchedule(
      group.members,
      effectiveMap,
    );

    // 2단계: BusyLock 게이팅 — Countdown(1번) ↔ Rally(3번) 음성 충돌 방지.
    // 자동 해제 시간 = LEAD + 최대 행군 시간 + 추가 grace.
    const autoReleaseMs =
      COUNTDOWN_LEAD_MS +
      maxMarch * 1000 +
      RALLY_AUTO_IDLE_GRACE_SECONDS * 1000;
    const acquired = this.busyLock.tryAcquire(
      { type: 'rally', groupId },
      autoReleaseMs,
      () => {
        // 비동기 작업이지만 콜백은 sync — promise를 fire-and-forget으로.
        // handleAutoIdle 내부에서 catch.
        void this.handleAutoIdle(groupId);
      },
    );
    if (!acquired) {
      throw new ConflictException({
        reason: 'busy',
        message: '다른 카운트다운이 진행 중입니다.',
        holder: this.busyLock.getHolder(),
      });
    }

    try {
      // 3단계: DB 업데이트 + broadcast.
      const startedAtServerMs = Date.now() + COUNTDOWN_LEAD_MS;
      await this.groupRepo.update(groupId, {
        state: 'running',
        startedAtServerMs,
        maxMarchSeconds: maxMarch,
      });

      const payload = { groupId, startedAtServerMs, fireOffsets };
      this.gateway.emitCountdownStart(payload);

      const full = await this.getFullGroup(groupId);
      this.gateway.emitGroupUpdated(full);
      this.gateway.emitBusyState(this.busyLock.getHolder());

      return { group: full, payload };
    } catch (err) {
      // DB update / fetch 실패 시 lock leak 방지 — 자동 해제 후 rethrow.
      this.busyLock.release({ type: 'rally', groupId });
      this.gateway.emitBusyState(null);
      throw err;
    }
  }

  async stopCountdown(groupId: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('RallyGroup not found');

    // BusyLock release — 다른 holder(다른 그룹의 rally, 또는 countdown)가 잡고 있으면 no-op.
    // BusyLockService.release는 holder mismatch 시 자동으로 무시함.
    this.busyLock.release({ type: 'rally', groupId });

    await this.groupRepo.update(groupId, {
      state: 'idle',
      startedAtServerMs: null,
      maxMarchSeconds: null,
    });

    this.gateway.emitCountdownStop(groupId);

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
    this.gateway.emitBusyState(this.busyLock.getHolder());
  }

  /**
   * BusyLock setTimeout 만료 시 호출 — 카운트다운 시간이 끝났는데 사용자가 stop을 안 누른 경우
   * 자동으로 DB state를 idle로 reset하고 broadcast.
   * 이 시점 BusyLockService 내부 holder는 이미 null (autoRelease가 holder→null 후 콜백 호출).
   * 콜백은 throw 안 해야 BusyLockService 안전 — try/catch로 swallow.
   */
  private async handleAutoIdle(groupId: string): Promise<void> {
    try {
      await this.groupRepo.update(groupId, {
        state: 'idle',
        startedAtServerMs: null,
        maxMarchSeconds: null,
      });
      this.gateway.emitCountdownStop(groupId);
      const full = await this.getFullGroup(groupId).catch(() => null);
      if (full) this.gateway.emitGroupUpdated(full);
      this.gateway.emitBusyState(null);
    } catch (err) {
      // DB error 등 — 로그만 남기고 swallow.
      console.error('[RallyGroupsService] handleAutoIdle 실패:', err);
    }
  }

  async getMemberUserId(memberId: string): Promise<number | null> {
    const member = await this.memberRepo.findOne({ where: { id: memberId } });
    return member?.userId ?? null;
  }

  async recomputeIfRunning(groupId: string): Promise<{
    payload?: {
      groupId: string;
      startedAtServerMs: number;
      fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[];
    };
  }> {
    const group = await this.getFullGroup(groupId);
    if (group.state !== 'running' || group.startedAtServerMs == null) return {};

    const effectiveMap = new Map<number, number>(
      group.members.map((m) => [
        m.userId,
        m.marchSecondsOverride ?? m.user?.marchSeconds ?? 0,
      ]),
    );

    const { maxMarch, fireOffsets } = computeFireSchedule(
      group.members,
      effectiveMap,
    );

    await this.groupRepo.update(groupId, { maxMarchSeconds: maxMarch });

    const payload = {
      groupId,
      startedAtServerMs: Number(group.startedAtServerMs),
      fireOffsets,
    };
    this.gateway.emitCountdownStart(payload);

    return { payload };
  }

  /**
   * marchSeconds 내림차순(느린 순)으로 orderIndex 재할당.
   * 동률일 때는 기존 orderIndex를 tie-break으로 사용해 안정 정렬.
   * @param mgr EntityManager — 트랜잭션 내부에서 호출 시 전달, 아니면 생략(자체 트랜잭션으로 실행)
   */
  private async reorderByMarchSeconds(
    groupId: string,
    mgr?: EntityManager,
  ): Promise<void> {
    if (mgr) {
      return this.reorderByMarchSeconds_inner(groupId, mgr);
    }
    return this.dataSource.transaction((m) =>
      this.reorderByMarchSeconds_inner(groupId, m),
    );
  }

  private async reorderByMarchSeconds_inner(
    groupId: string,
    mgr: EntityManager,
  ): Promise<void> {
    const memberRepo = mgr.getRepository(RallyGroupMember);
    // user 관계 포함해서 조회 — marchSeconds 읽기 위함
    const members: RallyGroupMember[] = await memberRepo.find({
      where: { groupId },
      relations: ['user'],
      lock: { mode: 'pessimistic_write' },
    });
    if (members.length === 0) return;

    // 정렬 핵심 로직은 export된 순수 함수로 위임
    const sorted: RallyGroupMember[] = sortMembersByMarchDesc(members);

    // (groupId, orderIndex) unique constraint 충돌 방지:
    // 1단계: 모든 row를 음수 임시값으로 이동 (중간 상태에서 충돌 없음)
    for (let i = 0; i < members.length; i++) {
      await memberRepo.update(members[i].id, { orderIndex: -(i + 1) });
    }
    // 2단계: 정렬된 순서로 최종값 부여
    for (let i = 0; i < sorted.length; i++) {
      await memberRepo.update(sorted[i].id, { orderIndex: i + 1 });
    }
  }

  /**
   * 특정 유저가 속한 모든 그룹을 일괄 재정렬.
   * saveBattleSettings(me.controller)에서 marchSeconds 변경 후 호출.
   */
  async reorderAllForUser(userId: number): Promise<void> {
    const memberships = await this.memberRepo.find({ where: { userId } });
    const groupIds = Array.from(new Set(memberships.map((m) => m.groupId)));
    if (groupIds.length === 0) return;

    // 1단계: 모든 그룹 재정렬을 단일 트랜잭션으로 — 중간 예외 시 partial state 방지
    await this.dataSource.transaction(async (mgr) => {
      for (const gid of groupIds) {
        await this.reorderByMarchSeconds(gid, mgr);
      }
    });

    // emit은 트랜잭션 커밋 이후에만 — 롤백 시 유령 방송 방지
    for (const gid of groupIds) {
      const full = await this.getFullGroup(gid);
      this.gateway.emitGroupUpdated(full);
      if (full.state === 'running') {
        await this.recomputeIfRunning(gid);
      }
    }
  }
}
