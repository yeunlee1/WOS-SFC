// 전역 번역 큐가 동시 4개를 넘기지 않고, 분당 상한을 넘으면 즉시 limit 오류를 내는지 검증한다.
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_TRANSLATE_GLOBAL_RPM,
  TRANSLATION_QUEUE_CONCURRENCY,
  TRANSLATION_QUEUE_WINDOW_MS,
  TranslationQueueService,
} from './translation-queue.service';
import { TranslateProviderError } from './translate-engine.service';

function makeQueue(rpm?: string) {
  const config = {
    get: jest.fn((key: string) => (key === 'TRANSLATE_GLOBAL_RPM' ? rpm : undefined)),
  } as unknown as ConfigService;
  return new TranslationQueueService(config);
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('TranslationQueueService', () => {
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('동시 실행은 4개까지이고 하나가 끝나야 다음이 시작한다', async () => {
    const queue = makeQueue();
    const gates = Array.from({ length: 5 }, () => deferred<string>());
    const started: number[] = [];
    const runs = gates.map((gate, index) =>
      queue.run(() => {
        started.push(index);
        return gate.promise;
      }),
    );
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3]);
    expect(TRANSLATION_QUEUE_CONCURRENCY).toBe(4);

    gates[1].resolve('b');
    await runs[1];
    await Promise.resolve();
    expect(started).toEqual([0, 1, 2, 3, 4]);

    gates.forEach((g, i) => g.resolve(String(i)));
    await expect(Promise.all(runs)).resolves.toEqual(['0', 'b', '2', '3', '4']);
  });

  it('실패한 작업도 자리를 비워 다음 작업이 시작한다', async () => {
    const queue = makeQueue();
    const gates = Array.from({ length: 5 }, () => deferred<string>());
    const runs = gates.map((gate) => queue.run(() => gate.promise));
    gates[0].reject(new Error('boom'));
    await expect(runs[0]).rejects.toThrow('boom');
    gates.slice(1).forEach((g, i) => g.resolve(String(i)));
    await expect(Promise.all(runs.slice(1))).resolves.toEqual(['0', '1', '2', '3']);
  });

  it('분당 상한을 넘기면 실행 없이 즉시 429 limit 오류다', async () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const queue = makeQueue('2');
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(queue.run(fn)).resolves.toBe('ok');
    await expect(queue.run(fn)).resolves.toBe('ok');
    const error = await queue.run(fn).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TranslateProviderError);
    expect(error).toMatchObject({ message: 'limit', status: 429, retryAfterMs: 60_000 });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('창이 지나면 다시 허용한다', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const queue = makeQueue('1');
    const fn = jest.fn().mockResolvedValue('ok');
    await expect(queue.run(fn)).resolves.toBe('ok');
    await expect(queue.run(fn)).rejects.toMatchObject({ status: 429 });
    now.mockReturnValue(1_000_000 + TRANSLATION_QUEUE_WINDOW_MS + 1);
    await expect(queue.run(fn)).resolves.toBe('ok');
  });

  it.each([undefined, '', 'abc', '0', '-5', '1.5'])(
    'TRANSLATE_GLOBAL_RPM 이 %p 이면 기본값 120 이다',
    (raw) => {
      expect(makeQueue(raw as string | undefined).rpm).toBe(DEFAULT_TRANSLATE_GLOBAL_RPM);
      expect(DEFAULT_TRANSLATE_GLOBAL_RPM).toBe(120);
    },
  );

  it('TRANSLATE_GLOBAL_RPM 정수를 읽는다', () => {
    expect(makeQueue('30').rpm).toBe(30);
  });
});
