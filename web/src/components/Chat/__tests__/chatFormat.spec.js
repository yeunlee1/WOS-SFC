// 채팅 항목 공용 포맷(locale·시간·이니셜)이 ChatTab·ChatDock에서 같은 값을 내는지 검증한다.
import { describe, expect, it } from 'vitest';
import { formatMessageTime, initialsOf, localeFor } from '../chatFormat';

describe('chatFormat', () => {
  it('localeFor는 5개 언어를 알고 그 밖은 en-US', () => {
    expect(localeFor('ko')).toBe('ko-KR');
    expect(localeFor('en')).toBe('en-US');
    expect(localeFor('ja')).toBe('ja-JP');
    expect(localeFor('zh')).toBe('zh-CN');
    expect(localeFor('ru')).toBe('ru-RU');
    expect(localeFor('other')).toBe('en-US');
    expect(localeFor(undefined)).toBe('en-US');
  });

  it('formatMessageTime은 시:분을 주고 없거나 깨진 값은 빈 문자열', () => {
    const iso = '2026-09-10T00:05:00.000Z';
    const expected = new Date(iso).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(formatMessageTime(iso, 'en')).toBe(expected);
    expect(formatMessageTime(undefined, 'en')).toBe('');
    expect(formatMessageTime('not a date', 'en')).toBe('');
  });

  it('initialsOf는 앞 두 글자 대문자, 없으면 ??', () => {
    expect(initialsOf('tester')).toBe('TE');
    expect(initialsOf('테스터')).toBe('테스');
    expect(initialsOf('')).toBe('??');
    expect(initialsOf(undefined)).toBe('??');
  });
});
