// 공용 채팅 메시지 항목의 상태 4종 렌더, 원문 토글 접근성, 재시도 콜백, 시스템 메시지를 검증한다.
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import ChatMessageItem from '../ChatMessageItem';

const msg = {
  id: 101,
  nickname: '테스터',
  allianceName: 'KOR',
  language: 'ko',
  content: '10분 뒤 SFC 집결 갑니다',
  createdAt: '2026-09-10T00:00:00.000Z',
};

function renderItem(props) {
  return render(
    <I18nProvider>
      <ChatMessageItem
        msg={msg}
        myLang="en"
        autoTranslate
        pending={false}
        failed={false}
        onRetry={() => {}}
        variant="tab"
        {...props}
      />
    </I18nProvider>,
  );
}

describe('ChatMessageItem', () => {
  beforeEach(() => localStorage.setItem('wos-lang', 'ko'));
  afterEach(() => cleanup());

  it('번역 있음 — 번역문을 본문으로, 원문 보기는 aria-pressed 버튼', async () => {
    renderItem({ translations: { en: 'Rally to SFC in 10 min' } });
    expect(screen.getByText('Rally to SFC in 10 min')).toBeInTheDocument();
    const toggle = screen.getByRole('button', { name: '원문 보기' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);
    expect(screen.getByText(msg.content)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '번역 보기' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('원문 보기 토글은 키보드 Enter로도 동작한다', async () => {
    const user = userEvent.setup();
    renderItem({ translations: { en: 'Rally to SFC in 10 min' } });
    const toggle = screen.getByRole('button', { name: '원문 보기' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByText(msg.content)).toBeInTheDocument();
  });

  it('대기 — "번역 중…"을 aria-live=polite로 보여준다', () => {
    renderItem({ pending: true });
    const status = screen.getByText('번역 중…');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status.className).toContain('chat-msg-status');
    expect(screen.getByText(msg.content)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('실패 — "번역 실패"와 다시 시도 버튼, 클릭하면 onRetry(id)', () => {
    const onRetry = vi.fn();
    renderItem({ failed: true, onRetry });
    expect(screen.getByText(/번역 실패/)).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: '다시 시도' });
    expect(retry.className).toContain('chat-msg-retry');
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledWith(101);
  });

  it('원문 — 자동번역 off면 번역이 있어도 원문만, 상태 표시 없음', () => {
    renderItem({ autoTranslate: false, translations: { en: 'Rally' }, pending: true });
    expect(screen.getByText(msg.content)).toBeInTheDocument();
    expect(screen.queryByText('Rally')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText('번역 중…')).toBeNull();
  });

  it('tab 변형은 [연맹] 태그와 chat-tab-msg 클래스, dock 변형은 chat-dock-msg 클래스', () => {
    const { container, unmount } = renderItem({});
    expect(container.querySelector('.chat-tab-msg')).not.toBeNull();
    expect(screen.getByText('[KOR]')).toBeInTheDocument();
    expect(container.querySelector('.chat-tab-msg-avatar').textContent).toBe('테스');
    unmount();

    const dock = renderItem({ variant: 'dock' });
    expect(dock.container.querySelector('.chat-dock-msg')).not.toBeNull();
    expect(dock.container.querySelector('.chat-tab-msg')).toBeNull();
    expect(screen.queryByText('[KOR]')).toBeNull();
  });

  it('시스템 메시지는 kind를 현재 언어 문구로 렌더한다', () => {
    const { container } = renderItem({
      msg: { _type: 'system', _id: 's1', kind: 'joined', nickname: 'a' },
    });
    expect(container.querySelector('.chat-tab-system-msg').textContent).toContain(
      'a님이 입장했습니다',
    );
  });

  it('시스템 메시지 dock 변형은 chat-dock-system', () => {
    const { container } = renderItem({
      variant: 'dock',
      msg: { _type: 'system', _id: 's1', kind: 'joinedMany', count: 3 },
    });
    expect(container.querySelector('.chat-dock-system').textContent).toContain(
      '3명이 입장했습니다',
    );
  });
});
