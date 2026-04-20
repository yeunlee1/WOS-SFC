import { IsInt, Min, Max, IsOptional } from 'class-validator';

export class UpdateMarchOverrideDto {
  @IsInt()
  @Min(0)
  @Max(180)
  @IsOptional()
  marchSecondsOverride: number | null;
}
