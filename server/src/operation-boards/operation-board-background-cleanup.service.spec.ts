// 작전판 배경 고아 탐지가 저장본·라이브 보드가 쓰는 파일을 건드리지 않는지 검증한다.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationBoardBackgroundCleanupService } from './operation-board-background-cleanup.service';
import { OPERATION_BOARD_BACKGROUND_ORPHAN_GRACE_MS } from './operation-board-background-files';
import { OperationBoard } from './operation-board.entity';
import { OperationBoardsGateway } from './operation-boards.gateway';
import { OperationBoardsModule } from './operation-boards.module';
import { BoardUploadQuotaService } from '../boards/board-upload-quota.service';

const PREFIX = '/uploads/operation-boards/';
const SNAPSHOT = '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg';
const LIVE = '1776610051249-751ebe71-020f-4a5f-94b6-97571b3fc31e.png';
const ORPHAN = '1776611347996-7f290a35-5fbc-460f-a543-e9999f08e44b.webp';
const FRESH = '1776612000000-2b1c9d4e-3f5a-4c6b-8d7e-9f0a1b2c3d4e.png';

let root: string;
let directory: string;
const repo = { find: jest.fn() };
const quota = { invalidate: jest.fn() };
const liveBoard = { liveBackgroundImageUrl: jest.fn() };
let service: OperationBoardBackgroundCleanupService;

function makeFile(name: string, body = 'x') {
  writeFileSync(join(directory, name), body);
}

async function ageFile(name: string, ms: number) {
  const when = new Date(Date.now() - ms);
  await utimes(join(directory, name), when, when);
}

const OLD = OPERATION_BOARD_BACKGROUND_ORPHAN_GRACE_MS * 2;

beforeEach(() => {
  jest.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'op-bg-cleanup-'));
  directory = join(root, 'uploads', 'operation-boards');
  mkdirSync(directory, { recursive: true });
  repo.find.mockResolvedValue([]);
  liveBoard.liveBackgroundImageUrl.mockReturnValue(null);
  service = new OperationBoardBackgroundCleanupService(
    repo as unknown as Repository<OperationBoard>,
    quota as unknown as BoardUploadQuotaService,
    liveBoard as unknown as OperationBoardsGateway,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('OperationBoardBackgroundCleanupService.scanOrphans', () => {
  it('저장본과 라이브 보드가 쓰는 배경을 빼고 참조 없는 오래된 파일만 잡는다', async () => {
    repo.find.mockResolvedValue([
      { id: 1, backgroundImageUrl: `${PREFIX}${SNAPSHOT}` },
      { id: 2, backgroundImageUrl: null },
    ]);
    liveBoard.liveBackgroundImageUrl.mockReturnValue(`${PREFIX}${LIVE}`);
    for (const name of [SNAPSHOT, LIVE, ORPHAN, FRESH]) makeFile(name);
    for (const name of [SNAPSHOT, LIVE, ORPHAN]) await ageFile(name, OLD);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans.map((o) => o.fileName)).toEqual([ORPHAN]);
    expect(report.skippedRecent).toBe(1);
    expect(report.liveCheck).toBe('ok');
    expect(report.liveBackgroundImageUrl).toBe(`${PREFIX}${LIVE}`);
  });

  // 저장본을 불러와 그대로 다시 저장하면 두 행이 같은 파일을 가리킨다.
  it('두 저장본이 같은 배경을 공유하면 한쪽이 사라져도 고아가 아니다', async () => {
    makeFile(SNAPSHOT);
    await ageFile(SNAPSHOT, OLD);

    repo.find.mockResolvedValue([
      { id: 1, backgroundImageUrl: `${PREFIX}${SNAPSHOT}` },
      { id: 2, backgroundImageUrl: `${PREFIX}${SNAPSHOT}` },
    ]);
    await expect(service.scanOrphans({ directory })).resolves.toMatchObject({
      orphans: [],
    });

    repo.find.mockResolvedValue([
      { id: 2, backgroundImageUrl: `${PREFIX}${SNAPSHOT}` },
    ]);
    const afterOneRemoved = await service.purgeOrphans({ directory });

    expect(afterOneRemoved.deletion.deleted).toEqual([]);
    expect(existsSync(join(directory, SNAPSHOT))).toBe(true);
  });

  it('저장본이 하나도 없어도 라이브 보드가 띄운 배경은 고아가 아니다', async () => {
    repo.find.mockResolvedValue([]);
    liveBoard.liveBackgroundImageUrl.mockReturnValue(`${PREFIX}${LIVE}`);
    makeFile(LIVE);
    await ageFile(LIVE, OLD);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans).toEqual([]);
    expect(report.referencedFiles).toBe(1);
  });

  it('저장된 URL 에 쿼리나 공백이 섞여 있어도 파일명이 같으면 보호한다', async () => {
    repo.find.mockResolvedValue([
      { id: 1, backgroundImageUrl: `  ${PREFIX}${SNAPSHOT}?v=3  ` },
    ]);
    makeFile(SNAPSHOT);
    await ageFile(SNAPSHOT, OLD);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans).toEqual([]);
  });

  it('30분 유예 안에 올라온 파일은 건드리지 않는다', async () => {
    makeFile(FRESH);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans).toEqual([]);
    expect(report.skippedRecent).toBe(1);
  });

  it('업로더 이름 규칙 밖 파일은 고아로 올리지 않고 보고만 한다', async () => {
    makeFile('legacy-background.png');
    await ageFile('legacy-background.png', OLD);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans).toEqual([]);
    expect(report.skippedUnrecognized).toEqual(['legacy-background.png']);
  });

  it('기본은 dry-run 이라 파일을 지우지 않는다', async () => {
    makeFile(ORPHAN);
    await ageFile(ORPHAN, OLD);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans).toHaveLength(1);
    expect(existsSync(join(directory, ORPHAN))).toBe(true);
    expect(quota.invalidate).not.toHaveBeenCalled();
  });

  // 라이브 보드는 프로세스 메모리에만 있다. 상태를 못 읽으면 지금 화면에 떠 있는
  // 파일을 고아로 오인할 수 있으므로 판정 자체를 포기한다.
  it('라이브 보드 상태를 읽지 못하면 고아를 하나도 올리지 않는다', async () => {
    liveBoard.liveBackgroundImageUrl.mockImplementation(() => {
      throw new Error('라이브 보드 없음');
    });
    makeFile(ORPHAN);
    await ageFile(ORPHAN, OLD);

    const report = await service.scanOrphans({ directory });

    expect(report.liveCheck).toBe('unavailable');
    expect(report.orphans).toEqual([]);
    expect(report.skippedReason).toEqual(expect.any(String));
  });
});

