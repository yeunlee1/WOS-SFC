import { useState, useEffect } from 'react';
import { useStore } from './store';
import { useSocket } from './hooks/useSocket';
import { useReadyProbe } from './hooks/useReadyProbe';
import { useResizable } from './hooks/useResizable';
import { useI18n } from './i18n';
import { api, getSocket } from './api';
import { syncTime, startup, shutdown } from './clockSync';
import AuthModal from './components/Auth/AuthModal';
import { warmupRallyAudio } from './components/Battle/rallyGroupPlayer';
import Petals from './components/Layout/Petals';
import SnowCanvas from './components/Layout/SnowCanvas';
import BlossomCanvas from './components/Layout/BlossomCanvas';
import Header from './components/Layout/Header';
import OnlinePanel from './components/Layout/OnlinePanel';
import IconRail from './components/Layout/IconRail';
import UserPopover from './components/Layout/UserPopover';
import CommandPalette from './components/Layout/CommandPalette';
import BattleTab from './components/Battle/BattleTab';
import CommunityTab from './components/Community/CommunityTab';
import ChatTab from './components/Chat/ChatTab';
import ChatDock from './components/Chat/ChatDock';
import AdminTab from './components/AdminTab/AdminTab';

// chatDockOpen 초기값 — localStorage 우선, 없으면 false (도크 닫힘)
function _initChatDockOpen() {
  try {
    return localStorage.getItem('wos-chat-dock-open') === '1';
  } catch {
    return false;
  }
}

