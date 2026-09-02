// 동화 껍데기가 탭을 전환하고, 관리자 탭은 developer 에게만 보이며, 로그아웃이 세션을 정리하는지 검증한다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../i18n';
import { useStore } from '../../store';
import StoryShell from '../StoryShell';

const api = vi.hoisted(() => ({ logout: vi.fn(async () => ({ ok: true })) }));
vi.mock('../../api', () => ({ api, getSocket: () => null, disconnectSocket: vi.fn() }));
vi.mock('../../components/Battle/tts', () => ({ speak: vi.fn(), stopAllTts: vi.fn() }));

const member = { id: 1, nickname: 'alice', role: 'member', allianceName: 'KOR', language: 'ko' };

function renderShell(props = {}) {
  const onTabChange = vi.fn();
  render(
    <I18nProvider>
      <StoryShell activeTab="battle" onTabChange={onTabChange} {...props}>
        <div>본문</div>
      </StoryShell>
    </I18nProvider>,
  );
  return { onTabChange };
}

describe('StoryShell', () => {
  beforeEach(() => {
    cleanup();
    useStore.setState({
      user: member,
      onlineUsers: [],
      timeSyncState: 'unsynced',
      timeSyncRtt: 0,
      timeOffset: 0,
      ttsMuted: false,
      ttsVolume: 0.3,
    });
  });

  it('탭 버튼을 누르면 onTabChange 를 부른다', () => {
    const { onTabChange } = renderShell();
    fireEvent.click(screen.getByRole('button', { name: '커뮤니티' }));
    expect(onTabChange).toHaveBeenCalledWith('community');
  });

  it('관리자 탭은 developer 에게만 보인다', () => {
    renderShell();
    expect(screen.queryByRole('button', { name: '관리자' })).toBeNull();
    cleanup();
    useStore.setState({ user: { ...member, role: 'developer' } });
    renderShell();
    expect(screen.getByRole('button', { name: '관리자' })).toBeInTheDocument();
  });

  it('로그아웃하면 API 를 부르고 사용자를 비운다', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: /alice/ }));
    fireEvent.click(screen.getByRole('button', { name: '로그아웃' }));
    await waitFor(() => expect(useStore.getState().user).toBeNull());
    expect(api.logout).toHaveBeenCalled();
  });

  it('미동기화 상태를 성공처럼 표시하지 않는다', () => {
    renderShell();
    expect(screen.getByText('미동기화')).toBeInTheDocument();
    expect(screen.queryByText(/±\s*0\s*ms/)).toBeNull();
  });
});
