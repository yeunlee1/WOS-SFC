import { useState, useEffect } from 'react';
import { useStore } from './store';
import { useSocket } from './hooks/useSocket';
import { useResizable } from './hooks/useResizable';
import { useI18n } from './i18n';
import { api } from './api';
import AuthModal from './components/Auth/AuthModal';
import Petals from './components/Layout/Petals';
import Header from './components/Layout/Header';
import OnlinePanel from './components/Layout/OnlinePanel';
import BattleTab from './components/Battle/BattleTab';
import CommunityTab from './components/Community/CommunityTab';
import ChatTab from './components/Chat/ChatTab';

export default function App() {
  const user      = useStore((s) => s.user);
  const setUser   = useStore((s) => s.setUser);
  const clearUser = useStore((s) => s.clearUser);
  const setTimeOffset = useStore((s) => s.setTimeOffset);
  const { changeLang } = useI18n();
  const [activeTab, setActiveTab] = useState('battle');
  const [hydrating, setHydrating] = useState(true);
  const [isOnlineOpen, setIsOnlineOpen] = useState(false);
  const { size: sidebarWidth, handleMouseDown: startSidebarResize } =
    useResizable('wos-sidebar-width', 200, { min: 150, max: 450 });

  useSocket(user);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.getMe();
        setUser(me.user);
        changeLang(me.user.language || 'ko');
        try {
          const localBefore = Date.now();
          const res = await api.getTime();
          setTimeOffset(res.utc - Math.round((localBefore + Date.now()) / 2));
        } catch { /* offset 0 유지 */ }
      } catch {
        // 유효한 세션 없음 — 로그인 화면 표시
      } finally {
        setHydrating(false);
      }
    })();

    const handleExpiry = () => clearUser();
    window.addEventListener('auth:expired', handleExpiry);
    return () => window.removeEventListener('auth:expired', handleExpiry);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (hydrating) return null;

  if (!user) {
    return <><Petals /><AuthModal /></>;
  }

  return (
    <div className="app-container">
      <Petals />
      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onToggleOnline={() => setIsOnlineOpen((v) => !v)}
      />
      <div className="main-with-sidebar">
        <main className="tab-content">
          {activeTab === 'battle'    && <BattleTab />}
          {activeTab === 'community' && <CommunityTab />}
          {activeTab === 'chat'      && <ChatTab />}
        </main>
        <div
          className="resize-handle resize-handle--vertical"
          onMouseDown={startSidebarResize}
        />
        {/* 모바일: 오버레이 클릭으로 사이드바 닫기 */}
        {isOnlineOpen && (
          <div className="online-overlay" onClick={() => setIsOnlineOpen(false)} />
        )}
        <OnlinePanel style={{ width: sidebarWidth }} isOpen={isOnlineOpen} />
      </div>
    </div>
  );
}
