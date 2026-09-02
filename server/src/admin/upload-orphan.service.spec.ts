// 고아 회수 범위가 화이트리스트 두 폴더로 한정되고 폴더별 참조 판정이 섞이지 않는지 검증한다.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { Repository } from 'typeorm';
import {
  UPLOAD_ORPHAN_FOLDERS,
  UPLOAD_ORPHAN_FOLDER_DIRECTORIES,
  UploadOrphanService,
} from './upload-orphan.service';
import { BoardImageCleanupService } from '../boards/board-image-cleanup.service';
import { BoardPost } from '../boards/board-post.entity';
import { BoardUploadQuotaService } from '../boards/board-upload-quota.service';
import { UPLOAD_ORPHAN_GRACE_MS } from '../boards/upload-orphan-scan';
import { OperationBoardBackgroundCleanupService } from '../operation-boards/operation-board-background-cleanup.service';
import { OperationBoard } from '../operation-boards/operation-board.entity';
import { OperationBoardsGateway } from '../operation-boards/operation-boards.gateway';
import { UPLOAD_ROOT } from '../storage-paths';

const BOARD_PREFIX = '/uploads/boards/';
const OPERATION_PREFIX = '/uploads/operation-boards/';

const BOARD_KEPT = '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg';
const BOARD_ORPHAN = '1776610051249-751ebe71-020f-4a5f-94b6-97571b3fc31e.png';
const OPERATION_KEPT =
  '1776611347996-7f290a35-5fbc-460f-a543-e9999f08e44b.webp';
const OPERATION_ORPHAN =
  '1776612000000-2b1c9d4e-3f5a-4c6b-8d7e-9f0a1b2c3d4e.png';
// 두 폴더에 같은 이름으로 존재하지만 참조는 한쪽 폴더에만 걸려 있는 파일들.
const CROSS_IN_OPERATION =
  '1776613000000-11112222-3333-4444-5555-666677778888.png';
const CROSS_IN_BOARDS =
  '1776614000000-99990000-aaaa-bbbb-cccc-ddddeeeeffff.png';
const OUTSIDE = '1776615000000-12341234-5678-9abc-def0-0123456789ab.png';

const OLD = UPLOAD_ORPHAN_GRACE_MS * 2;

let root: string;
let boardsDir: string;
let operationDir: string;
let otherDir: string;

const boardRepo = { find: jest.fn() };
const operationRepo = { find: jest.fn() };
const quota = { invalidate: jest.fn() };
const liveBoard = { liveBackgroundImageUrl: jest.fn() };
let service: UploadOrphanService;

function makeFile(dir: string, name: string, body = 'x') {
  writeFileSync(join(dir, name), body);
}

async function ageFile(dir: string, name: string, ms = OLD) {
  const when = new Date(Date.now() - ms);
  await utimes(join(dir, name), when, when);
}

function directories() {
  return { boards: boardsDir, 'operation-boards': operationDir };
}

