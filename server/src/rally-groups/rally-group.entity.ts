import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { RallyGroupMember } from './rally-group-member.entity';
import { User } from '../users/users.entity';

export const RALLY_GROUP_STATES = ['idle', 'running', 'finished'] as const;
export type RallyGroupState = (typeof RALLY_GROUP_STATES)[number];

@Entity('rally_groups')
export class RallyGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 40 })
  name: string;

  // 1~6 자동 할당 — 생성 시 count+1, 삭제 시 남은 그룹들 재번호화로 1..N 연속 유지.
  // 음성 안내("N번 집결그룹 집결 시작합니다")에서 N으로 사용되며,
  // name 필드(`${displayOrder}번 집결그룹`)와 중복되지만 정규 소스는 이 필드.
  // name에서 정규식 파싱보다 안정적.
  @Column({ name: 'display_order', type: 'int', default: 1 })
  displayOrder: number;

  @Column({ name: 'created_by_id', type: 'int' })
  createdById: number;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'created_by_id' })
  createdBy?: User;

  @Column({ name: 'broadcast_all', default: false })
  broadcastAll: boolean;

  @Column({
    type: 'enum',
    enum: RALLY_GROUP_STATES,
    default: 'idle',
  })
  state: RallyGroupState;

  @Column({ name: 'started_at_server_ms', type: 'bigint', nullable: true })
  startedAtServerMs: number | null;

  @Column({ name: 'max_march_seconds', type: 'int', nullable: true })
  maxMarchSeconds: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => RallyGroupMember, (member) => member.group, { cascade: true })
  members: RallyGroupMember[];
}
