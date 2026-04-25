import { IsIn } from 'class-validator';
import { UserRole } from '../users.entity';

export class UpdateRoleDto {
  @IsIn(['admin', 'member', 'developer'])
  role: UserRole;
}
