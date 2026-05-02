// PersonalSyncOffset — 디바이스별 카운트다운 TTS 발화 시점 미세 보정 UI.
//
// 용도: 같은 카운트다운에 참여하는 100명 중 본인 디바이스만 살짝 빠르거나 느리게
//       음성이 들리는 경우 ±100ms 단위로 직접 조정. 값은 localStorage에
//       디바이스별로 저장(폰/PC 따로). clockSync.getServerNow()가 자동 합산하므로
//       시각 표시 + TTS 발화 슬롯 모두 적용된다.

import { useStore } from '../../store';

const STEP_MS = 100;
const MIN_MS = -1000;
const MAX_MS = 1000;

export default function PersonalSyncOffset() {
  const offset = useStore((s) => s.personalOffsetMs);
  const setOffset = useStore((s) => s.setPersonalOffsetMs);

  const adjust = (delta) => setOffset(Math.max(MIN_MS, Math.min(MAX_MS, offset + delta)));
  const reset = () => setOffset(0);
  const onSliderChange = (e) => setOffset(Number(e.target.value));

  const displayText = offset === 0
    ? '0ms (기본)'
    : `${offset > 0 ? '+' : ''}${offset}ms`;

  return (
    <section className="personal-sync-offset" style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-1, rgba(0,0,0,0.08))' }}>
      <h4 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>음성 미세 보정</h4>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 16px', lineHeight: 1.5 }}>
        다른 사람보다 음성이 늦게 들리면 +, 빠르게 들리면 -. 디바이스별 저장 (폰/PC 따로). 모르겠으면 0 권장.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button
          className="btn"
          style={{ padding: '4px 10px', fontSize: 12, minWidth: 60 }}
          onClick={() => adjust(-STEP_MS)}
          disabled={offset <= MIN_MS}
          aria-label="100ms 늦추기"
        >
          −100ms
        </button>
        <span
          style={{
            flex: 1,
            textAlign: 'center',
            fontSize: 13,
            fontWeight: 600,
            color: offset === 0 ? 'var(--text-3)' : 'var(--text-1)',
          }}
        >
          {displayText}
        </span>
        <button
          className="btn"
          style={{ padding: '4px 10px', fontSize: 12, minWidth: 60 }}
          onClick={() => adjust(STEP_MS)}
          disabled={offset >= MAX_MS}
          aria-label="100ms 당기기"
        >
          +100ms
        </button>
        <button
          className="btn"
          style={{ padding: '4px 10px', fontSize: 12, minWidth: 40 }}
          onClick={reset}
          disabled={offset === 0}
          aria-label="0으로 리셋"
        >
          0
        </button>
      </div>
      <input
        type="range"
        min={MIN_MS}
        max={MAX_MS}
        step={STEP_MS}
        value={offset}
        onChange={onSliderChange}
        style={{ width: '100%' }}
        aria-label="음성 미세 보정 슬라이더"
        aria-valuetext={displayText}
      />
    </section>
  );
}
