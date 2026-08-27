// 게시판 업로드 이미지의 경로 검증·삭제·고아 판정을 임시 디렉터리에서 검증한다.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  BOARD_IMAGE_ORPHAN_GRACE_MS,
  collectBoardImageOrphans,
  deleteBoardImageFiles,
  deleteBoardImagesByUrl,
  resolveBoardImageFilePath,
} from './board-image-files';

const NAME_A = '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg';
const NAME_B = '1776610051249-751ebe71-020f-4a5f-94b6-97571b3fc31e.png';
const NAME_C = '1776611347996-7f290a35-5fbc-460f-a543-e9999f08e44b.webp';

let root: string;
let directory: string;

// 거부 로그가 테스트 출력을 덮지 않도록 삼키는 로거를 쓴다.
function silentLogger() {
  return { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

function makeFile(name: string, body = 'x', dir = directory) {
  const fp = join(dir, name);
  writeFileSync(fp, body);
  return fp;
}

async function ageFile(name: string, ms: number) {
  const when = new Date(Date.now() - ms);
  await utimes(join(directory, name), when, when);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'board-images-'));
  directory = join(root, 'uploads', 'boards');
  mkdirSync(directory, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveBoardImageFilePath 경로 봉쇄', () => {
  it('업로더가 만든 이름만 업로드 폴더 바로 아래 경로로 되돌린다', () => {
    expect(resolveBoardImageFilePath(NAME_A, directory)).toBe(
      join(directory, NAME_A),
    );
  });

  it.each([
    `../../${NAME_A}`,
    `..\\..\\${NAME_A}`,
    `sub/${NAME_A}`,
    `/etc/${NAME_A}`,
    `C:\\Windows\\${NAME_A}`,
    'me.png',
    '',
    '.',
    '..',
  ])('업로드 폴더를 벗어나는 값은 거부한다: %s', (value) => {
    expect(resolveBoardImageFilePath(value, directory)).toBeNull();
  });
});

describe('deleteBoardImagesByUrl', () => {
  it('게시물이 들고 있던 이미지 파일을 실제로 지운다', async () => {
    makeFile(NAME_A);
    makeFile(NAME_B);

    const summary = await deleteBoardImagesByUrl(
      [`/uploads/boards/${NAME_A}`, `/uploads/boards/${NAME_B}`],
      { directory },
    );

    expect(summary.deleted.sort()).toEqual([NAME_A, NAME_B].sort());
    expect(existsSync(join(directory, NAME_A))).toBe(false);
    expect(existsSync(join(directory, NAME_B))).toBe(false);
  });

  it('업로드 폴더 밖을 가리키는 값으로는 아무것도 지우지 못한다', async () => {
    const outside = join(root, 'secret.png');
    writeFileSync(outside, 'top secret');
    const sibling = join(root, 'uploads', 'operation-boards');
    mkdirSync(sibling, { recursive: true });
    const siblingFile = makeFile(NAME_C, 'background', sibling);

    const summary = await deleteBoardImagesByUrl(
      [
        `/uploads/boards/../../secret.png`,
        `/uploads/boards/..\\..\\secret.png`,
        `/uploads/boards/../operation-boards/${NAME_C}`,
        `/uploads/boards/%2e%2e%2fsecret.png`,
        `../../secret.png`,
        join(root, 'secret.png'),
        `/uploads/operation-boards/${NAME_C}`,
      ],
      { directory, logger: silentLogger() },
    );

    expect(summary.deleted).toEqual([]);
    expect(summary.rejected).toHaveLength(7);
    expect(existsSync(outside)).toBe(true);
    expect(existsSync(siblingFile)).toBe(true);
  });

  it('파일이 이미 없어도 예외를 던지지 않고 missing 으로 보고한다', async () => {
    const summary = await deleteBoardImagesByUrl(
      [`/uploads/boards/${NAME_A}`],
      { directory },
    );

    expect(summary.missing).toEqual([NAME_A]);
    expect(summary.deleted).toEqual([]);
    expect(summary.failed).toEqual([]);
  });

  it('삭제가 실패하면 삼키지 않고 failed 로 보고하고 로그를 남긴다', async () => {
    // 같은 이름의 디렉터리를 만들면 unlink 가 EPERM/EISDIR 로 실패한다.
    mkdirSync(join(directory, NAME_A));
    const logger = { debug: jest.fn(), error: jest.fn(), warn: jest.fn() };

    const summary = await deleteBoardImagesByUrl(
      [`/uploads/boards/${NAME_A}`],
      { directory, logger: logger as never },
    );

    expect(summary.failed).toEqual([NAME_A]);
    expect(logger.error).toHaveBeenCalled();
  });

  it('null 이나 빈 목록에도 안전하다', async () => {
    await expect(deleteBoardImagesByUrl(null, { directory })).resolves.toEqual(
      expect.objectContaining({ deleted: [], rejected: [] }),
    );
  });
});

describe('deleteBoardImageFiles 파일명 직접 삭제', () => {
  it('경로 조작 파일명은 거부한다', async () => {
    const outside = join(root, 'secret.png');
    writeFileSync(outside, 'top secret');

    const summary = await deleteBoardImageFiles(['../secret.png'], {
      directory,
      logger: silentLogger(),
    });

    expect(summary.deleted).toEqual([]);
    expect(summary.rejected).toEqual(['../secret.png']);
    expect(existsSync(outside)).toBe(true);
  });
});

describe('collectBoardImageOrphans', () => {
  it('참조된 파일은 고아로 잡지 않는다', async () => {
    makeFile(NAME_A);
    await ageFile(NAME_A, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const report = await collectBoardImageOrphans({
      directory,
      referencedFileNames: new Set([NAME_A]),
    });

    expect(report.orphans).toEqual([]);
    expect(report.referencedFiles).toBe(1);
    expect(report.scannedFiles).toBe(1);
  });

  it('참조가 없고 유예 시간을 넘긴 파일만 고아로 잡는다', async () => {
    makeFile(NAME_A, 'abcde');
    await ageFile(NAME_A, BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const report = await collectBoardImageOrphans({
      directory,
      referencedFileNames: new Set<string>(),
    });

    expect(report.orphans.map((o) => o.fileName)).toEqual([NAME_A]);
    expect(report.orphanBytes).toBe(5);
  });

  it('막 올라와 아직 게시물로 저장되지 않은 파일은 건드리지 않는다', async () => {
    makeFile(NAME_B);

    const report = await collectBoardImageOrphans({
      directory,
      referencedFileNames: new Set<string>(),
    });

    expect(report.orphans).toEqual([]);
    expect(report.skippedRecent).toBe(1);
  });

  it('업로더 이름 규칙이 아닌 파일은 보고만 하고 고아로 올리지 않는다', async () => {
    makeFile('legacy.png');
    await ageFile('legacy.png', BOARD_IMAGE_ORPHAN_GRACE_MS * 2);

    const report = await collectBoardImageOrphans({
      directory,
      referencedFileNames: new Set<string>(),
    });

    expect(report.orphans).toEqual([]);
    expect(report.skippedUnrecognized).toEqual(['legacy.png']);
  });

  it('업로드 폴더가 아직 없으면 빈 보고서를 낸다', async () => {
    const report = await collectBoardImageOrphans({
      directory: join(root, 'missing'),
      referencedFileNames: new Set<string>(),
    });

    expect(report.scannedFiles).toBe(0);
    expect(report.orphans).toEqual([]);
  });
});
