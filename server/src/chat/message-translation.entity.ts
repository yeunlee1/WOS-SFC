// 채팅 메시지별 번역 행. (message_id, lang) 이 PK 라 메시지 하나의 언어별 번역이 곧 캐시다.
// server/migrations/005_message_translations.sql 과 컬럼·PK·FK 이름이 같아야 dev sync 가 재생성하지 않는다.
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
} from 'typeorm';
import { Message } from './message.entity';

@Entity('message_translations')
export class MessageTranslation {
  @PrimaryColumn({ name: 'message_id', type: 'int' })
  messageId: number;

  @PrimaryColumn({ type: 'varchar', length: 8 })
  lang: string;

  @Column({ type: 'text' })
  text: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Message, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'message_id',
    foreignKeyConstraintName: 'fk_message_translations_message',
  })
  message: Message;
}
