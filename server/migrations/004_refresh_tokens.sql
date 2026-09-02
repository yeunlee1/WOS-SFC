-- 기기별 refresh 토큰 테이블. users.refresh_token_hash(계정당 1개)를 대체한다.
--
-- 왜 — 계정당 해시 1개면 PC 와 폰에서 같이 쓸 때 먼저 로그인한 기기가 access 만료(1시간)
-- 시점에 refresh 실패로 강제 로그아웃됐다. 기기당 1행으로 옮기고 그 행만 회전·폐기한다.
--
-- 000 으로 만든 빈 DB 와 기존 dev DB 양쪽에서 멱등하게 동작한다.
-- 인덱스·제약 이름은 server/src/auth/refresh-token.entity.ts 와 같다.
CREATE TABLE IF NOT EXISTS `refresh_tokens` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime(6) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_refresh_tokens_token_hash` (`token_hash`),
  KEY `idx_refresh_tokens_user_id` (`user_id`),
  CONSTRAINT `fk_refresh_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- users.refresh_token_hash 는 더 이상 쓰지 않는다. 있을 때만 지운다(멱등).
SET @column_exists := (
  SELECT COUNT(*)
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'users'
    AND COLUMN_NAME = 'refresh_token_hash'
);

SET @drop_column_sql := IF(
  @column_exists = 1,
  'ALTER TABLE `users` DROP COLUMN `refresh_token_hash`',
  'DO 0'
);

PREPARE drop_column_stmt FROM @drop_column_sql;
EXECUTE drop_column_stmt;
DEALLOCATE PREPARE drop_column_stmt;
