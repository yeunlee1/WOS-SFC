// 실시간 삭제로 상세 공지가 사라질 때 목록으로 복구되는지 검증한다.
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import Noticeboard from '../Noticeboard';
import { I18nProvider } from '../../../i18n';
import { useStore } from '../../../store';

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
});
