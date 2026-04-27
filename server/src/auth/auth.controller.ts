import { Controller, Post, Get, Body, Req, Res, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';

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
  // 가입 시도 제한: 10분당 5회. 자동 가입 봇은 차단하되, 정상 사용자가 입력 실수로
  // 몇 번 실패해도 1시간씩 막히지 않도록 완화. (이전: 1시간당 3회)
  @Throttle({ default: { limit: 5, ttl: 600000 } })
  @Post('signup')
  async signup(@Body() dto: SignupDto, @Res({ passthrough: true }) res: any) {
    const { accessToken, refreshToken, user } = await this.authService.signup(dto);
    this.setCookies(res, accessToken, refreshToken);
    return { user };
  }

  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: any) {
    const { accessToken, refreshToken, user } = await this.authService.login(dto);
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
