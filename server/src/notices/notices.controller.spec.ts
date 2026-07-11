// 서버 공지 삭제가 KOR 관리자 역할로 제한되는지 검증한다.
import { ForbiddenException } from '@nestjs/common';
import { NoticesController } from './notices.controller';
import { NoticesService } from './notices.service';

describe('NoticesController 삭제 권한', () => {
  const service = { remove: jest.fn() };
  let controller: NoticesController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new NoticesController(service as unknown as NoticesService);
  });

  it.each([
    { role: 'member', allianceName: 'KOR' },
    { role: 'admin', allianceName: 'NSL' },
    { role: 'developer', allianceName: 'NSL' },
  ])('권한이 부족한 사용자의 삭제를 거부한다', (user) => {
    expect(() => controller.remove(1, { user })).toThrow(ForbiddenException);
    expect(service.remove).not.toHaveBeenCalled();
  });

  it.each(['admin', 'developer'])('KOR %s는 공지를 삭제할 수 있다', (role) => {
    controller.remove(1, { user: { role, allianceName: 'KOR' } });

    expect(service.remove).toHaveBeenCalledWith(1);
  });
});
