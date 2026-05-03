import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { ThrottlerGuard, Throttle } from '@nestjs/throttler';

@Controller()
export class AppController {
  // 클라이언트 시간 동기화용 — t1(수신 직후), t2(응답 직전) 별도 측정으로
  // 클라이언트가 NTP 4-timestamp 알고리즘에 서버 처리 시간을 분리해 RTT 보정 가능.
  // Cache-Control: no-store — CDN/프록시가 캐시하면 클라이언트가 오래된 시각을 받음.
  // ThrottlerGuard — /time은 클릭한 번에 5샘플을 보내는 설계이지만 무제한 호출 방지.
  // 분당 30회 = 5샘플 × 6회 동기화로 충분, 봇·DoS 방어.
  @Get('time')
  @Header('Cache-Control', 'no-store')
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 90, ttl: 60000 } })
  getTime(): { utc: number; t1: number; t2: number } {
    const t1 = Date.now();
    const t2 = Date.now();
    return { utc: t2, t1, t2 };
  }
}
