import { computeFireSchedule } from './rally-groups.service';

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
