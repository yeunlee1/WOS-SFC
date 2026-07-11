// 번역 캐시 조회 응답이 프론트 계약인 translated 객체 형태인지 검증한다.
import { TranslationsController } from './translations.controller';
import { TranslationsService } from './translations.service';

describe('TranslationsController 캐시 조회', () => {
  it.each([
    ['cached text', { translated: 'cached text' }],
    [null, { translated: null }],
  ])('서비스 결과를 translated 필드로 감싼다', async (value, expected) => {
    const service = { get: jest.fn().mockResolvedValue(value) };
    const controller = new TranslationsController(
      service as unknown as TranslationsService,
    );

    await expect(controller.get('cache-key')).resolves.toEqual(expected);
  });
});
