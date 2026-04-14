import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    // Passport 기본 전략 설정
    PassportModule,
    // JWT 설정: 환경변수 JWT_SECRET 우선, 없으면 기본값 사용 / 만료 7일
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'wos_jwt_secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  // JwtStrategy를 프로바이더로 등록 — Passport가 자동 인식
  providers: [AuthService, JwtStrategy],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
