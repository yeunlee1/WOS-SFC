// 스크롤로 보이게 된 메시지 id를 300ms 스로틀로 모아 활성 동기화 인스턴스에 넘기는지 검증한다.
import React from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setActiveTranslationSync } from '../../../chat/translationSync';
import { collectVisibleMessageIds, useOlderTranslations } from '../useOlderTranslations';

function Harness({ ids }) {
  const ref = React.useRef(null);
  const onScroll = useOlderTranslations(ref);
  return (
    <div data-testid="box" ref={ref} onScroll={onScroll}>
      {ids.map((id) => (
        <div key={id} data-msg-id={id} />
      ))}
      <div data-msg-id="not-a-number" />
    </div>
  );
}

describe('useOlderTranslations', () => {
  const fakeSync = { onScrolledToOlder: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    fakeSync.onScrolledToOlder.mockClear();
    setActiveTranslationSync(fakeSync);
  });

  afterEach(() => {
    setActiveTranslationSync(null);
    vi.useRealTimers();
    cleanup();
  });

  it('collectVisibleMessageIds는 숫자 id만 모은다 (jsdom은 전부 보이는 것으로 친다)', () => {
    const view = render(<Harness ids={[3, 4]} />);
    expect(collectVisibleMessageIds(view.getByTestId('box'))).toEqual([3, 4]);
    expect(collectVisibleMessageIds(null)).toEqual([]);
  });

  it('스크롤 이벤트 여러 번은 300ms 뒤 한 번만 전달한다', () => {
    const view = render(<Harness ids={[1, 2]} />);
    const box = view.getByTestId('box');
    fireEvent.scroll(box);
    fireEvent.scroll(box);
    fireEvent.scroll(box);
    expect(fakeSync.onScrolledToOlder).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(fakeSync.onScrolledToOlder).toHaveBeenCalledTimes(1);
    expect(fakeSync.onScrolledToOlder).toHaveBeenCalledWith([1, 2]);
  });

  it('활성 인스턴스가 없으면 조용히 넘어간다', () => {
    setActiveTranslationSync(null);
    const view = render(<Harness ids={[1]} />);
    fireEvent.scroll(view.getByTestId('box'));
    expect(() => vi.advanceTimersByTime(300)).not.toThrow();
  });
});
