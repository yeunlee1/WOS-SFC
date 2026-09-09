// 게시글 단건 번역 서비스가 캐시 적중 시 엔진을 부르지 않고, 미스 시 엔진 1회 후 저장하며, 저장 실패를 삼키는지 검증한다.
import { Logger } from '@nestjs/common';
import { TranslateService } from './translate.service';
import { TranslateEngineService, TranslateProviderError } from './translate-engine.service';
import { TranslationCacheService } from './translation-cache.service';

describe('TranslateService', () => {
  const engine = { translateMulti: jest.fn() };
  const cache = { get: jest.fn(), set: jest.fn() };
  let service: TranslateService;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    cache.get.mockResolvedValue(null);
    cache.set.mockResolvedValue(undefined);
    engine.translateMulti.mockResolvedValue({ source: 'ko', translations: { en: 'hello' } });
    service = new TranslateService(
      engine as unknown as TranslateEngineService,
      cache as unknown as TranslationCacheService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  it('캐시 적중이면 엔진을 부르지 않는다', async () => {
    cache.get.mockResolvedValueOnce('cached');
    await expect(service.translate('안녕', 'en')).resolves.toBe('cached');
    expect(engine.translateMulti).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('미스면 엔진을 대상 1개로 한 번 부르고 결과를 저장한다', async () => {
    await expect(service.translate('안녕', 'en')).resolves.toBe('hello');
    expect(engine.translateMulti).toHaveBeenCalledTimes(1);
    expect(engine.translateMulti).toHaveBeenCalledWith('안녕', ['en']);
    expect(cache.set).toHaveBeenCalledWith('en', '안녕', 'hello');
  });

  it('getCached / translateUncached 를 나눠 쓸 수 있다(컨트롤러의 미스 한도 판단용)', async () => {
    cache.get.mockResolvedValueOnce('cached');
    await expect(service.getCached('안녕', 'en')).resolves.toBe('cached');
    expect(engine.translateMulti).not.toHaveBeenCalled();

    await expect(service.translateUncached('안녕', 'en')).resolves.toBe('hello');
    expect(cache.get).toHaveBeenCalledTimes(1);
    expect(engine.translateMulti).toHaveBeenCalledTimes(1);
  });

  it('캐시 저장 실패는 경고만 남기고 번역문을 돌려준다', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    cache.set.mockRejectedValueOnce(new Error('db down'));
    await expect(service.translate('안녕', 'en')).resolves.toBe('hello');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain('db down');
  });

  it('엔진 오류는 그대로 전파한다', async () => {
    const error = new TranslateProviderError('boom', 500);
    engine.translateMulti.mockRejectedValueOnce(error);
    await expect(service.translate('안녕', 'en')).rejects.toBe(error);
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('엔진이 그 언어를 비워 돌려주면(잘림·빈 문자열) 실패로 던지고 캐시하지 않는다', async () => {
    engine.translateMulti.mockResolvedValueOnce({ source: 'ko', translations: {} });
    await expect(service.translate('안녕', 'en')).rejects.toBeInstanceOf(TranslateProviderError);
    expect(cache.set).not.toHaveBeenCalled();
  });
});
