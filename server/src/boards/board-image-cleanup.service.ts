// 어떤 게시물도 참조하지 않는 업로드 이미지를 찾아 보고하고, 요청이 있을 때만 회수한다.
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BoardPost } from './board-post.entity';
import {
  BoardImageDeletionSummary,
  BoardImageOrphanReport,
  collectBoardImageOrphans,
  deleteBoardImageFiles,
  referencedBoardImageName,
} from './board-image-files';
import { BoardUploadQuotaService } from './board-upload-quota.service';

// 기본값은 운영 경로(BOARD_UPLOAD_DIR)와 기본 유예 시간이다.
// 여기서 덮어쓰는 것은 테스트뿐이고, 컨트롤러는 아무 값도 넘기지 않는다.
export type BoardImageScanOptions = {
  directory?: string;
  graceMs?: number;
  now?: number;
};

export type BoardImagePurgeResult = BoardImageOrphanReport & {
  deletion: BoardImageDeletionSummary;
};

@Injectable()
export class BoardImageCleanupService {
  private readonly logger = new Logger(BoardImageCleanupService.name);

  constructor(
    @InjectRepository(BoardPost) private readonly repo: Repository<BoardPost>,
    private readonly quota: BoardUploadQuotaService,
  ) {}

  // dry-run. 판정만 하고 디스크를 건드리지 않는다.
  async scanOrphans(
    options: BoardImageScanOptions = {},
  ): Promise<BoardImageOrphanReport> {
    const referencedFileNames = await this.loadReferencedFileNames();
    return collectBoardImageOrphans({ ...options, referencedFileNames });
  }

  async purgeOrphans(
    options: BoardImageScanOptions = {},
  ): Promise<BoardImagePurgeResult> {
    const report = await this.scanOrphans(options);
    // 스캔과 삭제 사이에 저장된 게시물이 있으면 그 파일은 더 이상 고아가 아니다.
    // 유예 시간만으로 못 막는 경합을 여기서 한 번 더 걸러낸다.
    const referencedNow = await this.loadReferencedFileNames();
    const targets = report.orphans
      .map((orphan) => orphan.fileName)
      .filter((fileName) => !referencedNow.has(fileName));

    const deletion = await deleteBoardImageFiles(targets, {
      directory: options.directory,
      logger: this.logger,
    });

    if (deletion.deleted.length > 0) {
      // quota 는 디스크를 5초 캐시로 들고 있다. 회수분이 곧바로 반영되게 버린다.
      this.quota.invalidate();
    }
    this.logger.warn(
      `고아 게시판 이미지 회수 — 삭제 ${deletion.deleted.length}건, 이미 없음 ${deletion.missing.length}건, 실패 ${deletion.failed.length}건, 스캔 뒤 참조됨 ${report.orphans.length - targets.length}건`,
    );

    return { ...report, deletion };
  }

  private async loadReferencedFileNames(): Promise<Set<string>> {
    const posts = await this.repo.find({ select: ['id', 'imageUrls'] });
    const fileNames = new Set<string>();
    for (const post of posts) {
      for (const url of post.imageUrls ?? []) {
        const fileName = referencedBoardImageName(url);
        if (fileName) fileNames.add(fileName);
      }
    }
    return fileNames;
  }
}
