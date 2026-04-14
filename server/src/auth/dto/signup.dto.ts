import { IsString, IsEnum, IsDateString, MinLength, IsIn } from 'class-validator';
import { LANGUAGES } from '../../users/users.entity';
import type { UserRole, Language } from '../../users/users.entity';

export class SignupDto {
  @IsString() nickname: string;
  @IsString() @MinLength(6) password: string;
  @IsString() allianceName: string;
  @IsEnum(['admin', 'member', 'developer']) role: UserRole;
  @IsDateString() birthDate: string;
  @IsString() name: string;
  @IsIn(LANGUAGES) language: Language;
  @IsString() serverCode: string;
}
