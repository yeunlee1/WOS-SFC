// uploads/ 아래 폴더 하나를 훑어 참조 없는 파일을 찾고, 요청이 있을 때만 지운다.
//
// 폴더마다 "무엇이 참조인가"가 다르다(게시판은 board_posts, 작전판은 저장본 + 라이브 보드).
// 그 판정은 각 폴더의 서비스가 하고, 이 파일은 그 결과를 받아 디스크만 다룬다.
// 참조 집합을 만드는 책임을 여기로 끌어오지 마라 — 한쪽 규칙이 다른 폴더에 적용되면
// 살아 있는 파일이 지워진다.
import { Logger } from '@nestjs/common';
import type { Dirent } from 'fs';
import { readdir, stat, unlink } from 'fs/promises';

// 업로드는 끝났지만 아직 게시물·저장본으로 저장되지 않은 파일을 고아로 오인하지 않도록 두는 유예.
// 사용자가 이미지를 올린 뒤 글을 쓰거나 작전판을 꾸미고 저장하기까지의 시간을 넉넉히 덮는다.
export const UPLOAD_ORPHAN_GRACE_MS = 30 * 60 * 1000;

export type UploadOrphanLogger = Pick<Logger, 'debug' | 'warn' | 'error'>;

/** 파일명 하나를 업로드 폴더 바로 아래 실제 경로로 되돌린다. 규칙 밖이면 null. */
export type UploadFilePathResolver = (
  fileName: unknown,
  directory: string,
) => string | null;

export type UploadDeletionSummary = {
  deleted: string[];
  missing: string[];
  failed: string[];
  rejected: string[];
};

export type UploadOrphan = {
  fileName: string;
  bytes: number;
  modifiedAt: string;
};

export type UploadOrphanReport = {
  directory: string;
  graceMs: number;
  scannedFiles: number;
  referencedFiles: number;
  skippedRecent: number;
  skippedUnrecognized: string[];
  orphans: UploadOrphan[];
  orphanBytes: number;
};

export function emptyUploadDeletionSummary(): UploadDeletionSummary {
  return { deleted: [], missing: [], failed: [], rejected: [] };
}

export function emptyUploadOrphanReport(
  directory: string,
  graceMs: number = UPLOAD_ORPHAN_GRACE_MS,
): UploadOrphanReport {
  return {
    directory,
    graceMs,
    scannedFiles: 0,
    referencedFiles: 0,
    skippedRecent: 0,
    skippedUnrecognized: [],
    orphans: [],
    orphanBytes: 0,
  };
}

/**
 * 참조 판정용 파일명 추출.
 *
 * 여기만은 관대해야 한다. 과잉 포함은 삭제를 막을 뿐이지만 누락은 살아 있는
 * 파일을 지운다. 그래서 쿼리·공백·경로 구분자를 걷어내고 파일명만 뽑아 넓게 보호한다.
 */
export function referencedUploadFileName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const withoutQuery = value.split(/[?#]/)[0].trim();
  const fileName = withoutQuery.split(/[\\/]/).pop();
  return fileName ? fileName : null;
}

async function unlinkOne(
  fileName: string,
  filePath: string,
  summary: UploadDeletionSummary,
  logger: UploadOrphanLogger,
  label: string,
): Promise<void> {
  try {
    await unlink(filePath);
    summary.deleted.push(fileName);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      // 이미 없는 파일은 목표 상태와 같다. 실패로 세지 않는다.
      summary.missing.push(fileName);
      logger.debug(`${label} 파일이 이미 없다: ${fileName}`);
      return;
    }
    summary.failed.push(fileName);
    logger.error(
      `${label} 삭제 실패(${code ?? 'unknown'}): ${fileName} — 고아로 남으므로 관리자 회수가 필요하다`,
    );
  }
}

export type UploadDeleteOptions = {
  directory: string;
  resolveFilePath: UploadFilePathResolver;
  /** 로그 문구에 쓰는 대상 이름. 예 — "게시판 이미지", "작전판 배경 이미지". */
  label: string;
  logger: UploadOrphanLogger;
};

/** 파일명 목록을 지운다. 경로 봉쇄를 통과하지 못한 값은 지우지 않고 거부로 보고한다. */
export async function deleteUploadFiles(
  fileNames: readonly unknown[] | null | undefined,
  options: UploadDeleteOptions,
): Promise<UploadDeletionSummary> {
  const { directory, resolveFilePath, label, logger } = options;
  const summary = emptyUploadDeletionSummary();
  for (const raw of fileNames ?? []) {
    const filePath = resolveFilePath(raw, directory);
    if (!filePath) {
      summary.rejected.push(String(raw));
      logger.error(
        `업로드 폴더 밖을 가리키는 ${label} 파일명이라 삭제를 거부했다: ${String(raw)}`,
      );
      continue;
    }
    await unlinkOne(raw as string, filePath, summary, logger, label);
  }
  return summary;
}

/**
 * 업로드 폴더에서 참조가 없는 파일을 찾는다. 판정만 하고 지우지 않는다.
 *
 * 고아로 올리지 않는 것 — 참조된 파일, 유예 시간 안에 쓰인 파일(아직 저장되지
 * 않았을 수 있다), 업로더 이름 규칙이 아닌 파일(정체를 모르므로 보고만 한다).
 * 시각 기준은 mtime 하나만 쓴다. 볼륨 복원 등으로 mtime 이 최신으로 바뀌면
 * "최근 파일"로 분류되어 삭제를 건너뛰는 안전한 쪽으로 틀린다.
 */
export async function collectUploadOrphans(options: {
  referencedFileNames: ReadonlySet<string>;
  directory: string;
  resolveFilePath: UploadFilePathResolver;
  graceMs?: number;
  now?: number;
}): Promise<UploadOrphanReport> {
  const {
    referencedFileNames,
    directory,
    resolveFilePath,
    graceMs = UPLOAD_ORPHAN_GRACE_MS,
    now = Date.now(),
  } = options;

  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    entries = [];
  }

  const report = emptyUploadOrphanReport(directory, graceMs);

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    report.scannedFiles += 1;
    const fileName = entry.name;
    if (referencedFileNames.has(fileName)) {
      report.referencedFiles += 1;
      continue;
    }
    const filePath = resolveFilePath(fileName, directory);
    if (!filePath) {
      report.skippedUnrecognized.push(fileName);
      continue;
    }
    let stats: Awaited<ReturnType<typeof stat>>;
    try {
      stats = await stat(filePath);
    } catch {
      // 스캔 도중 사라졌으면 회수할 것도 없다.
      continue;
    }
    if (now - stats.mtimeMs < graceMs) {
      report.skippedRecent += 1;
      continue;
    }
    report.orphans.push({
      fileName,
      bytes: stats.size,
      modifiedAt: new Date(stats.mtimeMs).toISOString(),
    });
    report.orphanBytes += stats.size;
  }

  return report;
}
