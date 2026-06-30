import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import {ErrorBoundary} from './components/ErrorBoundary';
import './index.css';

// 全局 Fetch 拦截器：自动处理 Electron 和浏览器开发模式下的 Token 注入
const originalFetch = window.fetch;
let cachedDevToken: string | undefined = undefined;

window.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // 排除免签的 SSE 和自举 Token 接口，防止死锁
  if (url.includes('/api/') && !url.includes('/api/db/events') && !url.includes('/api/dev-auth-token')) {
    let token = await window.inkflow?.getAuthToken?.();

    // 如果在非 Electron 的开发环境下，使用自举的缓存 Token
    if (!token && (import.meta as any).env?.DEV) {
      if (!cachedDevToken) {
        try {
          const res = await originalFetch('/api/dev-auth-token');
          if (res.ok) {
            const data = await res.json();
            cachedDevToken = data.token;
          }
        } catch (err) {
          console.error('Failed to bootstrap dev auth token:', err);
        }
      }
      token = cachedDevToken;
    }

    if (token) {
      const headers = new Headers(init?.headers);
      headers.set('Authorization', `Bearer ${token}`);
      return originalFetch(input, { ...init, headers });
    }
  }
  return originalFetch(input, init);
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
