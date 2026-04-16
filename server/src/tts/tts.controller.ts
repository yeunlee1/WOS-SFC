import { Controller, Get, Param, Res, HttpStatus, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Response } from 'express';
import { TtsService } from './tts.service';

const PHRASES: Record<string, Record<string, string>> = {
  start:  { ko: '카운트다운을 시작합니다.', en: 'Countdown starting.', ja: 'カウントダウンを開始します。', zh: '倒计时开始。' },
  stop:   { ko: '카운트다운이 중지되었습니다.', en: 'Countdown stopped.', ja: 'カウントダウンが中止されました。', zh: '倒计时已停止。' },
  finish: { ko: '시작!', en: 'Start!', ja: '始め!', zh: '开始!' },
};

function getText(lang: string, key: string): string {
  if (PHRASES[key]) return PHRASES[key][lang] || PHRASES[key]['en'];
  return key; // 숫자 그대로
}

@Controller('tts-audio')
@UseGuards(AuthGuard('jwt'))
export class TtsController {
  constructor(private service: TtsService) {}

  // GET /tts-audio/:lang/:key  → mp3 파일 직접 서빙
  @Get(':lang/:key')
  async serve(
    @Param('lang') lang: string,
    @Param('key') key: string,
    @Res() res: Response,
  ) {
    const allowedLangs = ['ko', 'en', 'ja', 'zh'];
    if (!allowedLangs.includes(lang)) {
      return res.status(HttpStatus.BAD_REQUEST).send('invalid lang');
    }

    try {
      const text = getText(lang, key);
      const fp = await this.service.ensureFile(lang, key, text);
      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      return res.sendFile(fp);
    } catch (e) {
      return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: (e as Error).message });
    }
  }
}
