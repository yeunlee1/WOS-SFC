// 작전판 SVG 드로잉 캔버스를 제공한다.
import { useMemo, useRef, useState } from 'react';
import {
  compactOperationPath,
  createOperationElement,
  OPERATION_MARKERS,
  sanitizeOperationElement,
} from './operationBoardTypes';

const BOARD_WIDTH = 1000;
const BOARD_HEIGHT = 620;

function pointFromEvent(svg, event) {
  const rect = svg.getBoundingClientRect();
  return {
    x: Math.round(((event.clientX - rect.left) / rect.width) * BOARD_WIDTH),
    y: Math.round(((event.clientY - rect.top) / rect.height) * BOARD_HEIGHT),
  };
}

function isMeaningfulDraft(element) {
  if (!element) return false;
  if (element.type === 'path') return (element.d || '').split('L').length > 1;
  return Math.abs((element.x2 ?? element.x) - element.x) > 2 ||
    Math.abs((element.y2 ?? element.y) - element.y) > 2;
}

function renderElement(element, preview = false) {
  const common = {
    key: preview ? 'draft' : element.id,
    'data-element-id': element.id,
    className: 'operation-svg-element' + (preview ? ' is-preview' : ''),
  };
  const stroke = element.color || '#7dd3fc';
  const strokeWidth = Number(element.strokeWidth || 3);

  if (element.type === 'path') {
    return (
      <path
        {...common}
        d={element.d || ''}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    );
  }
  if (element.type === 'line' || element.type === 'arrow') {
    return (
      <line
        {...common}
        x1={element.x}
        y1={element.y}
        x2={element.x2}
        y2={element.y2}
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        markerEnd={element.type === 'arrow' ? 'url(#operation-arrow)' : undefined}
      />
    );
  }
  if (element.type === 'rect') {
    const x = Math.min(element.x, element.x2);
    const y = Math.min(element.y, element.y2);
    const width = Math.abs(element.x2 - element.x);
    const height = Math.abs(element.y2 - element.y);
    return (
      <rect
        {...common}
        x={x}
        y={y}
        width={width}
        height={height}
        rx="6"
        fill={element.filled ? `${stroke}30` : 'transparent'}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (element.type === 'ellipse') {
    const cx = (element.x + element.x2) / 2;
    const cy = (element.y + element.y2) / 2;
    const rx = Math.abs(element.x2 - element.x) / 2;
    const ry = Math.abs(element.y2 - element.y) / 2;
    return (
      <ellipse
        {...common}
        cx={cx}
        cy={cy}
        rx={rx}
        ry={ry}
        fill={element.filled ? `${stroke}30` : 'transparent'}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }
  if (element.type === 'text') {
    return (
      <text
        {...common}
        x={element.x}
        y={element.y}
        fill={stroke}
        fontSize={element.fontSize || 18}
        fontWeight="700"
      >
        {element.text}
      </text>
    );
  }
  if (element.type === 'marker') {
    return (
      <text
        {...common}
        x={element.x}
        y={element.y}
        fill={stroke}
        fontSize={element.fontSize || 28}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {element.marker || OPERATION_MARKERS[2]}
      </text>
    );
  }
  return null;
}

export default function OperationBoardCanvas({
  elements,
  background,
  tool,
  color,
  strokeWidth,
  marker,
  canDraw,
  onAddElement,
  onRemoveElement,
}) {
  const svgRef = useRef(null);
  const [draft, setDraft] = useState(null);
  const renderedElements = useMemo(
    () => elements.map((element) => renderElement(element)),
    [elements],
  );

  function handlePointerDown(event) {
    const svg = svgRef.current;
    if (!svg || !canDraw) return;

    if (tool === 'erase') {
      const targetId = event.target?.dataset?.elementId;
      if (targetId) onRemoveElement(targetId);
      return;
    }

    const point = pointFromEvent(svg, event);
    if (tool === 'text') {
      const text = window.prompt('텍스트', '');
      if (text?.trim()) {
        onAddElement(createOperationElement('text', { ...point, text, color }));
      }
      return;
    }
    if (tool === 'marker') {
      onAddElement(createOperationElement('marker', { ...point, marker, color }));
      return;
    }

    const type = tool === 'pen' ? 'pen' : tool;
    const next = createOperationElement(type, {
      ...point,
      x2: point.x,
      y2: point.y,
      d: `M ${point.x} ${point.y}`,
      color,
      strokeWidth,
    });
    setDraft(next);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event) {
    const svg = svgRef.current;
    if (!svg || !draft || !canDraw) return;
    const point = pointFromEvent(svg, event);
    setDraft((current) => {
      if (!current) return current;
      if (current.type === 'path') {
        return { ...current, d: compactOperationPath(`${current.d} L ${point.x} ${point.y}`) };
      }
      return { ...current, x2: point.x, y2: point.y };
    });
  }

  function finishDraft() {
    const sanitized = sanitizeOperationElement(draft);
    if (isMeaningfulDraft(sanitized)) onAddElement(sanitized);
    setDraft(null);
  }

  return (
    <section className="operation-canvas-shell" aria-label="작전판 캔버스">
      <svg
        ref={svgRef}
        className={'operation-canvas' + (canDraw ? ' can-draw' : ' is-readonly')}
        viewBox={`0 0 ${BOARD_WIDTH} ${BOARD_HEIGHT}`}
        role="img"
        aria-label="작전판"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDraft}
        onPointerCancel={() => setDraft(null)}
      >
        <defs>
          <pattern id="operation-grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(125,211,252,0.12)" strokeWidth="1" />
          </pattern>
          <marker id="operation-arrow" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="10" markerHeight="10" orient="auto">
            <path d="M 1 1 L 11 6 L 1 11 z" fill="currentColor" />
          </marker>
        </defs>
        <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="rgba(6,14,28,0.84)" />
        <rect width={BOARD_WIDTH} height={BOARD_HEIGHT} fill="url(#operation-grid)" />
        {background?.type === 'image' && background.imageUrl && (
          <image href={background.imageUrl} x="0" y="0" width={BOARD_WIDTH} height={BOARD_HEIGHT} preserveAspectRatio="xMidYMid meet" opacity="0.82" />
        )}
        {renderedElements}
        {draft && renderElement(draft, true)}
      </svg>
    </section>
  );
}
