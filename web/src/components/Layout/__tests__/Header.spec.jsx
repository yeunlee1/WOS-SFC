// Header의 시간 동기화 배지가 미동기화 상태를 성공처럼 표시하지 않는지 검증한다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import Header from '../Header';
import { I18nProvider } from '../../../i18n';
import { useStore } from '../../../store';

vi.mock('../../Battle/tts', () => ({
  speak: vi.fn(),
  stopAllTts: vi.fn(),
}));

function renderHeader() {
  return render(
    <I18nProvider>
      <Header activeTab="battle" chatDockOpen={false} />
    </I18nProvider>,
  );
}

describe('Header 시간 동기화 배지', () => {
  beforeEach(() => {
    cleanup();
    useStore.setState({
      timeOffset: 0,
      timeSyncRtt: 0,
      timeSyncState: 'unsynced',
      onlineUsers: [],
    });
  });

  it('미동기화 상태에서는 ±0ms 성공 표시를 하지 않는다', () => {
    renderHeader();
    const badge = document.querySelector('.time-sync-badge');
    expect(badge).toBeInTheDocument();
    expect(badge.textContent).not.toMatch(/±\s*0\s*ms/);
    expect(badge.textContent).not.toContain('🟢');
    expect(badge.textContent).toContain('미동기화');
  });

  it('동기화 시도 중에는 진행 상태를 표시한다', () => {
    useStore.setState({ timeSyncState: 'syncing' });
    renderHeader();
    expect(document.querySelector('.time-sync-badge').textContent).toContain(
      '동기화 중',
    );
  });

  it('동기화 실패는 실패로 표시한다', () => {
    useStore.setState({ timeSyncState: 'failed' });
    renderHeader();
    const badge = document.querySelector('.time-sync-badge');
    expect(badge.textContent).toContain('실패');
    expect(badge.textContent).not.toContain('🟢');
  });

  it('동기화 성공 후에만 실측 RTT를 표시한다', () => {
    useStore.setState({ timeSyncState: 'synced', timeSyncRtt: 42 });
    renderHeader();
    const badge = document.querySelector('.time-sync-badge');
    expect(badge.textContent).toContain('42ms');
    expect(badge.textContent).toContain('🟢');
  });

  it('미동기화 상태에서는 시계가 서버 시각인 것처럼 안내하지 않는다', () => {
    renderHeader();
    const clock = document.querySelector('.world-clock');
    expect(clock.getAttribute('title')).toContain('미동기화');
  });
});
