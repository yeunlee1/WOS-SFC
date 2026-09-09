// 배치 번역 엔드포인트가 기존 행 적중·건너뜀·부분 실패·한도(429)를 계약대로 돌려주고, 사용량 조회가 developer 전용인지 검증한다.
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Logger } from '@nestjs/common';
import { DeveloperGuard } from '../admin/developer.guard';
import { TranslateController } from './translate.controller';
import { TranslateService } from './translate.service';
import { TranslationRateLimitService } from './translation-rate-limit.service';
import { TranslateEngineService, TranslateProviderError } from './translate-engine.service';
import { MessageTranslationsService } from './message-translations.service';
import { TranslationQueueService } from './translation-queue.service';
import { TranslateUsageService } from './translate-usage.service';
import fixtures from '../../../docs/contracts/chat-events.json';

describe('TranslateController — 배치·사용량', () => {
  const service = { getCached: jest.fn(), translateUncached: jest.fn() };
  const rateLimit = {
    consumeRequest: jest.fn(),
    consumeProviderMiss: jest.fn(),
    consumeBatch: jest.fn(),
  };
  const engine = { translateBatch: jest.fn() };
  const store = { getForMessages: jest.fn(), upsertMany: jest.fn() };
  const queue = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };
  const usage = { snapshot: jest.fn() };
  const request = { user: { id: 1, role: 'member' } } as never;
  let controller: TranslateController;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    rateLimit.consumeBatch.mockReturnValue({ allowed: true, retryAfterMs: 0 });
    store.getForMessages.mockResolvedValue(new Map());
    store.upsertMany.mockResolvedValue(undefined);
    engine.translateBatch.mockResolvedValue({});
    controller = new TranslateController(
      service as unknown as TranslateService,
      rateLimit as unknown as TranslationRateLimitService,
      engine as unknown as TranslateEngineService,
      store as unknown as MessageTranslationsService,
      queue as unknown as TranslationQueueService,
      usage as unknown as TranslateUsageService,
    );
  });
  afterEach(() => jest.restoreAllMocks());

  // 픽스처 항목 100은 글자가 없는 텍스트(좌표·이모지)라 hasLetters 규칙으로 skipped 가 된다.
  // 응답은 키 집합·타입뿐 아니라 값까지 픽스처 translate:batch:response 와 같아야 한다.
  it('계약 픽스처 요청을 넣으면 응답이 픽스처 translate:batch:response 와 같다', async () => {
    engine.translateBatch.mockResolvedValueOnce({
      101: { source: 'ko', text: 'Rally to SFC in 10 min' },
    });
    const body = fixtures['translate:batch:request'];

    const response = JSON.parse(JSON.stringify(await controller.translateBatch(body as never, request)));

    expect(Object.keys(response).sort()).toEqual(Object.keys(fixtures['translate:batch:response']).sort());
    expect(Array.isArray(response.skipped)).toBe(true);
    expect(Array.isArray(response.failed)).toBe(true);
    for (const [id, text] of Object.entries(response.translated)) {
      expect(Number.isInteger(Number(id))).toBe(true);
      expect(typeof text).toBe('string');
    }
    expect(response).toEqual(fixtures['translate:batch:response']);
    expect(rateLimit.consumeBatch).toHaveBeenCalledWith(1);
    expect(store.getForMessages).toHaveBeenCalledWith([101], ['en']);
    expect(engine.translateBatch).toHaveBeenCalledWith(
      [{ id: 101, text: body.items[1].text }],
      'en',
    );
    expect(store.upsertMany).toHaveBeenCalledWith([
      { messageId: 101, lang: 'en', text: 'Rally to SFC in 10 min' },
    ]);
  });

  it('원문이 이미 대상 언어(단일 스크립트)거나 글자가 없으면 skipped 다', async () => {
    const response = await controller.translateBatch(
      {
        targetLang: 'ko',
        items: [
          { id: 1, text: '안녕하세요' },
          { id: 2, text: '123 👍' },
          { id: 3, text: 'hello' },
        ],
      } as never,
      request,
    );
    expect(response.skipped).toEqual([1, 2]);
    expect(engine.translateBatch).toHaveBeenCalledWith([{ id: 3, text: 'hello' }], 'ko');
  });

  it('기존 행 적중은 엔진에 보내지 않고 translated 에 바로 넣는다', async () => {
    store.getForMessages.mockResolvedValueOnce(new Map([[1, { en: 'Stored' }]]));
    engine.translateBatch.mockResolvedValueOnce({ 2: { source: 'ko', text: 'Fresh' } });
    const response = await controller.translateBatch(
      { targetLang: 'en', items: [{ id: 1, text: '집결' }, { id: 2, text: '화로' }] } as never,
      request,
    );
    expect(engine.translateBatch).toHaveBeenCalledWith([{ id: 2, text: '화로' }], 'en');
    expect(response).toEqual({ translated: { 1: 'Stored', 2: 'Fresh' }, skipped: [], failed: [] });
    expect(store.upsertMany).toHaveBeenCalledWith([{ messageId: 2, lang: 'en', text: 'Fresh' }]);
  });

  it('전부 적중이거나 전부 건너뜀이면 엔진을 부르지 않는다', async () => {
    store.getForMessages.mockResolvedValueOnce(new Map([[1, { en: 'Stored' }]]));
    await controller.translateBatch({ targetLang: 'en', items: [{ id: 1, text: '집결' }] } as never, request);
    await controller.translateBatch({ targetLang: 'ko', items: [{ id: 2, text: '집결' }] } as never, request);
    expect(engine.translateBatch).not.toHaveBeenCalled();
    expect(queue.run).not.toHaveBeenCalled();
  });

  it('엔진이 text null 을 준 항목은 failed 다(부분 실패)', async () => {
    engine.translateBatch.mockResolvedValueOnce({
      1: { source: 'ko', text: 'A' },
      2: { source: 'unknown', text: null },
    });
    const response = await controller.translateBatch(
      { targetLang: 'en', items: [{ id: 1, text: '집결' }, { id: 2, text: '화로' }] } as never,
      request,
    );
    expect(response).toEqual({ translated: { 1: 'A' }, skipped: [], failed: [2] });
    expect(store.upsertMany).toHaveBeenCalledWith([{ messageId: 1, lang: 'en', text: 'A' }]);
  });

  // 2026-09-10 E2E 핫픽스 — SFC 가 섞인 한국어는 mixed 라 ko 대상에서 skipped 가 아니다. 모델이 source:ko 로
  // 용어만 치환한 문자열을 돌려줘도 ko 결과는 원문이어야 한다(웹은 원문과 같으면 원문 상태로 표시한다).
  it('엔진이 source === target 으로 돌려준 항목은 모델 출력과 무관하게 원문이다', async () => {
    const text = '10분 뒤 SFC 집결 갑니다. 창병 위주로 넣어주세요.';
    engine.translateBatch.mockResolvedValueOnce({
      7: { source: 'ko', text: '10분 뒤 SFC rally 갑니다. 창병 위주로 넣어주세요.' },
    });
    const response = await controller.translateBatch(
      { targetLang: 'ko', items: [{ id: 7, text }] } as never,
      request,
    );
    expect(engine.translateBatch).toHaveBeenCalledWith([{ id: 7, text }], 'ko');
    expect(response).toEqual({ translated: { 7: text }, skipped: [], failed: [] });
    expect(store.upsertMany).toHaveBeenCalledWith([{ messageId: 7, lang: 'ko', text }]);
  });

  it('source === target 인데 text 가 비어도 원문이다(failed 아님)', async () => {
    const text = 'SFC 집결 go';
    engine.translateBatch.mockResolvedValueOnce({ 8: { source: 'ko', text: null } });
    const response = await controller.translateBatch(
      { targetLang: 'ko', items: [{ id: 8, text }] } as never,
      request,
    );
    expect(response).toEqual({ translated: { 8: text }, skipped: [], failed: [] });
  });

  it('공급자 오류(429 아님)는 미스 전부를 failed 로 돌려준다(픽스처 failed 형태)', async () => {
    engine.translateBatch.mockRejectedValueOnce(new TranslateProviderError('boom', 500));
    const response = await controller.translateBatch(
      { targetLang: 'en', items: [{ id: 100, text: '집결' }, { id: 101, text: '화로' }] } as never,
      request,
    );
    expect(JSON.parse(JSON.stringify(response))).toEqual(fixtures['translate:batch:response:failed']);
  });

  it('사용자 배치 한도를 넘으면 message·retryAfterMs 가 있는 429 다', async () => {
    rateLimit.consumeBatch.mockReturnValueOnce({ allowed: false, retryAfterMs: 12_000 });
    const error = await controller
      .translateBatch({ targetLang: 'en', items: [{ id: 1, text: '집결' }] } as never, request)
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 429 });
    expect(JSON.parse(JSON.stringify((error as { response: unknown }).response))).toEqual(
      fixtures['translate:429'],
    );
    expect(store.getForMessages).not.toHaveBeenCalled();
    expect(engine.translateBatch).not.toHaveBeenCalled();
  });

  it('전역 큐 상한(429)도 retryAfterMs 가 있는 429 다', async () => {
    queue.run.mockRejectedValueOnce(new TranslateProviderError('limit', 429, 30_000));
    await expect(
      controller.translateBatch({ targetLang: 'en', items: [{ id: 1, text: '집결' }] } as never, request),
    ).rejects.toMatchObject({ status: 429, response: expect.objectContaining({ retryAfterMs: 30_000 }) });
  });

  it('GET /translate/usage 는 DeveloperGuard 가 붙어 있고 스냅샷을 돌려준다', () => {
    const guards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller.usage) ?? [];
    expect(guards).toContain(DeveloperGuard);
    usage.snapshot.mockReturnValue({ calls: 3 });
    expect(controller.usage()).toEqual({ calls: 3 });
  });

  it('DeveloperGuard 는 developer 가 아니면 거부한다(403 경로)', () => {
    const guard = new DeveloperGuard();
    const ctx = (role: string) =>
      ({ switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }) }) as never;
    expect(guard.canActivate(ctx('member'))).toBe(false);
    expect(guard.canActivate(ctx('admin'))).toBe(false);
    expect(guard.canActivate(ctx('developer'))).toBe(true);
  });
});
