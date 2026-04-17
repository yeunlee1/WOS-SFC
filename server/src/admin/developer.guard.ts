import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { User } from '../users/users.entity';

@Injectable()
export class DeveloperGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    return req.user?.role === 'developer';
  }
}
