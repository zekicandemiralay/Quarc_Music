import { useState, useEffect, useRef } from 'react';

export default function useNetworkStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [serverOk, setServerOk] = useState(true);
  const intervalRef = useRef(null);

  async function pingServer() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      setServerOk(res.ok);
    } catch {
      setServerOk(false);
    }
  }

  useEffect(() => {
    function handleOnline() {
      setOnline(true);
      pingServer();
    }
    function handleOffline() {
      setOnline(false);
      setServerOk(false);
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    // Ping immediately, then every 30s
    pingServer();
    intervalRef.current = setInterval(pingServer, 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      clearInterval(intervalRef.current);
    };
  }, []);

  return { online, serverOk };
}
