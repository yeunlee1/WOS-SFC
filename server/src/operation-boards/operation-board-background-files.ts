// 작전판 배경 이미지의 경로 봉쇄와 파일 삭제, 고아 판정을 담당한다.
import { Logger } from '@nestjs/common';
import { unlink } from 'fs/promises';
import { dirname, resolve } from 'path';
import {
  OPERATION_BOARD_BACKGROUND_DIR,
  OPERATION_BOARD_BACKGROUND_FILE_NAME_PATTERN,
  OPERATION_BOARD_BACKGROUND_URL_PATTERN,
  OPERATION_BOARD_BACKGROUND_URL_PREFIX,
} from './operation-board-upload.options';
import {
  UPLOAD_ORPHAN_GRACE_MS,
  collectUploadOrphans,
  deleteUploadFiles,
  type UploadDeletionSummary,
  type UploadOrphanLogger,
  type UploadOrphanReport,
} from '../boards/upload-orphan-scan';

// 업로드는 끝났지만 아직 저장본이나 라이브 배경으로 쓰이지 않은 파일을
// 고아로 오인하지 않도록 두는 유예. 게시판 이미지와 같은 값을 쓴다.
export const OPERATION_BOARD_BACKGROUND_ORPHAN_GRACE_MS =
  UPLOAD_ORPHAN_GRACE_MS;

const OPERATION_BOARD_BACKGROUND_LABEL = '작전판 배경 이미지';

type BackgroundLogger = UploadOrphanLogger;

const defaultLogger: BackgroundLogger = new Logger('OperationBoardBackground');

export type OperationBoardBackgroundDeleteOptions = {
  directory?: string;
  logger?: BackgroundLogger;
};

export type OperationBoardBackgroundDeletionSummary = UploadDeletionSummary;
export type OperationBoardBackgroundOrphanScanReport = UploadOrphanReport;

/**
 * 삭제 시도의 결과.
 * - skipped  : 배경이 없는 저장본이라 지울 것이 없었다.
 * - rejected : 업로더 규칙 밖 값이라 지우지 않았다(경로 조작 포함).
 * - deleted  : 파일을 실제로 지웠다.
 * - missing  : 이미 없었다. 목표 상태와 같으므로 실패가 아니다.
 * - failed   : 지우려 했으나 실패했다. 고아로 남는다.
 */
export type OperationBoardBackgroundDeleteResult =
  | 'skipped'
  | 'rejected'
  | 'deleted'
  | 'missing'
  | 'failed';

/**
 * 업로드 폴더 바로 아래의 실제 경로로만 되돌린다.
 *
 * 게시판 이미지(board-image-files.ts)와 같은 두 겹이다. (1) 업로더가 만든 파일명
 * 규칙과 정확히 일치해야 하고, (2) 정규화한 절대경로의 부모가 업로드 폴더 자신이어야
 * 한다. DB 값이 오염돼 `../..` 같은 조각이 섞여도 어느 한 겹만으로 폴더 밖 삭제가 막힌다.
 */
export function resolveOperationBoardBackgroundFilePath(
  fileName: unknown,
  directory: string = OPERATION_BOARD_BACKGROUND_DIR,
): string | null {
  if (typeof fileName !== 'string') return null;
  if (!OPERATION_BOARD_BACKGROUND_FILE_NAME_PATTERN.test(fileName)) return null;
  const root = resolve(directory);
  const target = resolve(root, fileName);
  if (dirname(target) !== root) return null;
  return target;
}

// 삭제 대상 판정은 엄격해야 한다. 형식을 벗어난 값은 지우지 않고 거부한다.
// 게시판 업로드 URL(/uploads/boards/...)도 여기서 걸러진다 — 접두사가 다르다.
export function operationBoardBackgroundFileNameFromUrl(
  url: unknown,
): string | null {
  if (typeof url !== 'string') return null;
  if (!OPERATION_BOARD_BACKGROUND_URL_PATTERN.test(url)) return null;
  return url.slice(OPERATION_BOARD_BACKGROUND_URL_PREFIX.length);
}

/**
 * 저장본이 들고 있던 배경 URL 하나를 파일에서 회수한다.
 *
 * 예외를 던지지 않는다. 호출부(저장본 삭제)는 이미 DB 를 지운 뒤라
 * 여기서 던지면 되돌릴 수 없는 실패가 된다. 결과는 반환값과 로그로만 알린다.
 */
export async function deleteOperationBoardBackgroundByUrl(
  url: unknown,
  options: OperationBoardBackgroundDeleteOptions = {},
): Promise<OperationBoardBackgroundDeleteResult> {
  const { directory = OPERATION_BOARD_BACKGROUND_DIR, logger = defaultLogger } =
    options;

  if (url === null || url === undefined || url === '') return 'skipped';

  const fileName = operationBoardBackgroundFileNameFromUrl(url);
  const filePath = fileName
    ? resolveOperationBoardBackgroundFilePath(fileName, directory)
    : null;
  if (!filePath) {
    logger.error(
      `업로드 폴더 밖을 가리키는 작전판 배경 값이라 삭제를 거부했다: ${String(url)}`,
    );
    return 'rejected';
  }

  try {
    await unlink(filePath);
    return 'deleted';
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // 이미 없는 파일은 목표 상태와 같다. 실패로 세지 않는다.
      logger.debug(`작전판 배경 이미지가 이미 없다: ${String(fileName)}`);
      return 'missing';
    }
    logger.error(
      `작전판 배경 이미지 삭제 실패(${code ?? 'unknown'}): ${String(fileName)} — 고아로 남아 업로드 한도를 갉아먹는다`,
    );
    return 'failed';
  }
}

/**
 * 배경 파일명 목록을 지운다. 경로 봉쇄를 통과하지 못한 값은 지우지 않고 거부로 보고한다.
 *
 * 고아 회수가 쓰는 입구다. URL 이 아니라 스캔이 실제 폴더에서 읽어 낸 파일명을 받는다.
 */
export async function deleteOperationBoardBackgroundFiles(
  fileNames: readonly unknown[] | null | undefined,
  options: OperationBoardBackgroundDeleteOptions = {},
): Promise<OperationBoardBackgroundDeletionSummary> {
  const { directory = OPERATION_BOARD_BACKGROUND_DIR, logger = defaultLogger } =
    options;
  return deleteUploadFiles(fileNames, {
    directory,
    resolveFilePath: resolveOperationBoardBackgroundFilePath,
    label: OPERATION_BOARD_BACKGROUND_LABEL,
    logger,
  });
}

/**
 * 작전판 배경 폴더에서 참조가 없는 파일을 찾는다. 판정만 하고 지우지 않는다.
 *
 * 참조 집합은 호출부가 만들어 넣는다. 작전판은 저장본(operation_boards)과
 * 라이브 보드(메모리) 두 곳에서 참조가 나오므로 그 판정을 여기에 두지 않는다 —
 * 게시판 규칙(board_posts 만 본다)을 이 폴더에 적용하면 라이브 배경이 지워진다.
 */
export async function collectOperationBoardBackgroundOrphans(options: {
  referencedFileNames: ReadonlySet<string>;
  directory?: string;
  graceMs?: number;
  now?: number;
}): Promise<OperationBoardBackgroundOrphanScanReport> {
  const { directory = OPERATION_BOARD_BACKGROUND_DIR, ...rest } = options;
  return collectUploadOrphans({
    ...rest,
    directory,
    resolveFilePath: resolveOperationBoardBackgroundFilePath,
  });
}
