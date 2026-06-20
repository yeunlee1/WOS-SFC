// 작전판 SVG 요소 생성과 저장 전 정리를 담당한다.
export const OPERATION_BOARD_TOOLS = [
  { id: 'pen', label: '펜' },
  { id: 'text', label: '텍스트' },
  { id: 'line', label: '직선' },
  { id: 'rect', label: '사각형' },
  { id: 'ellipse', label: '원' },
  { id: 'arrow', label: '화살표' },
  { id: 'marker', label: '마커' },
  { id: 'erase', label: '지우개' },
];

export const OPERATION_MARKERS = ['🔥', '⚠️', '🎯', '🛡️', '➡️', '⭐'];

const ADMIN_ROLES = ['admin', 'developer'];
const MAX_ELEMENTS = 500;
const MAX_TEXT_LENGTH = 300;
const MAX_STRING_LENGTH = 512;
const MAX_COLOR_LENGTH = 32;
const ALLOWED_ELEMENT_TYPES = new Set([
  'path',
  'line',
  'arrow',
  'rect',
  'ellipse',
  'text',
  'marker',
]);

const NUMERIC_KEYS = [
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
];

const STRING_KEYS = ['id', 'type', 'color', 'text', 'marker', 'd'];
const BOOLEAN_KEYS = ['filled'];

function makeOperationId() {
  const randomPart =
    globalThis.crypto?.randomUUID?.() ||
    Math.random().toString(36).slice(2, 10);
  return `op-${String(randomPart).slice(0, 48)}`;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function boundedString(value, maxLength, fallback = '') {
  const text = String(value ?? fallback);
  return text.slice(0, maxLength);
}

function normalizeElementType(type) {
  return type === 'pen' ? 'path' : type;
}

export function createOperationElement(type, payload = {}) {
  const elementType = normalizeElementType(type);
  const element = {
    id: boundedString(payload.id || makeOperationId(), 80),
    type: elementType,
    color: boundedString(payload.color || '#7dd3fc', MAX_COLOR_LENGTH),
    strokeWidth: finiteNumber(payload.strokeWidth ?? payload.width ?? 3, 3),
  };

  for (const key of NUMERIC_KEYS) {
    if (payload[key] !== undefined) {
      element[key] = finiteNumber(payload[key]);
    }
  }

  element.x = finiteNumber(payload.x ?? element.x);
  element.y = finiteNumber(payload.y ?? element.y);
  element.x2 = finiteNumber(payload.x2 ?? payload.x ?? element.x2);
  element.y2 = finiteNumber(payload.y2 ?? payload.y ?? element.y2);

  if (elementType === 'path') {
    element.d = boundedString(payload.d || '', MAX_STRING_LENGTH);
  }
  if (elementType === 'text') {
    element.text = boundedString(payload.text, MAX_TEXT_LENGTH);
    element.fontSize = finiteNumber(payload.fontSize ?? 18, 18);
  }
  if (elementType === 'marker') {
    element.marker = boundedString(payload.marker || OPERATION_MARKERS[2], MAX_STRING_LENGTH);
    element.text = boundedString(payload.text || '', MAX_TEXT_LENGTH);
  }
  if (payload.filled !== undefined) {
    element.filled = !!payload.filled;
  }

  return sanitizeOperationElement(element);
}

export function sanitizeOperationElement(element) {
  if (!element || typeof element !== 'object' || Array.isArray(element)) {
    return null;
  }

  const type = normalizeElementType(element.type);
  if (!ALLOWED_ELEMENT_TYPES.has(type)) return null;

  const sanitized = {
    id: boundedString(element.id || makeOperationId(), 80),
    type,
  };

  for (const key of NUMERIC_KEYS) {
    if (element[key] !== undefined) {
      sanitized[key] = finiteNumber(element[key]);
    }
  }

  for (const key of STRING_KEYS) {
    if (key === 'id' || key === 'type') continue;
    if (element[key] === undefined) continue;
    const maxLength =
      key === 'text'
        ? MAX_TEXT_LENGTH
        : key === 'color'
          ? MAX_COLOR_LENGTH
          : MAX_STRING_LENGTH;
    sanitized[key] = boundedString(element[key], maxLength);
  }

  for (const key of BOOLEAN_KEYS) {
    if (element[key] !== undefined) sanitized[key] = !!element[key];
  }

  return sanitized;
}

export function sanitizeOperationElements(elements) {
  if (!Array.isArray(elements)) return [];
  return elements
    .slice(-MAX_ELEMENTS)
    .map(sanitizeOperationElement)
    .filter(Boolean);
}

export function canUseOperationTools(user, canDraw) {
  return ADMIN_ROLES.includes(user?.role) || !!canDraw;
}

export function canManageOperationBoard(user) {
  return ADMIN_ROLES.includes(user?.role);
}
