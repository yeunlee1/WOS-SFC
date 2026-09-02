// 동화 버전(/story)의 루트. 세션 복원·소켓·시계 동기화 부트스트랩은 Task 4 에서 App.jsx 와 같게 채운다.
import { useEffect } from 'react';
import './story.css';

export default function StoryApp() {
  useEffect(() => {
    document.body.classList.add('story-body');
    const splash = document.getElementById('app-splash');
    if (splash) splash.remove();
    return () => document.body.classList.remove('story-body');
  }, []);

  return (
    <div className="story-root">
      <div className="story-paper" aria-hidden="true" />
    </div>
  );
}
