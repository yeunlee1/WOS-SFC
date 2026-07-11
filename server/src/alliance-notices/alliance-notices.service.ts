import {
  Injectable,
  ForbiddenException,
  NotFoundException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AllianceNotice } from './alliance-notice.entity';
import { CreateAllianceNoticeDto } from './dto/create-alliance-notice.dto';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { User } from '../users/users.entity';
import { hasOriginalNicknameOwnership } from '../users/nickname-ownership';

@Injectable()
export class AllianceNoticesService {
  constructor(
    @InjectRepository(AllianceNotice)
    private repo: Repository<AllianceNotice>,
    @Inject(forwardRef(() => RealtimeGateway)) private gateway: RealtimeGateway,
  ) {}

  findByAlliance(alliance: string): Promise<AllianceNotice[]> {
    return this.repo.find({
      where: { alliance },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  async add(dto: CreateAllianceNoticeDto, user: any): Promise<AllianceNotice> {
    const notice = this.repo.create({
      alliance: dto.alliance,
      source: dto.source,
      title: dto.title || '공지',
      content: dto.content,
      authorNick: user.nickname,
      lang: dto.lang || 'ko',
    });
    const saved = await this.repo.save(notice);
    await this.gateway.broadcastAllianceNotice(dto.alliance);
    return saved;
  }

  async remove(
    id: number,
    user: Pick<User, 'nickname' | 'role' | 'allianceName' | 'createdAt'>,
  ): Promise<void> {
    const notice = await this.repo.findOneBy({ id });
    if (!notice) throw new NotFoundException();
    const isSameAlliance = notice.alliance === user.allianceName;
    const isOwn = hasOriginalNicknameOwnership(
      user,
      notice.authorNick,
      notice.createdAt,
    );
    const isManager = user.role === 'admin' || user.role === 'developer';
    if (!isSameAlliance || (!isOwn && !isManager)) {
      throw new ForbiddenException();
    }
    await this.repo.delete(id);
    await this.gateway.broadcastAllianceNotice(notice.alliance);
  }
}