describe('OperationBoardBackgroundCleanupService.purgeOrphans', () => {
  it('고아 배경을 지우고 업로드 사용량 캐시를 무효화한다', async () => {
    makeFile(ORPHAN);
    await ageFile(ORPHAN, OLD);

    const result = await service.purgeOrphans({ directory });

    expect(result.deletion.deleted).toEqual([ORPHAN]);
    expect(existsSync(join(directory, ORPHAN))).toBe(false);
    expect(quota.invalidate).toHaveBeenCalled();
  });

  it('스캔 뒤 저장본이 참조하기 시작한 파일은 지우지 않는다', async () => {
    repo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 9, backgroundImageUrl: `${PREFIX}${ORPHAN}` },
      ]);
    makeFile(ORPHAN);
    await ageFile(ORPHAN, OLD);

    const result = await service.purgeOrphans({ directory });

    expect(result.deletion.deleted).toEqual([]);
    expect(existsSync(join(directory, ORPHAN))).toBe(true);
  });

  it('스캔 뒤 라이브 배경으로 올라온 파일은 지우지 않는다', async () => {
    liveBoard.liveBackgroundImageUrl
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(`${PREFIX}${ORPHAN}`);
    makeFile(ORPHAN);
    await ageFile(ORPHAN, OLD);

    const result = await service.purgeOrphans({ directory });

    expect(result.deletion.deleted).toEqual([]);
    expect(existsSync(join(directory, ORPHAN))).toBe(true);
  });

  it('라이브 상태를 읽지 못하면 한 건도 지우지 않는다', async () => {
    liveBoard.liveBackgroundImageUrl.mockImplementation(() => {
      throw new Error('라이브 보드 없음');
    });
    makeFile(ORPHAN);
    await ageFile(ORPHAN, OLD);

    const result = await service.purgeOrphans({ directory });

    expect(result.liveCheck).toBe('unavailable');
    expect(result.deletion.deleted).toEqual([]);
    expect(existsSync(join(directory, ORPHAN))).toBe(true);
    expect(quota.invalidate).not.toHaveBeenCalled();
  });
});

// 데코레이터 메타데이터가 빠지면 앱 부팅 때만 터진다. 조립 자체를 고정한다.
describe('OperationBoardBackgroundCleanupService DI 조립', () => {
  it('Nest 컨테이너가 저장소·quota·라이브 게이트웨이를 주입해 생성한다', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperationBoardBackgroundCleanupService,
        { provide: getRepositoryToken(OperationBoard), useValue: repo },
        { provide: BoardUploadQuotaService, useValue: quota },
        { provide: OperationBoardsGateway, useValue: liveBoard },
      ],
    }).compile();

    expect(
      moduleRef.get(OperationBoardBackgroundCleanupService),
    ).toBeInstanceOf(OperationBoardBackgroundCleanupService);
  });

  it('작전판 모듈이 회수 서비스를 제공하고 밖으로 내보낸다', () => {
    const providers = (Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      OperationBoardsModule,
    ) ?? []) as unknown[];
    const exported = (Reflect.getMetadata(
      MODULE_METADATA.EXPORTS,
      OperationBoardsModule,
    ) ?? []) as unknown[];

    expect(providers).toContain(OperationBoardBackgroundCleanupService);
    expect(exported).toContain(OperationBoardBackgroundCleanupService);
  });
});
