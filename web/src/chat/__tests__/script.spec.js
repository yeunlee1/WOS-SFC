// 채팅 원문의 스크립트 판별과 번역 대상 언어 정규화가 서버와 공유하는 픽스처와 일치하는지 검증한다.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  detectScript,
  effectiveLang,
  SUPPORTED_TARGETS,
  unambiguousLang,
} from '../script';

const fixturePath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../docs/contracts/chat-events.json',
);
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
const scriptFixtures = fixtures['script-fixtures'];

describe('detectScript / unambiguousLang — 공유 픽스처', () => {
  it('픽스처가 8건이다 (비어 있으면 위음성)', () => {
    expect(scriptFixtures).toHaveLength(8);
  });

  it.each(scriptFixtures.map((f) => [f.text, f.script, f.unambiguous]))(
    '"%s" → script %s, unambiguous %s',
    (text, script, unambiguous) => {
      expect(detectScript(text)).toBe(script);
      expect(unambiguousLang(text)).toBe(unambiguous);
    },
  );

  it('빈 문자열과 공백은 none', () => {
    expect(detectScript('')).toBe('none');
    expect(detectScript('   ')).toBe('none');
    expect(unambiguousLang('')).toBeNull();
  });

  it('가나와 한자가 섞이면 ja (한자 전용만 han)', () => {
    expect(detectScript('要塞を準備')).toBe('ja');
    expect(unambiguousLang('要塞を準備')).toBe('ja');
  });
});

describe('effectiveLang', () => {
  it('지원 언어는 그대로', () => {
    for (const code of ['ko', 'en', 'ja', 'zh', 'ru']) {
      expect(effectiveLang(code)).toBe(code);
    }
  });

  it('other는 en', () => {
    expect(effectiveLang('other')).toBe('en');
  });

  it('미지 값·빈 값은 en', () => {
    expect(effectiveLang('fr')).toBe('en');
    expect(effectiveLang(undefined)).toBe('en');
    expect(effectiveLang(null)).toBe('en');
    expect(effectiveLang('')).toBe('en');
  });

  it('SUPPORTED_TARGETS는 5개 언어를 이 순서로 가진다', () => {
    expect(SUPPORTED_TARGETS).toEqual(['ko', 'en', 'ja', 'zh', 'ru']);
  });
});
