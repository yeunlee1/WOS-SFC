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
        role: 'member', language: 'ko',
      })
    ).rejects.toThrow(ConflictException);
  });

  it('신규 유저 생성 성공', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockReturnValue({ nickname: 'newuser' });
    mockRepo.save.mockResolvedValue({ id: 1, nickname: 'newuser' });
    const result = await service.create({
      nickname: 'newuser', password: 'pass123', allianceName: 'KOR',
      role: 'member', language: 'ko',
    });
    expect(result).toHaveProperty('nickname', 'newuser');
  });

  it('회원가입 시 birthDate/name은 항상 null로 저장된다 (개인정보 최소화)', async () => {
    mockRepo.findOne.mockResolvedValue(null);
    mockRepo.create.mockImplementation((entity) => entity);
    mockRepo.save.mockImplementation(async (entity) => ({ id: 1, ...entity }));
    await service.create({
      nickname: 'newuser', password: 'pass123', allianceName: 'KOR',
      role: 'member', language: 'ko',
    });
    const created = mockRepo.create.mock.calls[0][0];
    expect(created.birthDate).toBeNull();
    expect(created.name).toBeNull();
  });

  it('findByNickname - 존재하는 유저 반환', async () => {
    mockRepo.findOne.mockResolvedValue({ id: 1, nickname: 'tester' });
    const user = await service.findByNickname('tester');
    expect(user).not.toBeNull();
    expect(user?.nickname).toBe('tester');
  });
});
