import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { I18nProvider } from './i18n';
import { resolveEntry } from './entry';

// 두 앱은 서로의 CSS 를 로드하지 않는다 — 각 앱이 자기 스타일을 import 하고,
// lazy 로 청크가 갈려 /story 에서는 기존 style.css 가, / 에서는 story.css 가 내려오지 않는다.
const Root =
  resolveEntry(window.location.pathname) === 'story'
    ? React.lazy(() => import('./story/StoryApp'))
    : React.lazy(() => import('./App'));

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <I18nProvider>
      <Suspense fallback={null}>
        <Root />
      </Suspense>
    </I18nProvider>
  </React.StrictMode>
);
