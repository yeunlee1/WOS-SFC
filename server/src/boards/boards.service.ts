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

  // 연맹별 조회를 순차 await 하면 소켓 접속 1건마다 왕복 5회가 직렬로 쌓인다.
  // 100명 동시 재접속에서 이 구간만으로 커넥션 풀 대기열이 길어져 지연이 누적된다.
  // 병렬로 띄우고 고정 목록 순서대로 다시 묶는다 (Promise.all은 순서를 보존한다).
  async findAllGrouped(): Promise<Record<string, BoardPost[]>> {
    const lists = await Promise.all(
      BOARD_ALLIANCES.map((a) => this.findByAlliance(a)),
    );
    const result: Record<string, BoardPost[]> = {};
    BOARD_ALLIANCES.forEach((a, i) => {
      result[a] = lists[i];
    });
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
