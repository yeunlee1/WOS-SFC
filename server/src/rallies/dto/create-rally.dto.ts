import { IsString, IsNumber, Min, Max, MaxLength } from 'class-validator';

export class CreateRallyDto {
  @IsString() @MaxLength(100) name: string;
  // 약 2033-05-18 UTC — 비정상적으로 먼 미래 타임스탬프 차단
  @IsNumber() @Min(0) @Max(2_000_000_000_000) endTimeUTC: number;
  @IsNumber() @Min(1) @Max(86400) totalSeconds: number;
}
