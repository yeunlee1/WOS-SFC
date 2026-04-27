-- 회원가입에서 더 이상 입력받지 않는 PII 필드를 NULL 허용으로 전환
-- (코드: server/src/users/users.entity.ts — name/birthDate를 nullable로 변경)
-- 적용 시점: 새 회원가입 코드 배포 직전.
ALTER TABLE users MODIFY COLUMN birth_date DATE NULL;
ALTER TABLE users MODIFY COLUMN name VARCHAR(100) NULL;
