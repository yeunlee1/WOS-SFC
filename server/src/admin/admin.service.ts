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
    return this.usersRepo.save(user);
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
