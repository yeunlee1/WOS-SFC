import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('alliance_notices')
export class AllianceNotice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  alliance: string; // 'KOR' | 'NSL' | 'JKY' | 'GPX' | 'UFO'

  @Column({ length: 20 })
  source: string; // 'discord' | 'kakao' | 'game'

  @Column({ length: 200, default: '공지' })
  title: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ name: 'author_nick', length: 50, default: '' })
  authorNick: string;

  @Column({ length: 10, default: 'ko' })
  lang: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
