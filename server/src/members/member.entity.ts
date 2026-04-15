// server/src/members/member.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('members')
export class Member {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  name: string;

  @Column({ length: 100, default: '' })
  role: string;

  @Column({ length: 100, default: '' })
  notes: string;

  @Column({ default: 0 })
  normalSeconds: number;

  @Column({ default: 0 })
  petSeconds: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
