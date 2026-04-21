import { IsInt, Min, Max, ValidateIf } from 'class-validator';

export class UpdateMarchOverrideDto {
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(180)
  marchSecondsOverride: number | null;
}
