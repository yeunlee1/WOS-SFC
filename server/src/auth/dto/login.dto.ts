import { IsString, MinLength, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString() @MaxLength(50) nickname: string;
  @IsString() @MinLength(6) @MaxLength(100) password: string;
}
