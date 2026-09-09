// 메시지 표시 상태(원문·번역·대기·실패)를 고르는 순수 셀렉터를 검증한다.
import { describe, expect, it } from 'vitest';
import { selectDisplay } from '../display';

const msg = { id: 1, content: '집결 갑니다', language: 'ko' };

describe('selectDisplay', () => {
  it('자동번역 off면 항상 원문', () => {
    expect(
      selectDisplay(msg, { en: 'Rally' }, 'en', false, true, true),
    ).toEqual({ state: 'original', text: '집결 갑니다', original: '집결 갑니다' });
  });

  it('내 언어 번역이 있으면 translated, 번역문이 원문과 같으면 original', () => {
    expect(selectDisplay(msg, { en: 'Rally' }, 'en', true, false, false)).toEqual({
      state: 'translated',
      text: 'Rally',
      original: '집결 갑니다',
    });
    expect(
      selectDisplay(msg, { en: '집결 갑니다' }, 'en', true, true, false).state,
    ).toBe('original');
  });

  it('번역이 없고 failed면 failed, pending이면 pending, 둘 다 아니면 original', () => {
    expect(selectDisplay(msg, undefined, 'en', true, true, true).state).toBe('failed');
    expect(selectDisplay(msg, { ja: 'x' }, 'en', true, true, false).state).toBe('pending');
    expect(selectDisplay(msg, {}, 'en', true, false, false).state).toBe('original');
  });

  it('translated가 failed·pending보다 우선한다', () => {
    expect(selectDisplay(msg, { en: 'Rally' }, 'en', true, true, true).state).toBe(
      'translated',
    );
  });

  it('UI 언어 other·미지는 en 번역을 고른다', () => {
    expect(selectDisplay(msg, { en: 'Rally' }, 'other', true, false, false).text).toBe(
      'Rally',
    );
    expect(selectDisplay(msg, { en: 'Rally' }, undefined, true, false, false).text).toBe(
      'Rally',
    );
  });

  it('content가 없어도 터지지 않는다', () => {
    expect(selectDisplay({ id: 2 }, undefined, 'en', true, false, false)).toEqual({
      state: 'original',
      text: '',
      original: '',
    });
  });
});
