// server/src/boards/board-post.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('board_posts')
export class BoardPost {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 10 })
  alliance: string; // 'KOR' | 'NSL' | 'JKY' | 'GPX' | 'UFO'

  @Column({ length: 50 })
  nickname: string;

  @Column({ name: 'user_alliance', length: 100 })
  userAlliance: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ length: 10, default: 'ko' })
  lang: string;

  @Column({ name: 'image_urls', type: 'simple-json', nullable: true, default: null })
  imageUrls: string[] | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
