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
