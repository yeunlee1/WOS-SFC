-- 채팅 메시지별 번역 테이블. (message_id, lang) 이 PK 라 메시지 하나의 언어별 번역이 곧 캐시다.
--
-- 왜 텍스트 해시 캐시(translations)를 쓰지 않는가 —
--   같은 문장이라도 원문 언어가 모호하면(한자 공유 문장) 해시 키 하나로는 번역이 뒤섞이고,
--   히스토리 200건에 번역을 동봉하려면 메시지 id 로 조인하는 편이 싸다(설계 3.6, 감사 C 5절 I).
--   메시지 보존 정리가 지우면 FK CASCADE 로 번역도 함께 사라진다(A-P6).
--
-- 엔티티: server/src/chat/message-translation.entity.ts — 컬럼·PK·FK 이름이 여기와 같아야
-- dev 의 synchronize 가 재생성하지 않는다. message-translation.entity.spec.ts 가 대조한다.
CREATE TABLE IF NOT EXISTS `message_translations` (
  `message_id` int NOT NULL,
  `lang` varchar(8) NOT NULL,
  `text` text NOT NULL,
  `created_at` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`message_id`, `lang`),
  CONSTRAINT `fk_message_translations_message` FOREIGN KEY (`message_id`) REFERENCES `messages` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
