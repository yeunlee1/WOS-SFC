// POST /translate(게시글·공지 단건) 요청. 빈 문자열·공백만은 거부하고 상한은 공지 본문 상한과 같다(A-S1).
import { IsIn, IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { TARGET_LANGS } from '../script-detect';

/** 게시글 본문 1000자(boards DTO)·공지 본문 2000자(notices·alliance-notices DTO) 중 큰 쪽. */
export const TRANSLATE_TEXT_MAX_LENGTH = 2000;

export class TranslateRequestDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/\S/, { message: 'text 는 공백만일 수 없습니다' })
  @MaxLength(TRANSLATE_TEXT_MAX_LENGTH)
  text: string;

  @IsIn(TARGET_LANGS)
  targetLang: string;
}
