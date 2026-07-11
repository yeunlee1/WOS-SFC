// 레거시 사용자 역할 변경 API의 개발자 전용 경계를 검증한다.
import { ForbiddenException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { UpdateRoleDto } from './dto/update-role.dto';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

describe('UsersController 역할 변경 보안', () => {
  const service = {
    findByNickname: jest.fn(),
    setRole: jest.fn(),
  };
  const realtimeGateway = { kickUser: jest.fn() };
  let controller: UsersController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new UsersController(
      service as unknown as UsersService,
      realtimeGateway as unknown as RealtimeGateway,
    );
  });

  it('admin의 레거시 역할 변경 시도를 거부한다', async () => {
    await expect(
      controller.setRole(
        'memberKo',
        { role: 'admin' },
        { user: { role: 'admin' } },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.setRole).not.toHaveBeenCalled();
  });

  it('developer의 admin/member 변경 후 해당 사용자의 모든 소켓 종료를 요청한다', async () => {
    service.setRole.mockResolvedValue({ nickname: 'memberKo', role: 'admin' });

    await expect(
      controller.setRole(
        'memberKo',
        { role: 'admin' },
        { user: { role: 'developer' } },
      ),
    ).resolves.toEqual({ nickname: 'memberKo', role: 'admin' });
    expect(realtimeGateway.kickUser).toHaveBeenCalledWith('memberKo');
  });

  it('DTO가 developer 역할 부여를 거부한다', async () => {
    const dto = plainToInstance(UpdateRoleDto, { role: 'developer' });
    const errors = await validate(dto);

    expect(errors).toHaveLength(1);
  });
});
