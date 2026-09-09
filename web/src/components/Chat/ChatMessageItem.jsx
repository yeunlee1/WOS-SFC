// 채팅 메시지 한 줄 — ChatTab·ChatDock·작전판 패널·동화 버전이 공유한다. 번역 상태 4종(원문·번역·대기·실패)과 시스템 메시지를 그린다.
import { memo, useState } from 'react';
import { useI18n } from '../../i18n';
import { getAllianceColor } from '../../store';
import { selectDisplay } from '../../chat/display';
import { formatSystemMessage } from '../../chat/systemMessages';
import { formatMessageTime, initialsOf } from './chatFormat';

// variant별 클래스 — 기존 CSS 선택자를 그대로 쓴다. dock은 연맹 태그를 그리지 않는다.
const CLASSES = {
  tab: {
    root: 'chat-tab-msg',
    avatar: 'chat-tab-msg-avatar',
    body: 'chat-tab-msg-body',
    head: 'chat-tab-msg-head',
    nick: 'chat-tab-msg-nick',
    alliance: 'chat-tab-msg-alliance',
    time: 'chat-tab-msg-time',
    text: 'chat-tab-msg-text',
    toggle: 'chat-tab-toggle-original',
    system: 'chat-tab-system-msg',
  },
  dock: {
    root: 'chat-dock-msg',
    avatar: 'chat-dock-msg-avatar',
    body: 'chat-dock-msg-body',
    head: 'chat-dock-msg-head',
    nick: 'chat-dock-msg-nick',
    alliance: null,
    time: 'chat-dock-msg-time',
    text: 'chat-dock-msg-text',
    toggle: 'chat-dock-msg-tr',
    system: 'chat-dock-system',
  },
};

function ChatMessageItem({
  msg,
  translations,
  myLang,
  autoTranslate,
  pending,
  failed,
  onRetry,
  variant = 'tab',
}) {
  const { t } = useI18n();
  const [showOriginal, setShowOriginal] = useState(false);
  const cls = CLASSES[variant] || CLASSES.tab;

  if (msg?._type === 'system') {
    return <div className={cls.system}>— {formatSystemMessage(msg, t)} —</div>;
  }

  const display = selectDisplay(
    msg,
    translations,
    myLang,
    autoTranslate,
    pending,
    failed,
  );
  const text =
    display.state === 'translated' && showOriginal
      ? display.original
      : display.text;
  const color = getAllianceColor(msg.allianceName);

  return (
    <div className={cls.root} data-msg-id={msg.id}>
      <div className={cls.avatar} style={{ background: color }}>
        {initialsOf(msg.nickname)}
      </div>
      <div className={cls.body}>
        <div className={cls.head}>
          <span className={cls.nick}>{msg.nickname}</span>
          {cls.alliance && msg.allianceName && (
            <span className={cls.alliance} style={{ color }}>
              [{msg.allianceName}]
            </span>
          )}
          <span className={cls.time}>
            {formatMessageTime(msg.createdAt, myLang)}
          </span>
        </div>
        <p className={cls.text}>{text}</p>
        {display.state === 'translated' && (
          <button
            type="button"
            className={cls.toggle}
            aria-pressed={showOriginal}
            onClick={() => setShowOriginal((v) => !v)}
          >
            {showOriginal ? t('viewTranslation') : t('viewOriginal')}
          </button>
        )}
        {display.state === 'pending' && (
          <span
            className="chat-msg-status chat-msg-status--pending"
            aria-live="polite"
          >
            {t('chatTranslating')}
          </span>
        )}
        {display.state === 'failed' && (
          <span className="chat-msg-status chat-msg-status--failed">
            {t('chatTranslateFailed')}{' '}
            <button
              type="button"
              className="chat-msg-retry"
              onClick={() => onRetry?.(msg.id)}
            >
              {t('chatRetry')}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

export default memo(ChatMessageItem);
