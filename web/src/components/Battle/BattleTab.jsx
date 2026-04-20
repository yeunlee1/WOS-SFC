import Countdown from './Countdown';
import PersonalPanel from './PersonalPanel';
import RallyGroupPanel from './RallyGroupPanel';

// BattleTab — 전투현황 탭 컨테이너
export default function BattleTab() {
  return (
    <div className="battle-grid">
      <div className="battle-slot"><Countdown /></div>
      <div className="battle-slot"><PersonalPanel /></div>
      <div className="battle-slot empty" aria-hidden="true" />
      <div className="battle-slot battle-slot--rally"><RallyGroupPanel /></div>
    </div>
  );
}
