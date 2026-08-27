// 게시판 작성자 귀속과 삭제 권한 경계를 검증한다.
import { ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { User } from '../users/users.entity';
import { BoardPost } from './board-post.entity';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';
import { deleteBoardImagesByUrl } from './board-image-files';
import { BoardUploadQuotaService } from './board-upload-quota.service';

jest.mock('./board-image-files', () => ({
  deleteBoardImagesByUrl: jest.fn(),
}));

const deleteImagesMock = deleteBoardImagesByUrl as jest.Mock;
const quota = { invalidate: jest.fn() };

beforeEach(() => {
  deleteImagesMock.mockResolvedValue({
    deleted: [],
    missing: [],
    failed: [],
    rejected: [],
  });
});

describe('BoardsService 보안 경계', () => {
  const repo = {
    create: jest.fn((value) => value),
    save: jest.fn(),
    findOneBy: jest.fn(),
    delete: jest.fn(),
  };
  const gateway = { broadcastBoard: jest.fn() };
  let service: BoardsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BoardsService(
      repo as unknown as Repository<BoardPost>,
      gateway as unknown as RealtimeGateway,
      quota as unknown as BoardUploadQuotaService,
    );
  });

  it('작성자와 게시 연맹을 인증 사용자 정보로 저장한다', async () => {
    repo.save.mockImplementation(async (value) => ({ id: 1, ...value }));
    const user = {
      nickname: 'memberKo',
      allianceName: 'KOR',
    } as Pick<User, 'nickname' | 'allianceName'>;

    await service.add(user, {
      alliance: 'NSL',
      content: 'hello',
      lang: 'ko',
    });

    expect(repo.create).toHaveBeenCalledWith({
      alliance: 'NSL',
      nickname: 'memberKo',
      userAlliance: 'KOR',
      content: 'hello',
      lang: 'ko',
      imageUrls: null,
    });
  });

  it('일반 사용자는 다른 작성자의 게시물을 삭제할 수 없다', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 1,
      alliance: 'KOR',
      nickname: 'ownerKo',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await expect(
      service.remove(1, {
        nickname: 'intruder',
        role: 'member',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(repo.delete).not.toHaveBeenCalled();
  });

  it.each([
    {
      nickname: 'ownerKo',
      role: 'member' as const,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      nickname: 'adminKo',
      role: 'admin' as const,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    },
    {
      nickname: 'developerKo',
      role: 'developer' as const,
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    },
  ])('작성자 또는 관리자 역할은 삭제할 수 있다', async (actor) => {
    repo.findOneBy.mockResolvedValue({
      id: 1,
      alliance: 'KOR',
      nickname: 'ownerKo',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });

    await service.remove(1, actor);

    expect(repo.delete).toHaveBeenCalledWith(1);
    expect(gateway.broadcastBoard).toHaveBeenCalledWith('KOR');
  });

  it.each([
    new Date('2026-01-02T00:00:00.000Z'),
    new Date('2026-01-03T00:00:00.000Z'),
  ])(
    '같은 닉네임으로 재가입한 일반 회원은 이전 글을 삭제할 수 없다',
    async (createdAt) => {
      repo.findOneBy.mockResolvedValue({
        id: 1,
        alliance: 'KOR',
        nickname: 'ownerKo',
        createdAt: new Date('2026-01-02T00:00:00.000Z'),
      });

      await expect(
        service.remove(1, {
          nickname: 'ownerKo',
          role: 'member',
          createdAt,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.delete).not.toHaveBeenCalled();
    },
  );
});

describe('BoardsController 사용자 전달', () => {
  it('요청 사용자를 작성과 삭제 서비스에 전달한다', async () => {
    const service = {
      add: jest.fn().mockResolvedValue({ id: 1 }),
      remove: jest.fn().mockResolvedValue(undefined),
    };
    const controller = new BoardsController(
      service as unknown as BoardsService,
    );
    const user = {
      nickname: 'memberKo',
      allianceName: 'KOR',
      role: 'member',
    } as User;
    const req = { user } as never;

    await controller.add(req, { alliance: 'NSL', content: 'hello' });
    await controller.remove(1, req);

    expect(service.add).toHaveBeenCalledWith(user, {
      alliance: 'NSL',
      content: 'hello',
    });
    expect(service.remove).toHaveBeenCalledWith(1, user);
  });
});

// 접속 1건마다 findAllGrouped가 연맹 5개를 순차로 await 하면 왕복 5회가 직렬로 쌓인다.
// 100명 동시 재접속이면 이 구간만으로 커넥션 풀 대기열이 길어져 지연이 누적된다.
describe('BoardsService.findAllGrouped 병렬 조회', () => {
  const repo = {
    find: jest.fn(),
  };
  const gateway = { broadcastBoard: jest.fn() };
  let service: BoardsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BoardsService(
      repo as unknown as Repository<BoardPost>,
      gateway as unknown as RealtimeGateway,
      quota as unknown as BoardUploadQuotaService,
    );
  });

  it('연맹 5개 조회를 순차 대기하지 않고 한 번에 띄운다', async () => {
    const release: Array<() => void> = [];
    repo.find.mockImplementation(
      () =>
        new Promise((resolve) => {
          release.push(() => resolve([]));
        }),
    );

    const pending = service.findAllGrouped();
    await new Promise((resolve) => setImmediate(resolve));

    // 순차 await면 첫 조회가 pending이라 1회에서 멈춘다.
    expect(repo.find).toHaveBeenCalledTimes(5);

    release.forEach((fn) => fn());
    await pending;
  });

  it('연맹 키와 각 연맹의 결과 대응은 그대로 유지된다', async () => {
    repo.find.mockImplementation(({ where }: { where: { alliance: string } }) =>
      Promise.resolve([{ id: where.alliance }]),
    );

    const grouped = await service.findAllGrouped();

    expect(Object.keys(grouped)).toEqual(['KOR', 'NSL', 'JKY', 'GPX', 'UFO']);
    for (const alliance of Object.keys(grouped)) {
      expect(grouped[alliance]).toEqual([{ id: alliance }]);
    }
  });
});

// 게시물을 지워도 이미지 파일이 남으면 1GB quota 가 영구히 잠긴다.
describe('BoardsService.remove 이미지 파일 회수', () => {
  const repo = {
    findOneBy: jest.fn(),
    delete: jest.fn(),
  };
  const gateway = { broadcastBoard: jest.fn() };
  let service: BoardsService;
  const owner = {
    nickname: 'ownerKo',
    role: 'member' as const,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    service = new BoardsService(
      repo as unknown as Repository<BoardPost>,
      gateway as unknown as RealtimeGateway,
      quota as unknown as BoardUploadQuotaService,
    );
    repo.findOneBy.mockResolvedValue({
      id: 1,
      alliance: 'KOR',
      nickname: 'ownerKo',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      imageUrls: [
        '/uploads/boards/1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg',
      ],
    });
  });

  it('DB 삭제가 끝난 뒤 게시물이 들고 있던 이미지 파일을 지운다', async () => {
    const order: string[] = [];
    repo.delete.mockImplementation(() => {
      order.push('db');
      return Promise.resolve({ affected: 1 });
    });
    deleteImagesMock.mockImplementation(() => {
      order.push('file');
      return Promise.resolve({
        deleted: ['a.jpg'],
        missing: [],
        failed: [],
        rejected: [],
      });
    });

    await service.remove(1, owner);

    expect(deleteImagesMock).toHaveBeenCalledWith(
      [
        '/uploads/boards/1776609627806-4870a517-30cf-4ddf-bd06-45c2a5d9c6eb.jpg',
      ],
      expect.anything(),
    );
    expect(order).toEqual(['db', 'file']);
    expect(quota.invalidate).toHaveBeenCalled();
  });

  it('DB 삭제가 실패하면 파일은 건드리지 않는다', async () => {
    repo.delete.mockRejectedValue(new Error('deadlock'));

    await expect(service.remove(1, owner)).rejects.toThrow('deadlock');
    expect(deleteImagesMock).not.toHaveBeenCalled();
  });

  it('파일 삭제가 통째로 실패해도 DB 삭제 결과를 되돌리지 않는다', async () => {
    repo.delete.mockResolvedValue({ affected: 1 });
    deleteImagesMock.mockRejectedValue(new Error('EBUSY'));

    await expect(service.remove(1, owner)).resolves.toBeUndefined();
    expect(gateway.broadcastBoard).toHaveBeenCalledWith('KOR');
  });

  it('이미지가 없는 게시물은 파일 삭제를 시도하지 않는다', async () => {
    repo.findOneBy.mockResolvedValue({
      id: 1,
      alliance: 'KOR',
      nickname: 'ownerKo',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
      imageUrls: null,
    });
    repo.delete.mockResolvedValue({ affected: 1 });

    await service.remove(1, owner);

    expect(deleteImagesMock).not.toHaveBeenCalled();
  });
});

// BoardsService 가 quota 서비스를 새로 주입받는다. 메타데이터 누락은 부팅 때만 터지므로 고정한다.
describe('BoardsService DI 조립', () => {
  it('Nest 컨테이너가 저장소·게이트웨이·quota 를 주입해 생성한다', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        BoardsService,
        { provide: getRepositoryToken(BoardPost), useValue: {} },
        { provide: RealtimeGateway, useValue: {} },
        { provide: BoardUploadQuotaService, useValue: quota },
      ],
    }).compile();

    expect(moduleRef.get(BoardsService)).toBeInstanceOf(BoardsService);
  });
});
