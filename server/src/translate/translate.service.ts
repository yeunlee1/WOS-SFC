import { Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { ConfigService } from '@nestjs/config';

const LANG_NAMES: Record<string, string> = {
  ko: '한국어',
  en: 'English',
  ja: '日本語',
  zh: '中文(简体)',
  ru: 'Русский',
};

@Injectable()
export class TranslateService {
  private client: Anthropic;

  constructor(private config: ConfigService) {
    this.client = new Anthropic({
      apiKey: this.config.get<string>('ANTHROPIC_API_KEY'),
    });
  }

  async translate(text: string, targetLang: string): Promise<string> {
    const targetName = LANG_NAMES[targetLang] || targetLang;
    const msg = await this.client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Translate the following text to ${targetName}. Output only the translated text, no explanations:\n\n${text}`,
        },
      ],
    });
    return (msg.content[0] as Anthropic.TextBlock).text;
  }
}
