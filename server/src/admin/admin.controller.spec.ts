// 고아 업로드 회수 엔드포인트가 개발자 전용이고 기본이 dry-run인지 검증한다.
import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import { AdminController } from './admin.controller';
import { AdminModule } from './admin.module';
import { AdminService } from './admin.service';
import { DeveloperGuard } from './developer.guard';
import { UploadOrphanService } from './upload-orphan.service';
import { OperationBoardsModule } from '../operation-boards/operation-boards.module';

describe('AdminController 고아 업로드 회수', () => {
  const adminService = {} as AdminService;
  const uploadOrphans = {
    scan: jest.fn(),
    purge: jest.fn(),
  };
  const controller = new AdminController(
    adminService,
    uploadOrphans as unknown as UploadOrphanService,
  );

  beforeEach(() => jest.clearAllMocks());

  it('개발자 가드가 컨트롤러 전체에 걸려 있다', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      AdminController,
    ) as unknown[];
    expect(guards).toContain(DeveloperGuard);
  });

  it('조회는 보고만 하고 삭제하지 않는다', async () => {
    uploadOrphans.scan.mockResolvedValue({ folders: [] });

    await controller.scanOrphanUploads();

    expect(uploadOrphans.scan).toHaveBeenCalledTimes(1);
    expect(uploadOrphans.purge).not.toHaveBeenCalled();
  });

  it('삭제는 명시적으로 요청했을 때만 수행한다', async () => {
    uploadOrphans.purge.mockResolvedValue({ folders: [], totalDeleted: 0 });

    await controller.purgeOrphanUploads();

    expect(uploadOrphans.purge).toHaveBeenCalledTimes(1);
  });
});

// 모듈 배선이 빠지면 앱 부팅 때만 터진다. 작전판 폴더까지 훑으려면
// AdminModule 이 OperationBoardsModule 을 끌어와야 한다.
describe('AdminModule 배선', () => {
  function resolvedImports(): unknown[] {
    const imports = (Reflect.getMetadata(
      MODULE_METADATA.IMPORTS,
      AdminModule,
    ) ?? []) as unknown[];
    return imports.map((entry) => {
      const forward = entry as { forwardRef?: () => unknown };
      return typeof forward?.forwardRef === 'function'
        ? forward.forwardRef()
        : entry;
    });
  }

  it('UploadOrphanService 를 제공한다', () => {
    const providers = (Reflect.getMetadata(
      MODULE_METADATA.PROVIDERS,
      AdminModule,
    ) ?? []) as unknown[];
    expect(providers).toContain(UploadOrphanService);
  });

  it('작전판 모듈을 가져온다', () => {
    expect(resolvedImports()).toContain(OperationBoardsModule);
  });
});
