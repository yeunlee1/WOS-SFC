-- 새 nickname 정책(`^[A-Za-z0-9가-힣]{2,20}$` — 특수문자 금지)에 맞춰
-- 기존 `dev_*` 형태의 dev 빠른 로그인 계정을 camelCase로 rename.
-- (코드: web/src/components/Auth/AuthModal.jsx — DEV_ACCOUNTS의 nickname을 동일하게 변경)
--
-- 안전성:
--   - START TRANSACTION/COMMIT으로 원자적. 새 nickname과 UNIQUE 충돌 시 ROLLBACK.
--   - 외래키(messages.user_id, rally_group_members.user_id 등)는 users.id 기반이므로
--     nickname rename은 영향 없음 — 역할/marchSeconds/연맹 설정 등 모든 부속 데이터 보존.
--
-- 000_initial_schema.sql 과의 관계:
--   이 파일은 스키마가 아니라 데이터 정정이다. 000 으로 갓 만든 빈 DB에는 users 행이
--   하나도 없으므로 일곱 개 UPDATE 가 전부 0 rows affected 로 끝난다. 실패하지 않고,
--   여러 번 실행해도 결과가 같다(멱등).
--
-- 누락된 두 계정(devAdminZh, devAdminJa)은 사용자가 처음 dev 빠른 로그인 클릭 시
-- 자동 가입 흐름으로 정상 생성됨.
START TRANSACTION;
UPDATE users SET nickname='devDevKo'    WHERE nickname='dev_dev_ko';
UPDATE users SET nickname='devAdminKo'  WHERE nickname='dev_admin_ko';
UPDATE users SET nickname='devAdminEn'  WHERE nickname='dev_admin_en';
UPDATE users SET nickname='devMemberKo' WHERE nickname='dev_member_ko';
UPDATE users SET nickname='devMemberZh' WHERE nickname='dev_member_zh';
UPDATE users SET nickname='devMemberEn' WHERE nickname='dev_member_en';
UPDATE users SET nickname='devMemberJa' WHERE nickname='dev_member_ja';
COMMIT;
