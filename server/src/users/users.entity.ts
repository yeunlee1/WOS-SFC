import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

export type UserRole = 'admin' | 'member' | 'developer';
export const LANGUAGES = ['ko', 'en', 'ja', 'zh', 'ru', 'other'] as const;
export type Language = (typeof LANGUAGES)[number];

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

  // 회원가입 시 더 이상 입력받지 않음 (개인정보 최소화). 기존 데이터 호환을 위해
  // 컬럼은 유지하되 nullable로 변경하고, 응답 화이트리스트에서도 제외 처리됨.
  // type 명시 필수 — `string | null` 유니언은 typeorm metadata 추론에서 Object로 잡혀
  // DataTypeNotSupportedError가 난다.
  @Column({ name: 'birth_date', type: 'date', nullable: true })
  birthDate: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  name: string | null;

  @Column({ type: 'enum', enum: LANGUAGES })
  language: Language;

  @Column({
    name: 'refresh_token_hash',
    type: 'varchar',
    nullable: true,
    length: 255,
    select: false,
  })
  refreshTokenHash: string | null;

  @Column({ name: 'march_seconds', type: 'int', nullable: true })
  marchSeconds: number | null;

  @Column({ name: 'is_leader', type: 'boolean', default: false })
  isLeader: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
