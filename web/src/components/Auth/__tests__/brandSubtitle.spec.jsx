// brandSubtitle.spec.jsx — 로그인 화면 브랜드 부제의 테마별 분기 회귀 가드.
//
// 검증 목적:
//  1) frost/spring은 기존 문구를 "1글자도" 바꾸지 않는다 — 4개 언어 원문을 그대로 고정한다.
//  2) daylight만 백야에 맞는 다른 문구를 쓰고, 그 문구에 'FROST'가 들어가지 않는다.
//  3) 알 수 없는 테마는 기본(frost 문구)으로 떨어진다.
//
// 설계 메모:
//  - i18n의 UI_TEXTS는 export되지 않으므로, 언어별 원문 고정은 소스 문자열로 검사한다.
//    [한계] 이 부분은 "그 문자열이 파일에 있다"만 보증하고 렌더 결과는 보증하지 못한다.
//    렌더 결과는 아래 DOM 테스트가 ko 기준으로 따로 보증한다.

import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { I18nProvider } from '../../../i18n';
import { useStore } from '../../../store';
import AuthModal from '../AuthModal';

const i18nSrc = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../i18n/index.jsx'),
  'utf8',
);

// 2026-08-27 daylight 추가 직전의 실제 값. 이 표가 바뀌면 frost/spring 표시가 바뀐 것이다.
const FROST_SUBTITLE_BY_LANG = {
  ko: 'FROST PROTOCOL · 얼어붙은 전장',
  en: 'FROST PROTOCOL · FROZEN BATTLEFIELD',
  ja: 'FROST PROTOCOL · 凍りついた戦場',
  zh: 'FROST PROTOCOL · 冰封战场',
};

function renderModal(theme, lang = 'ko') {
  localStorage.setItem('wos-lang', lang);
  useStore.setState({ theme });
  return render(
    <I18nProvider>
      <AuthModal />
    </I18nProvider>,
  );
}

const subtitle = () => document.querySelector('.auth-subtitle').textContent;

describe('로그인 브랜드 부제 — frost/spring 문구 불변', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('4개 언어의 authBrandSubtitle 원문이 기존 값 그대로다', () => {
    for (const [lang, text] of Object.entries(FROST_SUBTITLE_BY_LANG)) {
      expect(i18nSrc, `${lang} 문구 변경됨`).toContain(`authBrandSubtitle: '${text}'`);
    }
  });

  it('frost 테마의 렌더 결과가 기존 문구와 완전히 같다', () => {
    renderModal('frost');
    expect(subtitle()).toBe(FROST_SUBTITLE_BY_LANG.ko);
  });

  it('spring 테마의 렌더 결과도 기존 문구와 완전히 같다', () => {
    renderModal('spring');
    expect(subtitle()).toBe(FROST_SUBTITLE_BY_LANG.ko);
  });

  it('알 수 없는 테마도 기본 문구로 떨어진다', () => {
    renderModal('not-a-theme');
    expect(subtitle()).toBe(FROST_SUBTITLE_BY_LANG.ko);
  });
});

describe('로그인 브랜드 부제 — daylight 전용 문구', () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
  });

  it('daylight는 기존 문구와 다른 문구를 쓴다', () => {
    renderModal('daylight');
    expect(subtitle()).not.toBe(FROST_SUBTITLE_BY_LANG.ko);
  });

  it('daylight 문구에 FROST/얼어붙은이 들어가지 않는다', () => {
    renderModal('daylight');
    const s = subtitle();
    expect(s).not.toMatch(/FROST/i);
    expect(s).not.toContain('얼어붙은');
  });

  it('daylight 문구는 백야 컨셉을 담는다', () => {
    renderModal('daylight');
    expect(subtitle()).toContain('백야');
  });

  it('daylight 전용 키가 4개 언어 모두에 정의돼 있다', () => {
    // 언어별 블록을 나눠 각각 확인 — 한 언어에만 있어도 통과하는 위양성 차단.
    for (const lang of ['ko', 'en', 'ja', 'zh']) {
      const tag = `\n  ${lang}: {`;
      const at = i18nSrc.indexOf(tag);
      expect(at, `${lang} 블록 없음`).toBeGreaterThan(-1);
      let i = at + tag.length - 1;
      let depth = 0;
      while (i < i18nSrc.length) {
        if (i18nSrc[i] === '{') depth++;
        else if (i18nSrc[i] === '}') {
          depth--;
          if (depth === 0) break;
        }
        i++;
      }
      const block = i18nSrc.slice(at, i + 1);
      expect(block, `${lang}에 authBrandSubtitleDaylight 없음`).toContain('authBrandSubtitleDaylight:');
    }
  });

  it('언어를 en으로 바꿔도 daylight 문구가 나온다 (ko fallback 누수 없음)', () => {
    renderModal('daylight', 'en');
    const s = subtitle();
    expect(s).not.toBe(FROST_SUBTITLE_BY_LANG.en);
    expect(s).not.toMatch(/FROST/i);
  });
});
