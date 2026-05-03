// CommandPalette.spec.jsx — 명령 팔레트 카탈로그 구성 + role 분기 + filtering 회귀 가드.
//
// 검증 목적:
//  1) open=true 일 때 5개 섹션(NAVIGATE/ACTIONS/LANGUAGE/THEME/SESSION)이 모두 렌더된다.
//  2) user.role !== 'developer' → admin 명령 미노출
//     user.role === 'developer' → admin 명령 추가 노출 ('Go to: 🛡️ 관리자')
//  3) 검색 query에서 결과 0개 → cmdk-empty 표시
//  4) open=false → 컴포넌트 자체가 unmount (overlay/dialog 미렌더)
//
// 설계 메모:
//  - I18nProvider로 감싸 t() 호출 가능하게 함 (영문 'NAVIGATE' 등 라벨 사용 → en으로 고정)
//  - useStore.setState 로 user.role 직접 주입
//  - CommandPalette 의 props.run 콜백은 호출 안 함 (DOM 검증만)

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { I18nProvider } from '../../../i18n';
import { useStore } from '../../../store';
import CommandPalette from '../CommandPalette';

function renderWithProviders(ui) {
  // i18n에서 'wos-lang'을 'en'으로 고정 — section 라벨이 영문 대문자로 안정적
  localStorage.setItem('wos-lang', 'en');
  return render(<I18nProvider>{ui}</I18nProvider>);
}

describe('CommandPalette — 명령 카탈로그 + role 분기', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useStore.setState({
      user: { nickname: 'tester', role: 'member', allianceName: 'KOR' },
      ttsMuted: false,
    });
  });

  it('open=false → overlay/dialog 미렌더 (컴포넌트 자체 null)', () => {
    const { container } = renderWithProviders(
      <CommandPalette open={false} onClose={() => {}} onTabChange={() => {}} onToggleChatDock={() => {}} />,
    );
    expect(container.querySelector('.cmdk-overlay')).toBeNull();
    expect(container.querySelector('[role="dialog"]')).toBeNull();
  });

  it('open=true → 5개 섹션 + 12개 기본 명령 렌더 (member role)', () => {
    renderWithProviders(
      <CommandPalette open={true} onClose={() => {}} onTabChange={() => {}} onToggleChatDock={() => {}} />,
    );
    // 5개 섹션 영문 대문자
    expect(screen.getByText('NAVIGATE')).toBeInTheDocument();
    expect(screen.getByText('ACTIONS')).toBeInTheDocument();
    expect(screen.getByText('LANGUAGE')).toBeInTheDocument();
    expect(screen.getByText('THEME')).toBeInTheDocument();
    expect(screen.getByText('SESSION')).toBeInTheDocument();
    // 명령 개수: tab 3 (admin 제외) + actions 2 + lang 4 + theme 2 (frost/spring) + session 1 = 12
    // Phase 3.5에서 anthropic/dark 테마 폐기 → theme 카테고리 4 → 2.
    const items = document.querySelectorAll('.cmdk-item');
    expect(items.length).toBe(12);
    // admin 명령 미노출 (영어 환경 — Admin 텍스트 검색)
    expect(screen.queryByText(/Admin/i)).toBeNull();
  });

  it('role=developer → admin 명령 추가 (총 13개)', () => {
    useStore.setState({
      user: { nickname: 'devtester', role: 'developer', allianceName: 'KOR' },
    });
    renderWithProviders(
      <CommandPalette open={true} onClose={() => {}} onTabChange={() => {}} onToggleChatDock={() => {}} />,
    );
    // admin 옵션은 영어 환경 라벨 'Go to: 🛡️ Admin' (i18n t('tabAdmin') = '🛡️ Admin')
    expect(screen.getByText(/Admin/)).toBeInTheDocument();
    // 12 (member 기본) + 1 (admin 명령) = 13
    const items = document.querySelectorAll('.cmdk-item');
    expect(items.length).toBe(13);
  });

  it('검색 결과 0개 → cmdk-empty 메시지 표시', () => {
    renderWithProviders(
      <CommandPalette open={true} onClose={() => {}} onTabChange={() => {}} onToggleChatDock={() => {}} />,
    );
    const input = document.querySelector('.cmdk-input');
    expect(input).not.toBeNull();
    fireEvent.change(input, { target: { value: 'xyzzy_no_match_query' } });
    // empty 메시지 = 'No results' (en)
    expect(screen.getByText('No results')).toBeInTheDocument();
    expect(document.querySelectorAll('.cmdk-item').length).toBe(0);
  });

  it('Escape 키로 onClose 호출', () => {
    const onClose = vi.fn();
    renderWithProviders(
      <CommandPalette open={true} onClose={onClose} onTabChange={() => {}} onToggleChatDock={() => {}} />,
    );
    const input = document.querySelector('.cmdk-input');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