beforeEach(() => {
  jest.clearAllMocks();
  root = mkdtempSync(join(tmpdir(), 'upload-orphan-'));
  boardsDir = join(root, 'uploads', 'boards');
  operationDir = join(root, 'uploads', 'operation-boards');
  otherDir = join(root, 'uploads', 'avatars');
  for (const dir of [boardsDir, operationDir, otherDir]) {
    mkdirSync(dir, { recursive: true });
  }
  boardRepo.find.mockResolvedValue([]);
  operationRepo.find.mockResolvedValue([]);
  liveBoard.liveBackgroundImageUrl.mockReturnValue(null);

  service = new UploadOrphanService(
    new BoardImageCleanupService(
      boardRepo as unknown as Repository<BoardPost>,
      quota as unknown as BoardUploadQuotaService,
    ),
    new OperationBoardBackgroundCleanupService(
      operationRepo as unknown as Repository<OperationBoard>,
      quota as unknown as BoardUploadQuotaService,
      liveBoard as unknown as OperationBoardsGateway,
    ),
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('스캔 대상 화이트리스트', () => {
  it('uploads/ 아래 두 폴더만 회수 대상이다', () => {
    expect([...UPLOAD_ORPHAN_FOLDERS]).toEqual(['boards', 'operation-boards']);
  });

  it('각 폴더의 기본 경로가 uploads/<폴더> 그대로다', () => {
    for (const folder of UPLOAD_ORPHAN_FOLDERS) {
      expect(UPLOAD_ORPHAN_FOLDER_DIRECTORIES[folder]).toBe(
        join(UPLOAD_ROOT, folder),
      );
    }
  });

  it('화이트리스트 밖 폴더와 uploads/ 바깥 파일은 회수하지 않는다', async () => {
    makeFile(otherDir, OPERATION_ORPHAN);
    await ageFile(otherDir, OPERATION_ORPHAN);
    makeFile(root, OUTSIDE);
    await ageFile(root, OUTSIDE);

    const purged = await service.purge({ directories: directories() });

    expect(purged.folders.map((f) => f.folder)).toEqual([
      'boards',
      'operation-boards',
    ]);
    // 스캔 뿌리가 화이트리스트 폴더 자신이어야 한다. uploads/ 를 통째로 훑으면
    // 여기가 상위 폴더로 잡히고 avatars/ 파일이 고아로 딸려 들어온다.
    expect(purged.folders.map((f) => f.directory)).toEqual([
      boardsDir,
      operationDir,
    ]);
    expect(existsSync(join(otherDir, OPERATION_ORPHAN))).toBe(true);
    expect(existsSync(join(root, OUTSIDE))).toBe(true);
    expect(purged.totalDeleted).toBe(0);
  });
});

describe('UploadOrphanService.scan', () => {
  it('폴더별로 고아를 나눠 보고한다', async () => {
    boardRepo.find.mockResolvedValue([
      { id: 1, imageUrls: [`${BOARD_PREFIX}${BOARD_KEPT}`] },
    ]);
    operationRepo.find.mockResolvedValue([
      { id: 1, backgroundImageUrl: `${OPERATION_PREFIX}${OPERATION_KEPT}` },
    ]);
    makeFile(boardsDir, BOARD_KEPT);
    makeFile(boardsDir, BOARD_ORPHAN, 'abcde');
    makeFile(operationDir, OPERATION_KEPT);
    makeFile(operationDir, OPERATION_ORPHAN, 'xyz');
    await ageFile(boardsDir, BOARD_KEPT);
    await ageFile(boardsDir, BOARD_ORPHAN);
    await ageFile(operationDir, OPERATION_KEPT);
    await ageFile(operationDir, OPERATION_ORPHAN);

    const report = await service.scan({ directories: directories() });

    const byFolder = Object.fromEntries(
      report.folders.map((f) => [f.folder, f]),
    );
    expect(byFolder['boards'].orphans.map((o) => o.fileName)).toEqual([
      BOARD_ORPHAN,
    ]);
    expect(byFolder['boards'].urlPrefix).toBe(BOARD_PREFIX);
    expect(byFolder['operation-boards'].orphans.map((o) => o.fileName)).toEqual(
      [OPERATION_ORPHAN],
    );
    expect(byFolder['operation-boards'].urlPrefix).toBe(OPERATION_PREFIX);
    expect(report.totalOrphans).toBe(2);
    expect(report.totalOrphanBytes).toBe(8);
  });

  // 게시물 이미지 URL 은 /uploads/boards/ 만 허용되므로(CreateBoardPostDto) 같은 이름이
  // 작전판 폴더에 있어도 그 게시물이 참조하는 파일이 아니다. 참조 집합을 섞으면
  // 반대 방향에서 살아 있는 파일을 지우게 된다.
  it('게시판 참조가 작전판 파일을 보호하지 않고, 작전판 참조가 게시판 파일을 보호하지 않는다', async () => {
    boardRepo.find.mockResolvedValue([
      { id: 1, imageUrls: [`${BOARD_PREFIX}${CROSS_IN_OPERATION}`] },
    ]);
    operationRepo.find.mockResolvedValue([
      { id: 1, backgroundImageUrl: `${OPERATION_PREFIX}${CROSS_IN_BOARDS}` },
    ]);
    makeFile(operationDir, CROSS_IN_OPERATION);
    makeFile(boardsDir, CROSS_IN_BOARDS);
    await ageFile(operationDir, CROSS_IN_OPERATION);
    await ageFile(boardsDir, CROSS_IN_BOARDS);

    const report = await service.scan({ directories: directories() });
    const byFolder = Object.fromEntries(
      report.folders.map((f) => [f.folder, f]),
    );

    expect(byFolder['operation-boards'].orphans.map((o) => o.fileName)).toEqual(
      [CROSS_IN_OPERATION],
    );
    expect(byFolder['boards'].orphans.map((o) => o.fileName)).toEqual([
      CROSS_IN_BOARDS,
    ]);
  });

  it('라이브 보드가 띄운 배경은 저장본이 없어도 고아가 아니다', async () => {
    liveBoard.liveBackgroundImageUrl.mockReturnValue(
      `${OPERATION_PREFIX}${OPERATION_KEPT}`,
    );
    makeFile(operationDir, OPERATION_KEPT);
    await ageFile(operationDir, OPERATION_KEPT);

    const report = await service.scan({ directories: directories() });

    expect(report.totalOrphans).toBe(0);
  });

  it('조회는 디스크를 건드리지 않는다', async () => {
    makeFile(boardsDir, BOARD_ORPHAN);
    makeFile(operationDir, OPERATION_ORPHAN);
    await ageFile(boardsDir, BOARD_ORPHAN);
    await ageFile(operationDir, OPERATION_ORPHAN);

    await service.scan({ directories: directories() });

    expect(existsSync(join(boardsDir, BOARD_ORPHAN))).toBe(true);
    expect(existsSync(join(operationDir, OPERATION_ORPHAN))).toBe(true);
    expect(quota.invalidate).not.toHaveBeenCalled();
  });
});

describe('UploadOrphanService.purge', () => {
  it('두 폴더의 고아를 지우고 폴더별 삭제 결과를 보고한다', async () => {
    makeFile(boardsDir, BOARD_ORPHAN);
    makeFile(operationDir, OPERATION_ORPHAN);
    await ageFile(boardsDir, BOARD_ORPHAN);
    await ageFile(operationDir, OPERATION_ORPHAN);

    const purged = await service.purge({ directories: directories() });
    const byFolder = Object.fromEntries(
      purged.folders.map((f) => [f.folder, f]),
    );

    expect(byFolder['boards'].deletion.deleted).toEqual([BOARD_ORPHAN]);
    expect(byFolder['operation-boards'].deletion.deleted).toEqual([
      OPERATION_ORPHAN,
    ]);
    expect(purged.totalDeleted).toBe(2);
    expect(existsSync(join(boardsDir, BOARD_ORPHAN))).toBe(false);
    expect(existsSync(join(operationDir, OPERATION_ORPHAN))).toBe(false);
  });

  it('라이브 상태를 못 읽으면 작전판만 건너뛰고 게시판 회수는 계속한다', async () => {
    liveBoard.liveBackgroundImageUrl.mockImplementation(() => {
      throw new Error('라이브 보드 없음');
    });
    makeFile(boardsDir, BOARD_ORPHAN);
    makeFile(operationDir, OPERATION_ORPHAN);
    await ageFile(boardsDir, BOARD_ORPHAN);
    await ageFile(operationDir, OPERATION_ORPHAN);

    const purged = await service.purge({ directories: directories() });
    const byFolder = Object.fromEntries(
      purged.folders.map((f) => [f.folder, f]),
    );

    expect(byFolder['boards'].deletion.deleted).toEqual([BOARD_ORPHAN]);
    expect(byFolder['operation-boards'].liveCheck).toBe('unavailable');
    expect(byFolder['operation-boards'].deletion.deleted).toEqual([]);
    expect(existsSync(join(operationDir, OPERATION_ORPHAN))).toBe(true);
  });
});
