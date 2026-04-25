import { Test, TestingModule } from '@nestjs/testing';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    })
      // ThrottlerGuard를 우회 — 본 spec은 throttle 동작 자체를 검증하지 않음.
      // app.controller.ts에 @UseGuards(ThrottlerGuard)가 추가되어
      // ThrottlerStorage 등 의존성 주입이 필요해지므로 guard를 mock으로 대체.
      .overrideGuard(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    appController = app.get<AppController>(AppController);
  });

  describe('time', () => {
    it('should return utc timestamp', () => {
      const result = appController.getTime();
      expect(typeof result.utc).toBe('number');
    });

    it('should return t1 and t2 timestamps', () => {
      const before = Date.now();
      const result = appController.getTime();
      const after = Date.now();
      expect(typeof result.t1).toBe('number');
      expect(typeof result.t2).toBe('number');
      expect(result.t1).toBeGreaterThanOrEqual(before);
      expect(result.t2).toBeLessThanOrEqual(after);
    });
  });
});
