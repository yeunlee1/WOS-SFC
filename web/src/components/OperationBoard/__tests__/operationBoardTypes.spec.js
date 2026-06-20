// 작전판 요소 생성 헬퍼의 기본 계약을 검증한다.
import { describe, expect, it } from 'vitest';
import {
  createOperationElement,
  OPERATION_BOARD_TOOLS,
  sanitizeOperationElements,
  canManageOperationBoard,
  canUseOperationTools,
} from '../operationBoardTypes';

describe('operationBoardTypes', () => {
  it('creates stable SVG text and marker elements', () => {
    const text = createOperationElement('text', {
      x: 10,
      y: 20,
      text: '1진입',
      color: '#fff',
    });
    expect(text.type).toBe('text');
    expect(text.text).toBe('1진입');
    expect(text.x).toBe(10);

    const marker = createOperationElement('marker', {
      x: 30,
      y: 40,
      marker: 'fire',
    });
    expect(marker.marker).toBe('fire');
  });

  it('limits operation board elements before saving', () => {
    const elements = Array.from({ length: 505 }, (_, index) =>
      createOperationElement('text', { x: index, y: index, text: 'x' }),
    );

    expect(sanitizeOperationElements(elements)).toHaveLength(500);
  });

  it('keeps sanitized elements shallow for live socket payloads', () => {
    const [element] = sanitizeOperationElements([
      createOperationElement('text', {
        id: 'e1',
        x: 1,
        y: 2,
        text: 'x'.repeat(400),
        color: '#123456',
        points: [{ x: 1, y: 2 }],
      }),
    ]);

    expect(element.text).toHaveLength(300);
    expect(element.points).toBeUndefined();
  });

  it('includes first-phase drawing tools', () => {
    expect(OPERATION_BOARD_TOOLS.map((tool) => tool.id)).toEqual([
      'pen',
      'text',
      'line',
      'rect',
      'ellipse',
      'arrow',
      'marker',
      'erase',
    ]);
  });

  it('checks operation board draw and manage permissions', () => {
    expect(canUseOperationTools({ role: 'member' }, false)).toBe(false);
    expect(canUseOperationTools({ role: 'member' }, true)).toBe(true);
    expect(canUseOperationTools({ role: 'admin' }, false)).toBe(true);
    expect(canManageOperationBoard({ role: 'developer' })).toBe(true);
    expect(canManageOperationBoard({ role: 'member' })).toBe(false);
  });
});
