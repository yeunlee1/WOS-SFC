import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdminService } from './admin.service';
import { User } from '../users/users.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

describe('AdminService — setLeader', () => {
  let service: AdminService;
  const mockRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    save: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };
  const mockGateway = {
    kickUser: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdminService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
        { provide: RealtimeGateway, useValue: mockGateway },
      ],
    }).compile();
    service = module.get<AdminService>(AdminService);
    jest.clearAllMocks();
  });

  it('setLeader(id, true) — isLeader가 true로 저장됨 + kickUser 호출 안 함', async () => {
    const sanitizedUser = {
      id: 1,
      nickname: 'alice',
      allianceName: 'KOR',
      role: 'member',
      isLeader: true,
      language: 'ko',
      marchSeconds: null,
      createdAt: new Date(),
    };
    mockRepo.update.mockResolvedValue({ affected: 1 });
    mockRepo.findOne.mockResolvedValue(sanitizedUser);

    const result = await service.setLeader(1, true);

    expect(mockRepo.update).toHaveBeenCalledWith(1, { isLeader: true });
    expect(mockRepo.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 1 },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        select: expect.arrayContaining(['id', 'nickname', 'isLeader']),
      }),
    );
    expect(result.isLeader).toBe(true);
    // passwordHash / birthDate / name 등 PII가 응답에 없어야 함
    expect(result).not.toHaveProperty('passwordHash');
    expect(result).not.toHaveProperty('birthDate');
    expect(result).not.toHaveProperty('name');
    expect(result).not.toHaveProperty('refreshTokenHash');
    // setLeader는 권한 게이트가 아닌 메타데이터 토글이므로 kickUser를 호출하지 않아야 함.
    // changeRole과 달리 JWT payload에 isLeader가 포함되어 있지 않아 stale 우려가 없음.
    expect(mockGateway.kickUser).not.toHaveBeenCalled();
  });

  it('setLeader(id, false) — isLeader가 false로 저장됨', async () => {
    const sanitizedUser = {
      id: 2,
      nickname: 'bob',
      allianceName: 'KOR',
      role: 'member',
      isLeader: false,
      language: 'ko',
      marchSeconds: null,
      createdAt: new Date(),
    };
    mockRepo.update.mockResolvedValue({ affected: 1 });
    mockRepo.findOne.mockResolvedValue(sanitizedUser);

    const result = await service.setLeader(2, false);

    expect(mockRepo.update).toHaveBeenCalledWith(2, { isLeader: false });
    expect(result.isLeader).toBe(false);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('존재하지 않는 id → NotFoundException', async () => {
    mockRepo.update.mockResolvedValue({ affected: 0 });

    await expect(service.setLeader(999, true)).rejects.toThrow(
      NotFoundException,
    );
    expect(mockRepo.findOne).not.toHaveBeenCalled();
    expect(mockRepo.save).not.toHaveBeenCalled();
  });
});
