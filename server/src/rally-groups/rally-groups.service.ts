import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { UserBattleSettings } from '../users/user-battle-settings.entity';
import { CreateRallyGroupDto } from './dto/create-rally-group.dto';
import { RallyGroupsGateway } from './rally-groups.gateway';

const MAX_GROUP_MEMBERS = 10;
const COUNTDOWN_LEAD_MS = 3000;

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
    @InjectRepository(UserBattleSettings) private settingsRepo: Repository<UserBattleSettings>,
    private gateway: RallyGroupsGateway,
    private dataSource: DataSource,
  ) {}

  async listAll(): Promise<RallyGroup[]> {
    return this.groupRepo.find({
      relations: ['members', 'members.user', 'createdBy'],
      order: { createdAt: 'ASC' },
    });
  }

  async getFullGroup(id: string): Promise<RallyGroup> {
    const group = await this.groupRepo.findOne({
      where: { id },
      relations: ['members', 'members.user', 'createdBy'],
    });
    if (!group) throw new NotFoundException('RallyGroup not found');
    return group;
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

  async addMember(groupId: string, userId: number): Promise<RallyGroupMember> {
    const saved = await this.dataSource.transaction(async (mgr) => {
      const count = await mgr.count(RallyGroupMember, { where: { groupId } });
      if (count >= MAX_GROUP_MEMBERS) throw new BadRequestException(`Group is full (max ${MAX_GROUP_MEMBERS})`);
      const duplicate = await mgr.findOne(RallyGroupMember, { where: { groupId, userId } });
      if (duplicate) throw new BadRequestException('User already in group');
      const member = mgr.create(RallyGroupMember, { groupId, userId, orderIndex: count + 1, marchSecondsOverride: null });
      return mgr.save(member);
    });

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
    return saved;
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

  async updateMarchOverride(memberId: string, seconds: number | null): Promise<RallyGroupMember> {
    const member = await this.memberRepo.findOne({ where: { id: memberId } });
    if (!member) throw new NotFoundException('Member not found');
    member.marchSecondsOverride = seconds;
    const saved = await this.memberRepo.save(member);

    const full = await this.getFullGroup(member.groupId);
    this.gateway.emitGroupUpdated(full);

    if (full.state === 'running') await this.recomputeIfRunning(member.groupId);

    return saved;
  }

  async startCountdown(groupId: string): Promise<{ group: RallyGroup; payload: { groupId: string; startedAtServerMs: number; fireOffsets: { orderIndex: number; offsetMs: number; userId: number }[] } }> {
    const group = await this.getFullGroup(groupId);

    const userIds = group.members.map((m) => m.userId);
    const settingsList = await this.settingsRepo.find({ where: { userId: In(userIds) } });
    const settingsMap = new Map(settingsList.map((s) => [s.userId, s]));

    const effectiveMap = new Map<number, number>(
      group.members.map((m) => [m.userId, m.marchSecondsOverride ?? settingsMap.get(m.userId)?.marchSeconds ?? 0]),
    );

    const { maxMarch, fireOffsets } = computeFireSchedule(group.members, effectiveMap);
    const startedAtServerMs = Date.now() + COUNTDOWN_LEAD_MS;

    group.state = 'running';
    group.startedAtServerMs = startedAtServerMs;
    group.maxMarchSeconds = maxMarch;
    await this.groupRepo.save(group);

    const payload = { groupId, startedAtServerMs, fireOffsets };
    this.gateway.emitCountdownStart(payload);

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);

    return { group: full, payload };
  }

  async stopCountdown(groupId: string): Promise<void> {
    const group = await this.groupRepo.findOne({ where: { id: groupId } });
    if (!group) throw new NotFoundException('RallyGroup not found');

    group.state = 'idle';
    group.startedAtServerMs = null;
    group.maxMarchSeconds = null;
    await this.groupRepo.save(group);

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

    const userIds = group.members.map((m) => m.userId);
    const settingsList = await this.settingsRepo.find({ where: { userId: In(userIds) } });
    const settingsMap = new Map(settingsList.map((s) => [s.userId, s]));

    const effectiveMap = new Map<number, number>(
      group.members.map((m) => [m.userId, m.marchSecondsOverride ?? settingsMap.get(m.userId)?.marchSeconds ?? 0]),
    );

    const { maxMarch, fireOffsets } = computeFireSchedule(group.members, effectiveMap);

    group.maxMarchSeconds = maxMarch;
    await this.groupRepo.save(group);

    const payload = { groupId, startedAtServerMs: Number(group.startedAtServerMs), fireOffsets };
    this.gateway.emitCountdownStart(payload);

    return { payload };
  }
}
