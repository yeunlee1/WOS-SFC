import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokensService } from './refresh-tokens.service';
import * as bcrypt from 'bcrypt';

interface RefreshPayload {
  sub: number;
  jti: string;
  type: string;
}

const INVALID_REFRESH = '리프레시 토큰이 유효하지 않습니다';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly sessions: RefreshTokensService,
  ) {}

  private createAccessToken(payload: { id: number; nickname: string; role: string; allianceName: string }) {
    return this.jwtService.sign(
      { sub: payload.id, nickname: payload.nickname, role: payload.role, allianceName: payload.allianceName },
      { expiresIn: '1h' },
    );
  }

  // refresh token은 jti를 포함한 JWT (타입 구분용). jti 의 해시가 refresh_tokens 행과 대응한다.
  private signRefreshToken(userId: number, jti: string): string {
    return this.jwtService.sign(
      { sub: userId, jti, type: 'refresh' },
      { expiresIn: '7d' },
    );
  }

  /** 로그인·가입마다 새 세션(기기) 행을 만든다. 다른 기기의 행은 건드리지 않는다. */
  private async createRefreshToken(userId: number): Promise<string> {
    return this.signRefreshToken(userId, await this.sessions.issue(userId));
  }

  async signup(dto: SignupDto) {
    // ConfigModule.forRoot()는 AppModule @Module 데코레이터 평가 시점에 .env를 로드한다.
    // 모듈 file top-level에서 process.env를 캡처하면 그 시점엔 dotenv가 아직 안 돌아 undefined가 들어간다 —
    // 그래서 메서드 호출 시점에 lazy 읽기로 바꿔야 .env 값이 정상 매칭된다.
    if (dto.serverCode !== process.env.SERVER_CODE) {
      throw new ForbiddenException('가입 코드가 올바르지 않습니다');
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

  /** 제시된 refresh 토큰의 세션 행만 회전한다. 같은 계정의 다른 기기는 영향받지 않는다. */
  async refreshTokens(rawRefreshToken: string) {
    let payload: RefreshPayload;
    try {
      payload = this.jwtService.verify<RefreshPayload>(rawRefreshToken);
    } catch {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    if (payload.type !== 'refresh' || typeof payload.jti !== 'string') {
      throw new UnauthorizedException(INVALID_REFRESH);
    }
    const nextJti = await this.sessions.rotate(payload.sub, payload.jti);
    if (!nextJti) throw new UnauthorizedException(INVALID_REFRESH);
    const user = await this.usersService.findById(payload.sub);
    if (!user) throw new UnauthorizedException(INVALID_REFRESH);
    return {
      accessToken: this.createAccessToken(user),
      refreshToken: this.signRefreshToken(user.id, nextJti),
      user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language },
    };
  }

  /** refresh 쿠키가 있을 때만 그 기기의 세션을 지운다. 만료된 JWT 도 decode 는 되므로 폐기할 수 있다. */
  async logout(userId: number, rawRefreshToken?: string): Promise<void> {
    if (!rawRefreshToken) return;
    const payload = this.jwtService.decode(rawRefreshToken) as RefreshPayload | null;
    if (
      !payload ||
      payload.type !== 'refresh' ||
      payload.sub !== userId ||
      typeof payload.jti !== 'string'
    ) {
      return;
    }
    await this.sessions.revoke(userId, payload.jti);
  }
}
