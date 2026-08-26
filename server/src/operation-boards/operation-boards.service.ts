// 작전판 저장본의 조회와 관리를 담당한다.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, type FindOptionsSelect } from 'typeorm';
import { RenameOperationBoardDto } from './dto/rename-operation-board.dto';
import { SaveOperationBoardDto } from './dto/save-operation-board.dto';
import { OperationBoard } from './operation-board.entity';
import { isOperationBoardBackgroundUrl } from './operation-board-upload.options';
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
  constructor(
    @InjectRepository(OperationBoard)
    private readonly repo: Repository<OperationBoard>,
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

    const result = await this.repo.delete(id);
    if (!result.affected) {
      throw new NotFoundException('작전판 저장본을 찾을 수 없습니다.');
    }
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
