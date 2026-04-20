import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../../users/users.entity';

@Injectable()
export class RallyAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const role = req.user?.role;
    if (role === 'admin' || role === 'developer') return true;
    throw new ForbiddenException();
  }
}
