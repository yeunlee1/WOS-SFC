import { IsString, MinLength, IsIn, MaxLength, Matches } from 'class-validator';
import { LANGUAGES } from '../../users/users.entity';
import type { Language } from '../../users/users.entity';

// 닉네임 정책: 한글/영문/숫자만, 2~20자. 특수문자·공백 금지.
// (게임 닉네임 = 로그인 ID)
// 닉네임 정규식 — server/web 양쪽이 동일해야 함. 한쪽만 바꾸면 silent divergence 발생.
const NICKNAME_REGEX = /^[A-Za-z0-9가-힣]{2,20}$/;

export class SignupDto {
  @IsString()
  @MinLength(2, { message: '닉네임은 2자 이상이어야 합니다' })
  @MaxLength(20)
  @Matches(NICKNAME_REGEX, {
    message:
      '닉네임은 한글 또는 영문/숫자만 사용할 수 있습니다 (2~20자, 특수문자·공백 불가)',
  })
  nickname: string;

  @IsString() @MinLength(6) @MaxLength(100) password: string;
  @IsString() @MaxLength(100) allianceName: string;
  @IsIn(LANGUAGES) language: Language;
  @IsString() @MaxLength(20) serverCode: string;
}
