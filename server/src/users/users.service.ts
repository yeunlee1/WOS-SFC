import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, Language } from './users.entity';
import * as bcrypt from 'bcrypt';
import { isQuarantinedLegacyAccount } from './quarantined-legacy-accounts';

export interface CreateUserDto {
  nickname: string;
  password: string;
  allianceName: string;
  role: UserRole;
  language: Language;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    if (isQuarantinedLegacyAccount(dto.nickname)) {
      throw new ConflictException('사용할 수 없는 닉네임입니다');
    }
    const exists = await this.usersRepo.findOne({ where: { nickname: dto.nickname } });
    if (exists) throw new ConflictException('이미 사용 중인 닉네임입니다');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.usersRepo.create({
      nickname: dto.nickname,
      passwordHash,
      allianceName: dto.allianceName,
      role: dto.role,
      birthDate: null,
      name: null,
      language: dto.language,
    });
    return this.usersRepo.save(user);
  }

  async findByNickname(nickname: string): Promise<User | null> {
    const user = await this.usersRepo.findOne({ where: { nickname } });
    return isQuarantinedLegacyAccount(user?.nickname) ? null : user;
  }

  async findById(id: number): Promise<User | null> {
    const user = await this.usersRepo.findOne({ where: { id } });
    return isQuarantinedLegacyAccount(user?.nickname) ? null : user;
  }

  async setRole(nickname: string, role: UserRole): Promise<User | null> {
    const user = await this.findByNickname(nickname);
    if (!user) return null;
    user.role = role;
    return this.usersRepo.save(user);
  }

  async updateRefreshTokenHash(userId: number, hash: string | null): Promise<void> {
    await this.usersRepo.update(userId, { refreshTokenHash: hash });
  }

  async findByIdWithRefreshToken(id: number): Promise<User | null> {
    const user = await this.usersRepo.findOne({
      where: { id },
      select: ['id', 'nickname', 'role', 'allianceName', 'language', 'refreshTokenHash'],
    });
    return isQuarantinedLegacyAccount(user?.nickname) ? null : user;
  }

  async updateMarchSeconds(userId: number, marchSeconds: number | null): Promise<void> {
    await this.usersRepo.update(userId, { marchSeconds });
  }
}
