import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { User, UserRole } from '../../users/users.entity';

const ADMIN_ROLES: UserRole[] = ['admin', 'developer'];

@Injectable()
export class RallyAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const role = req.user?.role;
    if (role && ADMIN_ROLES.includes(role)) return true;
    throw new ForbiddenException();
  }
}
