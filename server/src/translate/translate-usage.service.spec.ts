// 번역 사용량 카운터가 호출별 토큰·시간을 누적하고 스냅샷으로 노출하는지 검증한다.
import { Logger } from '@nestjs/common';
import { TranslateUsageService } from './translate-usage.service';

describe('TranslateUsageService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('초기 스냅샷은 0이고 since 가 ISO 시각이다', () => {
    const service = new TranslateUsageService();
    const snap = service.snapshot();
    expect(snap).toEqual({
      calls: 0,
      inputTokens: 0,
      cachedTokens: 0,
      outputTokens: 0,
      totalMs: 0,
      since: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(snap.since))).toBe(false);
  });

  it('record 가 호출 수·토큰·시간을 누적한다', () => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = new TranslateUsageService();
    service.record({ inputTokens: 100, cachedTokens: 20, outputTokens: 30, ms: 500, targets: 2 });
    service.record({ inputTokens: 50, cachedTokens: 0, outputTokens: 10, ms: 250, targets: 1 });
    expect(service.snapshot()).toMatchObject({
      calls: 2,
      inputTokens: 150,
      cachedTokens: 20,
      outputTokens: 40,
      totalMs: 750,
    });
  });

  it('호출마다 토큰·대상 수·소요 ms 를 로그로 남긴다', () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = new TranslateUsageService();
    service.record({ inputTokens: 123, cachedTokens: 4, outputTokens: 56, ms: 789, targets: 3 });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0][0]);
    for (const token of ['123', '4', '56', '789', '3']) {
      expect(line).toContain(token);
    }
  });
});
