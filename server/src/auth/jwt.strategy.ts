import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../users/users.service';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private readonly usersService: UsersService) {
    super({
      // Authorization 헤더의 Bearer 토큰에서 JWT 추출
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // 환경변수 JWT_SECRET 우선, 없으면 기본값 사용
      secretOrKey: process.env.JWT_SECRET || 'wos_jwt_secret',
    });
  }

  // JWT 검증 후 호출 — 유저 존재 여부 확인
  async validate(payload: { sub: number; nickname: string; role: string }) {
    const user = await this.usersService.findByNickname(payload.nickname);
    if (!user) throw new UnauthorizedException();
    return user;
  }
}
