// 고아 이미지 탐지가 참조된 파일과 방금 올라온 파일을 건드리지 않는지 검증한다.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardImageCleanupService } from './board-image-cleanup.service';
import { BOARD_IMAGE_ORPHAN_GRACE_MS } from './board-image-files';
import { BoardUploadQuotaService } from './board-upload-quota.service';
import { BoardPost } from './board-post.entity';

const REFERENCED = '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg';
const ORPHAN = '1776610051249-751ebe71-020f-4a5f-94b6-97571b3fc31e.png';
const FRESH = '1776611347996-7f290a35-5fbc-460f-a543-e9999f08e44b.webp';

let root: string;
let directory: string;
const repo = { find: jest.fn() };
const quota = { invalidate: jest.fn() };
let service: BoardImageCleanupService;

function makeFile(name: string, body = 'x') {
  writeFileSync(join(directory, name), body);
}

async function ageFile(name: string, ms: number) {
  const when = new Date(Date.now() - ms);
  await utimes(join(directory, name), when, when);
}

beforeEach(() => {
  jest.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'board-cleanup-'));
  directory = join(root, 'uploads', 'boards');
  mkdirSync(directory, { recursive: true });
  service = new BoardImageCleanupService(
    repo as unknown as Repository<BoardPost>,
    quota as unknown as BoardUploadQuotaService,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('BoardImageCleanupService.scanOrphans', () => {
  it('DB가 참조하는 파일은 고아로 잡지 않고, 참조 없는 오래된 파일만 잡는다', async () => {
    repo.find.mockResolvedValue([
      { id: 1, imageUrls: [`/uploads/boards/${REFERENCED}`] },
      { id: 2, imageUrls: null },
    ]);
    makeFile(REFERENCED);
    makeFile(ORPHAN);
    makeFile(FRESH);
    await ageFile(REFERENCED, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);
    await ageFile(ORPHAN, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans.map((o) => o.fileName)).toEqual([ORPHAN]);
    expect(report.skippedRecent).toBe(1);
  });

  it('기본은 dry-run 이라 파일을 지우지 않는다', async () => {
    repo.find.mockResolvedValue([]);
    makeFile(ORPHAN);
    await ageFile(ORPHAN, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans).toHaveLength(1);
    expect(existsSync(join(directory, ORPHAN))).toBe(true);
    expect(quota.invalidate).not.toHaveBeenCalled();
  });

  it('저장된 URL 형식이 깨져 있어도 파일명이 같으면 보호한다', async () => {
    repo.find.mockResolvedValue([
      { id: 1, imageUrls: [`  /uploads/boards/${ORPHAN}?v=2  `] },
    ]);
    makeFile(ORPHAN);
    await ageFile(ORPHAN, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const report = await service.scanOrphans({ directory });

    expect(report.orphans).toEqual([]);
  });
});

describe('BoardImageCleanupService.purgeOrphans', () => {
  it('고아 파일을 지우고 quota 사용량 캐시를 무효화한다', async () => {
    repo.find.mockResolvedValue([]);
    makeFile(ORPHAN);
    await ageFile(ORPHAN, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const result = await service.purgeOrphans({ directory });

    expect(result.deletion.deleted).toEqual([ORPHAN]);
    expect(existsSync(join(directory, ORPHAN))).toBe(false);
    expect(quota.invalidate).toHaveBeenCalled();
  });

  it('스캔 뒤 새로 참조된 파일은 지우지 않는다', async () => {
    repo.find
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { id: 9, imageUrls: [`/uploads/boards/${ORPHAN}`] },
      ]);
    makeFile(ORPHAN);
    await ageFile(ORPHAN, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const result = await service.purgeOrphans({ directory });

    expect(result.deletion.deleted).toEqual([]);
    expect(existsSync(join(directory, ORPHAN))).toBe(true);
  });
});

// 데코레이터 메타데이터가 빠지면 앱 부팅 때만 터진다. 조립 자체를 고정한다.
describe('BoardImageCleanupService DI 조립', () => {
  it('Nest 컨테이너가 저장소와 quota 를 주입해 생성한다', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BoardImageCleanupService,
        { provide: getRepositoryToken(BoardPost), useValue: repo },
        { provide: BoardUploadQuotaService, useValue: quota },
      ],
    }).compile();

    expect(moduleRef.get(BoardImageCleanupService)).toBeInstanceOf(
      BoardImageCleanupService,
    );
  });
});
