import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserRole } from '../users/users.entity';
import { RealtimeGateway } from '../realtime/realtime.gateway';

export type AssignableRole = Exclude<UserRole, 'developer'>;

@Injectable()
export class AdminService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
    @Inject(forwardRef(() => RealtimeGateway))
    private readonly realtimeGateway: RealtimeGateway,
  ) {}

  async getUsers(): Promise<User[]> {
    return this.usersRepo.find({
      select: ['id', 'nickname', 'allianceName', 'role', 'language', 'createdAt'],
      order: { createdAt: 'ASC' },
    });
  }

  async changeRole(id: number, role: AssignableRole): Promise<User> {
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('유저를 찾을 수 없습니다');
    user.role = role;
    const saved = await this.usersRepo.save(user);
    // JWT payload의 role은 만료(최대 1시간)까지 stale 상태가 됩니다.
    // 역할 변경 즉시 해당 유저의 소켓을 강제 종료하면, 재연결 시 새 JWT를 발급받아
    // stale role 창을 0으로 줄입니다 (권한 강등 즉시 반영).
    this.realtimeGateway.kickUser(saved.nickname);
    return saved;
  }

  async banUser(id: number, requesterId: number): Promise<void> {
    if (id === requesterId) {
      throw new BadRequestException('자기 자신은 벤할 수 없습니다');
    }
    const user = await this.usersRepo.findOne({ where: { id } });
    if (!user) throw new NotFoundException('유저를 찾을 수 없습니다');

    const { nickname } = user;
    await this.usersRepo.remove(user);
    this.realtimeGateway.kickUser(nickname);
  }
}
