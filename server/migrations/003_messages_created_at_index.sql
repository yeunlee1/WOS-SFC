-- 채팅 히스토리 조회(WHERE created_at > ? ORDER BY created_at DESC LIMIT 200)용 인덱스.
-- (코드: server/src/chat/chat.service.ts — getRecentMessages / deleteOldMessages)
--
-- 왜 필요한가:
--   messages 테이블에는 PK(id)와 FK(user_id) 인덱스만 있고 created_at 인덱스가 없다.
--   메시지가 누적될수록 접속 시 히스토리 조회가 풀 스캔 + filesort로 떨어지고,
--   그 지연이 handleConnection을 붙잡아 동시 접속 처리를 느리게 만든다.
--   보존 정리(deleteOldMessages)의 WHERE created_at < ? 도 같은 인덱스를 쓴다.
--
-- 000_initial_schema.sql 과의 관계:
--   이 인덱스는 000 에 들어 있지 않다. TypeORM 엔티티(message.entity.ts)에 @Index 선언이
--   없어서 synchronize 가 만드는 스키마에 없고, 000 은 그 스키마를 그대로 재현하기 때문이다.
--   따라서 이 파일이 idx_messages_created_at 의 유일한 소유자다.
--   주의 — 개발 환경에서 TYPEORM_SYNC=true 로 켜면 TypeORM 이 엔티티에 없는 이 인덱스를
--   DROP 한다. 그때는 이 마이그레이션을 다시 적용해야 한다(아래 멱등 처리로 안전하다).
--
-- 멱등 처리:
--   MySQL 은 CREATE INDEX IF NOT EXISTS 를 지원하지 않는다. 이력 테이블이 없는 기존 DB에
--   러너를 처음 붙일 때 이미 인덱스가 있으면 실패하므로, information_schema 로 존재 여부를
--   보고 없을 때만 만든다. 이미 있으면 DO 0(아무것도 하지 않는 문장)을 실행한다.
--
-- 적용 시점: 채팅 배포 전. 온라인 DDL이지만 대형 테이블에서는 잠금 시간을 미리 확인할 것.

SET @index_exists := (
  SELECT COUNT(*)
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'messages'
    AND INDEX_NAME = 'idx_messages_created_at'
);

SET @create_index_sql := IF(
  @index_exists = 0,
  'CREATE INDEX idx_messages_created_at ON messages (created_at)',
  'DO 0'
);

PREPARE create_index_stmt FROM @create_index_sql;
EXECUTE create_index_stmt;
DEALLOCATE PREPARE create_index_stmt;
