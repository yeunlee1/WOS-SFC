// Anthropic 번역 호출이 자동 재시도 없이 30초 단일 시도로 제한되는지 검증한다.
import { ConfigService } from '@nestjs/config';
import { TranslateService } from './translate.service';

const mockMessagesCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

describe('TranslateService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'hello' }],
    });
  });

  it('Anthropic 요청을 자동 재시도 없이 최대 30초로 제한한다', async () => {
    const config = {
      get: jest.fn().mockReturnValue('test-api-key'),
    } as unknown as ConfigService;
    const service = new TranslateService(config);

    await expect(service.translate('안녕', 'en')).resolves.toBe('hello');
    expect(mockMessagesCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-haiku-4-5-20251001',
        messages: expect.any(Array),
      }),
      { timeout: 30_000, maxRetries: 0 },
    );
  });
});
