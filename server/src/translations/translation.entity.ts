// server/src/translations/translation.entity.ts
import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('translations')
export class Translation {
  @PrimaryColumn({ name: 'cache_key', length: 255 })
  cacheKey: string;

  @Column({ type: 'text' })
  translated: string;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
