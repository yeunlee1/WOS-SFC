// 자동 스크롤 훅 — 사용자가 바닥에 있을 때만 따라가고, 아니면 새 메시지 배지를 센다 (B-7).
import React from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAutoScroll } from '../useAutoScroll';

let latest = null;
function Harness({ messages, contentKey }) {
  const scroll = useAutoScroll(messages, contentKey);
  latest = scroll;
  return (
    <div data-testid="box" ref={scroll.containerRef} onScroll={scroll.onScroll}>
      {messages.map((m) => (
        <p key={m.id}>{m.content}</p>
      ))}
      {scroll.newCount > 0 && <button data-testid="badge">{scroll.newCount}</button>}
    </div>
  );
}

// jsdom은 레이아웃이 없어 치수를 직접 심는다.
function setMetrics(el, { scrollHeight, clientHeight, scrollTop }) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight });
  el.scrollTop = scrollTop;
}

function setup(initial = [{ id: 1, content: 'a' }]) {
  const view = render(<Harness messages={initial} contentKey={null} />);
  const box = view.getByTestId('box');
  box.scrollTo = vi.fn(({ top }) => {
    box.scrollTop = top;
  });
  return { view, box };
}

describe('useAutoScroll', () => {
  afterEach(() => cleanup());

  it('바닥에 있을 때 새 메시지가 오면 끝으로 스크롤하고 배지는 없다', () => {
    const { view, box } = setup();
    setMetrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    fireEvent.scroll(box);

    setMetrics(box, { scrollHeight: 1200, clientHeight: 400, scrollTop: 600 });
    view.rerender(<Harness messages={[{ id: 1, content: 'a' }, { id: 2, content: 'b' }]} contentKey={null} />);

    expect(box.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1200 }));
    expect(view.queryByTestId('badge')).toBeNull();
  });

  // B-7: 60px보다 큰 메시지가 와도 "바닥 여부"는 DOM이 커지기 전(마지막 스크롤 시점)에 잰 값을 쓴다.
  it('DOM이 이미 커진 뒤에 재지 않으므로 큰 메시지도 따라간다', () => {
    const { view, box } = setup();
    setMetrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    fireEvent.scroll(box);
    // 300px짜리 메시지가 붙어 DOM이 먼저 커진 상태에서 effect가 돈다.
    setMetrics(box, { scrollHeight: 1300, clientHeight: 400, scrollTop: 600 });
    view.rerender(<Harness messages={[{ id: 1, content: 'a' }, { id: 2, content: 'tall' }]} contentKey={null} />);
    expect(box.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1300 }));
  });

  it('위로 올려 읽는 중이면 따라가지 않고 배지 카운트를 올린다', () => {
    const { view, box } = setup();
    setMetrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    fireEvent.scroll(box);
    box.scrollTo.mockClear();

    view.rerender(
      <Harness
        messages={[{ id: 1, content: 'a' }, { id: 2, content: 'b' }, { id: 3, content: 'c' }]}
        contentKey={null}
      />,
    );
    expect(box.scrollTo).not.toHaveBeenCalled();
    expect(view.getByTestId('badge').textContent).toBe('2');

    view.rerender(
      <Harness
        messages={[
          { id: 1, content: 'a' },
          { id: 2, content: 'b' },
          { id: 3, content: 'c' },
          { id: 4, content: 'd' },
        ]}
        contentKey={null}
      />,
    );
    expect(view.getByTestId('badge').textContent).toBe('3');
  });

  it('scrollToBottom을 부르면 끝으로 가고 배지가 사라진다', () => {
    const { view, box } = setup();
    setMetrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    fireEvent.scroll(box);
    view.rerender(<Harness messages={[{ id: 1, content: 'a' }, { id: 2, content: 'b' }]} contentKey={null} />);
    expect(view.getByTestId('badge')).toBeInTheDocument();

    act(() => latest.scrollToBottom());
    expect(box.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1000 }));
    expect(view.queryByTestId('badge')).toBeNull();
  });

  it('사용자가 다시 바닥까지 내리면 배지가 사라진다', () => {
    const { view, box } = setup();
    setMetrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 0 });
    fireEvent.scroll(box);
    view.rerender(<Harness messages={[{ id: 1, content: 'a' }, { id: 2, content: 'b' }]} contentKey={null} />);
    expect(view.getByTestId('badge')).toBeInTheDocument();

    setMetrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    fireEvent.scroll(box);
    expect(view.queryByTestId('badge')).toBeNull();
  });

  it('바닥에 있을 때 번역 도착(contentKey 변경)만으로도 끝을 유지한다', () => {
    const { view, box } = setup();
    setMetrics(box, { scrollHeight: 1000, clientHeight: 400, scrollTop: 600 });
    fireEvent.scroll(box);
    box.scrollTo.mockClear();
    setMetrics(box, { scrollHeight: 1100, clientHeight: 400, scrollTop: 600 });
    view.rerender(<Harness messages={[{ id: 1, content: 'a' }]} contentKey={{ 1: { en: 'x' } }} />);
    expect(box.scrollTo).toHaveBeenLastCalledWith(expect.objectContaining({ top: 1100 }));
    expect(view.queryByTestId('badge')).toBeNull();
  });
});
