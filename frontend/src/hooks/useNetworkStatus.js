import { useState, useEffect, useRef } from 'react';

export default function useNetworkStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  const [serverOk, setServerOk] = useState(true);
  // While recovering after screen unlock, suppress the error banner so users
  // don't see a flash of "not reachable" while Tailscale is reconnecting.
  const [recovering, setRecovering] = useState(false);
  const intervalRef  = useRef(null);
  const recoverTimer = useRef(null);

  async function pingServer() {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      setServerOk(res.ok);
      if (res.ok) setRecovering(false);
      return res.ok;
    } catch {
      setServerOk(false);
      return false;
    }
  }

  useEffect(() => {
    function handleOnline()  { setOnline(true);  pingServer(); }
    function handleOffline() { setOnline(false); setServerOk(false); }

    async function handleVisibilityChange() {
      if (document.visibilityState !== 'visible') return;
      // Entering foreground: suppress banner and retry pings so Tailscale
      // has time to reconnect before the user sees an error.
      setRecovering(true);
      clearTimeout(recoverTimer.current);
      // Stop suppressing after 8 s regardless, so a genuine outage still shows.
      recoverTimer.current = setTimeout(() => setRecovering(false), 8000);

      const ok = await pingServer();
      if (!ok) {
        setTimeout(async () => {
          const ok2 = await pingServer();
          if (!ok2) setTimeout(pingServer, 2500);
        }, 1500);
      }
    }

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    pingServer();
    intervalRef.current = setInterval(pingServer, 30_000);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(intervalRef.current);
      clearTimeout(recoverTimer.current);
    };
  }, []);

  // While recovering, report serverOk=true to suppress the banner
  return { online, serverOk: recovering ? true : serverOk };
}
