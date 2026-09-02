// 집결 그룹 멤버의 행군 시간 override를 "본인 또는 관리자"만 건드리도록 막는 가드
import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { User, UserRole } from '../../users/users.entity';
import { RallyGroupsService } from '../rally-groups.service';

const ADMIN_ROLES: UserRole[] = ['admin', 'developer'];

@Injectable()
export class RallyMemberSelfOrAdminGuard implements CanActivate {
  constructor(private readonly service: RallyGroupsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context
      .switchToHttp()
      .getRequest<Request & { user?: User }>();
    const user = req.user;
    if (!user) throw new ForbiddenException();

    const params = (req.params ?? {}) as Record<string, string | undefined>;
    const groupId = params.id;
    const memberId = params.memberId;
    if (!groupId || !memberId) throw new ForbiddenException();

    // URL의 그룹에 실제로 속한 멤버여야 한다.
    // 이 확인이 없으면 :id가 무시되어 다른 그룹의 memberId로도 요청이 통한다.
    // 존재 여부를 알려주지 않도록 404가 아니라 403으로 막는다.
    const ownerUserId = await this.service.getMemberUserIdInGroup(
      groupId,
      memberId,
    );
    if (ownerUserId === null) throw new ForbiddenException();

    if (user.role && ADMIN_ROLES.includes(user.role)) return true;
    if (ownerUserId !== user.id) throw new ForbiddenException();
    return true;
  }
}
