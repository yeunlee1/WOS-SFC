import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConflictException } from '@nestjs/common';
import { UsersService } from './users.service';
import { User } from './users.entity';

describe('UsersService', () => {
  let service: UsersService;
  const mockRepo = {
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: getRepositoryToken(User), useValue: mockRepo },
      ],
    }).compile();
    service = module.get<UsersService>(UsersService);
    jest.clearAllMocks();
  });

  it('닉네임 중복 시 ConflictException', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 1, nickname: 'tester' });
    await expect(
      service.create({
        nickname: 'tester', password: 'pass123', allianceName: 'KOR',
        role: 'member', birthDate: '1990-01-01', name: '테스터', language: 'ko',
      })
    ).rejects.toThrow(ConflictException);
  });

  it('신규 유저 생성 성공', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockReturnValue({ nickname: 'newuser' });
    mockRepo.save.mockResolvedValue({ id: 1, nickname: 'newuser' });
    const result = await service.create({
      nickname: 'newuser', password: 'pass123', allianceName: 'KOR',
      role: 'member', birthDate: '1990-01-01', name: '새유저', language: 'ko',
    });
    expect(result).toHaveProperty('nickname', 'newuser');
  });

  it('findByNickname - 존재하는 유저 반환', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 1, nickname: 'tester' });
    const user = await service.findByNickname('tester');
    expect(user).not.toBeNull();
    expect(user?.nickname).toBe('tester');
  });
});
