import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { UsersModule } from '../users/users.module';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

@Module({
  imports: [
    UsersModule,
    // JWT 설정: 환경변수 JWT_SECRET 우선, 없으면 기본값 사용 / 만료 7일
    JwtModule.register({
      secret: process.env.JWT_SECRET || 'wos_jwt_secret',
      signOptions: { expiresIn: '7d' },
    }),
  ],
  providers: [AuthService],
  controllers: [AuthController],
  exports: [JwtModule],
})
export class AuthModule {}
