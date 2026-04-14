import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('time', () => {
    it('should return utc timestamp', () => {
      const result = appController.getTime();
      expect(typeof result.utc).toBe('number');
    });
  });
});
