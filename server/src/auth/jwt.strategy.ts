import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { Request } from 'express';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    super({
      // access_token httpOnly 쿠키에서 JWT 추출 (XSS로부터 안전)
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => (req as any)?.cookies?.access_token ?? null,
      ]),
      secretOrKey: process.env.JWT_SECRET ?? (() => { throw new Error('JWT_SECRET 환경변수가 설정되지 않았습니다'); })(),
    });
  }

  async validate(payload: { sub: number; nickname: string; role: string }) {
    const user = await this.usersService.findByNickname(payload.nickname);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
