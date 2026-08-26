// ThemePicker.spec.jsx — 테마 선택기가 THEMES 3종을 모두 노출하는지 회귀 가드.
//
// 검증 목적:
//  1) THEME_META가 store의 THEMES와 1:1로 일치 (한쪽만 추가되는 드리프트 차단)
//  2) listbox 옵션 3개가 렌더되고 daylight 옵션이 존재한다
//  3) daylight 옵션 클릭 → store.theme === 'daylight' + localStorage 반영
//
// 설계 메모:
//  - 드롭다운은 항상 마운트(aria-hidden 토글)되므로 열지 않아도 옵션 DOM은 존재.
//    실제 사용 경로를 따라 trigger를 먼저 클릭한 뒤 옵션을 클릭한다.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useStore, THEMES } from '../../../store';
import ThemePicker from '../ThemePicker';

describe('ThemePicker — 테마 3종 노출 + 선택', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useStore.getState().setTheme('frost');
  });

  it('옵션 개수가 store THEMES 개수와 같다 (드리프트 차단)', () => {
    render(<ThemePicker />);
    const options = document.querySelectorAll('.theme-picker__option');
    expect(options.length).toBe(THEMES.length);
    expect(options.length).toBe(3);
  });

  it('THEMES의 모든 id에 대응하는 옵션 id가 존재한다', () => {
    render(<ThemePicker />);
    for (const t of THEMES) {
      expect(document.getElementById(`theme-opt-${t}`), `theme-opt-${t} 없음`).not.toBeNull();
    }
  });

  it('daylight 옵션 라벨에 "백야"가 들어간다', () => {
    render(<ThemePicker />);
    const opt = document.getElementById('theme-opt-daylight');
    expect(opt.textContent).toContain('백야');
  });

  it('daylight 옵션을 클릭하면 store와 localStorage가 daylight가 된다', () => {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole('button', { name: /테마 변경/ }));
    fireEvent.click(document.getElementById('theme-opt-daylight'));
    expect(useStore.getState().theme).toBe('daylight');
    expect(localStorage.getItem('wos-theme')).toBe('daylight');
  });

  it('daylight 선택 후 frost로 되돌릴 수 있다 (스왑 가능)', () => {
    render(<ThemePicker />);
    fireEvent.click(screen.getByRole('button', { name: /테마 변경/ }));
    fireEvent.click(document.getElementById('theme-opt-daylight'));
    expect(useStore.getState().theme).toBe('daylight');
    fireEvent.click(screen.getByRole('button', { name: /테마 변경/ }));
    fireEvent.click(document.getElementById('theme-opt-frost'));
    expect(useStore.getState().theme).toBe('frost');
    expect(localStorage.getItem('wos-theme')).toBe('frost');
  });
});
