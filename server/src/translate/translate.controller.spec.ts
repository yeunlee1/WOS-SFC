// 번역 API가 성공 계약을 유지하고 캐시 적중·동시 요청 합치기·한도·공급자 오류 전파를 지키는지 검증한다.
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
import { TranslationRateLimitService } from './translation-rate-limit.service';

describe('TranslateController', () => {
  const service = { getCached: jest.fn(), translateUncached: jest.fn() };
  const rateLimit = {
    consumeRequest: jest.fn(),
    consumeProviderMiss: jest.fn(),
  };
  let controller: TranslateController;
  const request = { user: { id: 1 } } as never;

  beforeEach(() => {
    jest.clearAllMocks();
    service.getCached.mockResolvedValue(null);
    rateLimit.consumeRequest.mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });
    rateLimit.consumeProviderMiss.mockReturnValue({
      allowed: true,
      retryAfterMs: 0,
    });
    controller = new TranslateController(
      service as unknown as TranslateService,
      rateLimit as unknown as TranslationRateLimitService,
    );
  });

  it('성공 시 translated 응답을 반환한다', async () => {
    service.translateUncached.mockResolvedValue('hello');

    await expect(
      controller.translate({ text: '안녕', targetLang: 'en' }, request),
    ).resolves.toEqual({ translated: 'hello' });
    expect(service.translateUncached).toHaveBeenCalledWith('안녕', 'en');
    expect(rateLimit.consumeRequest).toHaveBeenCalledWith(1);
    expect(rateLimit.consumeProviderMiss).toHaveBeenCalledWith(1);
  });

  it('서버 캐시가 있으면 외부 번역 공급자를 호출하지 않는다', async () => {
    service.getCached.mockResolvedValue('cached hello');

    await expect(
      controller.translate({ text: '안녕', targetLang: 'en' }, request),
    ).resolves.toEqual({ translated: 'cached hello' });
    expect(service.translateUncached).not.toHaveBeenCalled();
    expect(rateLimit.consumeRequest).toHaveBeenCalledWith(1);
    expect(rateLimit.consumeProviderMiss).not.toHaveBeenCalled();
  });

  it('동일한 동시 요청은 외부 번역 호출 하나를 공유한다', async () => {
    let resolveTranslation: (value: string) => void = () => undefined;
    service.translateUncached.mockReturnValue(
      new Promise<string>((resolve) => {
        resolveTranslation = resolve;
      }),
    );

    const first = controller.translate(
      { text: '동시 요청', targetLang: 'en' },
      request,
    );
    const second = controller.translate(
      { text: '동시 요청', targetLang: 'en' },
      request,
    );
    await Promise.resolve();
    resolveTranslation('shared');

    await expect(Promise.all([first, second])).resolves.toEqual([
      { translated: 'shared' },
      { translated: 'shared' },
    ]);
    expect(service.translateUncached).toHaveBeenCalledTimes(1);
    expect(rateLimit.consumeRequest).toHaveBeenCalledTimes(2);
    expect(rateLimit.consumeProviderMiss).toHaveBeenCalledTimes(1);
  });

  it('실패한 뒤의 같은 요청은 공급자를 다시 부른다(pending 정리)', async () => {
    service.translateUncached
      .mockRejectedValueOnce(new Error('provider unavailable'))
      .mockResolvedValueOnce('hello');

    await expect(
      controller.translate({ text: '안녕', targetLang: 'en' }, request),
    ).rejects.toThrow('provider unavailable');
    await expect(
      controller.translate({ text: '안녕', targetLang: 'en' }, request),
    ).resolves.toEqual({ translated: 'hello' });
    expect(service.translateUncached).toHaveBeenCalledTimes(2);
  });

  it('공급자 miss 한도를 넘으면 retryAfterMs가 있는 429를 반환한다', async () => {
    rateLimit.consumeProviderMiss.mockReturnValue({
      allowed: false,
      retryAfterMs: 42_000,
    });

    await expect(
      controller.translate({ text: '새 요청', targetLang: 'en' }, request),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ retryAfterMs: 42_000 }),
    });
    expect(service.translateUncached).not.toHaveBeenCalled();
  });

  it('엔드포인트 요청 한도는 캐시 조회 전에 429를 반환한다', async () => {
    rateLimit.consumeRequest.mockReturnValue({
      allowed: false,
      retryAfterMs: 12_000,
    });

    await expect(
      controller.translate({ text: '차단 요청', targetLang: 'en' }, request),
    ).rejects.toMatchObject({
      status: 429,
      response: expect.objectContaining({ retryAfterMs: 12_000 }),
    });
    expect(service.getCached).not.toHaveBeenCalled();
    expect(rateLimit.consumeProviderMiss).not.toHaveBeenCalled();
    expect(service.translateUncached).not.toHaveBeenCalled();
  });

  it('공급자 오류를 200 error payload로 바꾸지 않고 그대로 전파한다', async () => {
    const providerError = new Error('provider unavailable');
    service.translateUncached.mockRejectedValue(providerError);

    await expect(
      controller.translate({ text: '안녕', targetLang: 'en' }, request),
    ).rejects.toBe(providerError);
  });
});
