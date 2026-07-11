// 번역 공급자 호출 제한이 사용자별로 분리되고 정확한 재시도 시간을 반환하는지 검증한다.
import {
  TRANSLATION_GLOBAL_PROVIDER_RATE_LIMIT,
  TRANSLATION_PROVIDER_RATE_LIMIT,
  TRANSLATION_REQUEST_RATE_LIMIT,
  TranslationRateLimitService,
} from './translation-rate-limit.service';

describe('TranslationRateLimitService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('공급자 miss는 사용자별 10회 이후 남은 차단 시간을 반환한다', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const service = new TranslationRateLimitService();

    for (let index = 0; index < TRANSLATION_PROVIDER_RATE_LIMIT; index += 1) {
      expect(service.consumeProviderMiss(1).allowed).toBe(true);
    }
    expect(service.consumeProviderMiss(1)).toEqual({
      allowed: false,
      retryAfterMs: 60_000,
    });
    expect(service.consumeProviderMiss(2).allowed).toBe(true);

    now.mockReturnValue(1_060_000);
    expect(service.consumeProviderMiss(1).allowed).toBe(true);
  });

  it('엔드포인트 요청은 별도 사용자별 60회 버킷으로 제한한다', () => {
    jest.spyOn(Date, 'now').mockReturnValue(2_000_000);
    const service = new TranslationRateLimitService();

    for (let index = 0; index < TRANSLATION_REQUEST_RATE_LIMIT; index += 1) {
      expect(service.consumeRequest(1).allowed).toBe(true);
    }
    expect(service.consumeRequest(1)).toEqual({
      allowed: false,
      retryAfterMs: 60_000,
    });
    expect(service.consumeRequest(2).allowed).toBe(true);
    expect(service.consumeProviderMiss(1).allowed).toBe(true);
  });

  it('여러 사용자의 공급자 miss 합계도 서버 전체 60회로 제한한다', () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(3_000_000);
    const service = new TranslationRateLimitService();

    for (
      let index = 0;
      index < TRANSLATION_GLOBAL_PROVIDER_RATE_LIMIT;
      index += 1
    ) {
      const userId = Math.floor(index / TRANSLATION_PROVIDER_RATE_LIMIT) + 1;
      expect(service.consumeProviderMiss(userId).allowed).toBe(true);
    }
    expect(service.consumeProviderMiss(999)).toEqual({
      allowed: false,
      retryAfterMs: 60_000,
    });

    now.mockReturnValue(3_060_000);
    expect(service.consumeProviderMiss(999).allowed).toBe(true);
  });
});
