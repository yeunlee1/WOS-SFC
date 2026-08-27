-- 회원가입에서 더 이상 입력받지 않는 PII 필드를 NULL 허용으로 전환
-- (코드: server/src/users/users.entity.ts — name/birthDate를 nullable로 변경)
-- 적용 시점: 새 회원가입 코드 배포 직전.
--
-- 000_initial_schema.sql 과의 관계:
--   000 은 이미 birth_date/name 을 NULL 허용으로 만든다(엔티티의 현재 상태를 재현하므로).
--   따라서 빈 DB에서 000 다음에 이 파일이 도는 것은 같은 정의를 다시 적용하는 것이고,
--   MySQL 은 정의가 같은 MODIFY COLUMN 을 오류 없이 받는다(무의미하지만 안전).
--   이 파일은 000 이전부터 운영되던 DB — 두 컬럼이 아직 NOT NULL 인 DB — 를 위해 남긴다.
ALTER TABLE users MODIFY COLUMN birth_date DATE NULL;
ALTER TABLE users MODIFY COLUMN name VARCHAR(100) NULL;
