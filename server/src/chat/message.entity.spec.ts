// messages.created_at 인덱스가 엔티티에 선언돼 dev sync 가 003 의 인덱스를 지우지 않는지 확인한다.
import { getMetadataArgsStorage } from 'typeorm';
import { Message } from './message.entity';

it('Message 엔티티는 idx_messages_created_at 인덱스를 선언한다', () => {
  const index = getMetadataArgsStorage().indices.find(
    (i) => i.target === Message && i.name === 'idx_messages_created_at',
  );
  expect(index).toBeDefined();
  expect(index?.columns).toEqual(['createdAt']);
});
