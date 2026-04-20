import { computeFireSchedule, sortMembersByMarchDesc } from './rally-groups.service';

describe('computeFireSchedule', () => {
  it('멤버 3명, 서로 다른 marchSeconds → maxMarch와 offset 계산', () => {
    const members = [
      { userId: 1, orderIndex: 1 },
      { userId: 2, orderIndex: 2 },
      { userId: 3, orderIndex: 3 },
    ];
    const effectiveMap = new Map<number, number>([
      [1, 30],
      [2, 24],
      [3, 20],
    ]);

    const { maxMarch, fireOffsets } = computeFireSchedule(members, effectiveMap);

    expect(maxMarch).toBe(30);
    expect(fireOffsets).toHaveLength(3);

    const a = fireOffsets.find((o) => o.userId === 1)!;
    const b = fireOffsets.find((o) => o.userId === 2)!;
    const c = fireOffsets.find((o) => o.userId === 3)!;

    expect(a.offsetMs).toBe(0);
    expect(b.offsetMs).toBe(6000);
    expect(c.offsetMs).toBe(10000);
  });

  it('단일 멤버 → maxMarch=15, offset=0', () => {
    const members = [{ userId: 1, orderIndex: 1 }];
    const effectiveMap = new Map<number, number>([[1, 15]]);

    const { maxMarch, fireOffsets } = computeFireSchedule(members, effectiveMap);

    expect(maxMarch).toBe(15);
    expect(fireOffsets).toHaveLength(1);
    expect(fireOffsets[0].offsetMs).toBe(0);
  });

  it('빈 배열 → maxMarch=0, fireOffsets=[]', () => {
    const { maxMarch, fireOffsets } = computeFireSchedule([], new Map());

    expect(maxMarch).toBe(0);
    expect(fireOffsets).toHaveLength(0);
  });

  it('모두 동일값 (A=20, B=20) → offset 모두 0', () => {
    const members = [
      { userId: 1, orderIndex: 1 },
      { userId: 2, orderIndex: 2 },
    ];
    const effectiveMap = new Map<number, number>([
      [1, 20],
      [2, 20],
    ]);

    const { maxMarch, fireOffsets } = computeFireSchedule(members, effectiveMap);

    expect(maxMarch).toBe(20);
    expect(fireOffsets[0].offsetMs).toBe(0);
    expect(fireOffsets[1].offsetMs).toBe(0);
  });

  it('marchSeconds가 Map에 없는 유저 → 0 취급', () => {
    const members = [
      { userId: 1, orderIndex: 1 },
      { userId: 2, orderIndex: 2 },
    ];
    const effectiveMap = new Map<number, number>([[1, 20]]);

    const { maxMarch, fireOffsets } = computeFireSchedule(members, effectiveMap);

    expect(maxMarch).toBe(20);
    const missing = fireOffsets.find((o) => o.userId === 2)!;
    expect(missing.offsetMs).toBe(20000);
  });
});

describe('sortMembersByMarchDesc', () => {
  it('멤버 3명 — 느린 순(내림차순)으로 orderIndex 1,2,3 재할당', () => {
    // userId 1: 22초(빠름), userId 2: 38초(느림), userId 3: 37초(중간)
    const members = [
      { userId: 1, orderIndex: 1, marchSecondsOverride: null, user: { marchSeconds: 22 } },
      { userId: 2, orderIndex: 2, marchSecondsOverride: null, user: { marchSeconds: 38 } },
      { userId: 3, orderIndex: 3, marchSecondsOverride: null, user: { marchSeconds: 37 } },
    ] as any[];

    const sorted = sortMembersByMarchDesc(members);

    // 느린 순: userId 2(38s)=1번, userId 3(37s)=2번, userId 1(22s)=3번
    expect(sorted[0].userId).toBe(2);
    expect(sorted[0].orderIndex).toBe(1);
    expect(sorted[1].userId).toBe(3);
    expect(sorted[1].orderIndex).toBe(2);
    expect(sorted[2].userId).toBe(1);
    expect(sorted[2].orderIndex).toBe(3);
  });

  it('marchSecondsOverride가 user.marchSeconds보다 우선', () => {
    // userId 1: user.marchSeconds=10, override=50 → effective=50(느림) → 1번
    // userId 2: user.marchSeconds=40, override=null → effective=40 → 2번
    const members = [
      { userId: 1, orderIndex: 1, marchSecondsOverride: 50, user: { marchSeconds: 10 } },
      { userId: 2, orderIndex: 2, marchSecondsOverride: null, user: { marchSeconds: 40 } },
    ] as any[];

    const sorted = sortMembersByMarchDesc(members);

    expect(sorted[0].userId).toBe(1); // override=50 우선
    expect(sorted[0].orderIndex).toBe(1);
    expect(sorted[1].userId).toBe(2);
    expect(sorted[1].orderIndex).toBe(2);
  });

  it('동률은 기존 orderIndex 오름차순(안정 정렬)으로 tie-break', () => {
    const members = [
      { userId: 1, orderIndex: 3, marchSecondsOverride: null, user: { marchSeconds: 30 } },
      { userId: 2, orderIndex: 1, marchSecondsOverride: null, user: { marchSeconds: 30 } },
      { userId: 3, orderIndex: 2, marchSecondsOverride: null, user: { marchSeconds: 30 } },
    ] as any[];

    const sorted = sortMembersByMarchDesc(members);

    // 동률 → 기존 orderIndex 오름차순 유지
    expect(sorted[0].userId).toBe(2); // prevOrder 1
    expect(sorted[1].userId).toBe(3); // prevOrder 2
    expect(sorted[2].userId).toBe(1); // prevOrder 3
  });
});
