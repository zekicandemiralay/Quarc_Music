import { create } from 'zustand';

async function getJson(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Request failed');
  return data;
}

function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}
// iOS only allows Notification/Push APIs for a PWA actually installed to the
// home screen — a plain Safari tab silently lacks them, which otherwise
// looks identical to "unsupported" and gives no clue what to do about it.
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}

// Push services hand out the VAPID public key as a base64url string;
// pushManager.subscribe() needs it as raw bytes.
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

const useFriendsStore = create((set, get) => ({
  friends: [],            // [{id, username}]
  incomingRequests: [],   // [{id, userId, username, created_at}]
  outgoingRequests: [],   // [{id, userId, username, created_at}]
  activity: [],           // [{userId, username, nowPlaying, recentlyPlayed}]
  searchResults: [],      // [{id, username, status}]
  searching: false,
  loaded: false,
  // 'checking' | 'unsupported' | 'ios-needs-install' | 'default' | 'denied' | 'granted'
  pushStatus: 'checking',

  checkPushStatus: async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      set({ pushStatus: isIOS() && !isStandalone() ? 'ios-needs-install' : 'unsupported' });
      return;
    }
    if (Notification.permission === 'denied') { set({ pushStatus: 'denied' }); return; }
    if (Notification.permission !== 'granted') { set({ pushStatus: 'default' }); return; }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      set({ pushStatus: sub ? 'granted' : 'default' });
    } catch {
      set({ pushStatus: 'default' });
    }
  },

  enablePush: async () => {
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        set({ pushStatus: permission === 'denied' ? 'denied' : 'default' });
        return;
      }
      const { publicKey } = await getJson('/api/friends/push/public-key');
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });
      await getJson('/api/friends/push/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(sub.toJSON()),
      });
      set({ pushStatus: 'granted' });
    } catch (err) {
      console.error('enablePush failed:', err);
      set({ pushStatus: 'default' });
    }
  },

  disablePush: async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await getJson('/api/friends/push/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe();
      }
    } finally {
      set({ pushStatus: 'default' });
    }
  },

  load: async () => {
    try {
      const [friends, requests] = await Promise.all([
        getJson('/api/friends'),
        getJson('/api/friends/requests'),
      ]);
      set({
        friends,
        incomingRequests: requests.incoming,
        outgoingRequests: requests.outgoing,
        loaded: true,
      });
    } catch { /* keep whatever was already loaded */ }
    get().loadActivity();
  },

  // Called on an interval from the Friends page while it's open — kept
  // separate from load() so refreshing the feed doesn't also re-fetch
  // friends/requests every time.
  loadActivity: async () => {
    try {
      const activity = await getJson('/api/friends/activity');
      set({ activity });
    } catch { /* leave stale activity showing rather than clearing it */ }
  },

  reset: () => set({
    friends: [], incomingRequests: [], outgoingRequests: [], activity: [],
    searchResults: [], searching: false, loaded: false,
  }),

  search: async (q) => {
    const query = (q || '').trim();
    if (query.length < 2) { set({ searchResults: [] }); return; }
    set({ searching: true });
    try {
      const results = await getJson(`/api/friends/search?q=${encodeURIComponent(query)}`);
      set({ searchResults: results });
    } catch {
      set({ searchResults: [] });
    } finally {
      set({ searching: false });
    }
  },

  sendRequest: async (toUserId, toUsername) => {
    await getJson('/api/friends/requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ toUserId, toUsername }),
    });
    // Reflect it immediately in the search results dropdown without a refetch
    set((s) => ({
      searchResults: s.searchResults.map((u) => u.id === toUserId ? { ...u, status: 'pending_outgoing' } : u),
    }));
    get().load();
  },

  acceptRequest: async (requestId) => {
    await getJson(`/api/friends/requests/${requestId}/accept`, { method: 'POST' });
    get().load();
  },

  declineRequest: async (requestId) => {
    await getJson(`/api/friends/requests/${requestId}`, { method: 'DELETE' });
    get().load();
  },

  removeFriend: async (friendId) => {
    await getJson(`/api/friends/${friendId}`, { method: 'DELETE' });
    get().load();
  },
}));

export default useFriendsStore;
