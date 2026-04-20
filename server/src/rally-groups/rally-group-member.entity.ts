import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { RallyGroup } from './rally-group.entity';
import { User } from '../users/users.entity';

@Index(['groupId', 'userId'], { unique: true })
@Index(['groupId', 'orderIndex'], { unique: true })
@Entity('rally_group_members')
export class RallyGroupMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'group_id' })
  groupId: string;

  @Column({ name: 'user_id' })
  userId: number;

  @Column({ name: 'order_index', type: 'int' })
  orderIndex: number;

  @Column({ name: 'march_seconds_override', type: 'int', nullable: true })
  marchSecondsOverride: number | null;

  @ManyToOne(() => RallyGroup, (group) => group.members, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'group_id' })
  group: RallyGroup;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id' })
  user: User;
}
