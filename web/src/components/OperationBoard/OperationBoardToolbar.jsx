// 작전판의 도구막대와 저장·배경 동작을 제공한다.
import { useRef } from 'react';
import { OPERATION_BOARD_TOOLS, OPERATION_MARKERS } from './operationBoardTypes';

export default function OperationBoardToolbar({
  tool,
  color,
  strokeWidth,
  marker,
  canDraw,
  canManage,
  onToolChange,
  onColorChange,
  onStrokeWidthChange,
  onMarkerChange,
  onClear,
  onSave,
  onUploadBackground,
  onResetBackground,
}) {
  const fileRef = useRef(null);

  function handleFileChange(event) {
    const file = event.target.files?.[0];
    if (file) onUploadBackground(file);
    event.target.value = '';
  }

  return (
    <section className="operation-toolbar" aria-label="작전판 도구">
      <div className="operation-toolbar-tools">
        {OPERATION_BOARD_TOOLS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={'operation-tool-btn' + (tool === item.id ? ' active' : '')}
            onClick={() => onToolChange(item.id)}
            disabled={!canDraw}
            aria-label={item.label}
            title={item.label}
          >
            {item.label}
          </button>
        ))}
      </div>
      <label className="operation-control">
        <span>색</span>
        <input
          type="color"
          value={color}
          onChange={(event) => onColorChange(event.target.value)}
          disabled={!canDraw}
          aria-label="색상"
        />
      </label>
      <label className="operation-control">
        <span>굵기</span>
        <input
          type="range"
          min="1"
          max="12"
          value={strokeWidth}
          onChange={(event) => onStrokeWidthChange(Number(event.target.value))}
          disabled={!canDraw}
          aria-label="굵기"
        />
      </label>
      <label className="operation-control">
        <span>마커</span>
        <select
          value={marker}
          onChange={(event) => onMarkerChange(event.target.value)}
          disabled={!canDraw}
          aria-label="마커"
        >
          {OPERATION_MARKERS.map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      <span className="operation-toolbar-spacer" />
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="operation-hidden-file"
        onChange={handleFileChange}
      />
      <button type="button" onClick={() => fileRef.current?.click()} disabled={!canManage}>
        배경
      </button>
      <button type="button" onClick={onResetBackground} disabled={!canManage}>
        격자
      </button>
      <button type="button" onClick={onClear} disabled={!canManage}>
        지우기
      </button>
      <button type="button" className="operation-save-btn" onClick={onSave} disabled={!canManage} aria-label="저장">
        저장
      </button>
    </section>
  );
}
