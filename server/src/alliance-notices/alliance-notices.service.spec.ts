// 연맹 공지 삭제가 같은 연맹 안에서만 허용되는지 검증한다.
import { ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { AllianceNotice } from './alliance-notice.entity';
import { AllianceNoticesService } from './alliance-notices.service';

describe('AllianceNoticesService 삭제 권한', () => {
  const repo = {
    findOneBy: jest.fn(),
    delete: jest.fn(),
  };
  const gateway = { broadcastAllianceNotice: jest.fn() };
  let service: AllianceNoticesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AllianceNoticesService(
      repo as unknown as Repository<AllianceNotice>,
      gateway as unknown as RealtimeGateway,
    );
    repo.findOneBy.mockResolvedValue({
      id: 1,
      alliance: 'KOR',
      authorNick: 'ownerKo',
      createdAt: new Date('2026-01-02T00:00:00.000Z'),
    });
  });

  it.each(['admin', 'developer'])(
    '타 연맹 %s의 삭제를 거부한다',
    async (role) => {
      await expect(
        service.remove(1, {
          nickname: 'managerNsl',
          role,
          allianceName: 'NSL',
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.delete).not.toHaveBeenCalled();
    },
  );

  it('같은 연맹 관리자는 다른 작성자의 공지도 삭제할 수 있다', async () => {
    await service.remove(1, {
      nickname: 'adminKo',
      role: 'admin',
      allianceName: 'KOR',
      createdAt: new Date('2026-01-03T00:00:00.000Z'),
    });

    expect(repo.delete).toHaveBeenCalledWith(1);
    expect(gateway.broadcastAllianceNotice).toHaveBeenCalledWith('KOR');
  });

  it('원 작성 계정은 자신의 공지를 삭제할 수 있다', async () => {
    await service.remove(1, {
      nickname: 'ownerKo',
      role: 'member',
      allianceName: 'KOR',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(repo.delete).toHaveBeenCalledWith(1);
  });

  it.each([
    new Date('2026-01-02T00:00:00.000Z'),
    new Date('2026-01-03T00:00:00.000Z'),
  ])(
    '같은 닉네임 재가입 계정은 이전 공지를 삭제할 수 없다',
    async (createdAt) => {
      await expect(
        service.remove(1, {
          nickname: 'ownerKo',
          role: 'member',
          allianceName: 'KOR',
          createdAt,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(repo.delete).not.toHaveBeenCalled();
    },
  );
});
