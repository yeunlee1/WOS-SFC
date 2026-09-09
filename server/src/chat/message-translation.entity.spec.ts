// message_translations 엔티티가 005 마이그레이션 SQL 과 컬럼·PK·FK 정의가 같은지 대조한다.
import { readFileSync } from 'fs';
import { join } from 'path';
import { getMetadataArgsStorage } from 'typeorm';
import { MessageTranslation } from './message-translation.entity';
import { Message } from './message.entity';

const sql = readFileSync(
  join(__dirname, '..', '..', 'migrations', '005_message_translations.sql'),
  'utf8',
);

function sqlColumns(): string[] {
  return [...sql.matchAll(/^\s*`(\w+)`\s+(int|varchar|text|datetime)/gm)].map((m) => m[1]);
}

describe('MessageTranslation 엔티티 ↔ 005 SQL', () => {
  const storage = getMetadataArgsStorage();
  const table = storage.tables.find((t) => t.target === MessageTranslation);
  const columns = storage.columns.filter((c) => c.target === MessageTranslation);

  it('테이블 이름이 message_translations 다', () => {
    expect(table?.name).toBe('message_translations');
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS `message_translations`/);
  });

  it('컬럼 이름 집합이 SQL 과 같다', () => {
    const entityNames = columns
      .map((c) => c.options.name ?? c.propertyName)
      .sort();
    expect(entityNames).toEqual([...sqlColumns()].sort());
    expect(entityNames).toEqual(['created_at', 'lang', 'message_id', 'text']);
  });

  it('PK 는 (message_id, lang) 복합키다', () => {
    const pk = columns
      .filter((c) => c.options.primary)
      .map((c) => c.options.name ?? c.propertyName);
    expect(pk).toEqual(['message_id', 'lang']);
    expect(sql).toMatch(/PRIMARY KEY \(`message_id`, `lang`\)/);
  });

  it('lang 은 varchar(8), text 는 text, created_at 은 생성 시각 컬럼이다', () => {
    const lang = columns.find((c) => c.propertyName === 'lang');
    expect(lang?.options).toMatchObject({ type: 'varchar', length: 8 });
    const text = columns.find((c) => c.propertyName === 'text');
    expect(text?.options).toMatchObject({ type: 'text' });
    const createdAt = columns.find((c) => c.propertyName === 'createdAt');
    expect(createdAt?.mode).toBe('createDate');
    expect(sql).toMatch(/`lang` varchar\(8\) NOT NULL/);
  });

  it('messages 로의 FK 이름과 CASCADE 가 SQL 과 같다', () => {
    const relation = storage.relations.find(
      (r) => r.target === MessageTranslation && r.propertyName === 'message',
    );
    expect(relation?.relationType).toBe('many-to-one');
    expect((relation?.type as () => unknown)()).toBe(Message);
    expect(relation?.options.onDelete).toBe('CASCADE');
    const join = storage.joinColumns.find(
      (j) => j.target === MessageTranslation && j.propertyName === 'message',
    );
    expect(join?.name).toBe('message_id');
    expect(join?.foreignKeyConstraintName).toBe('fk_message_translations_message');
    expect(sql).toMatch(
      /CONSTRAINT `fk_message_translations_message` FOREIGN KEY \(`message_id`\) REFERENCES `messages` \(`id`\) ON DELETE CASCADE/,
    );
  });
});
