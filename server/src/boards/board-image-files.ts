// 게시판 업로드 이미지의 경로 봉쇄와 파일 삭제, 고아 판정을 담당한다.
import { Logger } from '@nestjs/common';
import { dirname, resolve } from 'path';
import {
  BOARD_UPLOAD_DIR,
  BOARD_UPLOAD_FILE_NAME_PATTERN,
  BOARD_UPLOAD_URL_PATTERN,
  BOARD_UPLOAD_URL_PREFIX,
} from './board-upload.options';
import {
  UPLOAD_ORPHAN_GRACE_MS,
  collectUploadOrphans,
  deleteUploadFiles,
  referencedUploadFileName,
  type UploadDeletionSummary,
  type UploadOrphan,
  type UploadOrphanLogger,
  type UploadOrphanReport,
} from './upload-orphan-scan';

// 업로드는 끝났지만 아직 게시물로 저장되지 않은 파일을 고아로 오인하지 않도록 두는 유예.
export const BOARD_IMAGE_ORPHAN_GRACE_MS = UPLOAD_ORPHAN_GRACE_MS;

const BOARD_IMAGE_LABEL = '게시판 이미지';

type BoardImageLogger = UploadOrphanLogger;

const defaultLogger: BoardImageLogger = new Logger('BoardImageFiles');

export type BoardImageDeleteOptions = {
  directory?: string;
  logger?: BoardImageLogger;
};

export type BoardImageDeletionSummary = UploadDeletionSummary;
export type BoardImageOrphan = UploadOrphan;
export type BoardImageOrphanReport = UploadOrphanReport;

/**
 * 업로드 폴더 바로 아래의 실제 경로로만 되돌린다.
 *
 * 두 겹으로 막는다. (1) 업로더가 만든 파일명 규칙과 정확히 일치해야 하고,
 * (2) 정규화한 절대경로의 부모가 업로드 폴더 자신이어야 한다. DB 값이 오염돼
 * `../..` 같은 조각이 섞여도 어느 한 겹만으로 폴더 밖 삭제가 막힌다.
 */
export function resolveBoardImageFilePath(
  fileName: unknown,
  directory: string = BOARD_UPLOAD_DIR,
): string | null {
  if (typeof fileName !== 'string') return null;
  if (!BOARD_UPLOAD_FILE_NAME_PATTERN.test(fileName)) return null;
  const root = resolve(directory);
  const target = resolve(root, fileName);
  if (dirname(target) !== root) return null;
  return target;
}

// 삭제 대상 판정은 엄격해야 한다. 형식을 벗어난 값은 지우지 않고 거부한다.
export function boardImageFileNameFromUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  if (!BOARD_UPLOAD_URL_PATTERN.test(url)) return null;
  return url.slice(BOARD_UPLOAD_URL_PREFIX.length);
}

// 참조 판정은 반대로 관대해야 한다. 과잉 포함은 삭제를 막을 뿐이지만
// 누락은 살아 있는 이미지를 지운다. 그래서 파일명만 뽑아 넓게 보호한다.
export function referencedBoardImageName(value: unknown): string | null {
  return referencedUploadFileName(value);
}

export async function deleteBoardImageFiles(
  fileNames: readonly unknown[] | null | undefined,
  options: BoardImageDeleteOptions = {},
): Promise<BoardImageDeletionSummary> {
  const { directory = BOARD_UPLOAD_DIR, logger = defaultLogger } = options;
  return deleteUploadFiles(fileNames, {
    directory,
    resolveFilePath: resolveBoardImageFilePath,
    label: BOARD_IMAGE_LABEL,
    logger,
  });
}

export async function deleteBoardImagesByUrl(
  urls: readonly unknown[] | null | undefined,
  options: BoardImageDeleteOptions = {},
): Promise<BoardImageDeletionSummary> {
  const logger = options.logger ?? defaultLogger;
  const fileNames: string[] = [];
  const rejected: string[] = [];
  for (const url of urls ?? []) {
    const fileName = boardImageFileNameFromUrl(url);
    if (!fileName) {
      rejected.push(String(url));
      logger.error(
        `게시판 이미지 URL 형식이 아니라 삭제를 거부했다: ${String(url)}`,
      );
      continue;
    }
    fileNames.push(fileName);
  }
  const summary = await deleteBoardImageFiles(fileNames, options);
  summary.rejected.unshift(...rejected);
  return summary;
}

/**
 * 게시판 업로드 폴더에서 참조가 없는 파일을 찾는다. 판정만 하고 지우지 않는다.
 *
 * 참조 집합은 board_posts.imageUrls 에서만 온다 — 작전판 저장본이나 라이브 보드는
 * 이 폴더의 파일을 참조할 수 없다(게시물 URL 은 /uploads/boards/ 만 허용된다).
 */
export async function collectBoardImageOrphans(options: {
  referencedFileNames: ReadonlySet<string>;
  directory?: string;
  graceMs?: number;
  now?: number;
}): Promise<BoardImageOrphanReport> {
  const { directory = BOARD_UPLOAD_DIR, ...rest } = options;
  return collectUploadOrphans({
    ...rest,
    directory,
    resolveFilePath: resolveBoardImageFilePath,
  });
}
