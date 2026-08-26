// 게시판 작성자 귀속과 삭제 권한 경계를 검증한다.
import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { User } from '../users/users.entity';
import { BoardPost } from './board-post.entity';
import { BoardsController } from './boards.controller';
import { BoardsService } from './boards.service';

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
