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

    // 목록은 요소를 뺀 메타만 준다 — 나머지 필드는 저장 응답과 같아야 한다.
    const { elements: savedElements, ...savedMeta } = saved;
    const list = await service.list();
    expect(list).toEqual([savedMeta]);
    expect(savedElements).toHaveLength(1);
  });

  it('persists image background URLs for developer users', async () => {
    const { service } = await setup();

    const saved = await service.saveSnapshot(
      { id: 3, nickname: 'devKo', role: 'developer' },
      {
        title: '이미지 작전',
        backgroundType: 'image',
        backgroundImageUrl:
          '/uploads/operation-boards/1760000000000-123e4567-e89b-12d3-a456-426614174000.webp',
        elements: [],
      },
    );

    expect(saved.backgroundImageUrl).toBe(
      '/uploads/operation-boards/1760000000000-123e4567-e89b-12d3-a456-426614174000.webp',
    );
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

  it('rejects external and path-traversal background image URLs', async () => {
    const { service } = await setup();

    for (const backgroundImageUrl of [
      'https://example.com/tracker.webp',
      '/uploads/operation-boards/../../auth/me.webp',
      '/uploads/operation-boards/not-generated.webp',
    ]) {
      await expect(
        service.saveSnapshot(
          { id: 1, nickname: 'devKo', role: 'developer' },
          {
            title: '외부 이미지',
            backgroundType: 'image',
            backgroundImageUrl,
            elements: [],
          },
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
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

  it('저장 요소를 화이트리스트로 검증해 형식이 틀리면 거절한다', async () => {
    const { service } = await setup();
    const actor = { id: 1, nickname: 'devKo', role: 'developer' };

    for (const elements of [
      [{ id: 'e1', type: 'nope' }],
      [{ id: 'e1', type: 'text', label: 'main' }],
      [{ id: 'e1', type: 'path', points: [{ x: 1, y: 2 }] }],
      [{ id: 'e1', type: 'text', text: 'x'.repeat(301) }],
    ]) {
      await expect(
        service.saveSnapshot(actor, {
          title: '형식 오류',
          backgroundType: 'grid',
          backgroundImageUrl: null,
          elements,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('실측 크기의 펜 200획 저장본은 그대로 저장한다', async () => {
    const { service } = await setup();
    const elements = Array.from({ length: 200 }, (_, index) => ({
      id: `op-${String(index).padStart(36, '0')}`,
      type: 'path',
      x: index,
      y: index,
      x2: index + 1,
      y2: index + 1,
      strokeWidth: 3,
      color: '#7dd3fc',
      d: `M ${index} ${index}`.padEnd(380, ' L 1 1'),
    }));
    // 이 본문은 전역 50kb 상한을 넘는 크기다 — 라우트별 상한이 없으면 도달조차 못 한다.
    expect(
      Buffer.byteLength(JSON.stringify({ elements }), 'utf8'),
    ).toBeGreaterThan(50 * 1024);

    const saved = await service.saveSnapshot(
      { id: 1, nickname: 'adminKo', role: 'admin' },
      {
        title: '펜 200획',
        backgroundType: 'grid',
        backgroundImageUrl: null,
        elements,
      },
    );

    expect(saved.elements).toHaveLength(200);
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

describe('operation board background upload options', () => {
  it('keeps background uploads image-only, single-file, and bounded', () => {
    const mod = require('./operation-board-upload.options') as {
      OPERATION_BOARD_BACKGROUND_LIMITS: Record<string, number>;
      OPERATION_BOARD_BACKGROUND_ALLOWED_MIME_TYPES: string[];
      OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE: Record<string, string>;
    };

    expect(mod.OPERATION_BOARD_BACKGROUND_LIMITS).toEqual({
      fileSize: 8 * 1024 * 1024,
      files: 1,
      fields: 0,
      parts: 1,
      fieldNameSize: 100,
    });
    expect(mod.OPERATION_BOARD_BACKGROUND_ALLOWED_MIME_TYPES).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ]);
    expect(mod.OPERATION_BOARD_BACKGROUND_EXTENSION_BY_MIME_TYPE).toMatchObject(
      {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/webp': '.webp',
      },
    );
  });
});

// ─── 목록 조회 응답 크기 ───
// 저장본 50개 × 요소 500개면 목록 한 번이 수 MB 다. 회원 전원이 작전판 탭에 들어올 때마다
// 그것을 내려받으면 카운트다운 브로드캐스트가 밀린다. 목록은 메타만 실어야 한다.
describe('OperationBoardsService 목록 조회', () => {
  function makeElements(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      id: `e${index}`,
      type: 'path',
      x: index,
      y: index,
      d: `M ${index} ${index}`.padEnd(400, ' L 1 1'),
    }));
  }

  async function setupWithBoards(boardCount: number, elementCount: number) {
    const repo = makeRepo();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperationBoardsService,
        { provide: getRepositoryToken(OperationBoard), useValue: repo },
      ],
    }).compile();
    const service: OperationBoardsService = moduleRef.get(
      OperationBoardsService,
    );

    for (let index = 0; index < boardCount; index += 1) {
      await service.saveSnapshot(
        { id: 1, nickname: 'adminKo', role: 'admin' },
        {
          title: `작전 ${index}`,
          backgroundType: 'grid',
          backgroundImageUrl: null,
          elements: makeElements(elementCount),
        },
      );
    }
    repo.find.mockClear();
    return { service, repo };
  }

  it('목록 응답에 요소를 싣지 않는다', async () => {
    const { service } = await setupWithBoards(3, 300);

    const list = await service.list();

    expect(list).toHaveLength(3);
    for (const row of list) {
      expect(row).not.toHaveProperty('elements');
      expect(row).not.toHaveProperty('elementsJson');
      expect(row.id).toEqual(expect.any(Number));
      expect(typeof row.title).toBe('string');
      expect(row.createdAt).toBeInstanceOf(Date);
      expect(row.updatedAt).toBeInstanceOf(Date);
    }
  });

  it('요소가 가득 찬 저장본이 여러 개여도 목록 응답이 작다', async () => {
    const { service } = await setupWithBoards(5, 500);

    const list = await service.list();
    const bytes = Buffer.byteLength(JSON.stringify(list), 'utf8');

    // 저장본 하나에 실린 요소만 200KB 가 넘는다. 메타만 실으면 저장본당 1KB 미만이어야 한다.
    expect(bytes).toBeLessThan(5 * 1024);
  });

  it('목록 조회는 DB 에서도 요소 컬럼을 읽지 않는다', async () => {
    const { service, repo } = await setupWithBoards(1, 10);

    await service.list();

    expect(repo.find).toHaveBeenCalledTimes(1);
    const findCalls = repo.find.mock.calls as unknown as Array<
      [{ select?: Record<string, unknown>; take?: number }]
    >;
    const options = findCalls[0][0];
    expect(options?.select).toBeDefined();
    expect(options.select).not.toHaveProperty('elementsJson');
    expect(options.select?.id).toBe(true);
    expect(options.select?.title).toBe(true);
    expect(options.select?.updatedAt).toBe(true);
    expect(options.take).toBe(50);
  });

  it('개별 조회는 요소를 그대로 싣는다', async () => {
    const { service } = await setupWithBoards(1, 12);

    const list = await service.list();
    const one = await service.getOne(list[0].id);

    expect(one.elements).toHaveLength(12);
    expect(one.title).toBe(list[0].title);
    expect(one.backgroundType).toBe(list[0].backgroundType);
    expect(one.backgroundImageUrl).toBe(list[0].backgroundImageUrl);
  });
});
