import { IsString, IsNumber, IsOptional, Min, Max, MaxLength } from 'class-validator';

export class CreateMemberDto {
  @IsString() @MaxLength(100) name: string;
  @IsNumber() @IsOptional() @Min(0) @Max(86400) normalSeconds?: number;
  @IsNumber() @IsOptional() @Min(0) @Max(86400) petSeconds?: number;
  @IsString() @IsOptional() @MaxLength(100) role?: string;
  @IsString() @IsOptional() @MaxLength(200) notes?: string;
}
