// 작전판 저장본의 조회와 관리를 담당한다.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type FindOptionsSelect } from 'typeorm';
import { RenameOperationBoardDto } from './dto/rename-operation-board.dto';
import { SaveOperationBoardDto } from './dto/save-operation-board.dto';
import { OperationBoard } from './operation-board.entity';
import { isOperationBoardBackgroundUrl } from './operation-board-upload.options';
import { deleteOperationBoardBackgroundByUrl } from './operation-board-background-files';
import { OperationBoardsGateway } from './operation-boards.gateway';
import { BoardUploadQuotaService } from '../boards/board-upload-quota.service';
import {
  MAX_OPERATION_ELEMENTS,
  MAX_OPERATION_ELEMENTS_BYTES,
  validateOperationElements,
  type OperationElement,
} from './operation-board-elements';

type ActingUser = { id: number; nickname: string; role: string };

const ADMIN_ROLES = ['admin', 'developer'];

/**
 * 목록 조회가 읽어 올 컬럼. elementsJson 은 일부러 빠져 있다 — list() 주석 참고.
 * 요소 개수는 넣지 않았다. elements_json 을 읽지 않고 세려면 MySQL JSON_LENGTH 를
 * 쓰는 원시 SQL 이 필요한데, 이 브랜치에서는 실제 DB 로 검증할 방법이 없어 넣지 않았다.
 */
const LIST_COLUMNS: FindOptionsSelect<OperationBoard> = {
  id: true,
  title: true,
  backgroundType: true,
  backgroundImageUrl: true,
  createdByUserId: true,
  createdByNick: true,
  updatedByUserId: true,
  updatedByNick: true,
  createdAt: true,
  updatedAt: true,
};

function assertAdmin(user: ActingUser): void {
  if (!ADMIN_ROLES.includes(user.role)) {
    throw new ForbiddenException();
  }
}

// 저장본도 라이브 보드와 같은 화이트리스트·상한을 쓴다 —
// 여기서 걸러야 DB 에 임의 키가 들어가고 그것이 다시 전원에게 브로드캐스트되는 경로가 막힌다.
function assertElementsBounded(elements: unknown[]): OperationElement[] {
  const validated = validateOperationElements(elements);
  if (validated.rejection === 'too-many') {
    throw new BadRequestException(
      `작전판 요소는 최대 ${MAX_OPERATION_ELEMENTS}개까지 저장할 수 있습니다.`,
    );
  }
  if (validated.rejection === 'too-large') {
    throw new BadRequestException(
      `작전판 저장 데이터가 상한(${Math.floor(MAX_OPERATION_ELEMENTS_BYTES / 1000)}KB)을 넘었습니다.`,
    );
  }
  if (validated.rejection) {
    throw new BadRequestException('작전판 요소 형식이 올바르지 않습니다.');
  }
  return validated.elements;
}

function normalizeTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) {
    throw new BadRequestException('작전판 제목을 입력해주세요.');
  }
  return trimmed;
}

function normalizeBackgroundImageUrl(
  dto: SaveOperationBoardDto,
): string | null {
  if (dto.backgroundType === 'grid') {
    return null;
  }

  const imageUrl = dto.backgroundImageUrl?.trim();
  if (!isOperationBoardBackgroundUrl(imageUrl)) {
    throw new BadRequestException(
      '서버에 업로드한 작전판 배경 이미지만 사용할 수 있습니다.',
    );
  }

  return imageUrl;
}

@Injectable()
export class OperationBoardsService {
  private readonly logger = new Logger(OperationBoardsService.name);

  constructor(
    @InjectRepository(OperationBoard)
    private readonly repo: Repository<OperationBoard>,
    // 업로드 한도는 uploads/ 전체를 합산한다. 배경을 회수하면 캐시를 버려
    // 다음 업로드 판정에 곧바로 반영되게 한다.
    private readonly quota: BoardUploadQuotaService,
    // 라이브 작전판이 지금 그 배경을 띄우고 있는지 확인하는 용도로만 쓴다.
    private readonly liveBoard: OperationBoardsGateway,
  ) {}

