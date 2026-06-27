// 작전판 저장본의 조회와 관리를 담당한다.
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RenameOperationBoardDto } from './dto/rename-operation-board.dto';
import { SaveOperationBoardDto } from './dto/save-operation-board.dto';
import { OperationBoard } from './operation-board.entity';

type ActingUser = { id: number; nickname: string; role: string };

const ADMIN_ROLES = ['admin', 'developer'];
const MAX_ELEMENTS = 500;
const MAX_ELEMENTS_BYTES = 250_000;

function assertAdmin(user: ActingUser): void {
  if (!ADMIN_ROLES.includes(user.role)) {
    throw new ForbiddenException();
  }
}

function assertElementsBounded(elements: unknown[]): void {
  if (elements.length > MAX_ELEMENTS) {
    throw new BadRequestException(
      `작전판 요소는 최대 ${MAX_ELEMENTS}개까지 저장할 수 있습니다.`,
    );
  }

  const bytes = Buffer.byteLength(JSON.stringify(elements), 'utf8');
  if (bytes > MAX_ELEMENTS_BYTES) {
    throw new BadRequestException('작전판 저장 데이터가 너무 큽니다.');
  }
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

  if (
    typeof dto.backgroundImageUrl !== 'string' ||
    dto.backgroundImageUrl.trim().length === 0
  ) {
    throw new BadRequestException('이미지 배경 URL을 입력해주세요.');
  }

  return dto.backgroundImageUrl.trim();
}

@Injectable()
export class OperationBoardsService {
  constructor(
    @InjectRepository(OperationBoard)
    private readonly repo: Repository<OperationBoard>,
  ) {}

  async list() {
    const rows = await this.repo.find({
      order: { updatedAt: 'DESC' },
      take: 50,
    });
    return rows.map((row) => this.format(row));
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
    assertElementsBounded(dto.elements);

    const now = new Date();
    const row = this.repo.create({
      title: normalizeTitle(dto.title),
      backgroundType: dto.backgroundType,
      backgroundImageUrl: normalizeBackgroundImageUrl(dto),
      elementsJson: dto.elements,
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
      id: row.id,
      title: row.title,
      backgroundType: row.backgroundType,
      backgroundImageUrl: row.backgroundImageUrl,
      elements: row.elementsJson ?? [],
      createdByUserId: row.createdByUserId,
      createdByNick: row.createdByNick,
      updatedByUserId: row.updatedByUserId,
      updatedByNick: row.updatedByNick,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
