// PersonalSyncOffset — 디바이스별 카운트다운 TTS 발화 시점 미세 보정 UI.
//
// 용도: 같은 카운트다운에 참여하는 100명 중 본인 디바이스만 살짝 빠르거나 느리게
//       음성이 들리는 경우 ±100ms 단위로 직접 조정. 값은 localStorage에
//       디바이스별로 저장(폰/PC 따로). clockSync.getServerNow()가 자동 합산하므로
//       시각 표시 + TTS 발화 슬롯 모두 적용된다.
//
// 자동 보정과의 관계 (중요):
//   재생기(countdownPlayer/rallyGroupPlayer)가 ctx.outputLatency 만큼 발화를 자동으로
//   앞당긴다. 그런데 여기 수동값도 "내 소리가 늦게 들린다"는 귀 판단으로 같은 출력 지연을
//   이미 손으로 보정해 넣은 값이라, 같은 물리량을 두 번 당기게 된다.
//   수식 안에서 두 번 더해지지는 않지만, 한 번이라도 보정해 본 사용자는 자동 보정분만큼
//   더 빨라진다. 그래서 자동·수동·합계를 화면에 그대로 드러내 그 위에서 재조정하게 한다.
//
// 부호 규칙 (코드 실측):
//   자동  ctxAnchor = ... - outputLatency          → 클수록 앞당김
//   수동  serverNow = Date.now() + personalOffsetMs → 클수록 앵커가 앞당겨짐
//   두 값이 같은 축(앞당기는 양)이라 그대로 더한다.

import { useState, useEffect } from 'react';
import { useStore } from '../../store';
import { getAutoLatencyMs } from './countdownPlayer';

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

  // 자동 보정값은 AudioContext 가 만들어진 뒤에만 읽을 수 있다(렌더 시점에는 아직
  // 없을 수 있음). 마운트 후와 수동값 조정 시마다 다시 읽는다.
  // ※ 보증하지 못하는 것 — 카운트다운 도중 출력 기기를 바꿔 실제 지연이 달라져도
  //   이 화면을 다시 건드리기 전까지는 갱신되지 않는다.
  const [autoMs, setAutoMs] = useState(0);
  useEffect(() => { setAutoMs(getAutoLatencyMs()); }, [offset]);

  const signed = (v) => `${v > 0 ? '+' : ''}${v}ms`;
  const totalMs = autoMs + offset;

  return (
    <section className="personal-sync-offset" style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid var(--border-1, rgba(0,0,0,0.08))' }}>
      <h4 style={{ fontSize: 14, margin: '0 0 10px', fontWeight: 600 }}>음성 미세 보정</h4>
      <p style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 10px', lineHeight: 1.5 }}>
        다른 사람보다 음성이 늦게 들리면 +, 빠르게 들리면 -. 디바이스별 저장 (폰/PC 따로). 모르겠으면 0 권장.
      </p>
      <p
        className="sync-offset-summary"
        style={{ fontSize: 12, color: 'var(--text-3)', margin: '0 0 16px', lineHeight: 1.5 }}
      >
        브라우저 자동 보정 {signed(autoMs)} + 내 보정 {signed(offset)} = 합계 {signed(totalMs)} 앞당김
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