export default function App() {
  const user      = useStore((s) => s.user);
  const setUser   = useStore((s) => s.setUser);
  const clearUser = useStore((s) => s.clearUser);
  const theme     = useStore((s) => s.theme);
  const { changeLang } = useI18n();
  const [activeTab, setActiveTab] = useState('battle');
  const [hydrating, setHydrating] = useState(true);
  const [isOnlineOpen, setIsOnlineOpen] = useState(_initChatDockOpen);
  const [cmdkOpen, setCmdkOpen] = useState(false);
  const [userPopOpen, setUserPopOpen] = useState(false);
  const [railOpen, setRailOpen] = useState(false);
  const { size: sidebarWidth, handleMouseDown: startSidebarResize } =
    useResizable('wos-sidebar-width', 200, { min: 150, max: 450 });

  useSocket(user);
  useReadyProbe(user);

  // 테마 클래스를 <body>에 적용 — CSS 변수 cascade 기반 전역 전환.
  // frost(메인) + spring(후속 리뉴얼). anthropic/dark는 폐기됨.
  useEffect(() => {
    const THEME_CLASSES = ['theme-frost', 'theme-spring'];
    document.body.classList.remove(...THEME_CLASSES);
    document.body.classList.add(`theme-${theme}`);
  }, [theme]);

  // chatDockOpen(=isOnlineOpen) 상태 localStorage 동기화
  useEffect(() => {
    try {
      localStorage.setItem('wos-chat-dock-open', isOnlineOpen ? '1' : '0');
    } catch { /* 무시 */ }
  }, [isOnlineOpen]);

  // 새로고침 splash 제거 — index.html에 인라인된 #app-splash가 React mount 전에 즉시 보임.
  // 첫 effect 실행(=React 마운트 + 첫 paint 직후)에 fade out → 320ms 후 DOM 제거.
  useEffect(() => {
    const splash = document.getElementById('app-splash');
    if (!splash) return;
    splash.classList.add('app-splash--leaving');
    const t = setTimeout(() => { splash.remove(); }, 360);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const me = await api.getMe();
        setUser(me.user);
        changeLang(me.user.language || 'ko');
        // 세션 복원 경로에서도 rally audio 사전 워밍업 — fire-and-forget.
        // ensureContext()는 사용자 제스처 없어도 AudioContext 생성 가능(suspended 상태).
        // fetch + decodeAudioData는 suspended에서도 동작하므로 bufferCache는 채워진다.
        // 이후 사용자 첫 클릭에서 global unlock 핸들러가 ctx.resume → 즉시 재생 가능.
        // 새로고침 후 첫 카운트다운 시작 시 누락되던 케이스 방지.
        warmupRallyAudio({ lang: me.user.language || 'ko' }).catch(() => { /* noop */ });
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

  // ─── 글로벌 키보드 단축키 ───
  // ⌘K / Ctrl+K: Command Palette 토글
  // C: Chat dock 토글 (input/textarea/select 포커스 시 무시)
  useEffect(() => {
    if (!user) return;
    function handler(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setCmdkOpen((o) => !o);
        return;
      }
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.toLowerCase() === 'c') {
        e.preventDefault();
        setIsOnlineOpen((o) => !o);
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [user]);

  // ─── UserPopover 외부 클릭 닫기 ───
  // setTimeout(0)으로 popover 자기 자신 click이 등록 후 발생하는 경합 회피.
  useEffect(() => {
    if (!userPopOpen) return;
    function handler() { setUserPopOpen(false); }
    const id = setTimeout(() => document.addEventListener('click', handler), 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener('click', handler);
    };
  }, [userPopOpen]);

  if (hydrating) return null;

  if (!user) {
    return <><Petals />{theme === 'frost' && <SnowCanvas />}{theme === 'spring' && <BlossomCanvas />}<AuthModal /></>;
  }

  // dock(=OnlinePanel) 실제 표시 여부: chat 탭에서는 풀페이지가 이미 채팅이므로 도크 비활성
  const dockActuallyOpen = isOnlineOpen && activeTab !== 'chat';

  return (
    <>
      {theme === 'spring' && <Petals />}
      {theme === 'frost' && <SnowCanvas />}
      {theme === 'spring' && <BlossomCanvas />}
      <div className={'app-container console' + (dockActuallyOpen ? ' console--with-dock' : '')}>
        <IconRail
          activeTab={activeTab}
          onTabChange={setActiveTab}
          chatDockOpen={isOnlineOpen}
          onToggleChatDock={() => setIsOnlineOpen((o) => !o)}
          onOpenCmdk={() => setCmdkOpen(true)}
          onToggleUserPopover={() => setUserPopOpen((o) => !o)}
          railOpen={railOpen}
          onCloseRail={() => setRailOpen(false)}
        />
        <div className="canvas">
          <Header
            activeTab={activeTab}
            chatDockOpen={isOnlineOpen}
            onTabChange={setActiveTab}
            onToggleOnline={() => setIsOnlineOpen((v) => !v)}
            onOpenRail={() => setRailOpen(true)}
            onOpenCmdk={() => setCmdkOpen(true)}
          />
          <main className="tab-content">
            {activeTab === 'battle'    && <BattleTab />}
            {activeTab === 'community' && <CommunityTab />}
            {activeTab === 'chat'      && <ChatTab />}
            {activeTab === 'admin' && user?.role === 'developer' && <AdminTab />}
          </main>
        </div>
        {dockActuallyOpen && (
          <ChatDock onClose={() => setIsOnlineOpen(false)} />
        )}
        {/* 모바일: 오버레이 클릭으로 사이드바 닫기 */}
        {isOnlineOpen && activeTab !== 'chat' && (
          <div className="online-overlay" onClick={() => setIsOnlineOpen(false)} />
        )}
      </div>

      {/* 모바일 rail 오버레이 */}
      <div
        className={'mobile-overlay' + (railOpen ? ' is-open' : '')}
        onClick={() => setRailOpen(false)}
        aria-hidden
      />

      {/* User Popover — 외부 클릭/Escape로 닫힘 */}
      {userPopOpen && (
        <UserPopover onClose={() => setUserPopOpen(false)} />
      )}

      {/* Command Palette — ⌘K로 호출 */}
      <CommandPalette
        open={cmdkOpen}
        onClose={() => setCmdkOpen(false)}
        onTabChange={setActiveTab}
        onToggleChatDock={() => setIsOnlineOpen((o) => !o)}
      />
    </>
  );
}
