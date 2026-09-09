// 게시글 단건 번역의 2단 캐시(메모리 LRU → DB)가 키 버전·적중·만료·상한을 지키는지 검증한다.
import {
  TRANSLATION_MEMORY_CACHE_MAX,
  TRANSLATION_MEMORY_CACHE_TTL_MS,
  TranslationCacheService,
} from './translation-cache.service';
import { TranslateEngineService } from './translate-engine.service';
import { TranslationsService } from '../translations/translations.service';

function makeCache(model = 'gpt-5.4-mini') {
  const engine = { cacheVersion: `openai:${model}:v2` };
  const db = { get: jest.fn().mockResolvedValue(null), set: jest.fn().mockResolvedValue(undefined) };
  const cache = new TranslationCacheService(
    engine as unknown as TranslateEngineService,
    db as unknown as TranslationsService,
  );
  return { cache, db, engine };
}

describe('TranslationCacheService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('키는 translate:{lang}:sha256 형태이고 해시 입력에 모델 버전이 들어간다', () => {
    const a = makeCache('gpt-5.4-mini').cache.makeKey('en', '안녕');
    const b = makeCache('gpt-5.4-nano').cache.makeKey('en', '안녕');
    expect(a).toMatch(/^translate:en:[0-9a-f]{64}$/);
    expect(b).toMatch(/^translate:en:[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
    expect(makeCache().cache.makeKey('ja', '안녕')).not.toBe(a);
    expect(makeCache().cache.makeKey('en', '안녕')).toBe(a);
  });

  it('version 은 엔진의 캐시 버전이다', () => {
    expect(makeCache('m1').cache.version).toBe('openai:m1:v2');
  });

  it('메모리 적중이면 DB 를 조회하지 않는다', async () => {
    const { cache, db } = makeCache();
    await cache.set('en', '안녕', 'hello');
    await expect(cache.get('en', '안녕')).resolves.toBe('hello');
    expect(db.get).not.toHaveBeenCalled();
    expect(db.set).toHaveBeenCalledWith(cache.makeKey('en', '안녕'), 'hello');
  });

  it('메모리 미스면 DB 를 1회 조회하고 적중분을 메모리에 올린다', async () => {
    const { cache, db } = makeCache();
    db.get.mockResolvedValueOnce('from-db');
    await expect(cache.get('en', '안녕')).resolves.toBe('from-db');
    await expect(cache.get('en', '안녕')).resolves.toBe('from-db');
    expect(db.get).toHaveBeenCalledTimes(1);
    expect(db.get).toHaveBeenCalledWith(cache.makeKey('en', '안녕'));
  });

  it('DB 에도 없으면 null 이고 메모리에 null 을 올리지 않는다', async () => {
    const { cache, db } = makeCache();
    await expect(cache.get('en', '없음')).resolves.toBeNull();
    await expect(cache.get('en', '없음')).resolves.toBeNull();
    expect(db.get).toHaveBeenCalledTimes(2);
  });

  it('메모리 항목은 30분 뒤 만료되어 DB 를 다시 본다', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-10T00:00:00Z'));
    const { cache, db } = makeCache();
    await cache.set('en', '안녕', 'hello');
    jest.advanceTimersByTime(TRANSLATION_MEMORY_CACHE_TTL_MS + 1);
    db.get.mockResolvedValueOnce('hello-db');
    await expect(cache.get('en', '안녕')).resolves.toBe('hello-db');
    expect(db.get).toHaveBeenCalledTimes(1);
  });

  it('메모리 상한(2000)을 넘으면 가장 오래된 항목부터 버린다', async () => {
    const { cache, db } = makeCache();
    for (let i = 0; i <= TRANSLATION_MEMORY_CACHE_MAX; i += 1) {
      await cache.set('en', `t${i}`, `v${i}`);
    }
    await cache.get('en', 't0');
    expect(db.get).toHaveBeenCalledTimes(1);
    db.get.mockClear();
    await cache.get('en', `t${TRANSLATION_MEMORY_CACHE_MAX}`);
    await cache.get('en', 't1');
    expect(db.get).not.toHaveBeenCalled();
  });

  it('DB 저장 실패는 그대로 던진다(호출자가 로그만 남기고 번역문을 돌려준다)', async () => {
    const { cache, db } = makeCache();
    db.set.mockRejectedValueOnce(new Error('db down'));
    await expect(cache.set('en', '안녕', 'hello')).rejects.toThrow('db down');
    // 메모리에는 올라가 있어 같은 프로세스 안에서는 적중한다.
    await expect(cache.get('en', '안녕')).resolves.toBe('hello');
  });
});
