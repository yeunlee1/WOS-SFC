import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RallyGroup } from './rally-group.entity';
import { RallyGroupMember } from './rally-group-member.entity';
import { UserBattleSettings } from '../users/user-battle-settings.entity';
import { CreateRallyGroupDto } from './dto/create-rally-group.dto';
import { RallyGroupsGateway } from './rally-groups.gateway';

@Injectable()
export class RallyGroupsService {
  constructor(
    @InjectRepository(RallyGroup) private groupRepo: Repository<RallyGroup>,
    @InjectRepository(RallyGroupMember) private memberRepo: Repository<RallyGroupMember>,
    @InjectRepository(UserBattleSettings) private settingsRepo: Repository<UserBattleSettings>,
    @Inject(forwardRef(() => RallyGroupsGateway)) private gateway: RallyGroupsGateway,
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
  }

  async addMember(groupId: string, userId: number): Promise<RallyGroupMember> {
    const group = await this.getFullGroup(groupId);

    const existing = group.members.find((m) => m.userId === userId);
    if (existing) throw new BadRequestException('User already in group');
    if (group.members.length >= 10) throw new BadRequestException('Group is full (max 10)');

    const orderIndex = group.members.length + 1;
    const member = this.memberRepo.create({ groupId, userId, orderIndex, marchSecondsOverride: null });
    const saved = await this.memberRepo.save(member);

    const full = await this.getFullGroup(groupId);
    this.gateway.emitGroupUpdated(full);
    return saved;
  }

  async removeMember(groupId: string, memberId: string): Promise<void> {
    const member = await this.memberRepo.findOne({ where: { id: memberId, groupId } });
    if (!member) throw new NotFoundException('Member not found');
    await this.memberRepo.remove(member);

    const remaining = await this.memberRepo.find({
      where: { groupId },
      order: { orderIndex: 'ASC' },
    });
    for (let i = 0; i < remaining.length; i++) {
      remaining[i].orderIndex = i + 1;
    }
    if (remaining.length > 0) await this.memberRepo.save(remaining);

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

    const memberSettings = await Promise.all(
      group.members.map(async (m) => {
        const settings = await this.settingsRepo.findOne({ where: { userId: m.userId } });
        const effective = m.marchSecondsOverride ?? settings?.marchSeconds ?? 0;
        return { member: m, effective };
      }),
    );

    const maxMarch = memberSettings.reduce((max, { effective }) => Math.max(max, effective), 0);
    const startedAtServerMs = Date.now() + 3000;

    const fireOffsets = memberSettings.map(({ member, effective }) => ({
      orderIndex: member.orderIndex,
      offsetMs: (maxMarch - effective) * 1000,
      userId: member.userId,
    }));

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

    const memberSettings = await Promise.all(
      group.members.map(async (m) => {
        const settings = await this.settingsRepo.findOne({ where: { userId: m.userId } });
        const effective = m.marchSecondsOverride ?? settings?.marchSeconds ?? 0;
        return { member: m, effective };
      }),
    );

    const maxMarch = memberSettings.reduce((max, { effective }) => Math.max(max, effective), 0);
    const fireOffsets = memberSettings.map(({ member, effective }) => ({
      orderIndex: member.orderIndex,
      offsetMs: (maxMarch - effective) * 1000,
      userId: member.userId,
    }));

    group.maxMarchSeconds = maxMarch;
    await this.groupRepo.save(group);

    const payload = { groupId, startedAtServerMs: Number(group.startedAtServerMs), fireOffsets };
    this.gateway.emitCountdownStart(payload);

    return { payload };
  }
}
