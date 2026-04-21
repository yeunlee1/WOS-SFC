import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { RallyAdminGuard } from './rally-admin.guard';

function makeContext(user: { role?: string } | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RallyAdminGuard', () => {
  let guard: RallyAdminGuard;

  beforeEach(() => {
    guard = new RallyAdminGuard();
  });

  it('role=admin → true 반환', () => {
    const result = guard.canActivate(makeContext({ role: 'admin' }));
    expect(result).toBe(true);
  });

  it('role=developer → true 반환', () => {
    const result = guard.canActivate(makeContext({ role: 'developer' }));
    expect(result).toBe(true);
  });

  it('role=member → ForbiddenException 발생', () => {
    expect(() => guard.canActivate(makeContext({ role: 'member' }))).toThrow(ForbiddenException);
  });

  it('req.user 없음 (미인증) → ForbiddenException 발생', () => {
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });
});
