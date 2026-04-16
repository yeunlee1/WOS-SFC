import { IsString, IsDateString, MinLength, IsIn, MaxLength } from 'class-validator';
import { LANGUAGES } from '../../users/users.entity';
import type { Language } from '../../users/users.entity';

export class SignupDto {
  @IsString() @MaxLength(50) nickname: string;
  @IsString() @MinLength(6) @MaxLength(100) password: string;
  @IsString() @MaxLength(100) allianceName: string;
  // role 필드 제거 — 서버가 항상 'member'로 고정
  @IsDateString() birthDate: string;
  @IsString() @MaxLength(100) name: string;
  @IsIn(LANGUAGES) language: Language;
  @IsString() @MaxLength(20) serverCode: string;
}
