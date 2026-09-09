// 연맹 공지 수동 번역이 other→en 요청, 실패 표시, i18n 버튼 문구를 지키는지 검증한다 (B-10).
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AllianceNoticeboard from '../AllianceNoticeboard';
import { I18nProvider } from '../../../i18n';
import { useStore } from '../../../store';
import { api } from '../../../api';

vi.mock('../../../api', () => ({
  api: {
    translate: vi.fn(),
    addAllianceNotice: vi.fn(),
    deleteAllianceNotice: vi.fn(),
  },
}));

function renderBoard(uiLang) {
  localStorage.setItem('wos-lang', uiLang);
  const view = render(
    <I18nProvider>
      <AllianceNoticeboard alliance="KOR" />
    </I18nProvider>,
  );
  fireEvent.click(screen.getByText('공지 제목'));
  return view;
}

describe('AllianceNoticeboard 번역', () => {
  beforeEach(() => {
    api.translate.mockReset();
    useStore.setState({
      user: { id: 1, nickname: 'member', role: 'member', allianceName: 'KOR' },
      allianceNotices: {
        KOR: [
          {
            id: 3,
            source: 'game',
            title: '공지 제목',
            content: '집결 안내',
            lang: 'ko',
            authorNick: 'lead',
          },
        ],
      },
    });
  });

  afterEach(() => cleanup());

  it('UI 언어 other는 en으로 요청한다', () => {
    api.translate.mockResolvedValue({ translated: 'Rally notice' });
    renderBoard('other');
    fireEvent.click(screen.getByRole('button', { name: /Translate/ }));
    expect(api.translate).toHaveBeenCalledWith('집결 안내', 'en');
  });

  it('실패하면 실패 문구를 보이고 버튼이 다시 살아난다', async () => {
    api.translate.mockRejectedValueOnce(new Error('provider'));
    renderBoard('en');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Translate/ }));
    });
    await waitFor(() =>
      expect(screen.getByText('Translation failed')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Translate/ })).not.toBeDisabled();
  });
});
