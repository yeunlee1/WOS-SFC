// 채팅 번역 서비스가 대상 집합을 계산하고, 기존 행을 빼고 엔진을 큐로 1회 부르며, 실패를 throw 대신 failed·error 로 돌려주는지 검증한다.
import { Logger } from '@nestjs/common';
import { ChatTranslationService } from './chat-translation.service';
import { MessageTranslationsService } from './message-translations.service';
import { TranslateEngineService, TranslateProviderError } from './translate-engine.service';
import { TranslationQueueService } from './translation-queue.service';
import type { Lang } from './script-detect';

describe('ChatTranslationService', () => {
  const engine = { translateMulti: jest.fn() };
  const store = { getForMessages: jest.fn(), upsertMany: jest.fn() };
  const queue = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };
  let service: ChatTranslationService;
  // 순수 한글 문장이라 unambiguousLang 이 ko 다. 'SFC' 가 섞이면 mixed 라 ko 가 빠지지 않는다.
  const msg = { id: 101, content: '10분 뒤 집결 갑니다' };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    store.getForMessages.mockResolvedValue(new Map());
    store.upsertMany.mockResolvedValue(undefined);
    engine.translateMulti.mockResolvedValue({
      source: 'ko',
      translations: { en: 'Rally to SFC in 10 min', ja: '10分後にSFC集結' },
    });
    service = new ChatTranslationService(
      engine as unknown as TranslateEngineService,
      store as unknown as MessageTranslationsService,
      queue as unknown as TranslationQueueService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  describe('translateForMessage — 대상 집합', () => {
    it('한글 문장은 ko 를 빼고 나머지를 큐를 거쳐 한 번에 번역한다', async () => {
      const result = await service.translateForMessage(msg, new Set<Lang>(['ko', 'en', 'ja']));

      expect(queue.run).toHaveBeenCalledTimes(1);
      expect(engine.translateMulti).toHaveBeenCalledTimes(1);
      expect(engine.translateMulti).toHaveBeenCalledWith(msg.content, ['en', 'ja']);
      expect(result).toEqual({
        translations: { en: 'Rally to SFC in 10 min', ja: '10分後にSFC集結' },
        failed: [],
      });
      expect(store.upsertMany).toHaveBeenCalledWith([
        { messageId: 101, lang: 'en', text: 'Rally to SFC in 10 min' },
        { messageId: 101, lang: 'ja', text: '10分後にSFC集結' },
      ]);
    });

    it('글자가 없으면 엔진·DB 없이 빈 결과다', async () => {
      const result = await service.translateForMessage(
        { id: 1, content: '456,789 👍' },
        new Set<Lang>(['ko', 'en']),
      );
      expect(result).toEqual({ translations: {}, failed: [] });
      expect(engine.translateMulti).not.toHaveBeenCalled();
      expect(store.getForMessages).not.toHaveBeenCalled();
    });

    it('대상이 전부 원문 언어면 엔진 없이 빈 결과다', async () => {
      const result = await service.translateForMessage(msg, new Set<Lang>(['ko']));
      expect(result).toEqual({ translations: {}, failed: [] });
      expect(engine.translateMulti).not.toHaveBeenCalled();
    });

    it('접속자 언어가 없으면 빈 결과다', async () => {
      const result = await service.translateForMessage(msg, new Set<Lang>());
      expect(result).toEqual({ translations: {}, failed: [] });
      expect(engine.translateMulti).not.toHaveBeenCalled();
    });

    it('라틴·혼합 문장은 아무 언어도 빼지 않는다', async () => {
      engine.translateMulti.mockResolvedValueOnce({
        source: 'en',
        translations: { ko: '안녕', en: 'hello there' },
      });
      await service.translateForMessage({ id: 2, content: 'hello there' }, new Set<Lang>(['ko', 'en']));
      expect(engine.translateMulti).toHaveBeenCalledWith('hello there', ['ko', 'en']);
    });
  });

  describe('translateForMessage — 기존 행', () => {
    it('이미 저장된 언어는 빼고 미스만 부르며 결과는 합친다', async () => {
      store.getForMessages.mockResolvedValueOnce(new Map([[101, { en: 'Stored EN' }]]));
      engine.translateMulti.mockResolvedValueOnce({ source: 'ko', translations: { ja: 'JA' } });

      const result = await service.translateForMessage(msg, new Set<Lang>(['en', 'ja']));

      expect(store.getForMessages).toHaveBeenCalledWith([101], ['en', 'ja']);
      expect(engine.translateMulti).toHaveBeenCalledWith(msg.content, ['ja']);
      expect(result).toEqual({ translations: { en: 'Stored EN', ja: 'JA' }, failed: [] });
      expect(store.upsertMany).toHaveBeenCalledWith([{ messageId: 101, lang: 'ja', text: 'JA' }]);
    });

    it('전부 저장돼 있으면 엔진을 부르지 않는다', async () => {
      store.getForMessages.mockResolvedValueOnce(new Map([[101, { en: 'E', ja: 'J' }]]));
      const result = await service.translateForMessage(msg, new Set<Lang>(['en', 'ja']));
      expect(engine.translateMulti).not.toHaveBeenCalled();
      expect(store.upsertMany).not.toHaveBeenCalled();
      expect(result).toEqual({ translations: { en: 'E', ja: 'J' }, failed: [] });
    });

    it('DB 조회가 실패해도 엔진은 부른다', async () => {
      store.getForMessages.mockRejectedValueOnce(new Error('db down'));
      const result = await service.translateForMessage(msg, new Set<Lang>(['en', 'ja']));
      expect(engine.translateMulti).toHaveBeenCalledWith(msg.content, ['en', 'ja']);
      expect(result.failed).toEqual([]);
    });
  });

  describe('translateForMessage — 실패', () => {
    it('429 는 error:limit 이고 미스 전부가 failed 다(기존분은 유지)', async () => {
      store.getForMessages.mockResolvedValueOnce(new Map([[101, { en: 'Stored EN' }]]));
      engine.translateMulti.mockRejectedValueOnce(new TranslateProviderError('limit', 429, 5000));
      const result = await service.translateForMessage(msg, new Set<Lang>(['en', 'ja', 'zh']));
      expect(result).toEqual({
        translations: { en: 'Stored EN' },
        failed: ['ja', 'zh'],
        error: 'limit',
      });
      expect(store.upsertMany).not.toHaveBeenCalled();
    });

    it('큐가 상한으로 거부해도 error:limit 이다', async () => {
      queue.run.mockRejectedValueOnce(new TranslateProviderError('limit', 429, 60_000));
      const result = await service.translateForMessage(msg, new Set<Lang>(['en']));
      expect(result).toEqual({ translations: {}, failed: ['en'], error: 'limit' });
      expect(engine.translateMulti).not.toHaveBeenCalled();
    });

    it('그 밖의 공급자 오류는 error:provider 다', async () => {
      engine.translateMulti.mockRejectedValueOnce(new TranslateProviderError('boom', 500));
      const result = await service.translateForMessage(msg, new Set<Lang>(['en']));
      expect(result).toEqual({ translations: {}, failed: ['en'], error: 'provider' });
    });

    it('예상 밖 예외도 throw 하지 않고 provider 실패로 돌려준다', async () => {
      engine.translateMulti.mockRejectedValueOnce(new Error('unexpected'));
      await expect(service.translateForMessage(msg, new Set<Lang>(['en']))).resolves.toEqual({
        translations: {},
        failed: ['en'],
        error: 'provider',
      });
    });

    it('모델이 한 언어를 비우면 그 언어만 failed 이고 나머지는 저장한다', async () => {
      engine.translateMulti.mockResolvedValueOnce({ source: 'ko', translations: { en: 'EN' } });
      const result = await service.translateForMessage(msg, new Set<Lang>(['en', 'ja']));
      expect(result).toEqual({ translations: { en: 'EN' }, failed: ['ja'] });
      expect(store.upsertMany).toHaveBeenCalledWith([{ messageId: 101, lang: 'en', text: 'EN' }]);
    });

    it('모델이 감지한 source 가 대상에 있고 비어 있으면 원문을 그대로 넣는다', async () => {
      engine.translateMulti.mockResolvedValueOnce({ source: 'en', translations: { ko: '안녕' } });
      const result = await service.translateForMessage(
        { id: 5, content: 'hello' },
        new Set<Lang>(['ko', 'en']),
      );
      expect(result).toEqual({ translations: { ko: '안녕', en: 'hello' }, failed: [] });
    });
  });

  describe('attachHistory', () => {
    it('id 전체와 언어 집합으로 쿼리 1회', async () => {
      const map = new Map([[1, { en: 'a' }]]);
      store.getForMessages.mockResolvedValueOnce(map);
      const result = await service.attachHistory([{ id: 1 }, { id: 2 }], new Set<Lang>(['en', 'ja']));
      expect(store.getForMessages).toHaveBeenCalledTimes(1);
      expect(store.getForMessages).toHaveBeenCalledWith([1, 2], ['en', 'ja']);
      expect(result).toBe(map);
    });

    it('항목이나 언어가 없으면 조회하지 않는다', async () => {
      await expect(service.attachHistory([], new Set<Lang>(['en']))).resolves.toEqual(new Map());
      await expect(service.attachHistory([{ id: 1 }], new Set<Lang>())).resolves.toEqual(new Map());
      expect(store.getForMessages).not.toHaveBeenCalled();
    });

    it('조회 실패는 경고만 남기고 빈 맵이다(히스토리 전송은 계속된다)', async () => {
      store.getForMessages.mockRejectedValueOnce(new Error('db down'));
      await expect(service.attachHistory([{ id: 1 }], new Set<Lang>(['en']))).resolves.toEqual(
        new Map(),
      );
    });
  });
});
