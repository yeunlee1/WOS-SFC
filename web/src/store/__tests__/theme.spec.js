// theme.spec.js — 테마 정책 회귀 가드.
//
// 검증 목적:
//  1) THEMES 배열에 frost 포함 + 4개 테마 모두 등록됨 (UI 옵션 누락 방지)
//  2) setTheme: 알 수 없는 값 → fallback 'frost' (신규 사용자 기본값)
//  3) setTheme: 유효한 4개 테마 모두 통과
//  4) setTheme이 localStorage에 즉시 반영
//
// 설계 메모:
//  - _initTheme은 모듈 로드 시점에 한 번 실행 — vi.resetModules로 재로드 검증
//  - localStorage는 jsdom에서 기본 제공 — 매 it 마다 clear()로 초기화

import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('store theme — THEMES 정책 + setTheme/_initTheme 회귀 가드', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
  });

  it('THEMES 배열은 2개 테마 (frost/spring), frost-first', async () => {
    const { THEMES } = await import('../index.js');
    // frost = 메인 테마, spring = Phase 8에서 풀 리뉴얼 예정. anthropic/dark 폐기.
    expect(THEMES).toEqual(['frost', 'spring']);
    expect(THEMES[0]).toBe('frost');
    expect(THEMES).toHaveLength(2);
  });

  it('_initTheme: localStorage 비어있을 때 fallback은 frost (신규 사용자 기본값)', async () => {
    expect(localStorage.getItem('wos-theme')).toBeNull();
    const { useStore } = await import('../index.js');
    expect(useStore.getState().theme).toBe('frost');
  });

  it('_initTheme: localStorage에 invalid 값 저장된 경우 fallback frost', async () => {
    localStorage.setItem('wos-theme', 'mystery-theme');
    const { useStore } = await import('../index.js');
    expect(useStore.getState().theme).toBe('frost');
  });

  it('_initTheme: 폐기된 anthropic/dark 사용자는 frost로 자동 마이그레이션', async () => {
    for (const old of ['anthropic', 'dark']) {
      vi.resetModules();
      localStorage.clear();
      localStorage.setItem('wos-theme', old);
      const { useStore } = await import('../index.js');
      expect(useStore.getState().theme).toBe('frost');
    }
  });

  it('_initTheme: 유효한 frost/spring localStorage 값은 유지', async () => {
    for (const t of ['frost', 'spring']) {
      vi.resetModules();
      localStorage.clear();
      localStorage.setItem('wos-theme', t);
      const { useStore } = await import('../index.js');
      expect(useStore.getState().theme).toBe(t);
    }
  });

  it('setTheme: 유효한 2개 테마 모두 적용 + localStorage 동기화', async () => {
    const { useStore } = await import('../index.js');
    const { setTheme } = useStore.getState();
    for (const t of ['frost', 'spring']) {
      setTheme(t);
      expect(useStore.getState().theme).toBe(t);
      expect(localStorage.getItem('wos-theme')).toBe(t);
    }
  });

  it('setTheme: 폐기된 anthropic/dark 또는 알 수 없는 값 전달 → frost로 fallback', async () => {
    const { useStore } = await import('../index.js');
    for (const bad of ['anthropic', 'dark', 'not-a-theme']) {
      useStore.getState().setTheme(bad);
      expect(useStore.getState().theme).toBe('frost');
      expect(localStorage.getItem('wos-theme')).toBe('frost');
    }
  });
});
