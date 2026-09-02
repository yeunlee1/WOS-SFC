// 동화 버전 껍데기 — 책갈피 레일, 상단바, 본문 프레임, 접속 중 패널을 배치한다.
import OnlinePanel from '../components/Layout/OnlinePanel';
import StoryRail from './StoryRail';
import StoryTopbar from './StoryTopbar';

export default function StoryShell({ activeTab, onTabChange, children }) {
  // 채팅 탭은 자체 사이드바(접속자 목록)를 가지므로 오른쪽 패널을 숨긴다.
  const showPanel = activeTab !== 'chat';

  return (
    <div className={'story-shell' + (showPanel ? '' : ' story-shell--nopanel')}>
      <StoryRail activeTab={activeTab} onTabChange={onTabChange} />
      <div className="story-main">
        <StoryTopbar activeTab={activeTab} />
        <main className={'story-frame' + (activeTab === 'chat' ? ' story-frame--chat' : '')}>
          {children}
        </main>
      </div>
      {showPanel && (
        <aside className="story-online" aria-label="접속 중">
          <OnlinePanel isOpen />
        </aside>
      )}
    </div>
  );
}
