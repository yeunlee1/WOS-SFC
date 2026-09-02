// 경로에 따라 기존 앱과 동화 버전 중 무엇을 띄울지 정하는 규칙을 검증한다.
import { describe, it, expect } from 'vitest';
import { resolveEntry } from '../entry';

describe('resolveEntry', () => {
  it('/story 와 그 하위 경로는 동화 버전이다', () => {
    expect(resolveEntry('/story')).toBe('story');
    expect(resolveEntry('/story/')).toBe('story');
    expect(resolveEntry('/story/battle')).toBe('story');
  });

  it('그 밖의 경로는 기존 앱이다', () => {
    expect(resolveEntry('/')).toBe('main');
    expect(resolveEntry('/storybook')).toBe('main');
    expect(resolveEntry('/battle')).toBe('main');
  });
});
