// 동화 버전 전투현황 — 카운트다운·타임라인·개인 현황·집결 그룹을 그림책 카드로 배치한다. 엔진은 기존 컴포넌트 그대로.
import Countdown from '../components/Battle/Countdown';
import PersonalPanel from '../components/Battle/PersonalPanel';
import RallyGroupPanel from '../components/Battle/RallyGroupPanel';
import CountdownDots from '../components/Battle/CountdownDots';
import RallyDots from '../components/Battle/RallyDots';

export default function StoryBattle() {
  return (
    <div className="story-battle">
      <div className="story-col">
        <section className="story-card story-card--tilt-l" aria-label="수비 카운트">
          <Countdown />
        </section>
        <section className="story-card story-viz-row" aria-label="카운트 타임라인">
          <div className="story-viz">
            <h4>수비 카운트</h4>
            <CountdownDots />
          </div>
          <div className="story-viz">
            <h4>공격 카운트</h4>
            <RallyDots />
          </div>
        </section>
      </div>
      <div className="story-col">
        <section className="story-card story-card--tilt-r" aria-label="개인 현황판">
          <PersonalPanel />
        </section>
        <section className="story-card story-card--butter" aria-label="공격 카운트 그룹">
          <RallyGroupPanel />
        </section>
      </div>
    </div>
  );
}
