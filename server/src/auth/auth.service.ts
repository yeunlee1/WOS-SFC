import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import * as bcrypt from 'bcrypt';

// 서버 접속 코드 (하드코딩)
const SERVER_CODE = '2677';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  // 회원가입: 서버 코드 검증 후 유저 생성 및 JWT 반환
  async signup(dto: SignupDto) {
    if (dto.serverCode !== SERVER_CODE) {
      throw new ForbiddenException('서버 코드가 올바르지 않습니다');
    }
    const user = await this.usersService.create({
      nickname: dto.nickname,
      password: dto.password,
      allianceName: dto.allianceName,
      role: dto.role,
      birthDate: dto.birthDate,
      name: dto.name,
      language: dto.language,
    });
    const token = this.jwtService.sign({ sub: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName });
    return { token, user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language } };
  }

  // 로그인: 닉네임/비밀번호 검증 후 JWT 반환
  async login(dto: LoginDto) {
    const user = await this.usersService.findByNickname(dto.nickname);
    if (!user) throw new UnauthorizedException('닉네임 또는 비밀번호가 올바르지 않습니다');
    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('닉네임 또는 비밀번호가 올바르지 않습니다');
    const token = this.jwtService.sign({ sub: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName });
    return { token, user: { id: user.id, nickname: user.nickname, role: user.role, allianceName: user.allianceName, language: user.language } };
  }
}
