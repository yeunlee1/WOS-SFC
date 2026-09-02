// 기기별 refresh 토큰 행. 토큰 원문 대신 jti 의 sha256 만 저장한다.
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../users/users.entity';

// 인덱스 이름은 004_refresh_tokens.sql 과 같아야 dev 의 synchronize 가 다시 만들지 않는다.
@Entity('refresh_tokens')
@Index('idx_refresh_tokens_user_id', ['userId'])
@Index('uq_refresh_tokens_token_hash', ['tokenHash'], { unique: true })
export class RefreshToken {
  @PrimaryGeneratedColumn()
  id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;

  @Column({ name: 'user_id', type: 'int' })
  userId: number;

  @Column({ name: 'token_hash', type: 'char', length: 64 })
  tokenHash: string;

  @Column({ name: 'expires_at', type: 'datetime', precision: 6 })
  expiresAt: Date;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
