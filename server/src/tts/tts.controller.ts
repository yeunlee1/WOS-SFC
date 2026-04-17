import { Controller, Get, Param, Res, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { TtsService } from './tts.service';
import { LANGS, PHRASES, isValidTtsKey, getTtsText } from './tts.constants';

// TTS 파일은 숫자 읽기/문구 음성이라 인증 불필요 — HTMLAudioElement는 Authorization 헤더를 보낼 수 없음
@Controller('tts-audio')
export class TtsController {
  constructor(private service: TtsService) {}

  // GET /tts-audio/:lang/:key  → mp3 파일 직접 서빙
  @Get(':lang/:key')
  async serve(
    @Param('lang') lang: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    // 허용 언어 검증
    if (!(LANGS as readonly string[]).includes(lang)) {
      return res.status(HttpStatus.BAD_REQUEST).send('invalid lang');
    }

    // C1: 화이트리스트 검증 — 1~600 숫자 또는 PHRASES 키만 허용
    // 임의 텍스트 전달로 ElevenLabs API 비용 폭탄 방지
    if (!isValidTtsKey(key)) {
      return res.status(HttpStatus.NOT_FOUND).send('not found');
    }

    try {
      const text = getTtsText(lang, key);
      const fp = await this.service.ensureFile(lang, key, text);

      // M7: 숫자는 내용 불변이므로 1년 immutable, 문구는 변경 가능하므로 1일 캐시
      const isPhrase = Boolean(PHRASES[key]);
      const cacheControl = isPhrase
        ? 'public, max-age=86400'              // 문구: 1일
        : 'public, max-age=31536000, immutable'; // 숫자: 1년

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', cacheControl);
      const stream = createReadStream(fp);
      stream.pipe(res);
      return new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
    } catch (e) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: (e as Error).message });
    }
  }
}
