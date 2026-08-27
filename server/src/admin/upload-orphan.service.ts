// uploads/ 아래에서 회수를 허용한 폴더만 훑어 폴더별 고아 보고서를 만든다.
//
// 업로드 한도(1GB)는 uploads/ 전체를 합산하므로(board-upload-quota.service.ts 가
// UPLOAD_ROOT 를 재귀로 훑는다) 한 폴더만 회수할 수 있으면 다른 폴더의 고아가
// 전체 업로드를 막아 버린다. 그래서 두 폴더를 함께 본다.
import { Injectable } from '@nestjs/common';
import { BoardImageCleanupService } from '../boards/board-image-cleanup.service';
import {
  BOARD_UPLOAD_DIR,
  BOARD_UPLOAD_URL_PREFIX,
} from '../boards/board-upload.options';
import type {
  UploadDeletionSummary,
  UploadOrphanReport,
} from '../boards/upload-orphan-scan';
import {
  OperationBoardBackgroundCleanupService,
  type LiveBoardCheck,
} from '../operation-boards/operation-board-background-cleanup.service';
import {
  OPERATION_BOARD_BACKGROUND_DIR,
  OPERATION_BOARD_BACKGROUND_URL_PREFIX,
} from '../operation-boards/operation-board-upload.options';

/**
 * 스캔·삭제를 허용한 폴더 화이트리스트.
 *
 * uploads/ 를 통째로 readdir 하지 않는 이유가 여기 있다. 나중에 누가 uploads/ 아래에
 * 다른 용도의 폴더를 만들면 그 파일들이 "참조를 못 찾은 고아"로 잡혀 지워진다.
 * 새 폴더를 회수 대상에 넣으려면 그 폴더 전용 참조 판정을 만들어 아래 handlers 에
 * 함께 등록해야 한다 — 목록에만 추가하면 타입 검사가 막는다.
 */
export const UPLOAD_ORPHAN_FOLDERS = ['boards', 'operation-boards'] as const;

export type UploadOrphanFolder = (typeof UPLOAD_ORPHAN_FOLDERS)[number];

export const UPLOAD_ORPHAN_FOLDER_DIRECTORIES: Readonly<
  Record<UploadOrphanFolder, string>
> = {
  boards: BOARD_UPLOAD_DIR,
  'operation-boards': OPERATION_BOARD_BACKGROUND_DIR,
};

export const UPLOAD_ORPHAN_FOLDER_URL_PREFIXES: Readonly<
  Record<UploadOrphanFolder, string>
> = {
  boards: BOARD_UPLOAD_URL_PREFIX,
  'operation-boards': OPERATION_BOARD_BACKGROUND_URL_PREFIX,
};

export type UploadOrphanFolderReport = UploadOrphanReport & {
  folder: UploadOrphanFolder;
  urlPrefix: string;
  /** 작전판 폴더 전용 — 라이브 보드 상태를 읽었는지. 못 읽으면 회수를 건너뛴다. */
  liveCheck?: LiveBoardCheck;
  liveBackgroundImageUrl?: string | null;
  skippedReason?: string;
};

export type UploadOrphanPurgeFolderReport = UploadOrphanFolderReport & {
  deletion: UploadDeletionSummary;
};

export type UploadOrphanScanReport = {
  folders: UploadOrphanFolderReport[];
  totalOrphans: number;
  totalOrphanBytes: number;
};

export type UploadOrphanPurgeReport = {
  folders: UploadOrphanPurgeFolderReport[];
  totalOrphans: number;
  totalOrphanBytes: number;
  totalDeleted: number;
  totalFailed: number;
};

// 폴더 경로를 바꿔 끼우는 것은 테스트뿐이고, 컨트롤러는 아무 값도 넘기지 않는다.
export type UploadOrphanOptions = {
  directories?: Partial<Record<UploadOrphanFolder, string>>;
  graceMs?: number;
  now?: number;
};

type FolderScanOptions = { directory?: string; graceMs?: number; now?: number };

