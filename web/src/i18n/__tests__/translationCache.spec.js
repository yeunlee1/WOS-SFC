// 번역 로컬 캐시가 같은 prefix와 길이를 가진 다른 원문을 혼동하지 않는지 검증한다.
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
});
