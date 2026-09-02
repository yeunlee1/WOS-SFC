// 계정(닉네임) 단위 로그인 시도 제한이 IP 를 갈아타도 합산되고 표기 변형으로 우회되지 않는지 검증한다.
import {
  ACCOUNT_ATTEMPT_LIMIT,
  ACCOUNT_IP_ATTEMPT_LIMIT,
  ACCOUNT_WINDOW_MS,
  AccountLoginThrottle,
  normalizeAccountKey,
} from './account-login-throttle';

describe('normalizeAccountKey', () => {
  it('대소문자·앞뒤 공백·내부 공백·전각 문자를 같은 키로 접는다', () => {
    const base = normalizeAccountKey('alice');

    expect(base).not.toBeNull();
    for (const variant of [
      'Alice',
      'ALICE',
      '  alice  ',
      '\talice\n',
      'al ice',
      'ａｌｉｃｅ', // 전각 — MySQL utf8mb4_0900_ai_ci 는 이것도 같은 행으로 찾는다
      'alice　', // 전각 공백
      ' alice', // NBSP
    ]) {
      expect(normalizeAccountKey(variant)).toBe(base);
    }
  });

  it('서로 다른 닉네임은 다른 키가 된다', () => {
    expect(normalizeAccountKey('alice')).not.toBe(normalizeAccountKey('bob'));
  });

  it('문자열이 아니거나 비어 있으면 null 을 돌려준다', () => {
    for (const bad of [undefined, null, 123, ['a', 'b'], {}, '', '   ']) {
      expect(normalizeAccountKey(bad)).toBeNull();
    }
  });
});

describe('AccountLoginThrottle', () => {
  let throttle: AccountLoginThrottle;

  beforeEach(() => {
    throttle = new AccountLoginThrottle();
  });

  /** 같은 계정을 같은 IP 에서 n 번 시도한다. 통과 여부 배열을 돌려준다. */
  function attempt(account: string, ip: string, times: number, now = 0) {
    const results: boolean[] = [];
    for (let i = 0; i < times; i += 1) {
      results.push(throttle.consume(normalizeAccountKey(account)!, ip, now));
    }
    return results;
  }

  it('같은 IP 라도 계정이 다르면 따로 센다', () => {
    const ip = '203.0.113.7';

    // victim 계정을 이 IP 몫까지 소진시킨다.
    expect(attempt('victim', ip, ACCOUNT_IP_ATTEMPT_LIMIT)).not.toContain(false);
    expect(throttle.consume(normalizeAccountKey('victim')!, ip, 0)).toBe(false);

    // 같은 IP 의 다른 계정은 영향을 받지 않아야 한다.
    expect(throttle.consume(normalizeAccountKey('other')!, ip, 0)).toBe(true);
  });

  it('IP 를 갈아타도 계정 카운터가 합산된다', () => {
    const account = normalizeAccountKey('victim')!;

    // IP 를 매번 바꿔 계정 한도를 채운다. IP 당 1회씩이라 IP 쌍 한도에는 걸리지 않는다.
    for (let i = 0; i < ACCOUNT_ATTEMPT_LIMIT; i += 1) {
      expect(throttle.consume(account, `198.51.100.${i}`, 0)).toBe(true);
    }

    // 계정 한도를 넘겼으므로, 이 계정에 이미 실패 이력이 있는 IP 는 즉시 막힌다.
    expect(throttle.consume(account, '198.51.100.0', 0)).toBe(false);
  });

  it('계정이 한도를 넘어도 그 계정에 이력이 없는 IP 의 첫 시도는 통과한다 (잠금 DoS 대책)', () => {
    const account = normalizeAccountKey('victim')!;

    for (let i = 0; i < ACCOUNT_ATTEMPT_LIMIT * 2; i += 1) {
      throttle.consume(account, `198.51.100.${i % 20}`, 0);
    }

    // 정상 사용자의 IP 는 이 계정으로 실패한 적이 없다 — 공격 중에도 첫 시도는 통과해야 한다.
    expect(throttle.consume(account, '203.0.113.200', 0)).toBe(true);
  });

  it('닉네임 대소문자·공백 변형으로 계정 카운터를 우회할 수 없다', () => {
    const ip = '203.0.113.7';
    const variants = ['alice', 'Alice', 'ALICE', ' alice ', 'aLiCe', 'al ice', 'ａｌｉｃｅ'];

    const results = variants
      .slice(0, ACCOUNT_IP_ATTEMPT_LIMIT)
      .map((v) => throttle.consume(normalizeAccountKey(v)!, ip, 0));
    expect(results).not.toContain(false);

    // 변형을 바꿔도 같은 버킷이라 더는 통과하면 안 된다.
    for (const v of variants.slice(ACCOUNT_IP_ATTEMPT_LIMIT)) {
      expect(throttle.consume(normalizeAccountKey(v)!, ip, 0)).toBe(false);
    }
  });

  it('로그인에 성공하면 그 계정의 카운터가 비워진다', () => {
    const account = normalizeAccountKey('alice')!;
    const ip = '203.0.113.7';

    attempt('alice', ip, ACCOUNT_IP_ATTEMPT_LIMIT - 1);
    throttle.recordSuccess(account, ip);

    // 다시 처음부터 셀 수 있어야 한다.
    expect(attempt('alice', ip, ACCOUNT_IP_ATTEMPT_LIMIT)).not.toContain(false);
  });

  it('차단 중 반복 시도는 창을 연장하지 못한다 — 무기한 잠금이 되지 않는다', () => {
    const account = normalizeAccountKey('victim')!;
    const ip = '203.0.113.7';

    for (let i = 0; i < ACCOUNT_IP_ATTEMPT_LIMIT; i += 1) {
      expect(throttle.consume(account, ip, 0)).toBe(true);
    }

    // 공격자가 창 내내 두드려도
    for (let t = 1000; t < ACCOUNT_WINDOW_MS; t += 1000) {
      expect(throttle.consume(account, ip, t)).toBe(false);
    }

    // 최초 시도 시각 기준 창이 지나면 스스로 풀려야 한다.
    expect(throttle.consume(account, ip, ACCOUNT_WINDOW_MS + 1)).toBe(true);
  });

  it('창이 지나기 전에는 계속 막는다', () => {
    const account = normalizeAccountKey('victim')!;
    const ip = '203.0.113.7';

    for (let i = 0; i < ACCOUNT_IP_ATTEMPT_LIMIT; i += 1) {
      throttle.consume(account, ip, 0);
    }
    expect(throttle.consume(account, ip, ACCOUNT_WINDOW_MS - 1)).toBe(false);
  });

  it('추적 항목이 무한히 쌓이지 않는다', () => {
    // 매번 새 닉네임으로 두드려 메모리를 불리는 시나리오.
    for (let i = 0; i < 30000; i += 1) {
      throttle.consume(`flood-${i}`, '203.0.113.7', i);
    }
    expect(throttle.size()).toBeLessThanOrEqual(20000);
  });
});
