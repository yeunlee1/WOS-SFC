// JWT가 재사용 가능한 닉네임이 아닌 불변 사용자 ID로 검증되는지 확인한다.
import { UnauthorizedException } from '@nestjs/common';
import { JwtStrategy } from './jwt.strategy';
import { UsersService } from '../users/users.service';

describe('JwtStrategy 사용자 식별', () => {
  const usersService = {
    findById: jest.fn(),
    findByNickname: jest.fn(),
  };
  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.JWT_SECRET = 'jwt-strategy-test-secret';
    strategy = new JwtStrategy(usersService as unknown as UsersService);
  });

  it('토큰의 sub로 현재 사용자를 조회하고 nickname은 식별자로 사용하지 않는다', async () => {
    const currentUser = { id: 42, nickname: 'reusedName', role: 'member' };
    usersService.findById.mockResolvedValue(currentUser);

    await expect(
      strategy.validate({ sub: 42, nickname: 'reusedName', role: 'admin' }),
    ).resolves.toBe(currentUser);
    expect(usersService.findById).toHaveBeenCalledWith(42);
    expect(usersService.findByNickname).not.toHaveBeenCalled();
  });

  it('sub에 해당하는 사용자가 없으면 같은 nickname 계정이 있어도 거부한다', async () => {
    usersService.findById.mockResolvedValue(null);
    usersService.findByNickname.mockResolvedValue({
      id: 99,
      nickname: 'reusedName',
    });

    await expect(
      strategy.validate({ sub: 42, nickname: 'reusedName', role: 'member' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(usersService.findByNickname).not.toHaveBeenCalled();
  });
});
