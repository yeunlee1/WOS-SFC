import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { User } from '../users/users.entity';
import { CreateRallyGroupDto } from './dto/create-rally-group.dto';
import { RallyGroupsGateway } from './rally-groups.gateway';

const MAX_GROUP_MEMBERS = 10;
const COUNTDOWN_LEAD_MS = 4000;

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
    createdBy: group.createdBy ? (sanitizeUser(group.createdBy) as any) : group.createdBy,
    members: (group.members ?? []).map((m) => ({
      ...m,
      user: m.user ? (sanitizeUser(m.user) as any) : m.user,
    })) as any,
  };
}

/**
 * 멤버 배열을 marchSeconds 내림차순(느린 순)으로 정렬하고
 * orderIndex를 1부터 재할당한 새 배열을 반환.
 * 동률은 기존 orderIndex 오름차순으로 tie-break (안정 정렬).
 * 순수 함수 — DB 접근 없음. reorderByMarchSeconds의 정렬 핵심 로직.
 */
export function sortMembersByMarchDesc<T extends { orderIndex: number; marchSecondsOverride: number | null; user?: { marchSeconds?: number | null } | null }>(
  members: T[],
): T[] {
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
): { maxMarch: number; fireOffsets: Array<{ orderIndex: number; offsetMs: number; userId: number }> } {
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
export class RallyGroupsService {
  constructor(
    @InjectRepository(RallyGroup) private groupRepo: Repository<RallyGroup>,
    @InjectRepository(RallyGroupMember) private memberRepo: Repository<RallyGroupMember>,
    @InjectRepository(User) private userRepo: Repository<User>,
    private gateway: RallyGroupsGateway,
    private dataSource: DataSource,
  ) {}

  async listAssignableUsers() {
    return this.userRepo.find({
      select: ['id', 'nickname', 'allianceName', 'role', 'language'],
      order: { allianceName: 'ASC', nickname: 'ASC' },
    });
  }

  async listAll(): Promise<RallyGroup[]> {
    const groups = await this.groupRepo.find({
      relations: ['members', 'members.user', 'createdBy'],
      order: { createdAt: 'ASC' },
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
    const group = this.groupRepo.create({
      name: dto.name,
      broadcastAll: dto.broadcastAll ?? false,
      createdById: userId,
      state: 'idle',
    });
    const saved = await this.groupRepo.save(group);
    const full = await this.getFullGroup(saved.id);
    this.gateway.emitGroupUpdated(full);
    return full;
  }

  async remove(id: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id } });
    if (!group) throw new NotFoundException('RallyGroup not found');
    await this.groupRepo.remove(group);
    this.gateway.emitGroupRemoved(id);
  }

  async addMember(groupId: string, userId: number): Promise<RallyGroup> {
    await this.dataSource.transaction(async (mgr) => {
      const count = await mgr.count(RallyGroupMember, { where: { groupId } });
      if (count >= MAX_GROUP_MEMBERS) throw new BadRequestException(`Group is full (max ${MAX_GROUP_MEMBERS})`);
      const duplicate = await mgr.findOne(RallyGroupMember, { where: { groupId, userId } });
      if (duplicate) throw new BadRequestException('User already in group');
      // 임시 orderIndex(count+1)로 삽입 후 reorderByMarchSeconds에서 재할당
      const member = mgr.create(RallyGroupMember, { groupId, userId, orderIndex: count + 1, marchSecondsOverride: null });
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
      const member = await mgr.findOne(RallyGroupMember, { where: { id: memberId, groupId } });
      if (!member) throw new NotFoundException('Member not found');
      await mgr.remove(member);

      // 기존 연속 번호 재할당 대신 marchSeconds 기준 재정렬
      await this.reorderByMarchSeconds(groupId, mgr);
    });

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
  }

  async updateMarchOverride(memberId: string, seconds: number | null): Promise<RallyGroup> {
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

  async startCountdown(groupId: string): Promise<{ group: RallyGroup; payload: { groupId: string; startedAtServerMs: number; fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[] } }> {
    // 카운트다운 시작 전 최신 marchSeconds 기준으로 순서 재정렬
    await this.reorderByMarchSeconds(groupId);

    const group = await this.getFullGroup(groupId);

    const effectiveMap = new Map<number, number>(
      group.members.map((m) => [m.userId, m.marchSecondsOverride ?? m.user?.marchSeconds ?? 0]),
    );

    const { maxMarch, fireOffsets } = computeFireSchedule(group.members, effectiveMap);
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

    return { group: full, payload };
  }

  async stopCountdown(groupId: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('RallyGroup not found');

    await this.groupRepo.update(groupId, {
      state: 'idle',
      startedAtServerMs: null,
      maxMarchSeconds: null,
    });

    this.gateway.emitCountdownStop(groupId);

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
  }

  async getMemberUserId(memberId: string): Promise<number | null> {
    const member = await this.memberRepo.findOne({ where: { id: memberId } });
    return member?.userId ?? null;
  }

  async recomputeIfRunning(groupId: string): Promise<{ payload?: { groupId: string; startedAtServerMs: number; fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[] } }> {
    const group = await this.getFullGroup(groupId);
    if (group.state !== 'running' || group.startedAtServerMs == null) return {};

    const effectiveMap = new Map<number, number>(
      group.members.map((m) => [m.userId, m.marchSecondsOverride ?? m.user?.marchSeconds ?? 0]),
    );

    const { maxMarch, fireOffsets } = computeFireSchedule(group.members, effectiveMap);

    await this.groupRepo.update(groupId, { maxMarchSeconds: maxMarch });

    const payload = { groupId, startedAtServerMs: Number(group.startedAtServerMs), fireOffsets };
    this.gateway.emitCountdownStart(payload);

    return { payload };
  }

  /**
   * marchSeconds 내림차순(느린 순)으로 orderIndex 재할당.
   * 동률일 때는 기존 orderIndex를 tie-break으로 사용해 안정 정렬.
   * @param mgr EntityManager — 트랜잭션 내부에서 호출 시 전달, 아니면 생략(자체 트랜잭션으로 실행)
   */
  private async reorderByMarchSeconds(groupId: string, mgr?: EntityManager): Promise<void> {
    if (mgr) {
      return this.reorderByMarchSeconds_inner(groupId, mgr);
    }
    return this.dataSource.transaction((m) => this.reorderByMarchSeconds_inner(groupId, m));
  }

  private async reorderByMarchSeconds_inner(groupId: string, mgr: EntityManager): Promise<void> {
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
