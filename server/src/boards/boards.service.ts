// server/src/boards/boards.service.ts
import {
  ForbiddenException,
  Injectable,
  Inject,
  forwardRef,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardPost } from './board-post.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { User } from '../users/users.entity';
import { CreateBoardPostDto } from './dto/create-board-post.dto';
import { hasOriginalNicknameOwnership } from '../users/nickname-ownership';
import { deleteBoardImagesByUrl } from './board-image-files';
import { BoardUploadQuotaService } from './board-upload-quota.service';

const BOARD_ALLIANCES = ['KOR', 'NSL', 'JKY', 'GPX', 'UFO'];

@Injectable()
export class BoardsService {
  private readonly logger = new Logger(BoardsService.name);

  constructor(
    @InjectRepository(BoardPost) private repo: Repository<BoardPost>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
    private readonly quota: BoardUploadQuotaService,
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
    const imageUrls = post.imageUrls;
    // DB 를 먼저 지운다. 파일을 먼저 지우면 DB 삭제가 실패했을 때 게시물은 남고
    // 이미지만 사라져 되돌릴 수 없다. 이 순서면 최악이 고아 파일이고, 그건
    // BoardImageCleanupService 로 회수할 수 있다.
    await this.repo.delete(id);
    await this.gateway.broadcastBoard(alliance);
    await this.removeImageFiles(imageUrls);
  }

  // 파일 회수 실패가 이미 끝난 게시물 삭제를 되돌리지 않도록 여기서 끊고 로그만 남긴다.
  private async removeImageFiles(imageUrls: string[] | null): Promise<void> {
    if (!imageUrls?.length) return;
    try {
      const summary = await deleteBoardImagesByUrl(imageUrls, {
        logger: this.logger,
      });
      // 사용량 캐시(최대 5초)를 버려 회수분이 다음 업로드 판정에 곧바로 반영되게 한다.
      this.quota.invalidate();
      if (summary.failed.length > 0 || summary.rejected.length > 0) {
        this.logger.error(
          `게시판 이미지 회수 일부 실패 — 실패 ${summary.failed.length}건, 거부 ${summary.rejected.length}건`,
        );
      }
    } catch (error) {
      this.logger.error(
        `게시판 이미지 회수 중 예외: ${(error as Error).message}`,
      );
    }
  }
}
