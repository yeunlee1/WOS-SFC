import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { RallyGroupMember } from './rally-group-member.entity';

export type RallyGroupState = 'idle' | 'running' | 'finished';

@Entity('rally_groups')
export class RallyGroup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 40 })
  name: string;

  @Column({ name: 'created_by_id' })
  createdById: string;

  @Column({ name: 'broadcast_all', default: false })
  broadcastAll: boolean;

  @Column({
    type: 'enum',
    enum: ['idle', 'running', 'finished'],
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
