/// <reference types="vite/client" />
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary';
import { createAuthenticatedFetch } from './lib/authenticated-fetch';
import './index.css';

// 全局 Fetch 拦截器：自动处理 Electron 和浏览器开发模式下的 Token 注入
window.fetch = createAuthenticatedFetch({
  originalFetch: window.fetch,
  getAuthToken: () => window.inkflow?.getAuthToken?.(),
  // Local static E2E runs use a production Vite bundle but still need the
  // server's development token. Packaged/file-based builds never match this.
  isDev: import.meta.env.DEV || window.location.hostname === 'localhost',
  location: window.location,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
