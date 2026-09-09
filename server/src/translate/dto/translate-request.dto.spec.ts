// 게시글 단건 번역 DTO 가 빈 문자열·공백만·상한 초과를 거부하는지 검증한다(A-S1).
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { TRANSLATE_TEXT_MAX_LENGTH, TranslateRequestDto } from './translate-request.dto';

async function errorsFor(payload: unknown) {
  return validate(plainToInstance(TranslateRequestDto, payload as object), {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
}

describe('TranslateRequestDto', () => {
  it('상한은 공지·게시글 본문 상한과 같은 2000자다', () => {
    expect(TRANSLATE_TEXT_MAX_LENGTH).toBe(2000);
  });

  it.each(['', '   ', '\n\t'])('빈 문자열·공백만(%p)은 거부한다', async (text) => {
    expect(await errorsFor({ text, targetLang: 'en' })).not.toEqual([]);
  });

  it('상한 초과는 거부하고 정확히 상한은 통과한다', async () => {
    expect(await errorsFor({ text: '가'.repeat(2001), targetLang: 'en' })).not.toEqual([]);
    expect(await errorsFor({ text: '가'.repeat(2000), targetLang: 'en' })).toEqual([]);
  });

  it('targetLang 은 다섯 언어만 허용한다', async () => {
    expect(await errorsFor({ text: '안녕', targetLang: 'other' })).not.toEqual([]);
    expect(await errorsFor({ text: '안녕', targetLang: 'ru' })).toEqual([]);
  });
});
