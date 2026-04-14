// server/src/rallies/rally.entity.ts
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('rallies')
export class Rally {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100, default: '집결' })
  name: string;

  @Column({ name: 'end_time_utc', type: 'bigint' })
  endTimeUTC: number; // Unix ms

  @Column({ name: 'total_seconds' })
  totalSeconds: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
