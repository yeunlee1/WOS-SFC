import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Notice } from './notice.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

@Injectable()
export class NoticesService {
  constructor(
    @InjectRepository(Notice) private repo: Repository<Notice>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findAll(): Promise<Notice[]> {
    return this.repo.find({ order: { createdAt: 'DESC' } });
  }

  async add(data: Partial<Notice>): Promise<Notice> {
    const notice = this.repo.create(data);
    const saved = await this.repo.save(notice);
    await this.gateway.broadcastNotices();
    return saved;
  }

  async remove(id: number): Promise<void> {
    await this.repo.delete(id);
    await this.gateway.broadcastNotices();
  }
}
