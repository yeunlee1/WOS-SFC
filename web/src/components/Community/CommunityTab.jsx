import { useState } from 'react';
import { useI18n } from '../../i18n';
import { ALLIANCES } from '../../store';
import Noticeboard from './Noticeboard';
import Board from './Board';

// CommunityTab — 커뮤니티 탭 컨테이너
// 서브탭: notices | board-KOR | board-NSL | board-JKY | board-GPX | board-UFO
export default function CommunityTab() {
  const { t } = useI18n();
  const [subTab, setSubTab] = useState('notices');

  const tabs = [
    { key: 'notices', label: t('tabNotices') },
    ...ALLIANCES.map((a) => ({ key: `board-${a}`, label: a })),
  ];

  return (
    <div className="community-tab">
      {/* 서브탭 네비 */}
      <div className="sub-tab-nav">
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            className={`sub-tab-btn${subTab === key ? ' active' : ''}`}
            onClick={() => setSubTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 콘텐츠 */}
      <div className="sub-tab-content">
        {subTab === 'notices' && <Noticeboard />}
        {ALLIANCES.map((a) =>
          subTab === `board-${a}` ? <Board key={a} alliance={a} /> : null
        )}
      </div>
    </div>
  );
}
