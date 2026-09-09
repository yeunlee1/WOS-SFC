// online:updated diff로 입퇴장 시스템 메시지를 만들고 2초 창으로 합치는 순수 함수를 검증한다.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createOnlineTracker,
  createSystemMessage,
  diffOnline,
  formatSystemMessage,
} from '../systemMessages';

const u = (nickname, alliance = 'KOR') => ({ nickname, alliance, role: 'member' });

describe('diffOnline', () => {
  it('닉네임 기준으로 입장·퇴장을 가른다 (다중 탭은 1명)', () => {
    const prev = [u('a'), u('b'), u('b')];
    const next = [u('b'), u('c'), u('c')];
    expect(diffOnline(prev, next)).toEqual({ joined: ['c'], left: ['a'] });
  });

  it('문자열 항목과 닉네임 없는 항목도 견딘다', () => {
    expect(diffOnline(['a', {}], ['a', 'b'])).toEqual({ joined: ['b'], left: [] });
  });
});

describe('createOnlineTracker', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('첫 목록은 기준선이라 메시지를 만들지 않는다', () => {
    const onFlush = vi.fn();
    const tracker = createOnlineTracker({ onFlush });
    tracker.update([u('me'), u('a')]);
    vi.advanceTimersByTime(5000);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('두 번째 목록부터 입장 1·퇴장 1을 2초 뒤 한 번에 알린다', () => {
    const onFlush = vi.fn();
    const tracker = createOnlineTracker({ onFlush });
    tracker.update([u('me'), u('a')]);
    tracker.update([u('me'), u('b')]);
    vi.advanceTimersByTime(1999);
    expect(onFlush).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush).toHaveBeenCalledWith({ joined: ['b'], left: ['a'] });
  });

  it('2초 안에 5명이 들어오면 한 번의 flush에 5명이 실린다', () => {
    const onFlush = vi.fn();
    const tracker = createOnlineTracker({ onFlush });
    tracker.update([u('me')]);
    const names = ['a', 'b', 'c', 'd', 'e'];
    names.forEach((n, i) => {
      vi.advanceTimersByTime(300);
      tracker.update([u('me'), ...names.slice(0, i + 1).map((x) => u(x))]);
    });
    vi.advanceTimersByTime(2000);
    expect(onFlush).toHaveBeenCalledTimes(1);
    expect(onFlush.mock.calls[0][0].joined).toEqual(names);
    expect(onFlush.mock.calls[0][0].left).toEqual([]);
  });

  it('창 안에서 들어왔다 나간 사람은 상쇄된다', () => {
    const onFlush = vi.fn();
    const tracker = createOnlineTracker({ onFlush });
    tracker.update([u('me')]);
    tracker.update([u('me'), u('a')]);
    tracker.update([u('me')]);
    vi.advanceTimersByTime(2000);
    expect(onFlush).not.toHaveBeenCalled();
  });

  it('dispose 뒤에는 flush가 없다', () => {
    const onFlush = vi.fn();
    const tracker = createOnlineTracker({ onFlush });
    tracker.update([u('me')]);
    tracker.update([u('me'), u('a')]);
    tracker.dispose();
    vi.advanceTimersByTime(3000);
    expect(onFlush).not.toHaveBeenCalled();
  });
});

describe('createSystemMessage / formatSystemMessage', () => {
  const t = (key) =>
    ({
      chatJoined: '{nickname}님이 입장했습니다',
      chatLeft: '{nickname}님이 퇴장했습니다',
      chatJoinedMany: '{count}명이 입장했습니다',
      chatLeftMany: '{count}명이 퇴장했습니다',
      chatHistoryError: '지난 대화를 불러오지 못했습니다.',
    })[key] ?? key;

  it('_type system과 고유 _id·createdAt을 붙인다', () => {
    const a = createSystemMessage({ kind: 'joined', nickname: 'x' });
    const b = createSystemMessage({ kind: 'joined', nickname: 'x' });
    expect(a).toMatchObject({ _type: 'system', kind: 'joined', nickname: 'x' });
    expect(a._id).not.toBe(b._id);
    expect(Date.parse(a.createdAt)).not.toBeNaN();
  });

  it('kind별로 i18n 키를 골라 자리표시자를 채운다', () => {
    expect(formatSystemMessage({ kind: 'joined', nickname: '테스터' }, t)).toBe(
      '테스터님이 입장했습니다',
    );
    expect(formatSystemMessage({ kind: 'left', nickname: 'a' }, t)).toBe(
      'a님이 퇴장했습니다',
    );
    expect(formatSystemMessage({ kind: 'joinedMany', count: 5 }, t)).toBe(
      '5명이 입장했습니다',
    );
    expect(formatSystemMessage({ kind: 'leftMany', count: 2 }, t)).toBe(
      '2명이 퇴장했습니다',
    );
    expect(formatSystemMessage({ kind: 'history_error' }, t)).toBe(
      '지난 대화를 불러오지 못했습니다.',
    );
  });

  it('옛 서버가 보낸 문자열 시스템 메시지(text)는 그대로 보여준다', () => {
    expect(formatSystemMessage({ kind: 'text', text: '공지' }, t)).toBe('공지');
    expect(formatSystemMessage({ text: '레거시' }, t)).toBe('레거시');
  });

  it('모르는 kind는 kind 문자열로 보여 조용히 사라지지 않는다', () => {
    expect(formatSystemMessage({ kind: 'maintenance' }, t)).toBe('maintenance');
  });
});
