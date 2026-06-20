// 작전판 저장 서비스의 스냅샷 계약을 검증한다.
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { validateSync } from 'class-validator';
import { RenameOperationBoardDto } from './dto/rename-operation-board.dto';
import { SaveOperationBoardDto } from './dto/save-operation-board.dto';
import { OperationBoard } from './operation-board.entity';
import { OperationBoardsService } from './operation-boards.service';

type MockOperationBoard = OperationBoard & {
  id: number;
  createdAt: Date;
  updatedAt: Date;
};

function makeRepo() {
  const rows: MockOperationBoard[] = [];
  const repo = {
    rows,
    create: jest.fn((value: Partial<OperationBoard>) => ({
      id: rows.length + 1,
      createdAt: new Date('2026-06-20T00:00:00.000Z'),
      updatedAt: new Date('2026-06-20T00:00:00.000Z'),
      ...value,
    })),
    save: jest.fn(async (value: MockOperationBoard) => {
      const existing = rows.find((row) => row.id === value.id);
      if (existing) Object.assign(existing, value);
      else rows.push(value);
      return value;
    }),
    find: jest.fn(async () =>
      [...rows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()),
    ),
    findOneBy: jest.fn(async ({ id }: { id: number }) => {
      return rows.find((row) => row.id === id) ?? null;
    }),
    delete: jest.fn(async (id: number) => {
      const index = rows.findIndex((row) => row.id === id);
      if (index >= 0) rows.splice(index, 1);
      return { affected: index >= 0 ? 1 : 0 };
    }),
  };
  return repo;
}

describe('OperationBoardsService', () => {
  async function setup() {
    const repo = makeRepo();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperationBoardsService,
        { provide: getRepositoryToken(OperationBoard), useValue: repo },
      ],
    }).compile();
    return { service: moduleRef.get(OperationBoardsService), repo };
  }

  it('saves and lists bounded operation board snapshots for admin users', async () => {
    const { service, repo } = await setup();

    const saved = await service.saveSnapshot(
      { id: 1, nickname: 'adminKo', role: 'admin' },
      {
        title: '서쪽 협공',
        backgroundType: 'grid',
        backgroundImageUrl: null,
        elements: [{ id: 'e1', type: 'text', x: 10, y: 20, text: '1진입' }],
      },
    );

    expect(repo.save).toHaveBeenCalledTimes(1);
    expect(saved.title).toBe('서쪽 협공');
    expect(saved.backgroundType).toBe('grid');
    expect(saved.backgroundImageUrl).toBeNull();
    expect(saved.elements).toHaveLength(1);
    expect(saved).not.toHaveProperty('elementsJson');
    expect(saved.createdByNick).toBe('adminKo');

    const list = await service.list();
    expect(list).toEqual([saved]);
  });

  it('persists image background URLs for developer users', async () => {
    const { service } = await setup();

    const saved = await service.saveSnapshot(
      { id: 3, nickname: 'devKo', role: 'developer' },
      {
        title: '이미지 작전',
        backgroundType: 'image',
        backgroundImageUrl: '/uploads/operation-boards/map.webp',
        elements: [],
      },
    );

    expect(saved.backgroundImageUrl).toBe('/uploads/operation-boards/map.webp');
    expect(saved.updatedByUserId).toBe(3);
  });

  it('rejects blank snapshot titles after trimming', async () => {
    const { service } = await setup();

    await expect(
      service.saveSnapshot(
        { id: 1, nickname: 'adminKo', role: 'admin' },
        {
          title: '   ',
          backgroundType: 'grid',
          backgroundImageUrl: null,
          elements: [],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects blank rename titles after trimming', async () => {
    const { service } = await setup();
    const saved = await service.saveSnapshot(
      { id: 1, nickname: 'devKo', role: 'developer' },
      {
        title: '초안',
        backgroundType: 'grid',
        backgroundImageUrl: null,
        elements: [],
      },
    );

    await expect(
      service.rename(
        saved.id,
        { id: 1, nickname: 'devKo', role: 'developer' },
        { title: '   ' },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects image snapshots without a non-empty background image URL', async () => {
    const { service } = await setup();

    for (const backgroundImageUrl of [null, '   '] satisfies Array<
      string | null
    >) {
      await expect(
        service.saveSnapshot(
          { id: 1, nickname: 'devKo', role: 'developer' },
          {
            title: '이미지 작전',
            backgroundType: 'image',
            backgroundImageUrl,
            elements: [],
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }

    const malformedDto = {
      title: '이미지 작전',
      backgroundType: 'image',
      backgroundImageUrl: undefined,
      elements: [],
    } as unknown as SaveOperationBoardDto;

    await expect(
      service.saveSnapshot(
        { id: 1, nickname: 'devKo', role: 'developer' },
        malformedDto,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects save, rename, and delete attempts from member users', async () => {
    const { service } = await setup();

    await expect(
      service.saveSnapshot(
        { id: 2, nickname: 'memberKo', role: 'member' },
        {
          title: '권한 없음',
          backgroundType: 'grid',
          backgroundImageUrl: null,
          elements: [],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.rename(
        1,
        { id: 2, nickname: 'memberKo', role: 'member' },
        { title: '거부' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.remove(1, { id: 2, nickname: 'memberKo', role: 'member' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects oversized element payloads', async () => {
    const { service } = await setup();
    const elements = Array.from({ length: 501 }, (_, index) => ({
      id: `e${index}`,
      type: 'text',
      x: index,
      y: index,
      text: 'x',
    }));

    await expect(
      service.saveSnapshot(
        { id: 1, nickname: 'devKo', role: 'developer' },
        {
          title: '너무 큼',
          backgroundType: 'grid',
          backgroundImageUrl: null,
          elements,
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    await expect(
      service.saveSnapshot(
        { id: 1, nickname: 'devKo', role: 'developer' },
        {
          title: '바이트 초과',
          backgroundType: 'grid',
          backgroundImageUrl: null,
          elements: [{ id: 'e1', text: '한'.repeat(250_001) }],
        },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('renames and deletes only existing snapshots', async () => {
    const { service } = await setup();
    const saved = await service.saveSnapshot(
      { id: 1, nickname: 'devKo', role: 'developer' },
      {
        title: '초안',
        backgroundType: 'grid',
        backgroundImageUrl: null,
        elements: [],
      },
    );

    const renamed = await service.rename(
      saved.id,
      { id: 1, nickname: 'devKo', role: 'developer' },
      { title: '최종' },
    );

    expect(renamed.title).toBe('최종');
    expect(renamed.updatedByNick).toBe('devKo');
    await service.remove(saved.id, {
      id: 1,
      nickname: 'devKo',
      role: 'developer',
    });
    await expect(service.getOne(saved.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(
      service.rename(
        999,
        { id: 1, nickname: 'devKo', role: 'developer' },
        { title: '없음' },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.remove(999, { id: 1, nickname: 'devKo', role: 'developer' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('OperationBoard DTO validation', () => {
  it('rejects empty save titles', () => {
    const dto = new SaveOperationBoardDto();
    dto.title = '';
    dto.backgroundType = 'grid';
    dto.backgroundImageUrl = null;
    dto.elements = [];

    const errors = validateSync(dto);

    expect(errors.some((error) => error.property === 'title')).toBe(true);
  });

  it('rejects empty rename titles', () => {
    const dto = new RenameOperationBoardDto();
    dto.title = '';

    const errors = validateSync(dto);

    expect(errors.some((error) => error.property === 'title')).toBe(true);
  });
});