  /**
   * 저장본 목록 — 요소는 싣지 않는다.
   *
   * 근거 — 저장본 하나가 요소 상한(250KB)까지 찰 수 있고 목록은 50개를 준다.
   * 요소를 함께 실으면 목록 한 번이 최대 약 12MB 이고, 작전판 탭에 들어오는
   * 회원 전원이 매번 그것을 받는다. 그 시간 동안 이벤트 루프가 카운트다운
   * 브로드캐스트를 밀어낸다. 요소가 필요한 곳은 "불러오기" 하나뿐이므로
   * 그쪽만 getOne 으로 개별 조회한다.
   *
   * select 로 elements_json 컬럼 자체를 읽지 않는다 — 응답에서만 빼면
   * DB→서버 구간의 전송과 JSON 파싱 비용이 그대로 남는다.
   */
  async list() {
    const rows = await this.repo.find({
      select: LIST_COLUMNS,
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => this.formatSummary(row));
  }

  async getOne(id: number) {
    const row = await this.repo.findOneBy({ id });
    if (!row) {
      throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
    }
    return this.format(row);
  }

  async saveSnapshot(user: ActingUser, dto: SaveOperationBoardDto) {
    assertAdmin(user);
    const elements = assertElementsBounded(dto.elements);

    const now = new Date();
    const row = this.repo.create({
      title: normalizeTitle(dto.title),
      backgroundType: dto.backgroundType,
      backgroundImageUrl: normalizeBackgroundImageUrl(dto),
      elementsJson: elements,
      createdByUserId: user.id,
      createdByNick: user.nickname,
      updatedByUserId: user.id,
      updatedByNick: user.nickname,
      createdAt: now,
      updatedAt: now,
    });

    return this.format(await this.repo.save(row));
  }

  async rename(id: number, user: ActingUser, dto: RenameOperationBoardDto) {
    assertAdmin(user);

    const row = await this.repo.findOneBy({ id });
    if (!row) {
      throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
    }

    row.title = normalizeTitle(dto.title);
    row.updatedByUserId = user.id;
    row.updatedByNick = user.nickname;
    row.updatedAt = new Date();

    return this.format(await this.repo.save(row));
  }

  async remove(id: number, user: ActingUser): Promise<void> {
    assertAdmin(user);

    // 삭제 전에 배경 URL 을 확보한다. 행이 사라진 뒤에는 읽을 수 없다.
    const row = await this.repo.findOneBy({ id });
    if (!row) {
      throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
    }
    const backgroundImageUrl = row.backgroundImageUrl;

    // DB 를 먼저 지운다. 파일을 먼저 지우면 DB 삭제가 실패했을 때 저장본은 남고
    // 배경만 사라져 되돌릴 수 없다. 이 순서면 최악이 고아 파일이다.
    const result = await this.repo.delete(id);
    if (!result.affected) {
      throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
    }

    await this.removeBackgroundFile(backgroundImageUrl);
  }

  /**
   * 저장본이 들고 있던 배경 파일을 회수한다.
   *
   * 회수하지 않는 경우가 있다 — 같은 배경 URL 을 다른 저장본이나 라이브 작전판이
   * 아직 참조하면 지우지 않는다. 저장본을 불러와 그대로 다시 저장하면 두 저장본이
   * 같은 파일을 가리키므로(web/src/components/OperationBoard/OperationBoardTab.jsx
   * 의 불러오기→저장 경로) 실제로 일어나는 상황이다.
   *
   * 파일 회수 실패가 이미 끝난 DB 삭제를 되돌리지 않도록 여기서 끊고 로그만 남긴다.
   */
  private async removeBackgroundFile(url: string | null): Promise<void> {
    if (!url) return;
    try {
      if (await this.isBackgroundStillReferenced(url)) {
        this.logger.debug(
          `다른 작전판이 같은 배경을 참조해 파일을 남긴다: ${url}`,
        );
        return;
      }
      const result = await deleteOperationBoardBackgroundByUrl(url, {
        logger: this.logger,
      });
      if (result === 'deleted') this.quota.invalidate();
    } catch (error) {
      this.logger.error(
        `작전판 배경 회수 중 예외: ${(error as Error).message} — 고아로 남으므로 관리자 확인이 필요하다`,
      );
    }
  }

  private async isBackgroundStillReferenced(url: string): Promise<boolean> {
    // 이 시점에는 대상 행이 이미 지워져 있으므로 남은 저장본만 세어진다.
    if ((await this.repo.countBy({ backgroundImageUrl: url })) > 0) return true;
    // 라이브 작전판이 그 배경을 띄우고 있으면 지금 보고 있는 인원의 화면이 깨진다.
    return this.liveBoard.isLiveBackgroundImage(url);
  }

  private format(row: OperationBoard) {
    return {
      ...this.formatSummary(row),
      elements: row.elementsJson ?? [],
    };
  }

  /** 요소를 뺀 메타만 담는다. 목록 조회 전용이다. */
  private formatSummary(row: OperationBoard) {
    return {
      id: row.id,
      title: row.title,
      backgroundType: row.backgroundType,
      backgroundImageUrl: row.backgroundImageUrl,
      createdByUserId: row.createdByUserId,
      createdByNick: row.createdByNick,
      updatedByUserId: row.updatedByUserId,
      updatedByNick: row.updatedByNick,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