/**
 * 폴더 하나를 맡는 회수 담당.
 *
 * 폴더마다 "무엇이 참조인가"가 다르다 — 게시판은 board_posts.imageUrls, 작전판은
 * 저장본 operation_boards.background_image_url 과 라이브 보드(메모리)다. 그 판정은
 * 각 서비스 안에 있고 서로 섞이지 않는다. 한쪽 판정을 다른 폴더에 적용하면
 * 살아 있는 파일이 지워진다.
 */
type FolderHandler = {
  scan: (options: FolderScanOptions) => Promise<UploadOrphanReport>;
  purge: (
    options: FolderScanOptions,
  ) => Promise<UploadOrphanReport & { deletion: UploadDeletionSummary }>;
};

@Injectable()
export class UploadOrphanService {
  constructor(
    private readonly boardImages: BoardImageCleanupService,
    private readonly operationBackgrounds: OperationBoardBackgroundCleanupService,
  ) {}

  async scan(
    options: UploadOrphanOptions = {},
  ): Promise<UploadOrphanScanReport> {
    const folders: UploadOrphanFolderReport[] = [];
    for (const folder of UPLOAD_ORPHAN_FOLDERS) {
      const report = await this.handlers()[folder].scan(
        this.folderOptions(folder, options),
      );
      folders.push(this.label(folder, report));
    }
    return {
      folders,
      totalOrphans: folders.reduce((sum, f) => sum + f.orphans.length, 0),
      totalOrphanBytes: folders.reduce((sum, f) => sum + f.orphanBytes, 0),
    };
  }

  async purge(
    options: UploadOrphanOptions = {},
  ): Promise<UploadOrphanPurgeReport> {
    const folders: UploadOrphanPurgeFolderReport[] = [];
    for (const folder of UPLOAD_ORPHAN_FOLDERS) {
      const result = await this.handlers()[folder].purge(
        this.folderOptions(folder, options),
      );
      folders.push({
        ...this.label(folder, result),
        deletion: result.deletion,
      });
    }
    return {
      folders,
      totalOrphans: folders.reduce((sum, f) => sum + f.orphans.length, 0),
      totalOrphanBytes: folders.reduce((sum, f) => sum + f.orphanBytes, 0),
      totalDeleted: folders.reduce(
        (sum, f) => sum + f.deletion.deleted.length,
        0,
      ),
      totalFailed: folders.reduce(
        (sum, f) => sum + f.deletion.failed.length,
        0,
      ),
    };
  }

  // Record<UploadOrphanFolder, ...> 라 화이트리스트에 폴더를 더하면
  // 담당 서비스를 붙이기 전까지 컴파일이 통과하지 않는다.
  private handlers(): Record<UploadOrphanFolder, FolderHandler> {
    return {
      boards: {
        scan: (options) => this.boardImages.scanOrphans(options),
        purge: (options) => this.boardImages.purgeOrphans(options),
      },
      'operation-boards': {
        scan: (options) => this.operationBackgrounds.scanOrphans(options),
        purge: (options) => this.operationBackgrounds.purgeOrphans(options),
      },
    };
  }

  private folderOptions(
    folder: UploadOrphanFolder,
    options: UploadOrphanOptions,
  ): FolderScanOptions {
    return {
      directory: options.directories?.[folder],
      graceMs: options.graceMs,
      now: options.now,
    };
  }

  // 관리자가 무엇을 지우는지 알 수 있게 폴더와 URL 접두사를 함께 싣는다.
  private label<T extends UploadOrphanReport>(
    folder: UploadOrphanFolder,
    report: T,
  ): UploadOrphanFolderReport {
    const extras = report as Partial<UploadOrphanFolderReport>;
    return {
      ...report,
      folder,
      urlPrefix: UPLOAD_ORPHAN_FOLDER_URL_PREFIXES[folder],
      ...(extras.liveCheck === undefined
        ? {}
        : {
            liveCheck: extras.liveCheck,
            liveBackgroundImageUrl: extras.liveBackgroundImageUrl ?? null,
          }),
      ...(extras.skippedReason === undefined
        ? {}
        : { skippedReason: extras.skippedReason }),
    };
  }
}
