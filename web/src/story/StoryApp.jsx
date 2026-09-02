// 동화 버전(/story)의 루트 — App.jsx 와 같은 세션 복원·소켓·시계 동기화 부트스트랩 위에 새 껍데기를 올린다.
import { useEffect, useState } from 'react';
import './story.css';
import { useStore } from '../store';
import { useSocket } from '../hooks/useSocket';
import { useReadyProbe } from '../hooks/useReadyProbe';
import { useI18n } from '../i18n';
import { api, getSocket, disconnectSocket } from '../api';
import { syncTime, startup, shutdown } from '../clockSync';
import { warmupRallyAudio } from '../components/Battle/rallyGroupPlayer';
import ChatTab from '../components/Chat/ChatTab';
import OperationBoardTab from '../components/OperationBoard/OperationBoardTab';
import AdminTab from '../components/AdminTab/AdminTab';
import StoryEntrance from './StoryEntrance';
import StoryShell from './StoryShell';
import StoryBattle from './StoryBattle';
import StoryCommunity from './StoryCommunity';

export default function StoryApp() {
  const user = useStore((s) => s.user);
  const setUser = useStore((s) => s.setUser);
  const clearUser = useStore((s) => s.clearUser);
  const { lang, changeLang } = useI18n();
  const [activeTab, setActiveTab] = useState('battle');
  const [hydrating, setHydrating] = useState(true);

  useSocket(user, lang);
  useReadyProbe(user);

  // 동화 버전 전용 body 클래스와 index.html 의 splash 제거.
  useEffect(() => {
    document.body.classList.add('story-body');
    const splash = document.getElementById('app-splash');
    if (splash) splash.remove();
    return () => document.body.classList.remove('story-body');
  }, []);

  // 세션 복원 — App.jsx 82~120줄과 같은 흐름.
  useEffect(() => {
    (async () => {
      try {
        const me = await api.getMe();
        setUser(me.user);
        changeLang(me.user.language || 'ko');
        warmupRallyAudio({ lang: me.user.language || 'ko' }).catch(() => {
          /* noop */
        });
      } catch {
        // 유효한 세션 없음 — 입구 표시
      } finally {
        setHydrating(false);
      }
    })();

    function onVisible() {
      if (document.visibilityState === 'visible') {
        if (useStore.getState().user) syncTime().catch(() => {});
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    const handleExpiry = () => {
      disconnectSocket();
      clearUser();
    };
    window.addEventListener('auth:expired', handleExpiry);
    return () => {
      window.removeEventListener('auth:expired', handleExpiry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 시계 동기화 수명주기 — 로그인 시 시작, 로그아웃 시 정리.
  useEffect(() => {
    if (!user) {
      shutdown();
      return undefined;
    }
    startup().catch(() => {
      /* offset 0 유지 */
    });
    return () => shutdown();
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 소켓 재연결 시 재동기화.
  useEffect(() => {
    if (!user) return undefined;
    const sock = getSocket();
    if (!sock) return undefined;
    const syncOnConnect = () => {
      syncTime().catch(() => {});
    };
    sock.on('connect', syncOnConnect);
    return () => {
      sock.off('connect', syncOnConnect);
    };
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (hydrating) {
    return (
      <div className="story-root">
        <div className="story-paper" aria-hidden="true" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="story-root">
        <div className="story-paper" aria-hidden="true" />
        <StoryEntrance />
      </div>
    );
  }

  return (
    <div className="story-root">
      <div className="story-paper" aria-hidden="true" />
      <StoryShell activeTab={activeTab} onTabChange={setActiveTab}>
        {activeTab === 'battle' && <StoryBattle />}
        {activeTab === 'operation' && <OperationBoardTab />}
        {activeTab === 'community' && <StoryCommunity />}
        {activeTab === 'chat' && <ChatTab />}
        {activeTab === 'admin' && user.role === 'developer' && <AdminTab />}
      </StoryShell>
    </div>
  );
}
