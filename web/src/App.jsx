import { useState } from 'react';
import { useStore } from './store';
import { useSocket } from './hooks/useSocket';
import AuthModal from './components/Auth/AuthModal';
import Header from './components/Layout/Header';
import OnlineList from './components/Dashboard/OnlineList';
import BattleTab from './components/Battle/BattleTab';
import CommunityTab from './components/Community/CommunityTab';
import ChatTab from './components/Chat/ChatTab';

export default function App() {
  const { user, token } = useStore();
  const [activeTab, setActiveTab] = useState('dashboard');

  // 소켓 연결 (로그인 후 유지)
  useSocket(token);

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
