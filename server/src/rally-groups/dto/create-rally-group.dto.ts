import { IsString, Length, IsBoolean, IsOptional } from 'class-validator';

export class CreateRallyGroupDto {
  @IsString()
  @Length(1, 40)
  name: string;

  @IsBoolean()
  @IsOptional()
  broadcastAll?: boolean;
}
