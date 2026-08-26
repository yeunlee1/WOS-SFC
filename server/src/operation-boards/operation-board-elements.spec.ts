// 작전판 요소 화이트리스트 검증과 총량 상한 계약을 검증한다.
import {
  MAX_OPERATION_ELEMENTS,
  MAX_OPERATION_ELEMENTS_BYTES,
  MAX_OPERATION_ELEMENT_BYTES,
  normalizeOperationElement,
  normalizeOperationElements,
  operationElementBytes,
} from './operation-board-elements';

describe('operation board element whitelist', () => {
  it('허용 키만 남기고 그 밖의 키가 있으면 요소를 거절한다', () => {
    expect(
      normalizeOperationElement({
        id: 'e1',
        type: 'path',
        x: 1,
        y: 2,
        x2: 3,
        y2: 4,
        d: 'M 1 2 L 3 4',
        color: '#7dd3fc',
        strokeWidth: 3,
        filled: false,
      }),
    ).toEqual({
      id: 'e1',
      type: 'path',
      x: 1,
      y: 2,
      x2: 3,
      y2: 4,
      d: 'M 1 2 L 3 4',
      color: '#7dd3fc',
      strokeWidth: 3,
      filled: false,
    });

    // 화이트리스트 밖 키는 값이 원시 타입이어도 거절한다.
    expect(
      normalizeOperationElement({ id: 'e2', type: 'text', label: 'main' }),
    ).toBeNull();
    expect(
      normalizeOperationElement({ id: 'e3', type: 'text', opacity: 0.7 }),
    ).toBeNull();
    expect(
      normalizeOperationElement({ id: 'e4', type: 'text', locked: false }),
    ).toBeNull();
  });

  it('타입·중첩·비유한수·문자열 길이를 거절한다', () => {
    expect(
      normalizeOperationElement({ id: 'e1', type: 'freehand' }),
    ).toBeNull();
    expect(
      normalizeOperationElement({ id: 'e1', type: 'path', points: [{ x: 1 }] }),
    ).toBeNull();
    expect(
      normalizeOperationElement({ id: 'e1', type: 'path', x: Number.NaN }),
    ).toBeNull();
    expect(
      normalizeOperationElement({
        id: 'e1',
        type: 'text',
        text: 'x'.repeat(301),
      }),
    ).toBeNull();
    expect(
      normalizeOperationElement({ id: 'x'.repeat(81), type: 'marker' }),
    ).toBeNull();
    expect(normalizeOperationElement(null)).toBeNull();
    expect(normalizeOperationElement([{ id: 'e1', type: 'text' }])).toBeNull();
  });

  it('요소 하나의 바이트 상한을 넘기면 거절한다', () => {
    expect(MAX_OPERATION_ELEMENT_BYTES).toBeLessThanOrEqual(4 * 1024);
    const huge = {
      id: 'e1',
      type: 'text',
      // 한글 300자는 UTF-8 900바이트라 개별 상한 안에 들어온다.
      text: '가'.repeat(300),
      marker: 'x'.repeat(512),
      d: 'M 1 1'.padEnd(512, '0'),
    };
    expect(operationElementBytes(huge)).toBeLessThanOrEqual(
      MAX_OPERATION_ELEMENT_BYTES,
    );
  });

  it('총 개수 상한을 넘기면 배열 전체를 거절한다', () => {
    const ok = Array.from({ length: MAX_OPERATION_ELEMENTS }, (_, index) => ({
      id: `e${index}`,
      type: 'marker',
    }));
    expect(normalizeOperationElements(ok)).toHaveLength(MAX_OPERATION_ELEMENTS);
    expect(
      normalizeOperationElements([...ok, { id: 'overflow', type: 'marker' }]),
    ).toBeNull();
  });

  it('총 바이트 상한을 넘기면 배열 전체를 거절한다', () => {
    const heavy = Array.from({ length: 400 }, (_, index) => ({
      id: `e${index}`,
      type: 'text',
      text: '가'.repeat(300),
    }));
    const bytes = heavy.reduce(
      (sum, element) => sum + operationElementBytes(element),
      0,
    );
    expect(bytes).toBeGreaterThan(MAX_OPERATION_ELEMENTS_BYTES);
    expect(normalizeOperationElements(heavy)).toBeNull();
  });

  it('배열이 아니거나 요소 하나라도 형식이 틀리면 전체를 거절한다', () => {
    expect(normalizeOperationElements(null)).toBeNull();
    expect(normalizeOperationElements([{ id: 'e1', type: 'nope' }])).toBeNull();
    expect(normalizeOperationElements([])).toEqual([]);
  });
});
