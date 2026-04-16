import { useState, useEffect } from 'react';
import { useStore } from './store';
import { useSocket } from './hooks/useSocket';
import { useI18n } from './i18n';
import { api } from './api';
import AuthModal from './components/Auth/AuthModal';
import Header from './components/Layout/Header';
import OnlineList from './components/Dashboard/OnlineList';
import BattleTab from './components/Battle/BattleTab';
import CommunityTab from './components/Community/CommunityTab';
import ChatTab from './components/Chat/ChatTab';

export default function App() {
  const user      = useStore((s) => s.user);
  const token     = useStore((s) => s.token);
  const setUser   = useStore((s) => s.setUser);
  const clearUser = useStore((s) => s.clearUser);
  const setTimeOffset = useStore((s) => s.setTimeOffset);
  const { changeLang } = useI18n();
  const [activeTab, setActiveTab] = useState('dashboard');
  const [hydrating, setHydrating] = useState(!!token && !user);

  // 소켓 연결 (로그인 후 유지)
  useSocket(token);

  // 페이지 새로고침 시 유저 복원
  useEffect(() => {
    if (!token || user) { setHydrating(false); return; }
    (async () => {
      try {
        const me = await api.getMe();
        setUser(me.user, token);
        changeLang(me.user.language || 'ko');
        // 시간 동기화
        try {
          const localBefore = Date.now();
          const res = await api.getTime();
          setTimeOffset(res.utc - Math.round((localBefore + Date.now()) / 2));
        } catch { /* offset 0 유지 */ }
      } catch {
        clearUser(); // 토큰 만료 → 로그아웃
      } finally {
        setHydrating(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (hydrating) return null; // 복원 중 빈 화면 (깜빡임 방지)

  if (!user) {
    return <AuthModal />;
  }

  return (
    <div className="app-container">
      <Header activeTab={activeTab} onTabChange={setActiveTab} />
      <main className="tab-content">
        {activeTab === 'dashboard'  && <OnlineList />}
        {activeTab === 'battle'     && <BattleTab />}
        {activeTab === 'community'  && <CommunityTab />}
        {activeTab === 'chat'       && <ChatTab />}
      </main>
    </div>
  );
}
