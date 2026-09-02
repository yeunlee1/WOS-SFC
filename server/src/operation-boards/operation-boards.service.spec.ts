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
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { OperationBoardsGateway } from './operation-boards.gateway';
import { BoardUploadQuotaService } from '../boards/board-upload-quota.service';
import { deleteOperationBoardBackgroundByUrl } from './operation-board-background-files';

// 배경 파일 회수는 실제 디스크를 건드린다. 운영 uploads/ 를 절대 만지지 않도록
// 실구현을 그대로 쓰되 대상 폴더만 테스트용 임시 디렉터리로 바꿔 끼운다.
// (변수명이 mock 으로 시작해야 jest.mock 호이스팅이 참조를 허용한다.)
let mockBackgroundDir = '';

jest.mock('./operation-board-background-files', () => {
  const actual = jest.requireActual('./operation-board-background-files');
  return {
    ...actual,
    deleteOperationBoardBackgroundByUrl: jest.fn(
      (url: unknown, options: Record<string, unknown> = {}) =>
        actual.deleteOperationBoardBackgroundByUrl(url, {
          ...options,
          directory: mockBackgroundDir,
        }),
    ),
  };
});

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
    countBy: jest.fn(
      async ({ backgroundImageUrl }: { backgroundImageUrl: string }) =>
        rows.filter((row) => row.backgroundImageUrl === backgroundImageUrl)
          .length,
    ),
  };
  return repo;
}

const deleteBackgroundMock =
  deleteOperationBoardBackgroundByUrl as unknown as jest.Mock;

// 업로드 사용량 캐시. 회수 뒤 무효화되는지만 본다.
function makeQuota() {
  return { invalidate: jest.fn() };
}

// 라이브 작전판이 지금 그 배경을 띄우고 있는지 알려주는 대역.
function makeLiveBoard(imageUrl: string | null = null) {
  return {
    isLiveBackgroundImage: jest.fn((url: string) => url === imageUrl),
  };
}

