// 동화 버전 커뮤니티 — 색인 탭(공지사항·연맹별)과, 연맹 탭에서는 공지와 게시판을 2열로 함께 보여준다.
import { useState } from 'react';
import { ALLIANCES } from '../store';
import Noticeboard from '../components/Community/Noticeboard';
import AllianceNoticeboard from '../components/Community/AllianceNoticeboard';
import Board from '../components/Community/Board';

const TAB_STYLE = {
  KOR: { background: '#cfe3f5' },
  NSL: { background: '#d3ede0' },
  JKY: { background: '#f7ecc4' },
  GPX: { background: '#e2d8f3' },
  UFO: { background: '#f5d6dd' },
};

export default function StoryCommunity() {
  const [mainTab, setMainTab] = useState('notices');
  const isAlliance = ALLIANCES.includes(mainTab);
  const tabs = [{ key: 'notices', label: '공지사항' }, ...ALLIANCES.map((a) => ({ key: a, label: a }))];

  return (
    <div className="story-community">
      <div className="story-tabs" role="tablist" aria-label="커뮤니티">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={mainTab === key}
            className={'story-tab' + (mainTab === key ? ' active' : '')}
            style={mainTab === key ? undefined : TAB_STYLE[key]}
            onClick={() => setMainTab(key)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="story-community-frame">
        {!isAlliance && <Noticeboard />}
        {isAlliance && (
          <div className="story-community-cols">
            <AllianceNoticeboard key={`notice-${mainTab}`} alliance={mainTab} />
            <Board key={`board-${mainTab}`} alliance={mainTab} />
          </div>
        )}
      </div>
    </div>
  );
}
