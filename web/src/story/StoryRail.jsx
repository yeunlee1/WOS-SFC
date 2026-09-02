// 동화 버전의 책갈피 레일 — 탭 내비게이션. 모바일에서는 CSS 로 하단 바가 된다.
import { useStore } from '../store';
import Icon from './icons';

const TABS = [
  { id: 'battle', label: '전투현황', icon: 'sword' },
  { id: 'operation', label: '작전판', icon: 'map' },
  { id: 'community', label: '커뮤니티', icon: 'bookmark' },
  { id: 'chat', label: '채팅', icon: 'chat' },
];

export function storyTabs(user) {
  return user?.role === 'developer'
    ? [...TABS, { id: 'admin', label: '관리자', icon: 'shield' }]
    : TABS;
}

export function storyTabLabel(id) {
  return [...TABS, { id: 'admin', label: '관리자' }].find((t) => t.id === id)?.label ?? '';
}

export default function StoryRail({ activeTab, onTabChange }) {
  const user = useStore((s) => s.user);
  const tabs = storyTabs(user);

  return (
    <nav className="story-rail" aria-label="primary">
      <div className="story-rail-logo" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <path d="M8 32V10a3 3 0 0 1 3-3h13l8 8v17a3 3 0 0 1-3 3H11a3 3 0 0 1-3-3z" fill="#fffdf8" stroke="#3f3a4a" strokeWidth="2" />
          <path d="M14 20h12M14 25h8" stroke="#3f3a4a" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </div>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={'story-rail-item' + (activeTab === tab.id ? ' active' : '')}
          onClick={() => onTabChange(tab.id)}
          aria-label={tab.label}
          aria-current={activeTab === tab.id ? 'page' : undefined}
        >
          <Icon name={tab.icon} size={22} />
          <span aria-hidden="true">{tab.label}</span>
        </button>
      ))}
      <span className="story-rail-spacer" />
      <span className="story-rail-foot" aria-hidden="true">눈 내리는 왕국의 작전 일지</span>
    </nav>
  );
}
