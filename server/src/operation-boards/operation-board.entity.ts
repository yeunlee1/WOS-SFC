// 작전판 저장본을 보관하는 TypeORM 엔티티다.
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type OperationBoardBackgroundType = 'grid' | 'image';

@Entity('operation_boards')
export class OperationBoard {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 80 })
  title: string;

  @Column({
    name: 'background_type',
    type: 'varchar',
    length: 16,
    default: 'grid',
  })
  backgroundType: OperationBoardBackgroundType;

  @Column({
    name: 'background_image_url',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  backgroundImageUrl: string | null;

  @Column({ name: 'elements_json', type: 'json' })
  elementsJson: unknown[];

  @Column({ name: 'created_by_user_id', type: 'int' })
  createdByUserId: number;

  @Column({ name: 'created_by_nick', length: 50 })
  createdByNick: string;

  @Column({ name: 'updated_by_user_id', type: 'int' })
  updatedByUserId: number;

  @Column({ name: 'updated_by_nick', length: 50 })
  updatedByNick: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
