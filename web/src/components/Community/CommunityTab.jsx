import { useState } from 'react';
import { useI18n } from '../../i18n';
import { ALLIANCES } from '../../store';
import Noticeboard from './Noticeboard';
import AllianceNoticeboard from './AllianceNoticeboard';
import Board from './Board';

// CommunityTab — 커뮤니티 탭 컨테이너
// 메인탭: 공지사항 | KOR | NSL | JKY | GPX | UFO
// 연맹 탭 내 서브탭: 공지 | 게시판
export default function CommunityTab() {
  const { t } = useI18n();
  const [mainTab, setMainTab] = useState('notices');
  const [allianceSubTab, setAllianceSubTab] = useState('notice'); // 'notice' | 'board'

  const mainTabs = [
    { key: 'notices', label: t('tabNotices') || '공지사항' },
    ...ALLIANCES.map((a) => ({ key: a, label: a })),
  ];

  // 연맹 탭 변경 시 서브탭 초기화
  function handleMainTabChange(key) {
    setMainTab(key);
    if (ALLIANCES.includes(key)) setAllianceSubTab('notice');
  }

  const isAlliance = ALLIANCES.includes(mainTab);

  return (
    <div className="community-tab">
      {/* 메인 탭 */}
      <div className="sub-tab-nav">
        {mainTabs.map(({ key, label }) => (
          <button
            key={key}
            className={`sub-tab-btn${mainTab === key ? ' active' : ''}`}
            onClick={() => handleMainTabChange(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* 연맹 탭 선택 시 서브탭 표시 */}
      {isAlliance && (
        <div className="sub-tab-nav sub-tab-nav--secondary">
          <button
            className={`sub-tab-btn${allianceSubTab === 'notice' ? ' active' : ''}`}
            onClick={() => setAllianceSubTab('notice')}
          >
            📢 공지
          </button>
          <button
            className={`sub-tab-btn${allianceSubTab === 'board' ? ' active' : ''}`}
            onClick={() => setAllianceSubTab('board')}
          >
            📝 게시판
          </button>
        </div>
      )}

      {/* 콘텐츠 */}
      <div className="sub-tab-content">
        {mainTab === 'notices' && <Noticeboard />}
        {isAlliance && allianceSubTab === 'notice' && (
          <AllianceNoticeboard key={`notice-${mainTab}`} alliance={mainTab} />
        )}
        {isAlliance && allianceSubTab === 'board' && (
          <Board key={`board-${mainTab}`} alliance={mainTab} />
        )}
      </div>
    </div>
  );
}
