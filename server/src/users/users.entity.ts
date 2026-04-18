import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

export type UserRole = 'admin' | 'member' | 'developer';
export const LANGUAGES = ['ko', 'en', 'ja', 'zh', 'ru', 'other'] as const;
export type Language = typeof LANGUAGES[number];

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true, length: 50 })
  nickname: string;

  @Column({ name: 'password_hash', length: 255 })
  passwordHash: string;

  @Column({ name: 'alliance_name', length: 100 })
  allianceName: string;

  @Column({ type: 'enum', enum: ['admin', 'member', 'developer'] })
  role: UserRole;

  @Column({ name: 'birth_date', type: 'date' })
  birthDate: string;

  @Column({ length: 100 })
  name: string;

  @Column({ type: 'enum', enum: LANGUAGES })
  language: Language;

  @Column({ name: 'refresh_token_hash', type: 'varchar', nullable: true, length: 255, select: false })
  refreshTokenHash: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
