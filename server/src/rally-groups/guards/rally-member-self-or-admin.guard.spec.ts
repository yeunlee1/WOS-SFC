import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RallyMemberSelfOrAdminGuard } from './rally-member-self-or-admin.guard';
import { RallyGroupsService } from '../rally-groups.service';

function makeContext(
  user: { id?: number; role?: string } | undefined,
  params: Record<string, string>,
): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user, params }),
    }),
  } as unknown as ExecutionContext;
}

describe('RallyMemberSelfOrAdminGuard', () => {
  let guard: RallyMemberSelfOrAdminGuard;
  let service: { getMemberUserIdInGroup: jest.Mock };

  beforeEach(() => {
    service = { getMemberUserIdInGroup: jest.fn().mockResolvedValue(7) };
    guard = new RallyMemberSelfOrAdminGuard(
      service as unknown as RallyGroupsService,
    );
  });

  it('본인 멤버 row → 통과', async () => {
    service.getMemberUserIdInGroup.mockResolvedValue(7);
    await expect(
      guard.canActivate(
        makeContext({ id: 7, role: 'member' }, { id: 'g1', memberId: 'm1' }),
      ),
    ).resolves.toBe(true);
    expect(service.getMemberUserIdInGroup).toHaveBeenCalledWith('g1', 'm1');
  });

  it('남의 멤버 row → ForbiddenException', async () => {
    service.getMemberUserIdInGroup.mockResolvedValue(99);
    await expect(
      guard.canActivate(
        makeContext({ id: 7, role: 'member' }, { id: 'g1', memberId: 'm2' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('role=admin → 통과', async () => {
    service.getMemberUserIdInGroup.mockResolvedValue(99);
    await expect(
      guard.canActivate(
        makeContext({ id: 1, role: 'admin' }, { id: 'g1', memberId: 'm2' }),
      ),
    ).resolves.toBe(true);
  });

  it('role=developer → 통과', async () => {
    service.getMemberUserIdInGroup.mockResolvedValue(99);
    await expect(
      guard.canActivate(
        makeContext({ id: 1, role: 'developer' }, { id: 'g1', memberId: 'm2' }),
      ),
    ).resolves.toBe(true);
  });

  it('URL의 그룹에 없는 멤버 → 관리자여도 ForbiddenException', async () => {
    service.getMemberUserIdInGroup.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        makeContext({ id: 1, role: 'admin' }, { id: 'g9', memberId: 'm1' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('존재하지 않는 멤버 → ForbiddenException', async () => {
    service.getMemberUserIdInGroup.mockResolvedValue(null);
    await expect(
      guard.canActivate(
        makeContext({ id: 7, role: 'member' }, { id: 'g1', memberId: 'nope' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('req.user 없음 (미인증) → ForbiddenException, DB 조회도 하지 않음', async () => {
    await expect(
      guard.canActivate(makeContext(undefined, { id: 'g1', memberId: 'm1' })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getMemberUserIdInGroup).not.toHaveBeenCalled();
  });

  it('param 누락 → ForbiddenException', async () => {
    await expect(
      guard.canActivate(makeContext({ id: 7, role: 'member' }, {})),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.getMemberUserIdInGroup).not.toHaveBeenCalled();
  });
});
