import { IsBoolean, IsOptional } from 'class-validator';

/**
 * 집결 그룹 생성 DTO — name 필드는 서버에서 자동 할당(`${displayOrder}번 집결그룹`)하므로 제거.
 * 클라이언트는 broadcastAll만 선택적으로 전달.
 */
export class CreateRallyGroupDto {
  @IsBoolean()
  @IsOptional()
  broadcastAll?: boolean;
}
