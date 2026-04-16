import RallyTimer from './RallyTimer';
import Countdown from './Countdown';
import Dispatch from './Dispatch';

// BattleTab — 전투현황 탭 컨테이너
export default function BattleTab() {
  return (
    <div className="battle-tab">
      <RallyTimer />
      <Countdown />
      <Dispatch />
    </div>
  );
}
