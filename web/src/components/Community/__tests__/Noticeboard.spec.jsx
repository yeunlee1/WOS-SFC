// 실시간 삭제로 상세 공지가 사라질 때 목록으로 복구되는지, 수동 번역이 other→en·실패 표시·i18n 문구를 지키는지 검증한다.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Noticeboard from '../Noticeboard';
import { I18nProvider } from '../../../i18n';
import { useStore } from '../../../store';
import { api } from '../../../api';

vi.mock('../../../api', () => ({
  api: {
    addNotice: vi.fn(),
    deleteNotice: vi.fn(),
    translate: vi.fn(),
  },
}));

describe('Noticeboard', () => {
  beforeEach(() => {
    cleanup();
    api.translate.mockReset();
    localStorage.setItem('wos-lang', 'ko');
    useStore.setState({
      user: { id: 1, nickname: 'member', role: 'member', allianceName: 'KOR' },
      notices: [
        {
          id: 1,
          source: 'game',
          title: '중요 공지',
          content: '내용',
          lang: 'ko',
        },
      ],
    });
  });

  it('returns to the list when the selected notice is removed remotely', () => {
    render(
      <I18nProvider>
        <Noticeboard />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('중요 공지'));
    expect(screen.getByText('내용')).toBeInTheDocument();

    act(() => useStore.setState({ notices: [] }));

    expect(screen.getByText('고정된 공지가 없어요')).toBeInTheDocument();
  });

  // B-10, B Q3: other UI 언어는 en으로 요청하고 실패를 숨기지 않는다.
  it('UI 언어 other는 en으로 번역을 요청하고 버튼 문구는 i18n이다', () => {
    localStorage.setItem('wos-lang', 'other');
    api.translate.mockResolvedValue({ translated: 'content' });
    render(
      <I18nProvider>
        <Noticeboard />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('중요 공지'));
    fireEvent.click(screen.getByRole('button', { name: /Translate/ }));
    expect(api.translate).toHaveBeenCalledWith('내용', 'en');
  });

  it('번역 실패를 문구로 보이고 다시 시도할 수 있다', async () => {
    localStorage.setItem('wos-lang', 'en');
    api.translate.mockRejectedValueOnce(new Error('provider'));
    render(
      <I18nProvider>
        <Noticeboard />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText('중요 공지'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Translate/ }));
    });
    await waitFor(() =>
      expect(screen.getByText('Translation failed')).toBeInTheDocument(),
    );
    expect(screen.getByRole('button', { name: /Translate/ })).not.toBeDisabled();
  });
});
