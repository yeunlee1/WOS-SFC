import { Controller, Get, Param, Req, Res, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { TtsService, TtsUnavailableError } from './tts.service';
import {
  getTtsText,
  parseTtsKey,
  parseTtsLang,
} from './tts.constants';

// TTS 파일은 숫자 읽기/문구 음성이라 인증 불필요 — HTMLAudioElement는 Authorization 헤더를 보낼 수 없음
@Controller('tts-audio')
export class TtsController {
  constructor(private service: TtsService) {}

  // GET /tts-audio/:lang/:key  → mp3 파일 직접 서빙
  @Get(':lang/:key')
  async serve(
    @Param('lang') lang: string,
    @Param('key') key: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    // 허용 언어 검증
    const safeLang = parseTtsLang(lang);
    if (!safeLang) {
      return res.status(HttpStatus.BAD_REQUEST).send('invalid lang');
    }

    // C1: 화이트리스트 검증 — 허용된 숫자 또는 PHRASES 키만 허용
    // 임의 텍스트 전달로 외부 TTS API 비용 폭탄 방지
    const safeKey = parseTtsKey(key);
    if (!safeKey) {
      return res.status(HttpStatus.NOT_FOUND).send('not found');
    }

    try {
      const text = getTtsText(safeLang, safeKey);
      const stat = await this.service.prepareAudio(
        safeLang,
        safeKey,
        text,
      );

      // 캐시 정책: 숫자/문구 모두 1시간 캐시 + 약한 ETag로 revalidation 허용.
      // ※ 과거에는 숫자를 `immutable` 로 주었으나, Google TTS 응답이 간혹 무음
      //   MP3를 반환하면 손상된 파일이 1년 동안 클라이언트에 고정되어 버렸다.
      //   서버 파일을 삭제해도 브라우저가 재요청하지 않는 문제가 생긴다.
      //   → max-age 는 유지하되 immutable 제거 + mtime 기반 ETag 로 자동 무효화.
      const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toFixed(0)}"`;
      if (req.headers['if-none-match'] === etag) {
        return res.status(HttpStatus.NOT_MODIFIED).end();
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      res.setHeader('Cache-Control', 'public, max-age=3600, stale-while-revalidate=86400');
      res.setHeader('ETag', etag);
      res.setHeader('Last-Modified', stat.mtime.toUTCString());
      const stream = this.service.createAudioStream(safeLang, safeKey);
      stream.pipe(res);
      return new Promise<void>((resolve, reject) => {
        stream.on('end', () => resolve());
        stream.on('error', reject);
      });
    } catch (error) {
      // 키 없이 캐시가 빈 상태는 서버 결함이 아니라 '없는 파일'이다. 클라이언트는 !ok 면 무음으로 넘어간다.
      if (error instanceof TtsUnavailableError) {
        return res.status(HttpStatus.NOT_FOUND).json({ error: 'audio unavailable' });
      }
      return res
        .status(HttpStatus.INTERNAL_SERVER_ERROR)
        .json({ error: 'audio unavailable' });
    }
  }
}
