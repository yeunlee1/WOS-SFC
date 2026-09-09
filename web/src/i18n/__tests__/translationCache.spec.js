// 번역 로컬 캐시(게시글용)가 원문을 혼동하지 않고, 공급자 전환 뒤 옛 항목을 읽지 않는지 검증한다.
import { beforeEach, describe, expect, it } from 'vitest';
import { cacheTranslation, getCachedTranslation } from '../index';

describe('translation local cache', () => {
  beforeEach(() => localStorage.clear());

  it('앞 80자와 길이가 같아도 전체 원문이 다르면 별도 키를 사용한다', () => {
    const prefix = '가'.repeat(80);
    const first = `${prefix}A`;
    const second = `${prefix}B`;

    cacheTranslation(first, 'en', 'first translation');

    expect(getCachedTranslation(first, 'en')).toBe('first translation');
    expect(getCachedTranslation(second, 'en')).toBeNull();
  });

  // C-10: 공급자를 OpenAI로 바꾸면서 키 버전을 v3로 올린다. v2 항목은 읽히지 않아야 한다.
  it('v2 키로 저장된 옛 번역은 읽지 않는다', () => {
    localStorage.setItem(
      'wos-trans-cache',
      JSON.stringify({ [JSON.stringify(['v2', 'en', '안녕'])]: 'old hello' }),
    );

    expect(getCachedTranslation('안녕', 'en')).toBeNull();

    cacheTranslation('안녕', 'en', 'hello');
    const stored = JSON.parse(localStorage.getItem('wos-trans-cache'));
    expect(Object.keys(stored)).toContain(JSON.stringify(['v3', 'en', '안녕']));
  });
});
