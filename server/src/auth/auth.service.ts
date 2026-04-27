import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  private createAccessToken(payload: { id: number; nickname: string; role: string; allianceName: string }) {
    return this.jwtService.sign(
      { sub: payload.id, nickname: payload.nickname, role: payload.role, allianceName: payload.allianceName },
      { expiresIn: '1h' },
    );
  }

  private async createRefreshToken(userId: number): Promise<string> {
    const jti = randomUUID();
    const hash = await bcrypt.hash(jti, 10);
    await this.usersService.updateRefreshTokenHash(userId, hash);
    // refresh token은 jti를 포함한 JWT (타입 구분용)
    return this.jwtService.sign(
      { sub: userId, jti, type: 'refresh' },
      { expiresIn: '7d' },
    );
  }

  async signup(dto: SignupDto) {
    // ConfigModule.forRoot()는 AppModule @Module 데코레이터 평가 시점에 .env를 로드한다.
    // 모듈 file top-level에서 process.env를 캡처하면 그 시점엔 dotenv가 아직 안 돌아 undefined가 들어간다 —
    // 그래서 메서드 호출 시점에 lazy 읽기로 바꿔야 .env 값이 정상 매칭된다.
    if (dto.serverCode !== process.env.SERVER_CODE) {
      throw new ForbiddenException('서버 코드가 올바르지 않습니다');
    }
    const user = await this.usersService.create({
      nickname: dto.nickname,
      password: dto.password,
      allianceName: dto.allianceName,
      role: 'member',
      language: dto.language,
    });
    const accessToken = this.createAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);
    return { accessToken, refreshToken, user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language } };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByNickname(dto.nickname);
    if (!user) throw new UnauthorizedException('닉네임 또는 비밀번호가 올바르지 않습니다');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('닉네임 또는 비밀번호가 올바르지 않습니다');
    const accessToken = this.createAccessToken(user);
    const refreshToken = await this.createRefreshToken(user.id);
    return { accessToken, refreshToken, user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language } };
  }

  async refreshTokens(rawRefreshToken: string) {
    try {
      const payload = this.jwtService.verify<{ sub: number; jti: string; type: string }>(rawRefreshToken);
      if (payload.type !== 'refresh') throw new UnauthorizedException();

      const user = await this.usersService.findByIdWithRefreshToken(payload.sub);
      if (!user?.refreshTokenHash) throw new UnauthorizedException();

      const valid = await bcrypt.compare(payload.jti, user.refreshTokenHash);
      if (!valid) throw new UnauthorizedException();

      const accessToken = this.createAccessToken(user);
      const newRefreshToken = await this.createRefreshToken(user.id);
      return { accessToken, refreshToken: newRefreshToken, user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language } };
    } catch {
      throw new UnauthorizedException('리프레시 토큰이 유효하지 않습니다');
    }
  }

  async logout(userId: number): Promise<void> {
    await this.usersService.updateRefreshTokenHash(userId, null);
  }
}
