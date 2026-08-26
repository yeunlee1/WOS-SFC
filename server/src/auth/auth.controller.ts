import { Controller, Post, Get, Body, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import {
  AccountLoginThrottleGuard,
  accountLoginThrottle,
  normalizeAccountKey,
} from '../common/account-login-throttle';
import { resolveClientIp } from '../common/rate-limit-tracker';

function cookieOptions(maxAge: number, path = '/') {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path,
    maxAge,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @UseGuards(ThrottlerGuard)
  // 가입 시도 제한: 10분당 20회 (IP 기준).
  //
  // 이 한도는 IP 하나가 아니라 그 IP 를 공유하는 사람 전부가 나눠 쓴다. 국내 LTE/5G 는 CGNAT 라
  // 다수 가입자가 같은 공인 IP 로 나가고, main.ts 의 trust proxy 로 실제 클라이언트 주소를 얻어도
  // 이 공유는 그대로 남는다 — 통신사가 부여한 주소 자체가 공유 주소이기 때문이다.
  //
  // 20 을 잡은 근거 —
  // - 가입은 1인 1회뿐이고 작전 시간대에 몰리지 않는다(온보딩은 며칠에 걸쳐 분산). login 과 달리
  //   "같은 순간에 100명"이 성립하지 않는다.
  // - 같은 CGNAT 주소를 공유하면서 같은 10분 안에 가입하는 최악 인원을 10명으로 잡고,
  //   1인 2회(가입 코드 오타 1회 + 성공 1회) → 10 × 2 = 20.
  // - 더 올리지 않는 이유: signup 실패의 대부분은 SERVER_CODE 대조 실패라, 한도를 크게 열면
  //   가입 코드 무차별 대입 속도가 그대로 올라간다. (이전: 10분당 5회)
  @Throttle({ default: { limit: 20, ttl: 600000 } })
  @Post('signup')
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: any) {
    const { accessToken, refreshToken, user } = await this.authService.signup(dto);
    this.setCookies(res, accessToken, refreshToken);
    return { user };
  }

  // 게이트 두 개를 겹쳐 건다. IP 게이트를 먼저 통과시켜 명백한 대량 요청을 가장 싸게 잘라내고,
  // 그 뒤에 계정 게이트로 "IP 를 갈아타며 한 계정을 두드리는" 패턴을 잡는다.
  @UseGuards(ThrottlerGuard, AccountLoginThrottleGuard)
  // 로그인 IP 한도: 5분당 100회 (IP 기준. 인증 전이라 사용자 단위로 나눌 수 없다).
  //
  // 이 한도는 IP 하나가 아니라 그 IP 를 공유하는 사람 전부가 나눠 쓴다. main.ts 의 trust proxy 로
  // 프록시 주소 대신 실제 클라이언트 주소를 얻게 됐지만, 국내 LTE/5G 는 CGNAT 라 그 "실제 주소"
  // 자체가 다수 가입자의 공유 주소다.
  //
  // 100 을 잡은 근거 —
  // - 공유 인원 가정: 연맹 100명 중 최악 25%(25명)가 같은 통신사 CGNAT 공인 IP 하나로 나간다.
  // - 시간대 분포 가정: 작전 준비 시간대에는 로그인이 흩어지지 않고 "출발" 직전 5분에 몰린다.
  // - 실패 재시도 여유: 1인 4회(비밀번호 오타 3 + 성공 1).
  // - 25명 × 4회 = 100회 / 5분.
  // 이전 값(60초당 10회)은 같은 가정에서 25명이 각 2회만 시도해도 소진돼, 정상 연맹원이
  // 집결 직전에 429 로 로그인 자체를 못 하는 상태가 된다.
  //
  // 한도를 10배로 올린 만큼 무차별 대입 방어는 IP 가 아니라 AccountLoginThrottleGuard 가 맡는다.
  // 한 계정에 대한 대입 속도는 이 100회가 아니라 계정당 15회/5분·(계정,IP)당 5회/5분이 지배한다.
  @Throttle({ default: { limit: 100, ttl: 300000 } })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const { accessToken, refreshToken, user } = await this.authService.login(dto);
    // 성공했으니 이 계정의 시도 카운터를 비운다 — 정상 사용자의 로그인은 누적되지 않는다.
    // (실패는 예외로 빠져 여기 도달하지 않으므로, 남는 것은 실패 시도뿐이다.)
    const account = normalizeAccountKey(dto.nickname);
    if (account) accountLoginThrottle.recordSuccess(account, resolveClientIp(req));
    this.setCookies(res, accessToken, refreshToken);
    return { user };
  }

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  async getMe(@Req() req: any) {
    const u = req.user;
    return { user: { id: u.id, nickname: u.nickname, role: u.role, allianceName: u.allianceName, language: u.language } };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post('refresh')
  async refresh(@Req() req: any, @Res({ passthrough: true }) res: any) {
    const rawRefreshToken = req.cookies?.refresh_token;
    if (!rawRefreshToken) throw new UnauthorizedException();
    const { accessToken, refreshToken } = await this.authService.refreshTokens(rawRefreshToken);
    this.setCookies(res, accessToken, refreshToken);
    return { ok: true };
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('logout')
  async logout(@Req() req: any, @Res({ passthrough: true }) res: any) {
    await this.authService.logout(req.user.id);
    res.clearCookie('access_token', { path: '/' });
    res.clearCookie('refresh_token', { path: '/auth/refresh' });
    return { ok: true };
  }

  private setCookies(res: any, accessToken: string, refreshToken: string) {
    res.cookie('access_token', accessToken, cookieOptions(60 * 60 * 1000));
    res.cookie('refresh_token', refreshToken, cookieOptions(7 * 24 * 60 * 60 * 1000, '/auth/refresh'));
  }
}
