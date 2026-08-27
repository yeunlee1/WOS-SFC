-- 빈 데이터베이스에 11개 엔티티 테이블을 만드는 초기 스키마.
--
-- 왜 필요한가:
--   server/src/app.module.ts 의 TypeORM 설정은 `synchronize: !isProduction && allowSync` 라
--   NODE_ENV=production 에서는 자동 테이블 생성이 항상 꺼진다. 컨테이너 배포는 매번 빈 DB로
--   시작하므로 이 파일이 없으면 부팅 직후 모든 쿼리가 "Table doesn't exist" 로 실패한다.
--   기존 001~003 은 전부 ALTER/UPDATE/CREATE INDEX 라 테이블을 만들지 않는다.
--
-- 파일명이 000 인 이유:
--   마이그레이션 러너(server/src/database/migrate.ts)는 파일명을 문자열 오름차순으로 정렬해
--   실행한다. '000' < '001' 이므로 기존 번호를 손대지 않고 맨 앞에 끼워 넣을 수 있다.
--
-- 기존 마이그레이션과의 관계 — 빈 DB에서 000 → 001 → 002 → 003 을 순서대로 다 돌리면 된다.
--   001: 이 파일이 birth_date/name 을 이미 NULL 허용으로 만들지만, 001 의 MODIFY COLUMN 은
--        같은 정의를 다시 적용하는 것이라 실패하지 않는다(무의미하지만 안전한 재적용).
--   002: 개발 계정 rename 은 새 DB에 대상 행이 0건이라 0 rows affected 로 끝난다.
--   003: 이 파일은 idx_messages_created_at 을 만들지 않는다. TypeORM 엔티티에 그 인덱스가
--        선언되어 있지 않아 "엔티티가 만드는 스키마"와 일치시키려면 여기 있으면 안 되고,
--        003 이 그 인덱스의 단일 소유자로 남아야 중복 생성이 없다.
--
-- CREATE TABLE IF NOT EXISTS 를 쓴 이유:
--   이미 테이블이 있는 기존 DB(개발용 wos_db 등)에 러너를 처음 붙일 때 000 이 곧바로
--   실패하지 않게 한다. 다만 IF NOT EXISTS 는 "있으면 건너뛴다"일 뿐 기존 테이블의 정의가
--   이 파일과 같은지 검사하지 않는다. 기존 DB에 적용할 때는 스키마 일치를 따로 확인할 것.
--
-- 문자셋을 테이블마다 명시한 이유:
--   운영 DB(wos_db)가 utf8mb4 / utf8mb4_unicode_ci 다. MySQL 8.4 서버 기본값은
--   utf8mb4_0900_ai_ci 라, 명시하지 않으면 컨테이너에서 만든 DB가 다른 정렬 규칙을 갖게 되고
--   nickname UNIQUE 비교 결과가 환경마다 달라진다.
--
-- 이 파일의 컬럼 정의는 추측이 아니라, 임시 DB에서 TypeORM synchronize 로 테이블을 만든 뒤
-- SHOW CREATE TABLE 출력을 그대로 옮긴 것이다. 인덱스/외래키 이름(IDX_*, FK_*)도 TypeORM 이
-- 생성하는 해시 이름 그대로여서, 개발 환경에서 synchronize 를 켜도 재생성이 일어나지 않는다.
--
-- 외래키 의존 순서대로 배치했다: users → (messages, rally_groups) → rally_group_members.

CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nickname` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `alliance_name` varchar(100) NOT NULL,
  `role` enum('admin','member','developer') NOT NULL,
  `birth_date` date DEFAULT NULL,
  `name` varchar(100) DEFAULT NULL,
  `language` enum('ko','en','ja','zh','ru','other') NOT NULL,
  `refresh_token_hash` varchar(255) DEFAULT NULL,
  `march_seconds` int DEFAULT NULL,
  `is_leader` tinyint NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_ad02a1be8707004cb805a4b502` (`nickname`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `source` varchar(20) NOT NULL,
  `title` varchar(200) NOT NULL DEFAULT '공지',
  `content` text NOT NULL,
  `author_nick` varchar(50) NOT NULL DEFAULT '',
  `lang` varchar(10) NOT NULL DEFAULT 'ko',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `alliance_notices` (
  `id` int NOT NULL AUTO_INCREMENT,
  `alliance` varchar(10) NOT NULL,
  `source` varchar(20) NOT NULL,
  `title` varchar(200) NOT NULL DEFAULT '공지',
  `content` text NOT NULL,
  `author_nick` varchar(50) NOT NULL DEFAULT '',
  `lang` varchar(10) NOT NULL DEFAULT 'ko',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- image_urls 는 엔티티에서 simple-json 이라 TypeORM 이 text 로 만든다(JSON 타입 아님).
CREATE TABLE IF NOT EXISTS `board_posts` (
  `id` int NOT NULL AUTO_INCREMENT,
  `alliance` varchar(10) NOT NULL,
  `nickname` varchar(50) NOT NULL,
  `user_alliance` varchar(100) NOT NULL,
  `content` text NOT NULL,
  `lang` varchar(10) NOT NULL DEFAULT 'ko',
  `image_urls` text,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- normalSeconds/petSeconds 는 엔티티에 name 지정이 없어 camelCase 컬럼명 그대로 만들어진다.
CREATE TABLE IF NOT EXISTS `members` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL,
  `role` varchar(100) NOT NULL DEFAULT '',
  `notes` varchar(100) NOT NULL DEFAULT '',
  `normalSeconds` int NOT NULL DEFAULT '0',
  `petSeconds` int NOT NULL DEFAULT '0',
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `rallies` (
  `id` int NOT NULL AUTO_INCREMENT,
  `name` varchar(100) NOT NULL DEFAULT '집결',
  `end_time_utc` bigint NOT NULL,
  `total_seconds` int NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `translations` (
  `cache_key` varchar(255) NOT NULL,
  `translated` text NOT NULL,
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`cache_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `operation_boards` (
  `id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(80) NOT NULL,
  `background_type` varchar(16) NOT NULL DEFAULT 'grid',
  `background_image_url` varchar(255) DEFAULT NULL,
  `elements_json` json NOT NULL,
  `created_by_user_id` int NOT NULL,
  `created_by_nick` varchar(50) NOT NULL,
  `updated_by_user_id` int NOT NULL,
  `updated_by_nick` varchar(50) NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- created_at 인덱스는 여기 없다. 003_messages_created_at_index.sql 이 담당한다.
CREATE TABLE IF NOT EXISTS `messages` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `content` text NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `FK_830a3c1d92614d1495418c46736` (`user_id`),
  CONSTRAINT `FK_830a3c1d92614d1495418c46736` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- created_by_id 외래키에는 ON DELETE 절이 없다(기본 RESTRICT). 엔티티의 @ManyToOne 에
-- onDelete 지정이 없어서 TypeORM 이 만드는 정의도 동일하다.
CREATE TABLE IF NOT EXISTS `rally_groups` (
  `id` varchar(36) NOT NULL,
  `name` varchar(40) NOT NULL,
  `display_order` int NOT NULL DEFAULT '1',
  `created_by_id` int NOT NULL,
  `broadcast_all` tinyint NOT NULL DEFAULT '0',
  `state` enum('idle','running','finished') NOT NULL DEFAULT 'idle',
  `started_at_server_ms` bigint DEFAULT NULL,
  `max_march_seconds` int DEFAULT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`id`),
  KEY `FK_f0731394c343f11b49062c1f0de` (`created_by_id`),
  CONSTRAINT `FK_f0731394c343f11b49062c1f0de` FOREIGN KEY (`created_by_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- group_id 가 varchar(255) 인 것은 오타가 아니다. 엔티티의 @Column({ name: 'group_id' }) 에
-- 타입 지정이 없어 TypeORM 이 string 기본 길이 255 로 만든다(참조 대상 rally_groups.id 는
-- @PrimaryGeneratedColumn('uuid') 라 varchar(36)). MySQL 은 문자열 외래키의 길이가 달라도
-- 문자셋/정렬이 같으면 허용하므로 실제로 생성된다. 여기서 36으로 "고쳐" 쓰면 개발 환경에서
-- synchronize 가 컬럼을 다시 255로 되돌린다.
CREATE TABLE IF NOT EXISTS `rally_group_members` (
  `id` varchar(36) NOT NULL,
  `group_id` varchar(255) NOT NULL,
  `user_id` int NOT NULL,
  `order_index` int NOT NULL,
  `march_seconds_override` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_47b79204e503a1f45d25637b28` (`group_id`,`order_index`),
  UNIQUE KEY `IDX_56d859c3c04de3d82ff8bf0302` (`group_id`,`user_id`),
  KEY `FK_062d6370450c82391e38cf5305d` (`user_id`),
  CONSTRAINT `FK_062d6370450c82391e38cf5305d` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `FK_4d77083e3eee3794f19d83280ba` FOREIGN KEY (`group_id`) REFERENCES `rally_groups` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
