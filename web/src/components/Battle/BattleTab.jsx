import Countdown from './Countdown';
import PersonalPanel from './PersonalPanel';
import RallyGroupPanel from './RallyGroupPanel';
import CountdownDots from './CountdownDots';
import RallyDots from './RallyDots';

// BattleTab — 전투현황 탭 컨테이너
export default function BattleTab() {
  return (
    <div className="battle-grid">
      <div className="battle-slot"><Countdown /></div>
      <div className="battle-slot"><PersonalPanel /></div>
      <div className="battle-slot battle-slot--rally"><RallyGroupPanel /></div>

      {/* battle-viz--defense / --attack: 향후 수비/공격 색상·아이콘 차별화를 위한 CSS hook (현재 베이스 .battle-viz 스타일만 사용) */}
      <div className="battle-viz-row">
        <div className="battle-slot battle-viz battle-viz--defense">
          <h4>수비 카운트</h4>
          <CountdownDots />
        </div>
        <div className="battle-slot battle-viz battle-viz--attack">
          <h4>공격 카운트</h4>
          <RallyDots />
        </div>
      </div>
    </div>
  );
}
