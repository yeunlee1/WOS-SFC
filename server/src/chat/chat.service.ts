import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import { Message } from './message.entity';
import { User } from '../users/users.entity';

@Injectable()
export class ChatService {
  constructor(
    @InjectRepository(Message)
    private readonly messagesRepo: Repository<Message>,
  ) {}

  // 메시지 저장
  async saveMessage(user: User, content: string): Promise<Message> {
    const msg = this.messagesRepo.create({ user, content });
    return this.messagesRepo.save(msg);
  }

  // 최근 7일치 메시지 최대 200개 조회 (오름차순)
  async getRecentMessages(): Promise<Message[]> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return this.messagesRepo.find({
      where: { createdAt: MoreThan(sevenDaysAgo) },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  // 7일 이전 오래된 메시지 삭제
  async deleteOldMessages(): Promise<void> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    await this.messagesRepo
      .createQueryBuilder()
      .delete()
      .where('created_at < :date', { date: sevenDaysAgo })
      .execute();
  }
}
