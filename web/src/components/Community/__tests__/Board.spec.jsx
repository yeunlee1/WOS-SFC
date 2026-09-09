// 게시판 수동 번역이 UI 언어 other에서도 en으로 요청하고, 실패를 숨기지 않고 i18n 문구로 보이는지 검증한다 (B-10, B Q3).
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Board from '../Board';
import { I18nProvider } from '../../../i18n';
import { useStore } from '../../../store';
import { api } from '../../../api';

vi.mock('../../../api', () => ({
  api: {
    translate: vi.fn(),
    addBoardPost: vi.fn(),
    deleteBoardPost: vi.fn(),
    uploadBoardImage: vi.fn(),
  },
}));

function renderBoard(uiLang) {
  localStorage.setItem('wos-lang', uiLang);
  return render(
    <I18nProvider>
      <Board alliance="KOR" />
    </I18nProvider>,
  );
}

describe('Board 번역', () => {
  beforeEach(() => {
    api.translate.mockReset();
    useStore.setState({
      user: { id: 1, nickname: 'member', role: 'member', allianceName: 'KOR' },
      boards: {
        KOR: [{ id: 7, nickname: 'x', alliance: 'KOR', content: '안녕', lang: 'ko' }],
      },
    });
  });

  afterEach(() => cleanup());

  it('UI 언어 other는 en으로 요청하고 버튼 문구는 i18n(en 폴백)이다', async () => {
    api.translate.mockResolvedValue({ translated: 'hello' });
    renderBoard('other');
    const button = screen.getByRole('button', { name: /Translate/ });
    fireEvent.click(button);
    expect(api.translate).toHaveBeenCalledWith('안녕', 'en');
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument());
  });

  it('요청 중에는 translating 문구, 실패하면 실패 문구를 보이고 다시 누를 수 있다', async () => {
    let reject;
    api.translate.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    renderBoard('en');
    fireEvent.click(screen.getByRole('button', { name: /Translate/ }));
    expect(screen.getByRole('button', { name: /Translating/ })).toBeDisabled();

    await act(async () => {
      reject(new Error('provider'));
    });
    expect(screen.getByText('Translation failed')).toBeInTheDocument();
    const again = screen.getByRole('button', { name: /Translate/ });
    expect(again).not.toBeDisabled();

    api.translate.mockResolvedValueOnce({ translated: 'hello' });
    fireEvent.click(again);
    await waitFor(() => expect(screen.getByText('hello')).toBeInTheDocument());
    expect(screen.queryByText('Translation failed')).toBeNull();
  });

  it('빈 응답도 실패로 보인다', async () => {
    api.translate.mockResolvedValue({});
    renderBoard('en');
    fireEvent.click(screen.getByRole('button', { name: /Translate/ }));
    await waitFor(() =>
      expect(screen.getByText('Translation failed')).toBeInTheDocument(),
    );
  });
});
