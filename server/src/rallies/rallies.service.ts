// server/src/rallies/rallies.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Rally } from './rally.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class RalliesService {
  constructor(
    @InjectRepository(Rally) private repo: Repository<Rally>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findAll(): Promise<Rally[]> {
    return this.repo.find({ order: { createdAt: 'ASC' } });
  }

  async add(data: Partial<Rally>): Promise<Rally> {
    const rally = this.repo.create(data);
    const saved = await this.repo.save(rally);
    await this.gateway.broadcastRallies();
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
    await this.gateway.broadcastRallies();
  }
}
