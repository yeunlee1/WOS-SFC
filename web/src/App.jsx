import { useState, useEffect } from 'react';
import { useStore } from './store';
import { useSocket } from './hooks/useSocket';
import { useResizable } from './hooks/useResizable';
import { useI18n } from './i18n';
import { api, getSocket } from './api';
import { syncTime, startPeriodicSync, stopPeriodicSync } from './timeSync';
import AuthModal from './components/Auth/AuthModal';
import Petals from './components/Layout/Petals';
import Header from './components/Layout/Header';
import OnlinePanel from './components/Layout/OnlinePanel';
import BattleTab from './components/Battle/BattleTab';
import CommunityTab from './components/Community/CommunityTab';
import ChatTab from './components/Chat/ChatTab';
import AdminTab from './components/AdminTab/AdminTab';

export default function App() {
  const user      = useStore((s) => s.user);
  const setUser   = useStore((s) => s.setUser);
  const clearUser = useStore((s) => s.clearUser);
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
        // SNTP 다중 샘플 동기화 (마운트 시 첫 동기화)
        try {
          await syncTime();
        } catch { /* offset 0 유지 */ }
      } catch {
        // 유효한 세션 없음 — 로그인 화면 표시
      } finally {
        setHydrating(false);
      }
    })();

    // 30초마다 주기적 재동기화
    startPeriodicSync(30_000);

    // 소켓 reconnect 시 재동기화 — 네트워크 단절 후 복구 시 drift 보정
    let _syncOnConnect = null;
    function _attachSocketSync() {
      const sock = getSocket();
      if (!sock) return;
      // 이전 리스너 제거 후 등록 (중복 방지)
      if (_syncOnConnect) sock.off('connect', _syncOnConnect);
      _syncOnConnect = () => {
        syncTime().catch(() => {});
      };
      sock.on('connect', _syncOnConnect);
    }
    // connectSocket()은 useSocket(user)에서 이미 호출되므로 getSocket()으로 참조
    // user가 있으면 바로 부착, 없으면 소켓 생성 전이므로 skip (로그인 후 재마운트 시 실행됨)
    _attachSocketSync();

    const handleExpiry = () => clearUser();
    window.addEventListener('auth:expired', handleExpiry);
    return () => {
      window.removeEventListener('auth:expired', handleExpiry);
      stopPeriodicSync();
      const sock = getSocket();
      if (sock && _syncOnConnect) sock.off('connect', _syncOnConnect);
    };
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
          {activeTab === 'admin' && user?.role === 'developer' && <AdminTab />}
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
