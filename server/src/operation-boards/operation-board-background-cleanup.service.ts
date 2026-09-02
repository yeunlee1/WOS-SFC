// 어떤 저장본도 라이브 작전판도 참조하지 않는 배경 이미지를 찾아 보고하고, 요청이 있을 때만 회수한다.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { OperationBoard } from './operation-board.entity';
import {
  collectOperationBoardBackgroundOrphans,
  deleteOperationBoardBackgroundFiles,
} from './operation-board-background-files';
import { OPERATION_BOARD_BACKGROUND_DIR } from './operation-board-upload.options';
import { OperationBoardsGateway } from './operation-boards.gateway';
import { BoardUploadQuotaService } from '../boards/board-upload-quota.service';
import {
  emptyUploadDeletionSummary,
  emptyUploadOrphanReport,
  referencedUploadFileName,
  UPLOAD_ORPHAN_GRACE_MS,
  type UploadDeletionSummary,
  type UploadOrphanReport,
} from '../boards/upload-orphan-scan';

// 기본값은 운영 경로와 기본 유예 시간이다. 여기서 덮어쓰는 것은 테스트뿐이다.
export type OperationBoardBackgroundScanOptions = {
  directory?: string;
  graceMs?: number;
  now?: number;
};

/**
 * 라이브 작전판 상태를 읽을 수 있었는지.
 *
 * `unavailable` 이면 고아 판정도 삭제도 하지 않는다. 라이브 보드가 띄우고 있는
 * 배경을 확인하지 못한 채 지우면 작전판을 보고 있는 인원 전원의 화면이 깨진다.
 * 확인할 수 없을 때는 회수를 포기하는 쪽이 안전하다 — 최악이 디스크를 좀 더
 * 쓰는 것이고, 반대쪽 최악은 작전 중 배경이 사라지는 것이다.
 */
export type LiveBoardCheck = 'ok' | 'unavailable';

export type OperationBoardBackgroundOrphanReport = UploadOrphanReport & {
  liveCheck: LiveBoardCheck;
  liveBackgroundImageUrl: string | null;
  skippedReason?: string;
};

export type OperationBoardBackgroundPurgeResult =
  OperationBoardBackgroundOrphanReport & {
    deletion: UploadDeletionSummary;
  };

type ReferenceLookup =
  | {
      available: true;
      fileNames: Set<string>;
      liveBackgroundImageUrl: string | null;
    }
  | { available: false; reason: string };

@Injectable()
export class OperationBoardBackgroundCleanupService {
  private readonly logger = new Logger(
    OperationBoardBackgroundCleanupService.name,
  );

  constructor(
    @InjectRepository(OperationBoard)
    private readonly repo: Repository<OperationBoard>,
    private readonly quota: BoardUploadQuotaService,
    // 라이브 작전판이 지금 그 배경을 띄우고 있는지 확인하는 용도로만 쓴다.
    private readonly liveBoard: OperationBoardsGateway,
  ) {}

  // dry-run. 판정만 하고 디스크를 건드리지 않는다.
  async scanOrphans(
    options: OperationBoardBackgroundScanOptions = {},
  ): Promise<OperationBoardBackgroundOrphanReport> {
    const directory = options.directory ?? OPERATION_BOARD_BACKGROUND_DIR;
    const graceMs = options.graceMs ?? UPLOAD_ORPHAN_GRACE_MS;

    const references = await this.loadReferences();
    if (!references.available) {
      return this.skippedReport(directory, graceMs, references.reason);
    }

    const report = await collectOperationBoardBackgroundOrphans({
      referencedFileNames: references.fileNames,
      directory,
      graceMs,
      now: options.now,
    });
    return {
      ...report,
      liveCheck: 'ok',
      liveBackgroundImageUrl: references.liveBackgroundImageUrl,
    };
  }

  async purgeOrphans(
    options: OperationBoardBackgroundScanOptions = {},
  ): Promise<OperationBoardBackgroundPurgeResult> {
    const report = await this.scanOrphans(options);
    if (report.liveCheck === 'unavailable') {
      return { ...report, deletion: emptyUploadDeletionSummary() };
    }

    // 스캔과 삭제 사이에 저장된 저장본이나 새로 띄운 라이브 배경이 있으면
    // 그 파일은 더 이상 고아가 아니다. 유예 시간만으로 못 막는 경합을 여기서 거른다.
    const referencedNow = await this.loadReferences();
    if (!referencedNow.available) {
      return {
        ...this.skippedReport(
          report.directory,
          report.graceMs,
          referencedNow.reason,
        ),
        deletion: emptyUploadDeletionSummary(),
      };
    }

    const targets = report.orphans
      .map((orphan) => orphan.fileName)
      .filter((fileName) => !referencedNow.fileNames.has(fileName));

    const deletion = await deleteOperationBoardBackgroundFiles(targets, {
      directory: report.directory,
      logger: this.logger,
    });

    if (deletion.deleted.length > 0) {
      // 업로드 한도는 uploads/ 전체를 합산한다. 회수분이 곧바로 반영되게 캐시를 버린다.
      this.quota.invalidate();
    }
    this.logger.warn(
      `고아 작전판 배경 회수 — 삭제 ${deletion.deleted.length}건, 이미 없음 ${deletion.missing.length}건, 실패 ${deletion.failed.length}건, 스캔 뒤 참조됨 ${report.orphans.length - targets.length}건`,
    );

    return { ...report, deletion };
  }

  private skippedReport(
    directory: string,
    graceMs: number,
    reason: string,
  ): OperationBoardBackgroundOrphanReport {
    this.logger.warn(
      `라이브 작전판 상태를 확인하지 못해 배경 회수를 건너뛴다: ${reason}`,
    );
    return {
      ...emptyUploadOrphanReport(directory, graceMs),
      liveCheck: 'unavailable',
      liveBackgroundImageUrl: null,
      skippedReason: `라이브 작전판 상태를 확인할 수 없어 회수를 건너뛰었다: ${reason}`,
    };
  }

  /**
   * 작전판 배경의 참조 집합. 저장본(DB)과 라이브 보드(메모리) 두 곳에서 모은다.
   *
   * 게시판 이미지와 다른 지점이 여기다. 게시판은 board_posts 한 곳만 보면 되지만
   * 작전판은 저장본이 하나도 없어도 라이브 보드가 그 파일을 띄우고 있을 수 있다.
   * 한쪽만 보면 살아 있는 파일을 지운다.
   */
  private async loadReferences(): Promise<ReferenceLookup> {
    let liveBackgroundImageUrl: string | null;
    try {
      liveBackgroundImageUrl = this.liveBoard.liveBackgroundImageUrl();
    } catch (error) {
      return { available: false, reason: (error as Error).message };
    }

    const rows = await this.repo.find({
      select: ['id', 'backgroundImageUrl'],
    });
    const fileNames = new Set<string>();
    for (const row of rows) {
      const fileName = referencedUploadFileName(row.backgroundImageUrl);
      if (fileName) fileNames.add(fileName);
    }
    const liveFileName = referencedUploadFileName(liveBackgroundImageUrl);
    if (liveFileName) fileNames.add(liveFileName);

    return { available: true, fileNames, liveBackgroundImageUrl };
  }
}
