import { IsIn } from 'class-validator';

// UserRole 타입을 인라인 union으로 — isolatedModules + emitDecoratorMetadata 조합에서
// type-only import는 데코레이터 metadata에 사용 불가. users.entity의 UserRole과 일치 유지.
export class UpdateRoleDto {
  @IsIn(['admin', 'member', 'developer'])
  role: 'admin' | 'member' | 'developer';
}
