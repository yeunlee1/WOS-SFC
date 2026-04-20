import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
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
      const member = mgr.create(RallyGroupMember, { groupId, userId, orderIndex: count + 1, marchSecondsOverride: null });
      await mgr.save(member);
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

      const remaining = await mgr.find(RallyGroupMember, {
        where: { groupId },
        order: { orderIndex: 'ASC' },
      });
      for (let i = 0; i < remaining.length; i++) {
        remaining[i].orderIndex = i + 1;
      }
      if (remaining.length > 0) await mgr.save(remaining);
    });

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
  }

  async updateMarchOverride(memberId: string, seconds: number | null): Promise<RallyGroup> {
    const member = await this.memberRepo.findOne({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Member not found');
    await this.memberRepo.update(memberId, { marchSecondsOverride: seconds });

    const full = await this.getFullGroup(member.groupId);
    this.gateway.emitGroupUpdated(full);

    if (full.state === 'running') await this.recomputeIfRunning(member.groupId);

    return full;
  }

  async startCountdown(groupId: string): Promise<{ group: RallyGroup; payload: { groupId: string; startedAtServerMs: number; fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[] } }> {
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
}
