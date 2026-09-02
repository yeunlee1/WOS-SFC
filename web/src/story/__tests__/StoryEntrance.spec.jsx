// 동화 입구의 로그인·가입이 기존 인증 계약(api → setUser → changeLang)을 지키는지 검증한다.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { I18nProvider } from '../../i18n';
import { useStore } from '../../store';
import StoryEntrance from '../StoryEntrance';

const api = vi.hoisted(() => ({ login: vi.fn(), signup: vi.fn() }));
vi.mock('../../api', () => ({ api }));
vi.mock('../../components/Battle/rallyGroupPlayer', () => ({
  warmupRallyAudio: vi.fn(async () => {}),
}));

function renderEntrance() {
  return render(
    <I18nProvider>
      <StoryEntrance />
    </I18nProvider>,
  );
}

describe('StoryEntrance', () => {
  beforeEach(() => {
    cleanup();
    useStore.setState({ user: null });
    api.login.mockReset();
    api.signup.mockReset();
  });

  it('빈 값으로 입장하면 안내를 보여주고 API 를 부르지 않는다', async () => {
    renderEntrance();
    fireEvent.click(screen.getByRole('button', { name: '입장' }));
    expect(await screen.findByText('닉네임과 비밀번호를 입력하세요')).toBeInTheDocument();
    expect(api.login).not.toHaveBeenCalled();
  });

  it('로그인 성공 시 사용자를 저장한다', async () => {
    api.login.mockResolvedValue({
      user: { id: 1, nickname: 'alice', language: 'ko', role: 'member', allianceName: 'KOR' },
    });
    renderEntrance();
    fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: 'alice' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: '입장' }));
    await waitFor(() => expect(useStore.getState().user?.nickname).toBe('alice'));
    expect(api.login).toHaveBeenCalledWith({ nickname: 'alice', password: 'secret1' });
  });

  it('가입 페이지에서 닉네임 규칙을 어기면 거부한다', async () => {
    renderEntrance();
    fireEvent.click(screen.getByRole('button', { name: /가입 코드로 이야기에 합류/ }));
    fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: 'a b' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'KOR' }));
    fireEvent.change(screen.getByLabelText('가입 코드'), { target: { value: 'code' } });
    fireEvent.click(screen.getByRole('button', { name: '합류하기' }));
    expect(await screen.findByText(/닉네임은 한글 또는 영문\/숫자만/)).toBeInTheDocument();
    expect(api.signup).not.toHaveBeenCalled();
  });

  it('가입이 성공하면 사용자를 저장한다', async () => {
    api.signup.mockResolvedValue({
      user: { id: 2, nickname: 'bob', language: 'en', role: 'member', allianceName: 'NSL' },
    });
    renderEntrance();
    fireEvent.click(screen.getByRole('button', { name: /가입 코드로 이야기에 합류/ }));
    fireEvent.change(screen.getByLabelText('닉네임'), { target: { value: 'bob' } });
    fireEvent.change(screen.getByLabelText('비밀번호'), { target: { value: 'secret1' } });
    fireEvent.click(screen.getByRole('button', { name: 'NSL' }));
    fireEvent.change(screen.getByLabelText('가입 코드'), { target: { value: 'code' } });
    fireEvent.click(screen.getByRole('button', { name: '합류하기' }));
    await waitFor(() => expect(useStore.getState().user?.nickname).toBe('bob'));
    expect(api.signup).toHaveBeenCalledWith({
      nickname: 'bob',
      password: 'secret1',
      allianceName: 'NSL',
      language: 'ko',
      serverCode: 'code',
    });
  });
});
