import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('notices')
export class Notice {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 20 })
  source: string;

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
