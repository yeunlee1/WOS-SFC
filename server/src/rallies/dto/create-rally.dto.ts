import { IsString, IsNumber, Min, Max, MaxLength } from 'class-validator';

export class CreateRallyDto {
  @IsString() @MaxLength(100) name: string;
  @IsNumber() @Min(0) endTimeUTC: number;
  @IsNumber() @Min(1) @Max(86400) totalSeconds: number;
}
