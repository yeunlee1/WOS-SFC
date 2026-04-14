import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole, Language } from './users.entity';
import * as bcrypt from 'bcrypt';

export interface CreateUserDto {
  nickname: string;
  password: string;
  allianceName: string;
  role: UserRole;
  birthDate: string;
  name: string;
  language: Language;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  async create(dto: CreateUserDto): Promise<User> {
    const exists = await this.usersRepo.findOne({ where: { nickname: dto.nickname } });
    if (exists) throw new ConflictException('이미 사용 중인 닉네임입니다');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = this.usersRepo.create({
      nickname: dto.nickname,
      passwordHash,
      allianceName: dto.allianceName,
      role: dto.role,
      birthDate: dto.birthDate,
      name: dto.name,
      language: dto.language,
    });
    return this.usersRepo.save(user);
  }

  async findByNickname(nickname: string): Promise<User | null> {
    return this.usersRepo.findOne({ where: { nickname } });
  }

  async setRole(nickname: string, role: UserRole): Promise<User | null> {
    const user = await this.findByNickname(nickname);
    if (!user) return null;
    user.role = role;
    return this.usersRepo.save(user);
  }
}
