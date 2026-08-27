// 작전판 배경 이미지의 경로 봉쇄와 파일 삭제를 임시 디렉터리에서 검증한다.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  OPERATION_BOARD_BACKGROUND_ORPHAN_GRACE_MS,
  collectOperationBoardBackgroundOrphans,
  deleteOperationBoardBackgroundByUrl,
  deleteOperationBoardBackgroundFiles,
  operationBoardBackgroundFileNameFromUrl,
  resolveOperationBoardBackgroundFilePath,
} from './operation-board-background-files';

const NAME_A = '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg';
const NAME_B = '1776610051249-751ebe71-020f-4a5f-94b6-97571b3fc31e.png';
const VICTIM = '1776611347996-7f290a35-5fbc-460f-a543-e9999f08e44b.webp';
// 윈도우 경로 구분자 케이스에 쓸 역슬래시 1글자.
const BS = String.fromCharCode(92);

let root: string;
let directory: string;

// 거부·실패 로그가 테스트 출력을 덮지 않도록 삼키는 로거를 쓴다.
function silentLogger() {
  return { debug: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'op-board-bg-'));
  directory = join(root, 'uploads', 'operation-boards');
  mkdirSync(directory, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('resolveOperationBoardBackgroundFilePath 경로 봉쇄', () => {
  it('업로더가 만든 이름만 업로드 폴더 바로 아래 경로로 되돌린다', () => {
    expect(resolveOperationBoardBackgroundFilePath(NAME_A, directory)).toBe(
      join(directory, NAME_A),
    );
  });

  it.each([
    `../../${NAME_A}`,
    `..${BS}..${BS}${NAME_A}`,
    `sub/${NAME_A}`,
    `/etc/${NAME_A}`,
    `C:${BS}Windows${BS}${NAME_A}`,
    '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.gif',
    'me.png',
    '',
    '.',
    '..',
    null,
    42,
  ])('업로드 폴더를 벗어나거나 규칙 밖인 값은 거부한다: %s', (value) => {
    expect(
      resolveOperationBoardBackgroundFilePath(value, directory),
    ).toBeNull();
  });
});

describe('operationBoardBackgroundFileNameFromUrl', () => {
  it('작전판 배경 URL 에서만 파일명을 뽑는다', () => {
    expect(
      operationBoardBackgroundFileNameFromUrl(
        `/uploads/operation-boards/${NAME_A}`,
      ),
    ).toBe(NAME_A);
  });

  it.each([
    `/uploads/boards/${NAME_A}`,
    `/uploads/operation-boards/../../${VICTIM}`,
    `/uploads/operation-boards/sub/${NAME_A}`,
    `https://evil.example/uploads/operation-boards/${NAME_A}`,
    `/uploads/operation-boards/${NAME_A}?x=1`,
    null,
  ])('작전판 배경 URL 형식이 아니면 거부한다: %s', (value) => {
    expect(operationBoardBackgroundFileNameFromUrl(value)).toBeNull();
  });
});

describe('deleteOperationBoardBackgroundByUrl', () => {
  it('저장본이 들고 있던 배경 파일을 실제로 지운다', async () => {
    writeFileSync(join(directory, NAME_A), 'x');

    const result = await deleteOperationBoardBackgroundByUrl(
      `/uploads/operation-boards/${NAME_A}`,
      { directory, logger: silentLogger() },
    );

    expect(result).toBe('deleted');
    expect(existsSync(join(directory, NAME_A))).toBe(false);
  });

  it('파일이 이미 없어도 예외를 던지지 않는다', async () => {
    const result = await deleteOperationBoardBackgroundByUrl(
      `/uploads/operation-boards/${NAME_B}`,
      { directory, logger: silentLogger() },
    );

    expect(result).toBe('missing');
  });

  // 경로 조작 값이 통과하면 업로드 폴더 밖 파일이 지워진다.
  // 실제 피해 파일을 만들어 두고 그것이 살아남는지로 확인한다.
  it.each([
    `/uploads/operation-boards/../../${VICTIM}`,
    `/uploads/operation-boards/..%2f..%2f${VICTIM}`,
    `/uploads/operation-boards/..${BS}..${BS}${VICTIM}`,
    `/uploads/operation-boards/${VICTIM}/../../../${VICTIM}`,
  ])('업로드 폴더 밖을 가리키는 값은 지우지 않는다: %s', async (url) => {
    const victimPath = join(root, VICTIM);
    writeFileSync(victimPath, 'do-not-delete');

    const result = await deleteOperationBoardBackgroundByUrl(url, {
      directory,
      logger: silentLogger(),
    });

    expect(result).toBe('rejected');
    expect(existsSync(victimPath)).toBe(true);
  });

  it('게시판 이미지 URL 은 작전판 삭제 경로로 지우지 않는다', async () => {
    const boardsDir = join(root, 'uploads', 'boards');
    mkdirSync(boardsDir, { recursive: true });
    writeFileSync(join(boardsDir, NAME_A), 'x');

    const result = await deleteOperationBoardBackgroundByUrl(
      `/uploads/boards/${NAME_A}`,
      { directory, logger: silentLogger() },
    );

    expect(result).toBe('rejected');
    expect(existsSync(join(boardsDir, NAME_A))).toBe(true);
  });

  it('배경이 없는 저장본(null)은 아무 것도 하지 않는다', async () => {
    const result = await deleteOperationBoardBackgroundByUrl(null, {
      directory,
      logger: silentLogger(),
    });

    expect(result).toBe('skipped');
  });
});

describe('deleteOperationBoardBackgroundFiles 파일명 직접 삭제', () => {
  it('업로더 규칙에 맞는 파일명만 지운다', async () => {
    writeFileSync(join(directory, NAME_A), 'x');

    const summary = await deleteOperationBoardBackgroundFiles([NAME_A], {
      directory,
      logger: silentLogger(),
    });

    expect(summary.deleted).toEqual([NAME_A]);
    expect(existsSync(join(directory, NAME_A))).toBe(false);
  });

  it('경로 조작 파일명은 거부하고 폴더 밖 파일을 남긴다', async () => {
    const victimPath = join(root, VICTIM);
    writeFileSync(victimPath, 'do-not-delete');

    const summary = await deleteOperationBoardBackgroundFiles(
      [`../${VICTIM}`, `..${BS}${VICTIM}`, `sub/${NAME_A}`],
      { directory, logger: silentLogger() },
    );

    expect(summary.deleted).toEqual([]);
    expect(summary.rejected).toHaveLength(3);
    expect(existsSync(victimPath)).toBe(true);
  });
});

describe('collectOperationBoardBackgroundOrphans', () => {
  it('참조된 파일은 고아로 잡지 않는다', async () => {
    writeFileSync(join(directory, NAME_A), 'x');
    const when = new Date(
      Date.now() - OPERATION_BOARD_BACKGROUND_ORPHAN_GRACE_MS * 2,
    );
    await utimes(join(directory, NAME_A), when, when);

    const report = await collectOperationBoardBackgroundOrphans({
      directory,
      referencedFileNames: new Set([NAME_A]),
    });

    expect(report.orphans).toEqual([]);
    expect(report.referencedFiles).toBe(1);
  });

  it('게시판 확장자(gif)는 작전판 업로더가 만들 수 없어 고아로 올리지 않는다', async () => {
    const gif = '1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.gif';
    writeFileSync(join(directory, gif), 'x');
    const when = new Date(
      Date.now() - OPERATION_BOARD_BACKGROUND_ORPHAN_GRACE_MS * 2,
    );
    await utimes(join(directory, gif), when, when);

    const report = await collectOperationBoardBackgroundOrphans({
      directory,
      referencedFileNames: new Set<string>(),
    });

    expect(report.orphans).toEqual([]);
    expect(report.skippedUnrecognized).toEqual([gif]);
  });

  it('업로드 폴더가 아직 없으면 빈 보고서를 낸다', async () => {
    const report = await collectOperationBoardBackgroundOrphans({
      directory: join(root, 'missing'),
      referencedFileNames: new Set<string>(),
    });

    expect(report.scannedFiles).toBe(0);
    expect(report.orphans).toEqual([]);
  });
});
