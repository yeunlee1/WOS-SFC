// server/src/boards/boards.service.ts
import {
  ForbiddenException,
  Injectable,
  Inject,
  forwardRef,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardPost } from './board-post.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { User } from '../users/users.entity';
import { CreateBoardPostDto } from './dto/create-board-post.dto';
import { hasOriginalNicknameOwnership } from '../users/nickname-ownership';

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

  async add(
    user: Pick<User, 'nickname' | 'allianceName'>,
    dto: CreateBoardPostDto,
  ): Promise<BoardPost> {
    const post = this.repo.create({
      alliance: dto.alliance,
      nickname: user.nickname,
      userAlliance: user.allianceName,
      content: dto.content,
      lang: dto.lang || 'ko',
      imageUrls: dto.imageUrls || null,
    });
    const saved = await this.repo.save(post);
    await this.gateway.broadcastBoard(saved.alliance);
    return saved;
  }

  async remove(
    id: number,
    user: Pick<User, 'nickname' | 'role' | 'createdAt'>,
  ): Promise<void> {
    const post = await this.repo.findOneBy({ id });
    if (!post) throw new NotFoundException('게시물을 찾을 수 없습니다');
    // 계정 삭제 뒤 같은 닉네임으로 재가입해도 이전 글 소유권은 승계되지 않는다.
    // DB 초 단위 timestamp가 같을 때도 안전하게 거부하도록 strict earlier만 인정한다.
    const isOwner = hasOriginalNicknameOwnership(
      user,
      post.nickname,
      post.createdAt,
    );
    const isManager = user.role === 'admin' || user.role === 'developer';
    if (!isOwner && !isManager) {
      throw new ForbiddenException('게시물을 삭제할 권한이 없습니다');
    }
    const alliance = post.alliance;
    await this.repo.delete(id);
    await this.gateway.broadcastBoard(alliance);
  }
}
