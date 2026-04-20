import { IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

export class UpdateBattleSettingsDto {
  @ValidateIf((o) => o.marchSeconds !== null)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  marchSeconds: number | null;
}
