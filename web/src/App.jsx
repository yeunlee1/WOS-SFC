import { useState, useEffect } from 'react';
import { useStore } from './store';
import { useSocket } from './hooks/useSocket';
import { useReadyProbe } from './hooks/useReadyProbe';
import { useResizable } from './hooks/useResizable';
import { useI18n } from './i18n';
import { api, getSocket } from './api';
import { syncTime, startup, shutdown } from './clockSync';
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
  const theme     = useStore((s) => s.theme);
  const { changeLang } = useI18n();
  const [activeTab, setActiveTab] = useState('battle');
  const [hydrating, setHydrating] = useState(true);
  const [isOnlineOpen, setIsOnlineOpen] = useState(false);
  const { size: sidebarWidth, handleMouseDown: startSidebarResize } =
    useResizable('wos-sidebar-width', 200, { min: 150, max: 450 });

  useSocket(user);
  useReadyProbe(user);

  // 테마 클래스를 <body>에 적용 — CSS 변수 cascade 기반 전역 전환
  useEffect(() => {
    const THEME_CLASSES = ['theme-spring', 'theme-anthropic', 'theme-dark'];
    document.body.classList.remove(...THEME_CLASSES);
    document.body.classList.add(`theme-${theme}`);
  }, [theme]);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.getMe();
        setUser(me.user);
        changeLang(me.user.language || 'ko');
        // clockSync 부팅 — 첫 동기화 + 주기적 재동기화 + system clock 점프 감지 + 멀티탭 채널
        try {
          await startup();
        } catch { /* offset 0 유지 */ }
      } catch {
        // 유효한 세션 없음 — 로그인 화면 표시
      } finally {
        setHydrating(false);
      }
    })();

    // 탭 복귀 시 재동기화 — 백그라운드 체류로 인한 drift 보정
    function onVisible() {
      if (document.visibilityState === 'visible') {
        syncTime().catch(() => {});
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    const handleExpiry = () => clearUser();
    window.addEventListener('auth:expired', handleExpiry);
    return () => {
      window.removeEventListener('auth:expired', handleExpiry);
      document.removeEventListener('visibilitychange', onVisible);
      shutdown();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 소켓 reconnect 시 재동기화 — user 로그인 이후 소켓이 생성된 뒤에 리스너 부착
  // (마운트 시점엔 user가 없어 getSocket()이 null일 수 있으므로 user 변경 감지 effect로 분리)
  useEffect(() => {
    if (!user) return;
    const sock = getSocket();
    if (!sock) return;
    const syncOnConnect = () => { syncTime().catch(() => {}); };
    sock.on('connect', syncOnConnect);
    return () => {
      sock.off('connect', syncOnConnect);
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

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
