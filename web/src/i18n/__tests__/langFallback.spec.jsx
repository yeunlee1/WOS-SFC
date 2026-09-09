// ru·other UI 언어의 en 폴백, 러시아어 셀렉트 항목, 계정 언어 초기화 규칙(C-7, C-11)을 검증한다.
import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider, SUPPORTED_LANGS, applyAccountLang, useI18n } from '../index';

function Probe() {
  const { t, lang } = useI18n();
  return (
    <div>
      <span data-testid="lang">{lang}</span>
      <span data-testid="send">{t('chatSend')}</span>
    </div>
  );
}

describe('UI 언어 폴백', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => cleanup());

  it.each(['ru', 'other', 'fr'])('%s UI 언어는 영어 문구로 폴백한다', (code) => {
    localStorage.setItem('wos-lang', code);
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId('lang').textContent).toBe(code);
    expect(screen.getByTestId('send').textContent).toBe('Send');
  });

  it('SUPPORTED_LANGS에 ru가 있고 <html lang>은 지원 코드일 때만 바꾼다', () => {
    expect(SUPPORTED_LANGS.map((l) => l.code)).toEqual(['ko', 'en', 'ja', 'zh', 'ru']);
    expect(SUPPORTED_LANGS.find((l) => l.code === 'ru').flag).toBe('🇷🇺');
    localStorage.setItem('wos-lang', 'ru');
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(document.documentElement.lang).toBe('ru');
  });
});

describe('applyAccountLang — 세션 복원 시 계정 언어 적용 규칙', () => {
  beforeEach(() => localStorage.clear());

  it('wos-lang이 없을 때만 계정 언어로 changeLang을 부른다', () => {
    const changeLang = vi.fn();
    applyAccountLang(changeLang, 'ja');
    expect(changeLang).toHaveBeenCalledWith('ja');
  });

  it('wos-lang이 있으면 헤더에서 고른 언어를 덮지 않는다', () => {
    localStorage.setItem('wos-lang', 'en');
    const changeLang = vi.fn();
    applyAccountLang(changeLang, 'ko');
    expect(changeLang).not.toHaveBeenCalled();
  });

  it('계정 언어가 비어 있으면 ko', () => {
    const changeLang = vi.fn();
    applyAccountLang(changeLang, undefined);
    expect(changeLang).toHaveBeenCalledWith('ko');
  });
});
