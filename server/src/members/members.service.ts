// server/src/members/members.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Member } from './member.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class MembersService {
  constructor(
    @InjectRepository(Member) private repo: Repository<Member>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findAll(): Promise<Member[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async add(data: Partial<Member>): Promise<Member> {
    const member = this.repo.create(data);
    const saved = await this.repo.save(member);
    await this.gateway.broadcastMembers();
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
    await this.gateway.broadcastMembers();
  }
}
