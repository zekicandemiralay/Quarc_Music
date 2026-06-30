import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './i18n';
import { API_BASE } from './lib/apiUrl';

// When the APK bundles the frontend locally the WebView origin is
// capacitor://localhost, so relative /api/... fetches would fail.
// Prepend API_BASE (set to the server URL at build time) and include cookies.
if (API_BASE) {
  const _fetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (typeof url === 'string' && url.startsWith('/')) {
      return _fetch(API_BASE + url, { credentials: 'include', ...init });
    }
    if (typeof url === 'string' && url.startsWith(API_BASE)) {
      return _fetch(input, { credentials: 'include', ...init });
    }
    return _fetch(input, init);
  };
}

// Skip service worker registration in Capacitor (it loads from local bundle,
// not a web server, so SW registration would fail or behave unexpectedly).
if (!window?.Capacitor?.isNativePlatform?.() && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
