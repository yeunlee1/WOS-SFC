// server/src/boards/boards.service.ts
import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardPost } from './board-post.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const BOARD_ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

@Injectable()
export class BoardsService {
  constructor(
    @InjectRepository(BoardPost) private repo: Repository<BoardPost>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  async findByAlliance(alliance: string): Promise<BoardPost[]> {
    return this.repo.find({
      where: { alliance },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async findAllGrouped(): Promise<Record<string, BoardPost[]>> {
    const result: Record<string, BoardPost[]> = {};
    for (const a of BOARD_ALLIANCES) {
      result[a] = await this.findByAlliance(a);
    }
    return result;
  }

  async add(data: Partial<BoardPost>): Promise<BoardPost> {
    const post = this.repo.create(data);
    const saved = await this.repo.save(post);
    await this.gateway.broadcastBoard(saved.alliance);
    return saved;
  }

  async remove(id: number): Promise<void> {
    const post = await this.repo.findOneBy({ id });
    if (!post) return;
    const alliance = post.alliance;
    await this.repo.delete(id);
    await this.gateway.broadcastBoard(alliance);
  }
}
