// 작전판 요소의 허용 키·타입·크기·총량을 한 곳에서 검증한다.
// 게이트웨이(실시간)와 서비스(REST 저장)가 같은 규칙을 쓰도록 여기에 모았다.

export type OperationElement = Record<string, unknown> & {
  id: string;
  type: string;
};

/** 라이브 보드와 저장본이 함께 지키는 요소 개수 상한. */
export const MAX_OPERATION_ELEMENTS = 500;

/**
 * 요소 하나의 JSON 바이트 상한.
 * 화이트리스트 최댓값을 모두 채운 요소가 약 2.3KB 다 —
 * id 80자 + d 512자 + text 300자(한글 900B) + marker 512자 + color 32자 + 숫자 12개.
 * 4KB 는 그 위에 여유를 둔 값이다.
 */
export const MAX_OPERATION_ELEMENT_BYTES = 4 * 1024;

/**
 * 요소 배열 전체의 JSON 바이트 상한.
 * 실측 — 웹 클라이언트가 만드는 펜 한 획은 약 496B(경로 문자열 상한 512자)라
 * 500획이 약 248KB 다. 250,000B 는 그 실측값에 맞춘 상한이며
 * 개수 상한(500)과 함께 라이브 보드 총량을 약 250KB 로 묶는다.
 */
export const MAX_OPERATION_ELEMENTS_BYTES = 250_000;

const ELEMENT_ID_MAX_LENGTH = 80;
const ELEMENT_TEXT_MAX_LENGTH = 300;
const ELEMENT_COLOR_MAX_LENGTH = 32;
const ELEMENT_STRING_MAX_LENGTH = 512;

const ALLOWED_ELEMENT_TYPES = new Set([
  'path',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'marker',
]);

// 아래 세 목록이 화이트리스트다. 여기에 없는 키가 하나라도 있으면 요소를 거절한다.
// 웹 클라이언트의 operationBoardTypes.js 가 만들어 내는 키와 정확히 같다.
const ALLOWED_NUMBER_KEYS = new Set([
  'x',
  'y',
  'x2',
  'y2',
  'cx',
  'cy',
  'rx',
  'ry',
  'width',
  'height',
  'strokeWidth',
  'fontSize',
]);
const ALLOWED_STRING_KEYS = new Set(['color', 'text', 'marker', 'd']);
const ALLOWED_BOOLEAN_KEYS = new Set(['filled']);

function stringMaxLength(key: string): number {
  if (key === 'text') return ELEMENT_TEXT_MAX_LENGTH;
  if (key === 'color') return ELEMENT_COLOR_MAX_LENGTH;
  return ELEMENT_STRING_MAX_LENGTH;
}

function normalizeRequiredString(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.length > maxLength) return null;
  return trimmed;
}

/** 요소 하나가 배열 안에서 차지하는 대략의 바이트 수(구분 쉼표 1B 포함). */
export function operationElementBytes(element: unknown): number {
  try {
    const json = JSON.stringify(element);
    if (typeof json !== 'string') return Number.POSITIVE_INFINITY;
    return Buffer.byteLength(json, 'utf8') + 1;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * 요소 하나를 화이트리스트로 정규화한다.
 * 허용되지 않은 키·타입·값이 하나라도 있으면 null 을 돌려준다(조용히 지우지 않는다).
 */
export function normalizeOperationElement(
  element: unknown,
): OperationElement | null {
  if (!element || typeof element !== 'object' || Array.isArray(element)) {
    return null;
  }

  const source = element as Record<string, unknown>;
  const id = normalizeRequiredString(source.id, ELEMENT_ID_MAX_LENGTH);
  if (!id) return null;

  const type = normalizeRequiredString(source.type, ELEMENT_STRING_MAX_LENGTH);
  if (!type || !ALLOWED_ELEMENT_TYPES.has(type)) return null;

  const sanitized: OperationElement = { id, type };
  for (const [key, value] of Object.entries(source)) {
    if (key === 'id' || key === 'type') continue;

    if (ALLOWED_NUMBER_KEYS.has(key)) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return null;
      sanitized[key] = value;
      continue;
    }

    if (ALLOWED_STRING_KEYS.has(key)) {
      if (typeof value !== 'string') return null;
      if (value.length > stringMaxLength(key)) return null;
      sanitized[key] = value;
      continue;
    }

    if (ALLOWED_BOOLEAN_KEYS.has(key)) {
      if (typeof value !== 'boolean') return null;
      sanitized[key] = value;
      continue;
    }

    // 화이트리스트 밖 키 — 거절한다.
    return null;
  }

  if (operationElementBytes(sanitized) > MAX_OPERATION_ELEMENT_BYTES) {
    return null;
  }

  return sanitized;
}

export type OperationElementsRejection =
  | 'invalid'
  | 'too-many'
  | 'too-large'
  | null;

/**
 * 요소 배열을 통째로 검증한다. 개수·총 바이트 상한을 넘기면 자르지 않고 전체를 거절한다.
 * 거절 사유가 필요하면 rejectOperationElements 를 쓴다.
 */
export function normalizeOperationElements(
  elements: unknown,
): OperationElement[] | null {
  const result = validateOperationElements(elements);
  return result.rejection ? null : result.elements;
}

export function validateOperationElements(elements: unknown): {
  elements: OperationElement[];
  bytes: number;
  rejection: OperationElementsRejection;
} {
  if (!Array.isArray(elements)) {
    return { elements: [], bytes: 0, rejection: 'invalid' };
  }
  if (elements.length > MAX_OPERATION_ELEMENTS) {
    return { elements: [], bytes: 0, rejection: 'too-many' };
  }

  const normalized: OperationElement[] = [];
  let bytes = 0;
  for (const element of elements) {
    const item = normalizeOperationElement(element);
    if (!item) return { elements: [], bytes: 0, rejection: 'invalid' };
    bytes += operationElementBytes(item);
    if (bytes > MAX_OPERATION_ELEMENTS_BYTES) {
      return { elements: [], bytes, rejection: 'too-large' };
    }
    normalized.push(item);
  }

  return { elements: normalized, bytes, rejection: null };
}