describe('OperationBoardsService', () => {
  async function setup() {
    const repo = makeRepo();
    const quota = makeQuota();
    const liveBoard = makeLiveBoard();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperationBoardsService,
        { provide: getRepositoryToken(OperationBoard), useValue: repo },
        { provide: BoardUploadQuotaService, useValue: quota },
        { provide: OperationBoardsGateway, useValue: liveBoard },
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
        { provide: BoardUploadQuotaService, useValue: makeQuota() },
        { provide: OperationBoardsGateway, useValue: makeLiveBoard() },
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

// ─── 저장본 삭제 시 배경 파일 회수 ───
// 업로드 한도(1GB)는 uploads/ 전체를 합산한다(board-upload-quota.service.ts 가
// UPLOAD_ROOT 를 재귀로 훑는다). 작전판 배경이 회수되지 않으면 게시판 업로드까지 막힌다.
describe('OperationBoardsService.remove 배경 파일 회수', () => {
  const NAME = '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg';
  const URL = `/uploads/operation-boards/${NAME}`;

  let root: string;
  let backgroundFile: string;

  function setupWith(liveImageUrl: string | null = null) {
    const repo = makeRepo();
    const quota = makeQuota();
    const liveBoard = makeLiveBoard(liveImageUrl);
    const service = new OperationBoardsService(
      repo as never,
      quota as never,
      liveBoard as never,
    );
    return { service, repo, quota, liveBoard };
  }

  async function saveWithBackground(
    service: OperationBoardsService,
    title = '배경 있는 작전',
  ) {
    return service.saveSnapshot(
      { id: 1, nickname: 'devKo', role: 'developer' },
      {
        title,
        backgroundType: 'image',
        backgroundImageUrl: URL,
        elements: [],
      },
    );
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'op-board-remove-'));
    mockBackgroundDir = join(root, 'uploads', 'operation-boards');
    mkdirSync(mockBackgroundDir, { recursive: true });
    backgroundFile = join(mockBackgroundDir, NAME);
    writeFileSync(backgroundFile, 'image-bytes');
    deleteBackgroundMock.mockClear();
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  it('저장본을 지우면 배경 이미지 파일도 지운다', async () => {
    const { service } = setupWith();
    const saved = await saveWithBackground(service);

    await service.remove(saved.id, {
      id: 1,
      nickname: 'devKo',
      role: 'developer',
    });

    expect(deleteBackgroundMock).toHaveBeenCalledWith(URL, expect.anything());
    expect(existsSync(backgroundFile)).toBe(false);
  });

  it('회수 뒤 업로드 사용량 캐시를 무효화한다', async () => {
    const { service, quota } = setupWith();
    const saved = await saveWithBackground(service);

    await service.remove(saved.id, {
      id: 1,
      nickname: 'devKo',
      role: 'developer',
    });

    expect(quota.invalidate).toHaveBeenCalled();
  });

  // 저장본을 불러와 그대로 다시 저장하면 두 저장본이 같은 배경 파일을 가리킨다
  // (OperationBoardTab.jsx 의 불러오기→저장 경로). 한쪽을 지울 때 파일을 지우면
  // 남은 저장본의 배경이 깨진다.
  it('다른 저장본이 같은 배경을 참조하면 파일을 남긴다', async () => {
    const { service } = setupWith();
    const first = await saveWithBackground(service, '원본');
    const second = await saveWithBackground(service, '복제본');

    await service.remove(first.id, {
      id: 1,
      nickname: 'devKo',
      role: 'developer',
    });

    expect(existsSync(backgroundFile)).toBe(true);
    expect(deleteBackgroundMock).not.toHaveBeenCalled();
    await expect(service.getOne(second.id)).resolves.toMatchObject({
      backgroundImageUrl: URL,
    });
  });

  // 라이브 작전판은 서버 메모리에 있고 저장본과 같은 URL 을 띄울 수 있다.
  // 지금 화면을 보고 있는 인원의 배경이 깨지지 않도록 파일을 남긴다.
  it('라이브 작전판이 같은 배경을 띄우고 있으면 파일을 남긴다', async () => {
    const { service, liveBoard } = setupWith(URL);
    const saved = await saveWithBackground(service);

    await service.remove(saved.id, {
      id: 1,
      nickname: 'devKo',
      role: 'developer',
    });

    expect(liveBoard.isLiveBackgroundImage).toHaveBeenCalledWith(URL);
    expect(existsSync(backgroundFile)).toBe(true);
    expect(deleteBackgroundMock).not.toHaveBeenCalled();
  });

  it('배경 파일이 이미 없어도 DB 삭제는 성공한다', async () => {
    const { service } = setupWith();
    const saved = await saveWithBackground(service);
    rmSync(backgroundFile);

    await expect(
      service.remove(saved.id, {
        id: 1,
        nickname: 'devKo',
        role: 'developer',
      }),
    ).resolves.toBeUndefined();
    await expect(service.getOne(saved.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('파일 회수가 예외를 던져도 DB 삭제를 되돌리지 않는다', async () => {
    const { service } = setupWith();
    const saved = await saveWithBackground(service);
    deleteBackgroundMock.mockRejectedValueOnce(new Error('EACCES'));

    await expect(
      service.remove(saved.id, {
        id: 1,
        nickname: 'devKo',
        role: 'developer',
      }),
    ).resolves.toBeUndefined();
    await expect(service.getOne(saved.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('배경이 없는 격자 저장본은 파일 회수를 시도하지 않는다', async () => {
    const { service } = setupWith();
    const saved = await service.saveSnapshot(
      { id: 1, nickname: 'devKo', role: 'developer' },
      {
        title: '격자',
        backgroundType: 'grid',
        backgroundImageUrl: null,
        elements: [],
      },
    );

    await service.remove(saved.id, {
      id: 1,
      nickname: 'devKo',
      role: 'developer',
    });

    expect(deleteBackgroundMock).not.toHaveBeenCalled();
    expect(existsSync(backgroundFile)).toBe(true);
  });

  it('없는 저장본을 지우면 파일을 건드리지 않고 404 를 던진다', async () => {
    const { service } = setupWith();

    await expect(
      service.remove(999, { id: 1, nickname: 'devKo', role: 'developer' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(deleteBackgroundMock).not.toHaveBeenCalled();
    expect(existsSync(backgroundFile)).toBe(true);
  });
});
